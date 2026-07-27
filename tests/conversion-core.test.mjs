import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fitsDisplay, flattenGds, parseGds, placedBoundsOf } from "../lib/gds.js";
import { buildGooFile, encodeBinaryLayer, validateGooFile } from "../lib/goo.js";
import { createCalibrationShapes, parseExposureSeries } from "../lib/calibration.js";
import { createRunManifest } from "../lib/manifest.js";
import { createMonochromePreview, rasterizeBinaryMask } from "../lib/raster.js";

function record(type, dataType, payload = []) {
  const length = payload.length + 4;
  return [length >> 8, length & 255, type, dataType, ...payload];
}

function int16(value) { return [(value >> 8) & 255, value & 255]; }
function int32(value) { return [(value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255]; }
function text(value) { const bytes = [...Buffer.from(value)]; return bytes.length % 2 ? [...bytes, 0] : bytes; }
function real8(input) {
  if (!input) return Array(8).fill(0);
  const bytes = Array(8).fill(0);
  let value = Math.abs(input);
  let exponent = 64;
  while (value >= 1) { value /= 16; exponent += 1; }
  while (value < 1 / 16) { value *= 16; exponent -= 1; }
  bytes[0] = (input < 0 ? 0x80 : 0) | exponent;
  let mantissa = BigInt(Math.round(value * 2 ** 56));
  for (let index = 7; index >= 1; index -= 1) {
    bytes[index] = Number(mantissa & 255n);
    mantissa >>= 8n;
  }
  return bytes;
}

function decodeGooLayerIndependently(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const layerStart = 0x2fb95;
  const encodedLength = view.getUint32(layerStart + 66, false) - 2;
  let offset = layerStart + 71;
  const end = offset + encodedLength;
  const pixels = [];
  while (offset < end) {
    const head = bytes[offset++];
    const color = head >> 6;
    if (color !== 0 && color !== 3) throw new Error(`Unsupported golden-test GOO color code ${color}.`);
    const byteCount = (head >> 4) & 3;
    let runLength = head & 0x0f;
    if (byteCount === 1) runLength += bytes[offset++] << 4;
    else if (byteCount === 2) runLength += (bytes[offset++] << 12) + (bytes[offset++] << 4);
    else if (byteCount === 3) runLength += (bytes[offset++] << 20) + (bytes[offset++] << 12) + (bytes[offset++] << 4);
    for (let index = 0; index < runLength; index += 1) pixels.push(color === 3 ? 1 : 0);
  }
  return Uint8Array.from(pixels);
}

test("parses and flattens a minimal GDSII boundary", () => {
  const xy = [[0, 0], [1000, 0], [1000, 2000], [0, 2000], [0, 0]].flatMap(([x, y]) => [...int32(x), ...int32(y)]);
  const bytes = new Uint8Array([
    ...record(0x05, 0x02, Array(24).fill(0)),
    ...record(0x06, 0x06, [...Buffer.from("TOP"), 0]),
    ...record(0x08, 0x00),
    ...record(0x0d, 0x02, int16(7)),
    ...record(0x0e, 0x02, int16(0)),
    ...record(0x10, 0x03, xy),
    ...record(0x11, 0x00),
    ...record(0x07, 0x00),
  ]);
  const model = parseGds(bytes.buffer);
  const shapes = flattenGds(model, "TOP");
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].layer, 7);
  assert.deepEqual(shapes[0].points[2], { x: 1, y: 2 });
});

test("parses a hierarchical GDSII stream with physical units, references, PATH and BOX", () => {
  const boundary = [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]].flatMap(([x, y]) => [...int32(x), ...int32(y)]);
  const box = [[2000, 0], [3000, 0], [3000, 1000], [2000, 1000], [2000, 0]].flatMap(([x, y]) => [...int32(x), ...int32(y)]);
  const path = [[0, 3000], [4000, 3000]].flatMap(([x, y]) => [...int32(x), ...int32(y)]);
  const bytes = new Uint8Array([
    ...record(0x00, 0x02, int16(600)),
    ...record(0x01, 0x02, Array(24).fill(0)),
    ...record(0x02, 0x06, text("TESTLIB")),
    ...record(0x03, 0x05, [...real8(0.001), ...real8(1e-9)]),
    ...record(0x05, 0x02, Array(24).fill(0)),
    ...record(0x06, 0x06, text("CHILD")),
    ...record(0x08, 0x00), ...record(0x0d, 0x02, int16(1)), ...record(0x0e, 0x02, int16(0)), ...record(0x10, 0x03, boundary), ...record(0x11, 0x00),
    ...record(0x09, 0x00), ...record(0x0d, 0x02, int16(2)), ...record(0x0f, 0x03, int32(2000)), ...record(0x21, 0x02, int16(1)), ...record(0x10, 0x03, path), ...record(0x11, 0x00),
    ...record(0x2d, 0x00), ...record(0x0d, 0x02, int16(3)), ...record(0x2e, 0x02, int16(0)), ...record(0x10, 0x03, box), ...record(0x11, 0x00),
    ...record(0x07, 0x00),
    ...record(0x05, 0x02, Array(24).fill(0)),
    ...record(0x06, 0x06, text("TOP")),
    ...record(0x0a, 0x00), ...record(0x12, 0x06, text("CHILD")), ...record(0x1b, 0x05, real8(2)), ...record(0x1c, 0x05, real8(90)), ...record(0x10, 0x03, [...int32(10000), ...int32(20000)]), ...record(0x11, 0x00),
    ...record(0x0b, 0x00), ...record(0x12, 0x06, text("CHILD")), ...record(0x13, 0x02, [...int16(2), ...int16(2)]), ...record(0x10, 0x03, [[-20000, -20000], [0, -20000], [-20000, 0]].flatMap(([x, y]) => [...int32(x), ...int32(y)])), ...record(0x11, 0x00),
    ...record(0x07, 0x00),
    ...record(0x04, 0x00),
  ]);
  const model = parseGds(bytes.buffer);
  assert.ok(Math.abs(model.unitMicrometers - 0.001) < 1e-12);
  assert.deepEqual(model.topCells, ["TOP"]);
  const shapes = flattenGds(model, "TOP");
  assert.equal(shapes.length, 15);
  assert.equal(shapes.filter((shape) => shape.layer === 1).length, 5);
  assert.equal(shapes.find((shape) => shape.layer === 2 && shape.width === 4)?.pathType, 1);
  const rotatedBoundary = shapes.find((shape) => shape.layer === 1 && shape.points.some((point) => point.y === 22));
  assert.deepEqual(rotatedBoundary?.points, [{ x: 10, y: 20 }, { x: 10, y: 22 }, { x: 8, y: 22 }, { x: 8, y: 20 }]);
});

test("encodes a binary layer and validates the resulting GOO container", () => {
  const rows = [new Uint8Array([0, 0, 1, 1]), new Uint8Array([1, 0, 0, 0])];
  const encoded = encodeBinaryLayer((y) => rows[y], 4, 2);
  assert.deepEqual([...encoded.data], [2, 195, 3]);
  assert.equal(encoded.checksum, 55);
  const goo = buildGooFile({ layerData: encoded.data, exposureSeconds: 9, whitePixels: encoded.whitePixels });
  const result = validateGooFile(goo, 8);
  assert.equal(result.pixels, 8);
  assert.equal(encoded.whitePixels, 3);
  assert.deepEqual([...decodeGooLayerIndependently(goo)], [...rows.flatMap((row) => [...row])]);
});

test("rasterizes native pixels with a stable pixel-centre rule", () => {
  const shape = {
    kind: "polygon",
    layer: 1,
    datatype: 0,
    width: 0,
    pathType: 0,
    points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
  };
  const settings = { anchor: "gds-origin", offsetX: 0, offsetY: 0, rotation: 0, mirrorX: false, mirrorY: false, inverted: false };
  const pixels = rasterizeBinaryMask([shape], settings, { width: 8, height: 6, pixelMicrometers: 1 });
  assert.deepEqual([
    ...Array.from({ length: 6 }, (_, y) => [...pixels.subarray(y * 8, (y + 1) * 8)].join("")),
  ], ["00000000", "00001100", "00001100", "00000000", "00000000", "00000000"]);

  const inverted = rasterizeBinaryMask([shape], { ...settings, inverted: true }, { width: 8, height: 6, pixelMicrometers: 1 });
  assert.equal(inverted.every((value, index) => value === 1 - pixels[index]), true);

  const preview = createMonochromePreview(pixels, 8, 6, 4, 4);
  assert.deepEqual([...preview], [0, 0, 0, 0, 0, 0, 0xffff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const invertedPreview = createMonochromePreview(inverted, 8, 6, 4, 4, 1);
  assert.deepEqual([...invertedPreview], [...preview].map((value) => 0xffff - value));
});

test("rasterizes GDS path end styles without antialiasing", () => {
  const settings = { anchor: "gds-origin", offsetX: 0, offsetY: 0, rotation: 0, mirrorX: false, mirrorY: false, inverted: false };
  const path = {
    kind: "path",
    layer: 1,
    datatype: 0,
    width: 2,
    pathType: 0,
    points: [{ x: -2, y: 0 }, { x: 2, y: 0 }],
  };
  const butt = rasterizeBinaryMask([path], settings, { width: 8, height: 6, pixelMicrometers: 1 });
  const square = rasterizeBinaryMask([{ ...path, pathType: 2 }], settings, { width: 8, height: 6, pixelMicrometers: 1 });
  const round = rasterizeBinaryMask([{ ...path, pathType: 1 }], settings, { width: 8, height: 6, pixelMicrometers: 1 });
  assert.equal(butt.reduce((sum, value) => sum + value, 0), 8);
  assert.equal(square.reduce((sum, value) => sum + value, 0), 12);
  assert.equal(round.reduce((sum, value) => sum + value, 0), 12);
});

test("keeps a fixed GOO byte-level golden reference", () => {
  const rows = [new Uint8Array([0, 0, 1, 1]), new Uint8Array([1, 0, 0, 0])];
  const encoded = encodeBinaryLayer((y) => rows[y], 4, 2);
  const goo = buildGooFile({
    layerData: encoded.data,
    exposureSeconds: 9,
    whitePixels: encoded.whitePixels,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
  });
  assert.equal(createHash("sha256").update(goo).digest("hex"), "0b3cd313b3f63f457ef8100b91a4477ca4be1f9cd16d306cf3f5a2d59800fd3f");
});

test("validates placement after anchor, rotation and offsets", () => {
  const shapes = [{
    kind: "polygon",
    layer: 1,
    datatype: 0,
    width: 0,
    pathType: 0,
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 2000 }, { x: 0, y: 2000 }],
  }];
  const settings = { anchor: "lower-left", offsetX: 0, offsetY: 0, rotation: 90, mirrorX: false, mirrorY: false };
  assert.deepEqual(placedBoundsOf(shapes, settings), { minX: -2000, minY: 0, maxX: 0, maxY: 1000, width: 2000, height: 1000 });
  assert.equal(fitsDisplay(shapes, settings, 4000, 2000), true);
  assert.equal(fitsDisplay(shapes, { ...settings, offsetX: -1 }, 4000, 2000), false);
});

test("creates a bounded 18–180 µm calibration pattern and validates its exposure series", () => {
  const shapes = createCalibrationShapes();
  assert.equal(shapes.length, 140);
  assert.deepEqual([...new Set(shapes.map((shape) => shape.layer))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(shapes.every((shape) => shape.points.every((point) => point.x % 18 === 0 && point.y % 18 === 0)), true);
  assert.equal(fitsDisplay(shapes, { anchor: "center", offsetX: 0, offsetY: 0, rotation: 0, mirrorX: false, mirrorY: false }, 153360, 77760), true);
  assert.deepEqual(parseExposureSeries("11, 5, 9, 9"), [5, 9, 11]);
  assert.throws(() => parseExposureSeries("0, 9"), /between 0.1 and 600/);
});

test("creates a reproducible run manifest", () => {
  const manifest = createRunManifest({
    source: { kind: "gds", name: "device.gds", sizeBytes: 1234, sha256: "abc" },
    mask: { selectedLayers: [1, 3], polarity: "exposed-geometry" },
    exposures: [7, 9, 11],
    process: { photoresist: "AZ1505", thicknessNm: "600", softBake: "100 C, 60 s", development: "45 s", notes: "test" },
    outputs: ["device-7s.goo", "device-9s.goo", "device-11s.goo"],
  });
  assert.equal(manifest.schema, "gds2goo-run-manifest/v1");
  assert.equal(manifest.process.thicknessNanometers, 600);
  assert.deepEqual(manifest.exposuresSeconds, [7, 9, 11]);
  assert.equal(manifest.source.sha256, "abc");
});

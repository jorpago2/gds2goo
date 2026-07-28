import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fitsDisplay, flattenGds, parseGds, placedBoundsOf } from "../lib/gds.js";
import { buildGooFile, encodeBinaryLayer, validateGooFile } from "../lib/goo.js";
import { createCalibrationShapes, createOrientationCheckShapes, parseExposureSeries } from "../lib/calibration.js";
import { fitsSubstrateArea, repeatShapes, transformGuideShapes } from "../lib/experiment.js";
import { createRunManifest, parseRunManifest } from "../lib/manifest.js";
import { createMonochromePreview, mergeBinaryOverlay, rasterizeBinaryMask } from "../lib/raster.js";
import { parseRecipeLibrary, saveRecipeToLibrary } from "../lib/recipes.js";
import { buildZip } from "../lib/zip.js";
import { createAlignmentMarkShapes, createSubstrateOutlineShape } from "../lib/substrate.js";
import { calculateViewerRasterSize, calculateViewerZoom } from "../lib/viewer.js";

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

test("reports exposure-relevant GDSII compatibility warnings", () => {
  const path = [[0, 0], [1000, 0]].flatMap(([x, y]) => [...int32(x), ...int32(y)]);
  const bytes = new Uint8Array([
    ...record(0x05, 0x02, Array(24).fill(0)), ...record(0x06, 0x06, text("TOP")),
    ...record(0x09, 0x00), ...record(0x0d, 0x02, int16(1)), ...record(0x0f, 0x03, int32(-100)),
    ...record(0x21, 0x02, int16(4)), ...record(0x30, 0x03, int32(50)), ...record(0x31, 0x03, int32(75)),
    ...record(0x10, 0x03, path), ...record(0x11, 0x00),
    ...record(0x0c, 0x00), ...record(0x11, 0x00), ...record(0x15, 0x00), ...record(0x11, 0x00),
    ...record(0x07, 0x00),
  ]);
  const compatibility = parseGds(bytes.buffer).compatibility;
  assert.deepEqual(compatibility.elementCounts, { boundaries: 0, boxes: 0, paths: 1, references: 0, texts: 1, nodes: 1 });
  assert.equal(compatibility.warnings.length, 4);
  assert.match(compatibility.warnings.join(" "), /TEXT.*NODE.*custom extensions.*absolute WIDTH/);
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

test("creates a bounded, asymmetric printer orientation pattern", () => {
  const shapes = createOrientationCheckShapes();
  assert.equal(shapes.length, 30);
  assert.equal(shapes.every((shape) => shape.points.every((point) => point.x % 18 === 0 && point.y % 18 === 0)), true);
  assert.equal(fitsDisplay(shapes, { anchor: "center", offsetX: 0, offsetY: 0, rotation: 0, mirrorX: false, mirrorY: false }, 153360, 77760), true);
});

test("creates physically dimensioned wafer flat and notch outlines", () => {
  const maskShape = createSubstrateOutlineShape({
    shape: "circle",
    widthMillimeters: 50.8,
    heightMillimeters: 50.8,
    marker: "flat",
    flatLengthMillimeters: 15.88,
    lineWidthMicrometers: 180,
  });
  assert.equal(maskShape.kind, "path");
  assert.equal(maskShape.width, 180);
  assert.ok(Math.abs(maskShape.points[0].x - 7940) < 1e-9);
  assert.equal(maskShape.points.at(-1), maskShape.points[0]);

  const notchShape = createSubstrateOutlineShape({
    shape: "circle", widthMillimeters: 50.8, heightMillimeters: 50.8,
    marker: "notch", lineWidthMicrometers: 180,
  });
  assert.ok(Math.abs(notchShape.points.at(-2).y + 24400) < 1e-9);
  assert.throws(() => createSubstrateOutlineShape({
    shape: "circle", widthMillimeters: 50.8, heightMillimeters: 50.8,
    marker: "flat", flatLengthMillimeters: 60, lineWidthMicrometers: 180,
  }), /Flat length/);

  assert.deepEqual([...mergeBinaryOverlay(new Uint8Array([0, 1, 0]), new Uint8Array([1, 1, 0]))], [1, 1, 0]);
  assert.deepEqual([...mergeBinaryOverlay(new Uint8Array([1, 0, 1]), new Uint8Array([1, 1, 0]), true)], [0, 0, 1]);
});

test("builds repeat arrays, substrate guides, usable-area checks and local recipes", () => {
  const square = {
    kind: "polygon", layer: 1, datatype: 0, width: 0, pathType: 0,
    points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }],
  };
  const repeated = repeatShapes([square], { rows: 2, columns: 3, pitchXMicrometers: 2000, pitchYMicrometers: 3000 });
  assert.equal(repeated.length, 6);
  assert.deepEqual(repeated[0].points[0], { x: -2500, y: 1000 });
  const settings = { anchor: "gds-origin", offsetX: 0, offsetY: 0, rotation: 0, mirrorX: false, mirrorY: false };
  const substrate = { shape: "circle", widthMillimeters: 10, heightMillimeters: 10, marker: "round", flatLengthMillimeters: 0, offsetXMicrometers: 0, offsetYMicrometers: 0, rotationDegrees: 0, edgeExclusionMillimeters: 1 };
  assert.equal(fitsSubstrateArea(repeated, settings, substrate), true);
  assert.equal(fitsSubstrateArea(repeated, { ...settings, offsetX: 3000 }, substrate), false);

  const guides = createAlignmentMarkShapes({ shape: "rectangle", widthMillimeters: 20, heightMillimeters: 10, style: "crosses", sizeMillimeters: 2, edgeExclusionMillimeters: 1, lineWidthMicrometers: 180 });
  assert.equal(guides.length, 8);
  const transformedPoint = transformGuideShapes([guides[0]], { offsetXMicrometers: 1000, offsetYMicrometers: 0, rotationDegrees: 180 })[0].points[0];
  assert.ok(Math.abs(transformedPoint.x - 9000) < 1e-9 && Math.abs(transformedPoint.y - 2000) < 1e-9);

  const recipe = { name: "AZ1505", exposure: 9, calibrationSeries: "7, 9, 11", process: { photoresist: "AZ1505", thicknessNm: "600", softBake: "100 C", development: "45 s", notes: "" } };
  assert.deepEqual(parseRecipeLibrary(JSON.stringify(saveRecipeToLibrary([], recipe))), [recipe]);
  assert.deepEqual(parseRecipeLibrary("not JSON"), []);
});

test("zooms the viewer smoothly within its physical inspection limits", () => {
  assert.ok(calculateViewerZoom(2, -100) > 2);
  assert.ok(calculateViewerZoom(2, 100) < 2);
  assert.ok(calculateViewerZoom(2, -20, true) > calculateViewerZoom(2, -20));
  assert.ok(calculateViewerZoom(8, -100) > 8);
  assert.ok(calculateViewerZoom(32, -100) > 32);
  assert.equal(calculateViewerZoom(64, -1000), 64);
  assert.equal(calculateViewerZoom(1, 1000, true), 1);
  assert.deepEqual(calculateViewerRasterSize(1, 8520, 4320), { width: 1400, height: 710 });
  assert.deepEqual(calculateViewerRasterSize(2.1, 8520, 4320), { width: 5600, height: 2839 });
  assert.deepEqual(calculateViewerRasterSize(8, 8520, 4320), { width: 8520, height: 4320 });
});

test("creates a reproducible run manifest", () => {
  const manifest = createRunManifest({
    source: { kind: "gds", name: "device.gds", sizeBytes: 1234, sha256: "abc" },
    mask: {
      topCell: "TOP",
      selectedLayers: [1, 3],
      polarity: "exposed-geometry",
      placement: { anchor: "center", anchorXMicrometers: 0, anchorYMicrometers: 0, rotationDegrees: 0, mirrorX: false, mirrorY: false },
      substrateOutline: {
        templateId: "wafer-2", marker: "flat", included: true, lineWidthMicrometers: 180,
        widthMillimeters: 50.8, heightMillimeters: 50.8, flatLengthMillimeters: 15.88,
        offsetXMicrometers: 180, offsetYMicrometers: -360, rotationDegrees: 5,
        edgeExclusionMillimeters: 3, alignmentStyle: "targets", alignmentSizeMillimeters: 3,
      },
      stepAndRepeat: { rows: 2, columns: 3, pitchXMicrometers: 10000, pitchYMicrometers: 12000 },
      layerExposuresSeconds: { 1: 7, 3: 11 },
    },
    exposures: [7, 9, 11],
    process: { photoresist: "AZ1505", thicknessNm: "600", softBake: "100 C, 60 s", development: "45 s", notes: "test" },
    outputs: ["device-7s.goo", "device-9s.goo", "device-11s.goo"],
  });
  assert.equal(manifest.schema, "gds2goo-run-manifest/v1");
  assert.equal(manifest.process.thicknessNanometers, 600);
  assert.deepEqual(manifest.exposuresSeconds, [7, 9, 11]);
  assert.equal(manifest.source.sha256, "abc");
  const restored = parseRunManifest(JSON.stringify(manifest));
  assert.equal(restored.settings.exposure, 7);
  assert.deepEqual(restored.selectedLayers, [1, 3]);
  assert.equal(restored.substrateOutline.alignmentStyle, "targets");
  assert.equal(restored.substrateOutline.offsetYMicrometers, -360);
  assert.deepEqual(restored.stepAndRepeat, { rows: 2, columns: 3, pitchXMicrometers: 10000, pitchYMicrometers: 12000 });
  assert.deepEqual(restored.layerExposures, { 1: 7, 3: 11 });
  assert.equal(restored.process.thicknessNm, "600");
  const invalidSubstrate = structuredClone(manifest);
  invalidSubstrate.mask.substrateOutline.lineWidthMicrometers = 1001;
  assert.throws(() => parseRunManifest(invalidSubstrate), /between 36 and 1000/);
  assert.throws(() => parseRunManifest("{}"), /schema/);
});

test("builds a readable store-only ZIP archive", () => {
  const zip = buildZip([{ name: "run.json", data: "{}" }], { date: new Date("2026-01-02T03:04:04Z") });
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const nameLength = view.getUint16(26, true);
  const dataLength = view.getUint32(18, true);
  assert.equal(new TextDecoder().decode(zip.subarray(30, 30 + nameLength)), "run.json");
  assert.equal(new TextDecoder().decode(zip.subarray(30 + nameLength, 30 + nameLength + dataLength)), "{}");
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.throws(() => buildZip([{ name: "../unsafe", data: "x" }]), /filename/);
});

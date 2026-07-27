import assert from "node:assert/strict";
import test from "node:test";
import { flattenGds, parseGds } from "../lib/gds.js";
import { buildGooFile, encodeBinaryLayer, validateGooFile } from "../lib/goo.js";

function record(type, dataType, payload = []) {
  const length = payload.length + 4;
  return [length >> 8, length & 255, type, dataType, ...payload];
}

function int16(value) { return [(value >> 8) & 255, value & 255]; }
function int32(value) { return [(value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255]; }

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

test("encodes a binary layer and validates the resulting GOO container", () => {
  const rows = [new Uint8Array([0, 0, 1, 1]), new Uint8Array([1, 0, 0, 0])];
  const encoded = encodeBinaryLayer((y) => rows[y], 4, 2);
  const goo = buildGooFile({ layerData: encoded.data, exposureSeconds: 9, whitePixels: encoded.whitePixels });
  const result = validateGooFile(goo, 8);
  assert.equal(result.pixels, 8);
  assert.equal(encoded.whitePixels, 3);
});

export const MARS_4_9K = {
  width: 8520,
  height: 4320,
  pixelMicrometers: 18,
  sizeX: 153.36,
  sizeY: 77.76,
  sizeZ: 175,
};

const HEADER_SIZE = 0x2fb95;
const MAGIC = [0x07, 0x00, 0x00, 0x00, 0x44, 0x4c, 0x50, 0x00];
const DELIMITER = [0x0d, 0x0a];
const ENDING = [0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x44, 0x4c, 0x50, 0x00];

class Writer {
  constructor(size) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.offset = 0;
  }

  u8(value) { this.bytes[this.offset++] = value & 0xff; }
  u16(value) { this.view.setUint16(this.offset, value, false); this.offset += 2; }
  u32(value) { this.view.setUint32(this.offset, value, false); this.offset += 4; }
  f32(value) { this.view.setFloat32(this.offset, value, false); this.offset += 4; }
  bool(value) { this.u8(value ? 1 : 0); }
  raw(values) { this.bytes.set(values, this.offset); this.offset += values.length; }
  string(value, size) {
    const encoded = new TextEncoder().encode(value).slice(0, size);
    this.raw(encoded);
    this.offset += size - encoded.length;
  }
}

function runSize(length) {
  if (length <= 0x0f) return 0;
  if (length <= 0x0fff) return 1;
  if (length <= 0x0fffff) return 2;
  return 3;
}

/** Encode every binary LCD pixel with Elegoo's documented GOO run-length format. */
export function encodeBinaryLayer(readRows, width, height) {
  const data = new Uint8Array(width * height + 8);
  let offset = 0;
  let checksum = 0;
  let whitePixels = 0;
  let last = -1;
  let length = 0;

  function byte(value) {
    data[offset++] = value;
    checksum = (checksum + value) & 0xff;
  }

  function emit(value, count) {
    if (!count) return;
    const size = runSize(count);
    byte(((value ? 0b11 : 0b00) << 6) | (size << 4) | (count & 0x0f));
    if (size === 1) byte(count >> 4);
    else if (size === 2) { byte(count >> 12); byte(count >> 4); }
    else if (size === 3) { byte(count >> 20); byte(count >> 12); byte(count >> 4); }
  }

  for (let y = 0; y < height; y += 1) {
    const row = readRows(y);
    if (row.length !== width) throw new Error(`Row ${y} contains ${row.length} pixels; expected ${width}.`);
    for (let x = 0; x < width; x += 1) {
      const value = row[x] ? 1 : 0;
      if (value) whitePixels += 1;
      if (value === last) length += 1;
      else {
        emit(last, length);
        last = value;
        length = 1;
      }
    }
  }
  emit(last, length);
  return { data: data.slice(0, offset), checksum: (~checksum) & 0xff, whitePixels };
}

function writePreview(writer, pixels, width, height) {
  if (pixels && pixels.length !== width * height) throw new Error("The GOO preview has an invalid size.");
  for (let i = 0; i < width * height; i += 1) writer.u16(pixels ? pixels[i] : 0);
}

function checksumOf(bytes) {
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) & 0xff;
  return (~sum) & 0xff;
}

/** Build a one-layer Mars 4 9K GOO exposure file. */
export function buildGooFile({ layerData, exposureSeconds, whitePixels = 0, smallPreview, bigPreview, createdAt = new Date() }) {
  if (!(exposureSeconds > 0 && exposureSeconds <= 600)) throw new Error("Exposure must be between 0 and 600 s.");
  const writer = new Writer(HEADER_SIZE + layerData.length + 85);
  const date = createdAt.toISOString().replace("T", " ").slice(0, 19);
  const volumeMl = whitePixels * (0.018 ** 2) * 0.05 / 1000;

  writer.string("V3.0", 4);
  writer.raw(MAGIC);
  writer.string("GDS2GOO browser", 32);
  writer.string("0.1.0", 24);
  writer.string(date, 24);
  writer.string("ELEGOO MARS 4", 32);
  writer.string("Mars 4 9K", 32);
  writer.string("Mask exposure", 32);
  writer.u16(0); writer.u16(0); writer.u16(0);
  writePreview(writer, smallPreview, 116, 116);
  writer.raw(DELIMITER);
  writePreview(writer, bigPreview, 290, 290);
  writer.raw(DELIMITER);
  writer.u32(1);
  writer.u16(MARS_4_9K.width); writer.u16(MARS_4_9K.height);
  writer.bool(false); writer.bool(false);
  writer.f32(MARS_4_9K.sizeX); writer.f32(MARS_4_9K.sizeY); writer.f32(MARS_4_9K.sizeZ);
  writer.f32(0.05); writer.f32(exposureSeconds); writer.bool(true);
  for (let i = 0; i < 7; i += 1) writer.f32(0);
  writer.f32(exposureSeconds);
  writer.u32(1);
  writer.f32(5); writer.f32(65); writer.f32(5); writer.f32(65);
  writer.f32(5); writer.f32(150); writer.f32(5); writer.f32(150);
  for (let i = 0; i < 8; i += 1) writer.f32(0);
  writer.u16(255); writer.u16(255); writer.bool(false);
  writer.u32(Math.ceil(exposureSeconds + 1));
  writer.f32(volumeMl); writer.f32(0); writer.f32(0);
  writer.string("€", 8);
  writer.u32(HEADER_SIZE); writer.bool(true); writer.u16(1);
  if (writer.offset !== HEADER_SIZE) throw new Error(`Invalid GOO header: ${writer.offset} bytes.`);

  writer.u16(0); writer.f32(MARS_4_9K.sizeZ); writer.f32(0.05); writer.f32(exposureSeconds);
  writer.f32(0); writer.f32(0); writer.f32(0); writer.f32(0);
  writer.f32(5); writer.f32(65); writer.f32(0); writer.f32(0);
  writer.f32(5); writer.f32(150); writer.f32(0); writer.f32(0);
  writer.u16(255); writer.raw(DELIMITER);
  writer.u32(layerData.length + 2); writer.u8(0x55); writer.raw(layerData);
  writer.u8(checksumOf(layerData)); writer.raw(DELIMITER); writer.raw(ENDING);
  if (writer.offset !== writer.bytes.length) throw new Error("Inconsistent internal GOO length.");
  return writer.bytes;
}

/** Minimal structural check that also verifies the encoded pixel count. */
export function validateGooFile(bytes, expectedPixels = MARS_4_9K.width * MARS_4_9K.height) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < MAGIC.length; i += 1) if (bytes[4 + i] !== MAGIC[i]) throw new Error("Invalid GOO signature.");
  const layerStart = HEADER_SIZE;
  const storedLength = view.getUint32(layerStart + 66, false);
  const dataStart = layerStart + 71;
  const dataLength = storedLength - 2;
  const dataEnd = dataStart + dataLength;
  if (dataEnd + 14 !== bytes.length) throw new Error("Invalid GOO layer length.");
  if (bytes[dataEnd] !== checksumOf(bytes.subarray(dataStart, dataEnd))) throw new Error("Invalid GOO layer checksum.");

  let pixels = 0;
  let offset = dataStart;
  while (offset < dataEnd) {
    const head = bytes[offset++];
    const type = head >> 6;
    const size = (head >> 4) & 3;
    if (type === 1) offset += 1;
    if (type === 2) {
      pixels += (head & 0x10) ? bytes[offset++] : 1;
      continue;
    }
    let length = head & 0x0f;
    if (size === 1) length += bytes[offset++] << 4;
    else if (size === 2) { length += bytes[offset++] << 12; length += bytes[offset++] << 4; }
    else if (size === 3) { length += bytes[offset++] << 20; length += bytes[offset++] << 12; length += bytes[offset++] << 4; }
    pixels += length;
  }
  if (pixels !== expectedPixels) throw new Error(`The GOO layer decodes to ${pixels} pixels; expected ${expectedPixels}.`);
  return { pixels, dataLength };
}

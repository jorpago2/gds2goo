const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
  };
}

function bytesOf(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return new TextEncoder().encode(data);
  throw new Error("ZIP entries must contain text or Uint8Array data.");
}

/** Build a standards-compliant ZIP using the uncompressed store method. */
export function buildZip(entries, { date = new Date() } = {}) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("The ZIP archive needs at least one file.");
  if (entries.length > 0xffff) throw new Error("The ZIP archive contains too many files.");
  const names = new Set();
  const timestamp = dosDateTime(date);
  const normalized = entries.map((entry) => {
    if (!entry?.name || /(^|[\\/])\.\.([\\/]|$)|[\\]/.test(entry.name)) throw new Error("Invalid ZIP filename.");
    if (names.has(entry.name)) throw new Error(`Duplicate ZIP filename: ${entry.name}.`);
    names.add(entry.name);
    const name = new TextEncoder().encode(entry.name);
    const data = bytesOf(entry.data);
    if (name.length > 0xffff || data.length > 0xffffffff) throw new Error("A ZIP entry is too large.");
    return { name, data, crc: crc32(data), offset: 0 };
  });

  const localSize = normalized.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = normalized.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff) throw new Error("The ZIP archive exceeds the 4 GB limit.");
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;
  const u16 = (value) => { view.setUint16(offset, value, true); offset += 2; };
  const u32 = (value) => { view.setUint32(offset, value, true); offset += 4; };
  const raw = (value) => { output.set(value, offset); offset += value.length; };

  for (const entry of normalized) {
    entry.offset = offset;
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(timestamp.time); u16(timestamp.date);
    u32(entry.crc); u32(entry.data.length); u32(entry.data.length); u16(entry.name.length); u16(0);
    raw(entry.name); raw(entry.data);
  }
  const centralOffset = offset;
  for (const entry of normalized) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(timestamp.time); u16(timestamp.date);
    u32(entry.crc); u32(entry.data.length); u32(entry.data.length); u16(entry.name.length); u16(0); u16(0);
    u16(0); u16(0); u32(0); u32(entry.offset); raw(entry.name);
  }
  u32(0x06054b50); u16(0); u16(0); u16(normalized.length); u16(normalized.length);
  u32(centralSize); u32(centralOffset); u16(0);
  return output;
}

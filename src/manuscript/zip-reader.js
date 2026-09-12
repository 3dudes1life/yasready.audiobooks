import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD) return offset;
  }
  throw new Error('invalid ZIP: end-of-central-directory record not found');
}

function safeSlice(buffer, start, end, label) {
  if (start < 0 || end < start || end > buffer.length) throw new Error(`invalid ZIP: ${label} is out of bounds`);
  return buffer.subarray(start, end);
}

export function readZipEntries(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const eocd = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buffer.length) throw new Error('invalid ZIP: central directory is out of bounds');

  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL) throw new Error(`invalid ZIP: central directory entry ${index} is corrupt`);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const filenameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameBuffer = safeSlice(buffer, cursor + 46, cursor + 46 + filenameLength, 'filename');
    const filename = nameBuffer.toString((flags & 0x800) !== 0 ? 'utf8' : 'utf8').replace(/\\/g, '/');

    if (buffer.readUInt32LE(localOffset) !== LOCAL) throw new Error(`invalid ZIP: local header missing for ${filename}`);
    const localFilenameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFilenameLength + localExtraLength;
    const compressed = safeSlice(buffer, dataStart, dataStart + compressedSize, `compressed data for ${filename}`);

    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`unsupported ZIP compression method ${method} for ${filename}`);

    if (uncompressedSize !== 0 && data.length !== uncompressedSize) {
      throw new Error(`invalid ZIP: size mismatch for ${filename}`);
    }
    entries.set(filename, Object.freeze({ filename, method, compressedSize, uncompressedSize: data.length, data }));
    cursor += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

export function zipText(entries, filename, { required = true } = {}) {
  const entry = entries.get(filename);
  if (!entry) {
    if (required) throw new Error(`ZIP entry not found: ${filename}`);
    return null;
  }
  return entry.data.toString('utf8');
}

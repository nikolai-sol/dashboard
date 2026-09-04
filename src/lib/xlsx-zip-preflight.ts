import { inflateRawSync } from "node:zlib";

export const MAX_XLSX_ZIP_ENTRIES = 128;
export const MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
export const MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
export const MAX_XLSX_COMPRESSION_RATIO = 100;

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTED_FLAG = 0x0001;
const STRONG_ENCRYPTION_FLAG = 0x0040;
const UTF8_FLAG = 0x0800;
const DEFLATE_OPTION_FLAGS = 0x0006;
const UNICODE_PATH_EXTRA_FIELD = 0x7075;

type EntryMetadata = {
  compressedBytes: number;
  uncompressedBytes: number;
  localHeaderOffset: number;
  nameBytes: Buffer;
  flags: number;
  method: number;
  crc: number;
};

type InflateRawInfo = {
  buffer: Buffer;
  engine: { bytesWritten: number };
};

const CRC32_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return value >>> 0;
});

function malformed(reason: string): never {
  throw new Error(`Malformed or ambiguous XLSX ZIP metadata: ${reason}`);
}

function requireRange(bytes: Buffer, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    malformed(`${label} is outside the archive`);
  }
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  if (bytes.length < END_OF_CENTRAL_DIRECTORY_BYTES) malformed("end record is missing");
  const earliest = Math.max(0, bytes.length - END_OF_CENTRAL_DIRECTORY_BYTES - MAX_ZIP_COMMENT_BYTES);
  const candidates: number[] = [];
  for (let offset = bytes.length - END_OF_CENTRAL_DIRECTORY_BYTES; offset >= earliest; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentBytes = bytes.readUInt16LE(offset + 20);
    if (offset + END_OF_CENTRAL_DIRECTORY_BYTES + commentBytes === bytes.length) candidates.push(offset);
  }
  if (candidates.length !== 1) malformed(candidates.length === 0 ? "end record is missing" : "multiple end records");
  return candidates[0]!;
}

function decodeEntryName(nameBytes: Buffer, flags: number): string {
  if (nameBytes.length === 0) malformed("entry name is empty");
  let name: string;
  if ((flags & UTF8_FLAG) !== 0) {
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    } catch {
      malformed("entry name is not valid UTF-8");
    }
  } else {
    if (nameBytes.some((byte) => byte > 0x7f)) malformed("non-ASCII entry name has no UTF-8 flag");
    name = nameBytes.toString("ascii");
  }
  if (
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    name.includes("//") ||
    name.split("/").some((part) => part === "." || part === "..")
  ) {
    malformed("entry name is unsafe");
  }
  return name;
}

function rejectMalformedExtraFields(extra: Buffer): void {
  let cursor = 0;
  while (cursor < extra.length) {
    if (cursor + 4 > extra.length) malformed("extra field header is truncated");
    const id = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + length > extra.length) malformed("extra field value is truncated");
    if (id === 0x0001) malformed("ZIP64 metadata is unsupported");
    if (id === UNICODE_PATH_EXTRA_FIELD) malformed("Unicode path overrides are unsupported");
    cursor += length;
  }
}

function validateLocalHeader(
  bytes: Buffer,
  entry: EntryMetadata,
  centralDirectoryOffset: number,
): { start: number; end: number; dataStart: number; dataEnd: number } {
  const offset = entry.localHeaderOffset;
  requireRange(bytes, offset, 30, "local header");
  if (bytes.readUInt32LE(offset) !== LOCAL_FILE_HEADER_SIGNATURE) malformed("local header signature does not match");
  const localFlags = bytes.readUInt16LE(offset + 6);
  const localMethod = bytes.readUInt16LE(offset + 8);
  const localCrc = bytes.readUInt32LE(offset + 14);
  const localCompressedBytes = bytes.readUInt32LE(offset + 18);
  const localUncompressedBytes = bytes.readUInt32LE(offset + 22);
  const localNameLength = bytes.readUInt16LE(offset + 26);
  const localExtraLength = bytes.readUInt16LE(offset + 28);
  const variableLength = localNameLength + localExtraLength;
  requireRange(bytes, offset + 30, variableLength, "local header fields");
  const localName = bytes.subarray(offset + 30, offset + 30 + localNameLength);
  const localExtra = bytes.subarray(offset + 30 + localNameLength, offset + 30 + variableLength);
  rejectMalformedExtraFields(localExtra);
  if (!localName.equals(entry.nameBytes) || localFlags !== entry.flags || localMethod !== entry.method) {
    malformed("central and local entry metadata disagree");
  }
  const dataStart = offset + 30 + variableLength;
  const dataEnd = dataStart + entry.compressedBytes;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > centralDirectoryOffset) malformed("entry data is outside the archive");
  let end = dataEnd;
  if ((entry.flags & DATA_DESCRIPTOR_FLAG) !== 0) {
    if (
      (localCrc !== 0 && localCrc !== entry.crc) ||
      (localCompressedBytes !== 0 && localCompressedBytes !== entry.compressedBytes) ||
      (localUncompressedBytes !== 0 && localUncompressedBytes !== entry.uncompressedBytes)
    ) {
      malformed("data descriptor and local entry sizes disagree");
    }
    const descriptorMatches = (valuesOffset: number, descriptorEnd: number) =>
      descriptorEnd <= centralDirectoryOffset &&
      descriptorEnd <= bytes.length &&
      bytes.readUInt32LE(valuesOffset) === entry.crc &&
      bytes.readUInt32LE(valuesOffset + 4) === entry.compressedBytes &&
      bytes.readUInt32LE(valuesOffset + 8) === entry.uncompressedBytes;
    const descriptorEnds: number[] = [];
    if (dataEnd + 12 <= bytes.length && descriptorMatches(dataEnd, dataEnd + 12)) {
      descriptorEnds.push(dataEnd + 12);
    }
    if (
      dataEnd + 16 <= bytes.length &&
      bytes.readUInt32LE(dataEnd) === DATA_DESCRIPTOR_SIGNATURE &&
      descriptorMatches(dataEnd + 4, dataEnd + 16)
    ) {
      descriptorEnds.push(dataEnd + 16);
    }
    if (descriptorEnds.length === 0) malformed("data descriptor disagrees with central entry metadata");
    if (descriptorEnds.length > 1) malformed("data descriptor layout is ambiguous");
    end = descriptorEnds[0]!;
  } else if (
    localCrc !== entry.crc ||
    localCompressedBytes !== entry.compressedBytes ||
    localUncompressedBytes !== entry.uncompressedBytes
  ) {
    malformed("central and local entry sizes disagree");
  }
  return { start: offset, end, dataStart, dataEnd };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

function validateEntryPayload(
  archive: Buffer,
  entry: EntryMetadata,
  range: { dataStart: number; dataEnd: number },
): { compressedBytes: number; expandedBytes: number } {
  const compressed = archive.subarray(range.dataStart, range.dataEnd);
  let expanded: Buffer;
  let consumedCompressedBytes = compressed.length;
  if (entry.method === 0) {
    expanded = compressed;
  } else {
    try {
      const inflated = inflateRawSync(compressed, {
        info: true,
        maxOutputLength: MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES + 1,
      }) as unknown as InflateRawInfo;
      expanded = inflated.buffer;
      consumedCompressedBytes = inflated.engine.bytesWritten;
    } catch {
      throw new Error("XLSX ZIP entry expanded bytes exceed 8 MiB or its compressed payload is malformed");
    }
    if (consumedCompressedBytes !== compressed.length) {
      malformed("deflate entry contains trailing compressed payload bytes");
    }
  }
  if (expanded.length > MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES) {
    throw new Error("XLSX ZIP entry expanded bytes exceed 8 MiB");
  }
  if (expanded.length !== entry.uncompressedBytes || crc32(expanded) !== entry.crc) {
    malformed("entry payload disagrees with declared size or checksum");
  }
  return { compressedBytes: consumedCompressedBytes, expandedBytes: expanded.length };
}

function assertCompressionRatio(compressedBytes: number, expandedBytes: number, aggregate: boolean): void {
  if (
    expandedBytes > 0 &&
    (compressedBytes === 0 || expandedBytes / compressedBytes > MAX_XLSX_COMPRESSION_RATIO)
  ) {
    throw new Error(`XLSX ZIP ${aggregate ? "aggregate " : ""}compression ratio exceeds 100:1`);
  }
}

export function assertBoundedXlsxZip(bytes: Buffer): void {
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = bytes.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = bytes.readUInt16LE(endOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(endOffset + 8);
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralDirectoryBytes = bytes.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) malformed("multi-disk archive is unsupported");
  if (
    entryCount === ZIP64_SENTINEL_16 ||
    centralDirectoryBytes === ZIP64_SENTINEL_32 ||
    centralDirectoryOffset === ZIP64_SENTINEL_32
  ) {
    malformed("ZIP64 metadata is unsupported");
  }
  if (entryCount === 0) malformed("archive has no entries");
  if (entryCount > MAX_XLSX_ZIP_ENTRIES) {
    throw new Error(`XLSX ZIP must contain at most ${MAX_XLSX_ZIP_ENTRIES} entries`);
  }
  if (centralDirectoryOffset + centralDirectoryBytes !== endOffset) malformed("central directory bounds disagree");
  requireRange(bytes, centralDirectoryOffset, centralDirectoryBytes, "central directory");

  const entries: EntryMetadata[] = [];
  const names = new Set<string>();
  let cursor = centralDirectoryOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(bytes, cursor, 46, "central directory entry");
    if (bytes.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) malformed("central directory signature does not match");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedBytes = bytes.readUInt32LE(cursor + 20);
    const uncompressedBytes = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const startingDisk = bytes.readUInt16LE(cursor + 34);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    if ((flags & (ENCRYPTED_FLAG | STRONG_ENCRYPTION_FLAG)) !== 0) malformed("encrypted entries are unsupported");
    if (method !== 0 && method !== 8) malformed("entry compression method is unsupported");
    const allowedFlags = UTF8_FLAG | DATA_DESCRIPTOR_FLAG | (method === 8 ? DEFLATE_OPTION_FLAGS : 0);
    if ((flags & ~allowedFlags) !== 0) malformed("entry general-purpose flags are unsupported");
    if (startingDisk !== 0) malformed("entry starts on another disk");
    if (
      compressedBytes === ZIP64_SENTINEL_32 ||
      uncompressedBytes === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      malformed("ZIP64 entry metadata is unsupported");
    }
    if (uncompressedBytes > MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error("XLSX ZIP entry expanded bytes exceed 8 MiB");
    }
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(bytes, cursor, recordLength, "central directory entry fields");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeEntryName(nameBytes, flags);
    const normalizedName = name.normalize("NFC").toLowerCase();
    if (names.has(normalizedName)) malformed("duplicate entry name is ambiguous");
    names.add(normalizedName);
    const extra = bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    rejectMalformedExtraFields(extra);
    entries.push({ compressedBytes, uncompressedBytes, localHeaderOffset, nameBytes, flags, method, crc });
    totalCompressedBytes += compressedBytes;
    totalUncompressedBytes += uncompressedBytes;
    cursor += recordLength;
  }
  if (cursor !== centralDirectoryOffset + centralDirectoryBytes) malformed("central directory entry count or size disagrees");
  if (totalUncompressedBytes > MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new Error("XLSX ZIP aggregate expanded bytes exceed 16 MiB");
  }
  entries.forEach((entry) => assertCompressionRatio(entry.compressedBytes, entry.uncompressedBytes, false));
  assertCompressionRatio(totalCompressedBytes, totalUncompressedBytes, true);

  const ranges = entries
    .map((entry) => ({ entry, ...validateLocalHeader(bytes, entry, centralDirectoryOffset) }))
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) malformed("local entry ranges overlap");
  }
  const actual = ranges.map((range) => validateEntryPayload(bytes, range.entry, range));
  actual.forEach((entry) => assertCompressionRatio(entry.compressedBytes, entry.expandedBytes, false));
  assertCompressionRatio(
    actual.reduce((sum, entry) => sum + entry.compressedBytes, 0),
    actual.reduce((sum, entry) => sum + entry.expandedBytes, 0),
    true,
  );
}

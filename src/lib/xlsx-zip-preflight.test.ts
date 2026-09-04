import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import ExcelJS from "exceljs";

import { parseAliceVisibilityWorkbook } from "./zaruku-alice-visibility-import";

const MAX_ENTRIES = 128;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_RATIO = 100;

type ZipFixtureEntry = {
  name: string;
  data: Buffer;
  compression?: "store" | "deflate";
  declaredUncompressedBytes?: number;
  compressedPaddingBytes?: number;
  flags?: number;
  zeroLocalMetadata?: boolean;
  dataDescriptor?: "signed" | "unsigned";
  centralExtra?: Buffer;
  localExtra?: Buffer;
};

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFixture(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.compression === "store" ? 0 : 8;
    const compressedPayload = method === 0 ? entry.data : deflateRawSync(entry.data, { level: 9 });
    const compressed = Buffer.concat([
      compressedPayload,
      Buffer.alloc(entry.compressedPaddingBytes ?? 0),
    ]);
    const checksum = crc32(entry.data);
    const declaredUncompressedBytes = entry.declaredUncompressedBytes ?? entry.data.length;
    const flags = 0x0800 | (entry.flags ?? 0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const localExtra = entry.localExtra ?? centralExtra;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(entry.zeroLocalMetadata ? 0 : checksum, 14);
    localHeader.writeUInt32LE(entry.zeroLocalMetadata ? 0 : compressed.length, 18);
    localHeader.writeUInt32LE(entry.zeroLocalMetadata ? 0 : declaredUncompressedBytes, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(localExtra.length, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(declaredUncompressedBytes, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(centralExtra.length, 30);
    centralHeader.writeUInt32LE(localOffset, 42);

    let descriptor = Buffer.alloc(0);
    if (entry.dataDescriptor) {
      descriptor = Buffer.alloc(entry.dataDescriptor === "signed" ? 16 : 12);
      const valuesOffset = entry.dataDescriptor === "signed" ? 4 : 0;
      if (entry.dataDescriptor === "signed") descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, valuesOffset);
      descriptor.writeUInt32LE(compressed.length, valuesOffset + 4);
      descriptor.writeUInt32LE(declaredUncompressedBytes, valuesOffset + 8);
    }
    const localPart = Buffer.concat([localHeader, name, localExtra, compressed, descriptor]);
    localParts.push(localPart);
    centralParts.push(Buffer.concat([centralHeader, name, centralExtra]));
    localOffset += localPart.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function unicodePathExtra(originalName: string, effectiveName: string): Buffer {
  const effectiveNameBytes = Buffer.from(effectiveName, "utf8");
  const body = Buffer.alloc(5 + effectiveNameBytes.length);
  body.writeUInt8(1, 0);
  body.writeUInt32LE(crc32(Buffer.from(originalName, "utf8")), 1);
  effectiveNameBytes.copy(body, 5);
  const field = Buffer.alloc(4 + body.length);
  field.writeUInt16LE(0x7075, 0);
  field.writeUInt16LE(body.length, 2);
  body.copy(field, 4);
  return field;
}

type XlsxZipPreflightModule = {
  assertBoundedXlsxZip: (bytes: Buffer) => void;
  MAX_XLSX_ZIP_ENTRIES: number;
  MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES: number;
  MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES: number;
  MAX_XLSX_COMPRESSION_RATIO: number;
};

async function loadPreflight(): Promise<XlsxZipPreflightModule> {
  const modulePath = "./xlsx-zip-preflight";
  const loaded = await import(modulePath).catch(() => ({}));
  const candidate = loaded as Partial<XlsxZipPreflightModule>;
  assert.equal(typeof candidate.assertBoundedXlsxZip, "function");
  return candidate as XlsxZipPreflightModule;
}

async function ordinaryWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Alice").addRows([
    ["Запрос", "Присутствует сайт", "Ответ в Алисе AI", ...Array.from({ length: 10 }, (_unused, index) => `Сайт ${index + 1}`)],
    ["обычный запрос", "true", "https://yandex.ru/search/?text=ordinary", "https://zaruku.ru/article"],
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("XLSX ZIP preflight exposes conservative limits and accepts an ordinary workbook", async () => {
  const preflight = await loadPreflight();
  assert.equal(preflight.MAX_XLSX_ZIP_ENTRIES, MAX_ENTRIES);
  assert.equal(preflight.MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES, MAX_ENTRY_BYTES);
  assert.equal(preflight.MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES, MAX_TOTAL_BYTES);
  assert.equal(preflight.MAX_XLSX_COMPRESSION_RATIO, MAX_RATIO);
  const bytes = await ordinaryWorkbookBuffer();
  assert.doesNotThrow(() => preflight.assertBoundedXlsxZip(bytes));
});

test("XLSX ZIP preflight caps central-directory entry count", async () => {
  const preflight = await loadPreflight();
  const entries = Array.from({ length: MAX_ENTRIES + 1 }, (_unused, index) => ({
    name: `entry-${index}.xml`,
    data: Buffer.from("x"),
  }));
  assert.throws(() => preflight.assertBoundedXlsxZip(zipFixture(entries)), /128|entries/i);
});

test("XLSX ZIP preflight caps each expanded entry", async () => {
  const preflight = await loadPreflight();
  const bomb = zipFixture([{ name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(MAX_ENTRY_BYTES + 1, 0x61) }]);
  assert.ok(bomb.length < 32 * 1024, `fixture was not compact: ${bomb.length}`);
  assert.throws(() => preflight.assertBoundedXlsxZip(bomb), /8 MiB|entry.*expanded/i);
});

test("XLSX ZIP preflight caps aggregate expanded bytes", async () => {
  const preflight = await loadPreflight();
  const sixMiB = Buffer.alloc(6 * 1024 * 1024, 0x61);
  const aggregate = zipFixture([
    { name: "part-a.xml", data: sixMiB, compression: "store" },
    { name: "part-b.xml", data: sixMiB, compression: "store" },
    { name: "part-c.xml", data: sixMiB, compression: "store" },
  ]);
  assert.throws(() => preflight.assertBoundedXlsxZip(aggregate), /16 MiB|aggregate.*expanded/i);
});

test("XLSX ZIP preflight caps per-entry compression ratio", async () => {
  const preflight = await loadPreflight();
  const compressed = zipFixture([{ name: "xl/sharedStrings.xml", data: Buffer.alloc(1024 * 1024, 0x61) }]);
  assert.throws(() => preflight.assertBoundedXlsxZip(compressed), /compression ratio|100/i);
});

test("XLSX ZIP preflight rejects deflate padding that disguises the true compression ratio", async () => {
  const preflight = await loadPreflight();
  const data = Buffer.alloc(1024 * 1024, 0x61);
  const compressedBytes = deflateRawSync(data, { level: 9 }).length;
  const declaredBytesNeeded = Math.ceil(data.length / MAX_RATIO);
  const paddingBytes = declaredBytesNeeded - compressedBytes;
  assert.ok(paddingBytes > 0);
  const padded = zipFixture([{
    name: "xl/sharedStrings.xml",
    data,
    compressedPaddingBytes: paddingBytes,
  }]);
  assert.throws(
    () => preflight.assertBoundedXlsxZip(padded),
    /compression ratio|trailing|payload.*disagree|malformed/i,
  );
});

test("XLSX ZIP preflight rejects unsupported data-descriptor metadata", async () => {
  const preflight = await loadPreflight();
  const missingDescriptor = zipFixture([{
    name: "xl/worksheets/sheet1.xml",
    data: Buffer.from("worksheet"),
    flags: 0x0008,
    zeroLocalMetadata: true,
  }]);
  assert.throws(
    () => preflight.assertBoundedXlsxZip(missingDescriptor),
    /data descriptor|malformed|ambiguous/i,
  );
});

test("XLSX ZIP preflight validates signed and unsigned data descriptors", async () => {
  const preflight = await loadPreflight();
  for (const dataDescriptor of ["signed", "unsigned"] as const) {
    const archive = zipFixture([{
      name: `xl/worksheets/${dataDescriptor}.xml`,
      data: Buffer.from("worksheet"),
      flags: 0x0008,
      zeroLocalMetadata: true,
      dataDescriptor,
    }]);
    assert.doesNotThrow(() => preflight.assertBoundedXlsxZip(archive));
  }
});

test("XLSX ZIP preflight rejects unsupported general-purpose flags", async () => {
  const preflight = await loadPreflight();
  const reservedFlag = zipFixture([{
    name: "xl/worksheets/sheet1.xml",
    data: Buffer.from("worksheet"),
    flags: 0x0020,
  }]);
  assert.throws(
    () => preflight.assertBoundedXlsxZip(reservedFlag),
    /general-purpose flags|malformed|unsupported/i,
  );

  const storedDeflateOption = zipFixture([{
    name: "stored.xml",
    data: Buffer.from("stored"),
    compression: "store",
    flags: 0x0002,
  }]);
  assert.throws(
    () => preflight.assertBoundedXlsxZip(storedDeflateOption),
    /general-purpose flags|malformed|unsupported/i,
  );
});

test("XLSX ZIP preflight rejects Unicode path overrides and normalized duplicate names", async () => {
  const preflight = await loadPreflight();
  const originalName = "safe.xml";
  const overridden = zipFixture([{
    name: originalName,
    data: Buffer.from("safe"),
    centralExtra: unicodePathExtra(originalName, "../unsafe.xml"),
  }]);
  assert.throws(
    () => preflight.assertBoundedXlsxZip(overridden),
    /Unicode path|ambiguous|unsafe|malformed/i,
  );

  const normalizedDuplicate = zipFixture([
    { name: "caf\u00e9.xml", data: Buffer.from("one") },
    { name: "cafe\u0301.xml", data: Buffer.from("two") },
  ]);
  assert.throws(
    () => preflight.assertBoundedXlsxZip(normalizedDuplicate),
    /duplicate|ambiguous/i,
  );
});

test("XLSX ZIP preflight rejects malformed and duplicate metadata", async () => {
  const preflight = await loadPreflight();
  const valid = zipFixture([{ name: "one.xml", data: Buffer.from("one") }]);
  assert.throws(() => preflight.assertBoundedXlsxZip(valid.subarray(0, valid.length - 1)), /malformed|metadata/i);
  const duplicate = zipFixture([
    { name: "same.xml", data: Buffer.from("one") },
    { name: "same.xml", data: Buffer.from("two") },
  ]);
  assert.throws(() => preflight.assertBoundedXlsxZip(duplicate), /duplicate|ambiguous/i);
});

test("XLSX ZIP preflight verifies bounded actual expansion instead of trusting forged sizes", async () => {
  const preflight = await loadPreflight();
  const forgedBomb = zipFixture([{
    name: "xl/worksheets/sheet1.xml",
    data: Buffer.alloc(MAX_ENTRY_BYTES + 1, 0x61),
    declaredUncompressedBytes: 1,
  }]);
  assert.ok(forgedBomb.length < 32 * 1024, `fixture was not compact: ${forgedBomb.length}`);
  assert.throws(() => preflight.assertBoundedXlsxZip(forgedBomb), /8 MiB|expanded/i);
});

test("Alice parser preflights a tiny expansion bomb before workbook materialization", async () => {
  const bomb = zipFixture([{ name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(MAX_ENTRY_BYTES + 1, 0x61) }]);
  let materializations = 0;
  const parseWithDependencies = parseAliceVisibilityWorkbook as unknown as (
    buffer: Buffer,
    input: Parameters<typeof parseAliceVisibilityWorkbook>[1],
    dependencies: { loadWorkbook: (bytes: Buffer) => Promise<ExcelJS.Workbook> },
  ) => ReturnType<typeof parseAliceVisibilityWorkbook>;
  await assert.rejects(
    () => parseWithDependencies(bomb, {
      accountId: "zaruku.ru",
      portalDomain: "zaruku.ru",
      period: "2026-08",
      officialSovPct: 43.91,
      capturedAt: "2026-09-04T13:28:14.000Z",
      sourceFilename: "bomb.xlsx",
      featuredSites: [],
    }, {
      loadWorkbook: async () => {
        materializations += 1;
        throw new Error("ExcelJS materialized the rejected workbook");
      },
    }),
    /8 MiB|entry.*expanded/i,
  );
  assert.equal(materializations, 0);
});

test("Alice parser uses the injected materializer after a valid ZIP preflight", async () => {
  const bytes = await ordinaryWorkbookBuffer();
  let materializations = 0;
  const parseWithDependencies = parseAliceVisibilityWorkbook as unknown as (
    buffer: Buffer,
    input: Parameters<typeof parseAliceVisibilityWorkbook>[1],
    dependencies: { loadWorkbook: (input: Buffer) => Promise<ExcelJS.Workbook> },
  ) => ReturnType<typeof parseAliceVisibilityWorkbook>;
  const parsed = await parseWithDependencies(bytes, {
    accountId: "zaruku.ru",
    portalDomain: "zaruku.ru",
    period: "2026-08",
    officialSovPct: 43.91,
    capturedAt: "2026-09-04T13:28:14.000Z",
    sourceFilename: "ordinary.xlsx",
    featuredSites: [],
  }, {
    loadWorkbook: async (input) => {
      materializations += 1;
      const workbook = new ExcelJS.Workbook();
      const copy = new Uint8Array(input.byteLength);
      copy.set(input);
      await workbook.xlsx.load(copy.buffer);
      return workbook;
    },
  });
  assert.equal(materializations, 1);
  assert.equal(parsed.exportedQueryCount, 1);
});

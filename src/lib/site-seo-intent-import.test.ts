import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  MAX_TARGET_INTENT_UPLOAD_BYTES,
  parseTargetIntentWorkbook,
} from "./site-seo-intent-import";

function workbookBytes(rows: readonly (readonly unknown[])[]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows.map((row) => [...row])),
    "Интент",
  );
  return Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));
}

test("parses accepted Russian XLSX columns, both match types and an optional group", () => {
  const result = parseTargetIntentWorkbook(
    workbookBytes([
      [" КЛЮЧ ", "Группа", "Тип совпадения"],
      ["HER2-положительный", "Онкология", "точное"],
      ["рак лёгкого", "", "фраза"],
    ]),
    "intent.xlsx",
  );

  assert.equal(result.state, "valid");
  assert.equal(result.worksheet, "Интент");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [
    {
      sourceRowOrdinal: 2,
      key: "HER2-положительный",
      normalizedKey: "her2 положительный",
      group: "Онкология",
      matchType: "exact",
    },
    {
      sourceRowOrdinal: 3,
      key: "рак лёгкого",
      normalizedKey: "рак легкого",
      group: null,
      matchType: "phrase",
    },
  ]);
});

test("parses a real BIFF8 XLS workbook without applying ZIP preflight", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Ключ", "Группа", "Тип совпадения"],
    ["HER2-положительный", "Онкология", "точное"],
    ["рак лёгкого", "", "фраза"],
  ]), "Интент");
  const bytes = Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));

  const result = parseTargetIntentWorkbook(bytes, "intent.xls");

  assert.equal(bytes.subarray(0, 8).toString("hex"), "d0cf11e0a1b11ae1");
  assert.equal(result.state, "valid");
  assert.equal(result.format, "xls");
  assert.equal(result.worksheet, "Интент");
  assert.deepEqual(result.rows.map(({ normalizedKey, matchType, group }) => ({ normalizedKey, matchType, group })), [
    { normalizedKey: "her2 положительный", matchType: "exact", group: "Онкология" },
    { normalizedKey: "рак легкого", matchType: "phrase", group: null },
  ]);
});

test("retains byte and logical-row bounds for BIFF8 XLS workbooks", () => {
  const oversizedBytes = parseTargetIntentWorkbook(
    Buffer.alloc(MAX_TARGET_INTENT_UPLOAD_BYTES + 1, 0x61),
    "intent.xls",
  );
  assert.equal(oversizedBytes.errors[0]?.code, "file_too_large");

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Ключ", "Тип совпадения"],
    ...Array.from({ length: 10_001 }, (_, index) => [`key-${index}`, "точное"]),
  ]), "Интент");
  const oversizedRows = parseTargetIntentWorkbook(
    Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" })),
    "intent.xls",
  );

  assert.equal(oversizedRows.state, "invalid");
  assert.equal(oversizedRows.errors[0]?.code, "row_limit");
});

test("parses a UTF-8 CSV fixture into the same logical rows", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.from("Ключ,Группа,Тип совпадения\nHER2,Маркеры,точное\nрак лёгкого,,фраза\n"),
    "intent.csv",
  );

  assert.equal(result.state, "valid");
  assert.equal(result.format, "csv");
  assert.equal(result.worksheet, null);
  assert.deepEqual(result.rows.map(({ normalizedKey, matchType, group }) => ({ normalizedKey, matchType, group })), [
    { normalizedKey: "her2", matchType: "exact", group: "Маркеры" },
    { normalizedKey: "рак легкого", matchType: "phrase", group: null },
  ]);
});

test("reports an exact duplicate without silently dropping either source row", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.from("Ключ,Группа,Тип совпадения\nHER2,Маркеры,точное\nHER2,Маркеры,точное\n"),
    "intent.csv",
  );

  assert.equal(result.state, "invalid");
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.conflictCount, 0);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.errors, [{
    row: 3,
    code: "exact_duplicate",
    message: "Строка полностью повторяет строку 2",
  }]);
});

test("distinguishes a normalized duplicate from an exact duplicate", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.from("Ключ,Группа,Тип совпадения\nРак-лёгкого,Онкология,фраза\nрак легкого,Онкология,фраза\n"),
    "intent.csv",
  );

  assert.equal(result.state, "invalid");
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.errors, [{
    row: 3,
    code: "normalized_duplicate",
    message: "Нормализованный ключ повторяет строку 2",
  }]);
});

test("reports contradictory rules for the same normalized key as conflicts", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.from("Ключ,Группа,Тип совпадения\nHER2,Маркеры,точное\nher2,Онкология,фраза\n"),
    "intent.csv",
  );

  assert.equal(result.state, "invalid");
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.conflictCount, 1);
  assert.deepEqual(result.errors, [{
    row: 3,
    code: "conflict",
    message: "Правило конфликтует со строкой 2",
  }]);
});

test("rejects unknown columns rather than silently interpreting them", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.from("Ключ,Группа,Тип совпадения,Синоним\nHER2,Маркеры,точное,neu\n"),
    "intent.csv",
  );

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: 1,
    column: "Синоним",
    code: "unknown_column",
    message: "Неизвестный столбец: Синоним",
  }]);
});

test("rejects an empty file with a safe validation error", () => {
  const result = parseTargetIntentWorkbook(Buffer.alloc(0), "intent.csv");
  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: null,
    code: "empty_file",
    message: "Файл пуст",
  }]);
});

test("rejects a header-only table as empty rather than returning an unexplained invalid state", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.from("Ключ,Группа,Тип совпадения\n"),
    "intent.csv",
  );
  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: null,
    code: "empty_file",
    message: "Таблица не содержит правил",
  }]);
});

test("rejects bytes beyond the upload limit before parsing", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.alloc(MAX_TARGET_INTENT_UPLOAD_BYTES + 1, 0x61),
    "intent.csv",
  );
  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: null,
    code: "file_too_large",
    message: `Файл превышает лимит ${MAX_TARGET_INTENT_UPLOAD_BYTES} байт`,
  }]);
});

test("rejects malformed XLSX ZIP structure before SheetJS parsing", () => {
  const valid = workbookBytes([
    ["Ключ", "Тип совпадения"],
    ["HER2", "точное"],
  ]);
  const result = parseTargetIntentWorkbook(
    Buffer.concat([valid, Buffer.from("trailing archive payload")]),
    "intent.xlsx",
  );

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: null,
    code: "invalid_workbook",
    message: "Не удалось прочитать таблицу",
  }]);
});

test("preflights identical malformed ZIP OOXML bytes under XLSX and XLS suffixes", () => {
  const zipBytes = workbookBytes([
    ["Ключ", "Тип совпадения"],
    ["HER2", "точное"],
  ]);
  assert.equal(zipBytes.subarray(0, 4).toString("hex"), "504b0304");
  const malformed = Buffer.concat([zipBytes, Buffer.from("trailing archive payload")]);

  const xlsx = parseTargetIntentWorkbook(malformed, "intent.xlsx");
  const renamedXls = parseTargetIntentWorkbook(malformed, "intent.xls");

  assert.equal(xlsx.state, "invalid");
  assert.equal(renamedXls.state, "invalid");
  assert.deepEqual(renamedXls.errors, xlsx.errors);
});

test("fails closed when OOXML ZIP and OLE BIFF workbook suffixes are swapped", () => {
  const zipBytes = workbookBytes([
    ["Ключ", "Тип совпадения"],
    ["HER2", "точное"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Ключ", "Тип совпадения"],
    ["HER2", "точное"],
  ]), "Интент");
  const biffBytes = Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));

  for (const result of [
    parseTargetIntentWorkbook(zipBytes, "intent.xls"),
    parseTargetIntentWorkbook(biffBytes, "intent.xlsx"),
  ]) {
    assert.equal(result.state, "invalid");
    assert.equal(result.errors[0]?.code, "invalid_workbook");
  }
});

test("bounds logical rows before materializing an unbounded catalogue", () => {
  const rows = Array.from({ length: 10_001 }, (_, index) => `key-${index},точное`);
  const result = parseTargetIntentWorkbook(
    Buffer.from(`Ключ,Тип совпадения\n${rows.join("\n")}\n`),
    "intent.csv",
  );

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: null,
    code: "row_limit",
    message: "Таблица содержит более 10000 строк правил",
  }]);
});

test("rejects invalid UTF-8 CSV bytes instead of decoding replacement characters", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.concat([
      Buffer.from("Ключ,Тип совпадения\n"),
      Buffer.from([0xc3, 0x28]),
      Buffer.from(",точное\n"),
    ]),
    "intent.csv",
  );

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: null,
    code: "invalid_encoding",
    message: "CSV должен быть в кодировке UTF-8",
  }]);
});

test("rejects duplicate recognized headers", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.from("Ключ,КЛЮЧ,Тип совпадения\nHER2,neu,точное\n"),
    "intent.csv",
  );

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: 1,
    column: "КЛЮЧ",
    code: "duplicate_column",
    message: "Столбец указан повторно: КЛЮЧ",
  }]);
});

test("rejects populated cells under an unnamed column", () => {
  const result = parseTargetIntentWorkbook(
    Buffer.from("Ключ,Тип совпадения,\nHER2,точное,скрытое значение\n"),
    "intent.csv",
  );

  assert.equal(result.state, "invalid");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [{
    row: 2,
    column: "3",
    code: "unnamed_column",
    message: "Строка 2 содержит значение в безымянном столбце 3",
  }]);
});

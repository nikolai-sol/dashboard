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

import * as XLSX from "xlsx";
import { assertBoundedXlsxZip } from "./xlsx-zip-preflight";

export const MAX_TARGET_INTENT_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_TARGET_INTENT_LOGICAL_ROWS = 10_000;

export type TargetIntentImportRow = Readonly<{
  sourceRowOrdinal: number;
  key: string;
  normalizedKey: string;
  group: string | null;
  matchType: "exact" | "phrase";
}>;

export type TargetIntentImportError = Readonly<{
  row: number | null;
  column?: string;
  code:
    | "empty_file"
    | "file_too_large"
    | "unsupported_file"
    | "invalid_workbook"
    | "invalid_encoding"
    | "source_unavailable"
    | "row_limit"
    | "missing_column"
    | "unknown_column"
    | "duplicate_column"
    | "unnamed_column"
    | "empty_key"
    | "unknown_match_type"
    | "exact_duplicate"
    | "normalized_duplicate"
    | "conflict";
  message: string;
}>;

export type TargetIntentImportResult = Readonly<{
  state: "valid" | "invalid";
  format: "csv" | "xls" | "xlsx";
  worksheet: string | null;
  rows: readonly TargetIntentImportRow[];
  errors: readonly TargetIntentImportError[];
  duplicateCount: number;
  conflictCount: number;
}>;

const expectedHeaders = new Map([
  ["ключ", "key"],
  ["группа", "group"],
  ["тип совпадения", "matchType"],
] as const);

function normalizedText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeTargetIntentKey(value: unknown): string {
  return normalizedText(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[\p{P}\p{S}_]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function emptyResult(
  error: TargetIntentImportError,
  format: "csv" | "xls" | "xlsx",
): TargetIntentImportResult {
  return {
    state: "invalid",
    format,
    worksheet: null,
    rows: [],
    errors: [error],
    duplicateCount: 0,
    conflictCount: 0,
  };
}

function extension(filename: string): "csv" | "xls" | "xlsx" | null {
  const match = String(filename ?? "").trim().toLowerCase().match(/\.([^.]+)$/u);
  if (match?.[1] === "csv") return "csv";
  if (match?.[1] === "xlsx") return "xlsx";
  if (match?.[1] === "xls") return "xls";
  return null;
}

function parseMatchType(value: unknown): "exact" | "phrase" | null {
  const normalized = normalizedText(value).toLocaleLowerCase("ru-RU");
  if (normalized === "точное") return "exact";
  if (normalized === "фраза") return "phrase";
  return null;
}

type WorkbookContainer = "zip" | "ole" | "text";

function workbookContainer(bytes: Buffer): WorkbookContainer {
  const signature = bytes.length >= 4 ? bytes.readUInt32LE(0) : null;
  if (
    signature === 0x04034b50 ||
    signature === 0x06054b50 ||
    signature === 0x08074b50 ||
    signature === 0x02014b50
  ) return "zip";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) return "ole";
  return "text";
}

function readLogicalTable(
  bytes: Buffer,
  format: "csv" | "xls" | "xlsx",
): { worksheet: string | null; cells: unknown[][] } {
  const container = workbookContainer(bytes);
  if (container === "zip") assertBoundedXlsxZip(bytes);
  if (
    (format === "xlsx" && container !== "zip") ||
    (format === "xls" && container !== "ole") ||
    (format === "csv" && container !== "text")
  ) throw new Error("Workbook container does not match its filename suffix");
  const source = format === "csv"
    ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    : bytes;
  const workbook = XLSX.read(source, {
    type: format === "csv" ? "string" : "buffer",
    raw: true,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellText: false,
    bookVBA: false,
    bookFiles: false,
  });
  const worksheetName = workbook.SheetNames[0];
  if (!worksheetName) return { worksheet: null, cells: [] };
  const worksheet = workbook.Sheets[worksheetName];
  const range = worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]) : null;
  if (range && range.e.r - range.s.r > MAX_TARGET_INTENT_LOGICAL_ROWS) {
    throw new RangeError("target_intent_row_limit");
  }
  const cells = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: "",
  });
  return { worksheet: format === "csv" ? null : worksheetName, cells };
}

export function parseTargetIntentWorkbook(
  input: Buffer | Uint8Array,
  filename: string,
): TargetIntentImportResult {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const format = extension(filename) ?? "xlsx";
  if (bytes.length === 0) {
    return emptyResult({ row: null, code: "empty_file", message: "Файл пуст" }, format);
  }
  if (bytes.length > MAX_TARGET_INTENT_UPLOAD_BYTES) {
    return emptyResult({
      row: null,
      code: "file_too_large",
      message: `Файл превышает лимит ${MAX_TARGET_INTENT_UPLOAD_BYTES} байт`,
    }, format);
  }
  const detectedFormat = extension(filename);
  if (!detectedFormat) {
    return emptyResult({
      row: null,
      code: "unsupported_file",
      message: "Поддерживаются только XLSX, XLS и CSV",
    }, format);
  }

  let table: { worksheet: string | null; cells: unknown[][] };
  try {
    table = readLogicalTable(bytes, detectedFormat);
  } catch (error) {
    if (error instanceof RangeError && error.message === "target_intent_row_limit") {
      return emptyResult({
        row: null,
        code: "row_limit",
        message: `Таблица содержит более ${MAX_TARGET_INTENT_LOGICAL_ROWS} строк правил`,
      }, detectedFormat);
    }
    if (error instanceof TypeError && /encoded data was not valid|UTF-8/i.test(error.message)) {
      return emptyResult({
        row: null,
        code: "invalid_encoding",
        message: "CSV должен быть в кодировке UTF-8",
      }, detectedFormat);
    }
    return emptyResult({
      row: null,
      code: "invalid_workbook",
      message: "Не удалось прочитать таблицу",
    }, detectedFormat);
  }
  if (table.cells.length === 0) {
    return emptyResult({ row: null, code: "empty_file", message: "Файл пуст" }, detectedFormat);
  }

  const headers = table.cells[0].map((value) => normalizedText(value));
  const columns = new Map<"key" | "group" | "matchType", number>();
  const headerErrors: TargetIntentImportError[] = [];
  const unnamedColumns: number[] = [];
  headers.forEach((header, index) => {
    if (!header) {
      unnamedColumns.push(index);
      return;
    }
    const field = expectedHeaders.get(header.toLocaleLowerCase("ru-RU") as never);
    if (!field) {
      headerErrors.push({
        row: 1,
        column: header,
        code: "unknown_column",
        message: `Неизвестный столбец: ${header}`,
      });
      return;
    }
    if (columns.has(field)) {
      headerErrors.push({
        row: 1,
        column: header,
        code: "duplicate_column",
        message: `Столбец указан повторно: ${header}`,
      });
      return;
    }
    columns.set(field, index);
  });
  for (let rowIndex = 1; rowIndex < table.cells.length; rowIndex += 1) {
    for (const columnIndex of unnamedColumns) {
      if (!normalizedText(table.cells[rowIndex]?.[columnIndex])) continue;
      headerErrors.push({
        row: rowIndex + 1,
        column: String(columnIndex + 1),
        code: "unnamed_column",
        message: `Строка ${rowIndex + 1} содержит значение в безымянном столбце ${columnIndex + 1}`,
      });
    }
  }
  for (const [header, field] of expectedHeaders) {
    if (field !== "group" && !columns.has(field)) {
      headerErrors.push({
        row: 1,
        column: header,
        code: "missing_column",
        message: `Отсутствует обязательный столбец: ${header}`,
      });
    }
  }
  if (headerErrors.length > 0) {
    return {
      state: "invalid",
      format: detectedFormat,
      worksheet: table.worksheet,
      rows: [],
      errors: headerErrors,
      duplicateCount: 0,
      conflictCount: 0,
    };
  }

  const rows: TargetIntentImportRow[] = [];
  const errors: TargetIntentImportError[] = [];
  for (let index = 1; index < table.cells.length; index += 1) {
    const cells = table.cells[index];
    const sourceRowOrdinal = index + 1;
    const key = normalizedText(cells[columns.get("key")!]);
    const group = normalizedText(cells[columns.get("group") ?? -1]) || null;
    const matchTypeValue = cells[columns.get("matchType")!];
    const matchType = parseMatchType(matchTypeValue);
    if (!key) {
      errors.push({ row: sourceRowOrdinal, column: "Ключ", code: "empty_key", message: "Ключ не может быть пустым" });
      continue;
    }
    if (!matchType) {
      errors.push({
        row: sourceRowOrdinal,
        column: "Тип совпадения",
        code: "unknown_match_type",
        message: "Тип совпадения должен быть «точное» или «фраза»",
      });
      continue;
    }
    const normalizedKey = normalizeTargetIntentKey(key);
    if (!normalizedKey) {
      errors.push({ row: sourceRowOrdinal, column: "Ключ", code: "empty_key", message: "Ключ не может быть пустым" });
      continue;
    }
    rows.push({ sourceRowOrdinal, key, normalizedKey, group, matchType });
  }
  if (rows.length === 0 && errors.length === 0) {
    errors.push({
      row: null,
      code: "empty_file",
      message: "Таблица не содержит правил",
    });
  }

  let duplicateCount = 0;
  let conflictCount = 0;
  const firstByNormalizedKey = new Map<string, TargetIntentImportRow>();
  for (const row of rows) {
    const previous = firstByNormalizedKey.get(row.normalizedKey);
    if (!previous) {
      firstByNormalizedKey.set(row.normalizedKey, row);
      continue;
    }
    if (previous.matchType !== row.matchType || previous.group !== row.group) {
      conflictCount += 1;
      errors.push({
        row: row.sourceRowOrdinal,
        code: "conflict",
        message: `Правило конфликтует со строкой ${previous.sourceRowOrdinal}`,
      });
    } else {
      duplicateCount += 1;
      const exact = previous.key === row.key;
      errors.push({
        row: row.sourceRowOrdinal,
        code: exact ? "exact_duplicate" : "normalized_duplicate",
        message: exact
          ? `Строка полностью повторяет строку ${previous.sourceRowOrdinal}`
          : `Нормализованный ключ повторяет строку ${previous.sourceRowOrdinal}`,
      });
    }
  }

  return {
    state: errors.length === 0 && rows.length > 0 ? "valid" : "invalid",
    format: detectedFormat,
    worksheet: table.worksheet,
    rows,
    errors,
    duplicateCount,
    conflictCount,
  };
}

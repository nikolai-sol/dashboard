import * as XLSX from "xlsx";

export const MAX_TARGET_INTENT_UPLOAD_BYTES = 5 * 1024 * 1024;

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
    | "source_unavailable"
    | "missing_column"
    | "unknown_column"
    | "empty_key"
    | "unknown_match_type"
    | "exact_duplicate"
    | "normalized_duplicate"
    | "conflict";
  message: string;
}>;

export type TargetIntentImportResult = Readonly<{
  state: "valid" | "invalid";
  format: "csv" | "xlsx";
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
  format: "csv" | "xlsx",
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

function extension(filename: string): "csv" | "xlsx" | null {
  const match = String(filename ?? "").trim().toLowerCase().match(/\.([^.]+)$/u);
  if (match?.[1] === "csv") return "csv";
  if (match?.[1] === "xlsx" || match?.[1] === "xls") return "xlsx";
  return null;
}

function parseMatchType(value: unknown): "exact" | "phrase" | null {
  const normalized = normalizedText(value).toLocaleLowerCase("ru-RU");
  if (normalized === "точное") return "exact";
  if (normalized === "фраза") return "phrase";
  return null;
}

function readLogicalTable(
  bytes: Buffer,
  format: "csv" | "xlsx",
): { worksheet: string | null; cells: unknown[][] } {
  const workbook = XLSX.read(format === "csv" ? bytes.toString("utf8") : bytes, {
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
  const cells = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: "",
  });
  return { worksheet: format === "xlsx" ? worksheetName : null, cells };
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
  } catch {
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
  headers.forEach((header, index) => {
    if (!header) return;
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
    columns.set(field, index);
  });
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

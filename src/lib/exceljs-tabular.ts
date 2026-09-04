import ExcelJS from "exceljs";

export async function loadExcelWorkbook(buffer: Buffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  await workbook.xlsx.load(copy.buffer);
  return workbook;
}

export function excelCellRawValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date || typeof value !== "object") return value;
  const structured = value as {
    result?: unknown;
    text?: unknown;
    hyperlink?: unknown;
    richText?: Array<{ text?: unknown }>;
    error?: unknown;
  };
  if ("result" in structured) return structured.result ?? "";
  if (Array.isArray(structured.richText)) {
    return structured.richText.map((part) => String(part.text ?? "")).join("");
  }
  if ("text" in structured) return structured.text ?? structured.hyperlink ?? "";
  if ("error" in structured) return structured.error ?? "";
  return cell.text;
}

export function worksheetToObjects(
  worksheet: ExcelJS.Worksheet,
  options: {
    normalizeHeader?: (header: string) => string;
    includeRowIndex?: boolean;
    emptyValue?: unknown;
  } = {},
): Record<string, unknown>[] {
  const normalizeHeader = options.normalizeHeader ?? ((header: string) => header);
  const emptyValue = options.emptyValue ?? "";
  const headers = new Map<number, string>();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    const header = normalizeHeader(cell.text.trim());
    if (header) headers.set(column, header);
  });
  if (headers.size === 0) return [];

  const rows: Record<string, unknown>[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const sourceRow = worksheet.getRow(rowNumber);
    const record: Record<string, unknown> = {};
    let hasValue = false;
    for (const [column, header] of headers) {
      const value = excelCellRawValue(sourceRow.getCell(column));
      const normalized = value === null || value === undefined || value === "" ? emptyValue : value;
      record[header] = normalized;
      if (normalized !== emptyValue && String(normalized).trim() !== "") hasValue = true;
    }
    if (!hasValue) continue;
    if (options.includeRowIndex) record.__row_index = rowNumber;
    rows.push(record);
  }
  return rows;
}

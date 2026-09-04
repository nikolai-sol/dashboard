import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import ExcelJS from "exceljs";
import { loadExcelWorkbook } from "./exceljs-tabular";

export const MAX_ALICE_WORKBOOK_BYTES = 5 * 1024 * 1024;
export const MAX_ALICE_QUERY_ROWS = 5_000;
export const MAX_ALICE_SOURCE_ROWS = MAX_ALICE_QUERY_ROWS * 10;
export const MAX_ALICE_FEATURED_SITES = 100;

const EXPECTED_ALICE_HEADERS = [
  "Запрос",
  "Присутствует сайт",
  "Ответ в Алисе AI",
  ...Array.from({ length: 10 }, (_, index) => `Сайт ${index + 1}`),
];

export type AliceVisibilityImportInput = {
  accountId: string;
  portalDomain: string;
  period: string;
  officialSovPct: number;
  capturedAt: string;
  sourceFilename: string;
  featuredSites: string[];
};

export type ParsedAliceVisibilityQuery = {
  queryHash: string;
  queryText: string;
  rawPresentValue: string;
  portalPresent: boolean;
  portalPosition: number | null;
  portalUrl: string | null;
  aliceAnswerUrl: string;
  sourceCount: number;
};

export type ParsedAliceVisibilitySource = {
  queryHash: string;
  sourceRank: number;
  sourceUrl: string;
  sourceDomain: string;
  isPortal: boolean;
};

export type ParsedAliceVisibilitySnapshot = AliceVisibilityImportInput & {
  sourceSha256: string;
  exportedQueryCount: number;
  portalPresentQueryCount: number;
  samplePresencePct: number;
  queries: ParsedAliceVisibilityQuery[];
  sources: ParsedAliceVisibilitySource[];
  featured: Array<{ displayOrder: number; siteUrl: string; siteDomain: string }>;
};

export function isPortalHostname(hostname: string, portalDomain: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  const portal = portalDomain.toLowerCase().replace(/^www\./, "");
  return normalized === portal || normalized.endsWith(`.${portal}`);
}

function requiredUrl(value: unknown, label: string): URL {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}: ссылка отсутствует`);
  return new URL(text);
}

function assertWorkbookSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ALICE_WORKBOOK_BYTES) {
    throw new Error("Размер XLSX не должен превышать 5 MiB");
  }
}

function cellText(row: ExcelJS.Row, column: number): string {
  return row.getCell(column).text.trim();
}

function hasNonEmptyExtraCell(row: ExcelJS.Row): boolean {
  let hasExtra = false;
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    if (column > EXPECTED_ALICE_HEADERS.length && cell.text.trim()) hasExtra = true;
  });
  return hasExtra;
}

export async function parseAliceVisibilityWorkbook(
  buffer: Buffer,
  input: AliceVisibilityImportInput,
): Promise<ParsedAliceVisibilitySnapshot> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new Error("Период должен иметь формат YYYY-MM");
  if (!Number.isFinite(input.officialSovPct) || input.officialSovPct < 0 || input.officialSovPct > 100) {
    throw new Error("Доля запросов должна быть от 0 до 100");
  }
  if (input.featuredSites.length > MAX_ALICE_FEATURED_SITES) {
    throw new Error("Допускается не более 100 отмеченных сайтов");
  }
  assertWorkbookSize(buffer.byteLength);

  const workbook = await loadExcelWorkbook(buffer);
  if (workbook.worksheets.length !== 1) {
    throw new Error("XLSX должен содержать ровно один рабочий лист");
  }
  const worksheet = workbook.worksheets[0]!;
  if (worksheet.rowCount > MAX_ALICE_QUERY_ROWS + 1) {
    throw new Error("XLSX содержит более 5000 строк запросов");
  }
  const headerRow = worksheet.getRow(1);
  const headers = EXPECTED_ALICE_HEADERS.map((_header, index) => cellText(headerRow, index + 1));
  if (
    JSON.stringify(headers) !== JSON.stringify(EXPECTED_ALICE_HEADERS) ||
    hasNonEmptyExtraCell(headerRow)
  ) {
    throw new Error("Заголовки workbook не соответствуют ожидаемому формату");
  }

  const seen = new Set<string>();
  const queries: ParsedAliceVisibilityQuery[] = [];
  const sources: ParsedAliceVisibilitySource[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (hasNonEmptyExtraCell(row)) {
      throw new Error(`Строка ${rowNumber}: лишние ячейки после сайта 10`);
    }
    const queryText = cellText(row, 1);
    if (!queryText) throw new Error(`Строка ${rowNumber}: запрос отсутствует`);
    const queryHash = createHash("sha256").update(queryText.toLowerCase()).digest("hex");
    if (seen.has(queryHash)) throw new Error(`Строка ${rowNumber}: запрос повторяется`);
    seen.add(queryHash);

    const rawPresentValue = cellText(row, 2).toLowerCase();
    if (rawPresentValue !== "true" && rawPresentValue !== "false") {
      throw new Error(`Строка ${rowNumber}: присутствие должно быть true или false`);
    }
    const aliceAnswerUrl = requiredUrl(cellText(row, 3), `Строка ${rowNumber}: ответ`).toString();
    const rowSources: ParsedAliceVisibilitySource[] = [];
    for (let sourceIndex = 0; sourceIndex < 10; sourceIndex += 1) {
      const value = cellText(row, sourceIndex + 4);
      if (!value) continue;
      const parsed = requiredUrl(value, `Строка ${rowNumber}, сайт ${sourceIndex + 1}`);
      rowSources.push({
        queryHash,
        sourceRank: sourceIndex + 1,
        sourceUrl: parsed.toString(),
        sourceDomain: parsed.hostname.toLowerCase().replace(/^www\./, ""),
        isPortal: isPortalHostname(parsed.hostname, input.portalDomain),
      });
    }
    if (sources.length + rowSources.length > MAX_ALICE_SOURCE_ROWS) {
      throw new Error("XLSX содержит слишком много строк источников");
    }
    const portalSource = rowSources.find((source) => source.isPortal) ?? null;
    const portalPresent = portalSource !== null;
    if (portalPresent !== (rawPresentValue === "true")) {
      throw new Error(`Строка ${rowNumber}: отметка присутствия не совпадает с источниками`);
    }
    sources.push(...rowSources);
    queries.push({ queryHash, queryText, rawPresentValue, portalPresent, portalPosition: portalSource?.sourceRank ?? null, portalUrl: portalSource?.sourceUrl ?? null, aliceAnswerUrl, sourceCount: rowSources.length });
  }

  const portalPresentQueryCount = queries.filter((query) => query.portalPresent).length;
  const featured = input.featuredSites.map((siteUrl, index) => {
    const parsed = requiredUrl(siteUrl, `Отмеченный сайт ${index + 1}`);
    return { displayOrder: index + 1, siteUrl: parsed.toString(), siteDomain: parsed.hostname.toLowerCase().replace(/^www\./, "") };
  });
  return { ...input, sourceSha256: createHash("sha256").update(buffer).digest("hex"), exportedQueryCount: queries.length, portalPresentQueryCount, samplePresencePct: queries.length ? portalPresentQueryCount / queries.length * 100 : 0, queries, sources, featured };
}

export async function parseAliceVisibilityWorkbookFile(
  filePath: string,
  input: AliceVisibilityImportInput,
): Promise<ParsedAliceVisibilitySnapshot> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("XLSX source must be a regular file");
  assertWorkbookSize(fileStat.size);
  return parseAliceVisibilityWorkbook(await readFile(filePath), input);
}

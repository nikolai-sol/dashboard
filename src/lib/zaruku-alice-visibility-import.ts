import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type ExcelJS from "exceljs";
import ExcelJSWorkbook from "exceljs/lib/doc/workbook";
import { assertBoundedXlsxZip } from "./xlsx-zip-preflight";
import { isHostnameWithinDomain, parseAbsoluteHttpUrl } from "./zaruku-url";

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
  officialSovPct: number | null;
  sourcePeriod?: AliceVisibilitySourcePeriod;
  officialSovPoints?: AliceVisibilityOfficialSovPoint[];
  capturedAt: string;
  sourceFilename: string;
  featuredSites: string[];
};

export type AliceVisibilitySourcePeriod = {
  kind: "calendar_month" | "custom";
  from: string;
  to: string;
};

export type AliceVisibilityOfficialSovPoint = {
  from: string;
  to: string;
  value: number;
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

export type AliceWorkbookLoader = (buffer: Buffer) => Promise<ExcelJS.Workbook>;

async function loadAliceWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJSWorkbook();
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  await workbook.xlsx.load(copy.buffer);
  return workbook;
}

export type ParsedAliceVisibilitySnapshot = Omit<
  AliceVisibilityImportInput,
  "sourcePeriod" | "officialSovPoints"
> & {
  sourcePeriod: AliceVisibilitySourcePeriod;
  officialSovPoints: AliceVisibilityOfficialSovPoint[];
  sourceSha256: string;
  exportedQueryCount: number;
  portalPresentQueryCount: number;
  samplePresencePct: number;
  queries: ParsedAliceVisibilityQuery[];
  sources: ParsedAliceVisibilitySource[];
  featured: Array<{ displayOrder: number; siteUrl: string; siteDomain: string }>;
};

function isoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be an ISO date`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid ISO date`);
  }
  return value;
}

function calendarMonthPeriod(period: string): AliceVisibilitySourcePeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error("period должен иметь формат YYYY-MM");
  }
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return {
    kind: "calendar_month",
    from: `${period}-01`,
    to: `${period}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function normalizeAliceVisibilityPeriod(input: Pick<
  AliceVisibilityImportInput,
  "period" | "officialSovPct" | "sourcePeriod" | "officialSovPoints"
>): {
  sourcePeriod: AliceVisibilitySourcePeriod;
  officialSovPoints: AliceVisibilityOfficialSovPoint[];
} {
  const monthlyPeriod = calendarMonthPeriod(input.period);
  const sourcePeriod = input.sourcePeriod ?? monthlyPeriod;
  if (
    !sourcePeriod ||
    (sourcePeriod.kind !== "calendar_month" && sourcePeriod.kind !== "custom")
  ) {
    throw new Error("source period kind must be calendar_month or custom");
  }
  const from = isoDate(sourcePeriod.from, "source period from");
  const to = isoDate(sourcePeriod.to, "source period to");
  if (from > to) throw new Error("source period from must not be after source period to");
  const officialSovPoints = input.officialSovPoints ?? [];
  if (!Array.isArray(officialSovPoints)) throw new Error("official weekly points must be an array");

  if (sourcePeriod.kind === "calendar_month") {
    if (from !== monthlyPeriod.from || to !== monthlyPeriod.to) {
      throw new Error("calendar_month source period must match the exact reporting month");
    }
    if (officialSovPoints.length !== 0) {
      throw new Error("calendar_month snapshot must not contain official weekly points");
    }
    if (typeof input.officialSovPct !== "number" || !Number.isFinite(input.officialSovPct) || input.officialSovPct < 0 || input.officialSovPct > 100) {
      throw new Error("Доля запросов должна быть от 0 до 100");
    }
    return { sourcePeriod: { kind: "calendar_month", from, to }, officialSovPoints: [] };
  }

  if (input.officialSovPct !== null) {
    throw new Error("custom snapshot official SOV must be null when weekly points are supplied");
  }
  if (officialSovPoints.length === 0) {
    throw new Error("custom snapshot requires nonempty official weekly points");
  }
  let previousTo: string | null = null;
  const normalizedPoints = officialSovPoints.map((point, index) => {
    if (!point || typeof point !== "object") throw new Error(`official weekly point ${index + 1} must be an object`);
    const pointFrom = isoDate(point.from, `official weekly point ${index + 1} from`);
    const pointTo = isoDate(point.to, `official weekly point ${index + 1} to`);
    if (pointFrom < from || pointTo > to) {
      throw new Error(`official weekly point ${index + 1} must be inside the source period`);
    }
    const pointFromDate = new Date(`${pointFrom}T00:00:00Z`);
    const pointToDate = new Date(`${pointTo}T00:00:00Z`);
    const inclusiveDays = (pointToDate.getTime() - pointFromDate.getTime()) / 86_400_000 + 1;
    if (pointFromDate.getUTCDay() !== 1 || pointToDate.getUTCDay() !== 0 || inclusiveDays !== 7) {
      throw new Error(`official weekly point ${index + 1} must cover Monday through Sunday (7 days)`);
    }
    if (previousTo !== null && pointFrom <= previousTo) {
      throw new Error("official weekly points must be ordered and nonoverlapping");
    }
    if (typeof point.value !== "number" || !Number.isFinite(point.value) || point.value < 0 || point.value > 100) {
      throw new Error(`official weekly point ${index + 1} value must be between 0 and 100`);
    }
    previousTo = pointTo;
    return { from: pointFrom, to: pointTo, value: point.value };
  });
  return {
    sourcePeriod: { kind: "custom", from, to },
    officialSovPoints: normalizedPoints,
  };
}

export function isPortalHostname(hostname: string, portalDomain: string): boolean {
  return isHostnameWithinDomain(hostname, portalDomain);
}

function requiredUrl(value: unknown, label: string): URL {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}: ссылка отсутствует`);
  const url = parseAbsoluteHttpUrl(text);
  if (!url) throw new Error(`${label}: требуется абсолютная HTTP(S) ссылка с доменом`);
  return url;
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
  dependencies: { loadWorkbook?: AliceWorkbookLoader } = {},
): Promise<ParsedAliceVisibilitySnapshot> {
  const normalizedPeriod = normalizeAliceVisibilityPeriod(input);
  if (input.featuredSites.length > MAX_ALICE_FEATURED_SITES) {
    throw new Error("Допускается не более 100 отмеченных сайтов");
  }
  assertWorkbookSize(buffer.byteLength);
  assertBoundedXlsxZip(buffer);

  const workbook = await (dependencies.loadWorkbook ?? loadAliceWorkbook)(buffer);
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
  return { ...input, ...normalizedPeriod, sourceSha256: createHash("sha256").update(buffer).digest("hex"), exportedQueryCount: queries.length, portalPresentQueryCount, samplePresencePct: queries.length ? portalPresentQueryCount / queries.length * 100 : 0, queries, sources, featured };
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

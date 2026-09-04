import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

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

export function parseAliceVisibilityWorkbook(
  buffer: Buffer,
  input: AliceVisibilityImportInput,
): ParsedAliceVisibilitySnapshot {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new Error("Период должен иметь формат YYYY-MM");
  if (!Number.isFinite(input.officialSovPct) || input.officialSovPct < 0 || input.officialSovPct > 100) {
    throw new Error("Доля запросов должна быть от 0 до 100");
  }

  const workbook = XLSX.read(buffer, { type: "buffer", dense: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Рабочий лист отсутствует");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false });
  const expected = ["Запрос", "Присутствует сайт", "Ответ в Алисе AI", ...Array.from({ length: 10 }, (_, i) => `Сайт ${i + 1}`)];
  if (rows.length === 0 || JSON.stringify(rows[0]?.slice(0, expected.length)) !== JSON.stringify(expected)) {
    throw new Error("Заголовки workbook не соответствуют ожидаемому формату");
  }

  const seen = new Set<string>();
  const queries: ParsedAliceVisibilityQuery[] = [];
  const sources: ParsedAliceVisibilitySource[] = [];
  for (const [offset, row] of rows.slice(1).entries()) {
    const rowNumber = offset + 2;
    const queryText = String(row[0] ?? "").trim();
    if (!queryText) throw new Error(`Строка ${rowNumber}: запрос отсутствует`);
    const queryHash = createHash("sha256").update(queryText.toLowerCase()).digest("hex");
    if (seen.has(queryHash)) throw new Error(`Строка ${rowNumber}: запрос повторяется`);
    seen.add(queryHash);

    const rawPresentValue = String(row[1] ?? "").trim().toLowerCase();
    if (rawPresentValue !== "true" && rawPresentValue !== "false") {
      throw new Error(`Строка ${rowNumber}: присутствие должно быть true или false`);
    }
    const aliceAnswerUrl = requiredUrl(row[2], `Строка ${rowNumber}: ответ`).toString();
    const rowSources = row.slice(3, 13).flatMap((value, index) => {
      if (!String(value ?? "").trim()) return [];
      const parsed = requiredUrl(value, `Строка ${rowNumber}, сайт ${index + 1}`);
      return [{ queryHash, sourceRank: index + 1, sourceUrl: parsed.toString(), sourceDomain: parsed.hostname.toLowerCase().replace(/^www\./, ""), isPortal: isPortalHostname(parsed.hostname, input.portalDomain) }];
    });
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

import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type {
  ZarukuGoogleSearchConsoleData,
  ZarukuGoogleSearchConsolePageRow,
  ZarukuGoogleSearchConsoleQueryRow,
  ZarukuGoogleSearchConsoleSummaryRow,
} from "@/lib/types";

export type SqlQuery = { sql: string; params: string[] };
export type GscQueryExecutor = (query: SqlQuery) => Promise<unknown[]>;

type GscQueryDbRow = {
  week_key: string;
  query_id: string;
  query_text: string;
  device_type: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

type GscPageDbRow = {
  week_key: string;
  page_id: string;
  page_url: string;
  device_type: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

type GscSummaryDbRow = {
  week_key: string;
  device_type: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

function buildInClause(values: readonly string[]) {
  return values.map(() => "?").join(", ");
}

function normalizePropertyUrls(propertyUrls: string[]) {
  const normalized = propertyUrls.map((propertyUrl) => propertyUrl.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : ["https://zaruku.ru/"];
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asNullableNumber(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function formatDate(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function weekClause(weeks: string[] | undefined, params: string[]) {
  const normalizedWeeks = (weeks ?? []).map((week) => week.trim()).filter(Boolean);
  if (normalizedWeeks.length === 0) return "";
  params.push(...normalizedWeeks);
  return `AND CONCAT(LEFT(YEARWEEK(report_date, 3), 4), '-W', RIGHT(YEARWEEK(report_date, 3), 2)) IN (${buildInClause(normalizedWeeks)})`;
}

function weightedAveragePositionSql() {
  return `
          CASE
            WHEN SUM(CASE WHEN average_position IS NULL THEN 0 ELSE impressions END) > 0
              THEN SUM(CASE WHEN average_position IS NULL THEN 0 ELSE average_position * impressions END)
                / NULLIF(SUM(CASE WHEN average_position IS NULL THEN 0 ELSE impressions END), 0)
            ELSE AVG(average_position)
          END`;
}

export function normalizeGscQueryRow(row: GscQueryDbRow): ZarukuGoogleSearchConsoleQueryRow {
  return {
    week: String(row.week_key),
    query_id: String(row.query_id),
    query: String(row.query_text),
    device: String(row.device_type),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

export function normalizeGscPageRow(row: GscPageDbRow): ZarukuGoogleSearchConsolePageRow {
  return {
    week: String(row.week_key),
    page_id: String(row.page_id),
    url: String(row.page_url),
    device: String(row.device_type),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

export function normalizeGscSummaryRow(row: GscSummaryDbRow): ZarukuGoogleSearchConsoleSummaryRow {
  return {
    week: String(row.week_key),
    device: String(row.device_type),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

const WEEK_KEY_SQL = "CONCAT(LEFT(YEARWEEK(report_date, 3), 4), '-W', RIGHT(YEARWEEK(report_date, 3), 2))";
const WEEK_FROM_SQL = "DATE_SUB(report_date, INTERVAL WEEKDAY(report_date) DAY)";
const WEEK_END_SQL = `DATE_ADD(${WEEK_FROM_SQL}, INTERVAL 6 DAY)`;

export function buildGoogleSearchConsoleAccountQueries(propertyUrls: string[], weeks?: string[]): Record<"queries" | "pages" | "summary", SqlQuery> {
  const normalizedPropertyUrls = normalizePropertyUrls(propertyUrls);
  const propertyScope = buildInClause(normalizedPropertyUrls);
  const queryParams = [...normalizedPropertyUrls];
  const pageParams = [...normalizedPropertyUrls];
  const summaryParams = [...normalizedPropertyUrls];
  const queryWeekClause = weekClause(weeks, queryParams);
  const pageWeekClause = weekClause(weeks, pageParams);
  const summaryWeekClause = weekClause(weeks, summaryParams);

  return {
    queries: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          query_hash AS query_id,
          query_text,
          device_type,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_queries_daily
        WHERE property_url IN (${propertyScope})
          ${queryWeekClause}
        GROUP BY week_key, query_hash, query_text, device_type
        ORDER BY week_key ASC, impressions DESC, clicks DESC, query_text ASC
      `,
      params: queryParams,
    },
    pages: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          page_hash AS page_id,
          page_url,
          device_type,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_pages_daily
        WHERE property_url IN (${propertyScope})
          ${pageWeekClause}
        GROUP BY week_key, page_hash, page_url, device_type
        ORDER BY week_key ASC, impressions DESC, clicks DESC, page_url ASC
      `,
      params: pageParams,
    },
    summary: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          device_type,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_summary_daily
        WHERE property_url IN (${propertyScope})
          ${summaryWeekClause}
        GROUP BY week_key, device_type
        ORDER BY week_key ASC, impressions DESC
      `,
      params: summaryParams,
    },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSettledRows<DbRow, ResultRow>(
  result: PromiseSettledResult<unknown[]>,
  label: string,
  normalize: (row: DbRow) => ResultRow,
  errors: string[],
) {
  if (result.status === "rejected") {
    errors.push(`${label}: ${errorMessage(result.reason)}`);
    return { rows: [] as ResultRow[], available: false };
  }
  try {
    return { rows: result.value.map((row) => normalize(row as DbRow)), available: true };
  } catch (error) {
    errors.push(`${label}: ${errorMessage(error)}`);
    return { rows: [] as ResultRow[], available: false };
  }
}

async function executeGscQuery(query: SqlQuery) {
  const [rows] = await pool.execute<RowDataPacket[]>(query.sql, query.params);
  return rows;
}

export async function loadZarukuGoogleSearchConsoleData(
  propertyUrls: string[],
  weeks?: string[],
  executeQuery: GscQueryExecutor = executeGscQuery,
): Promise<ZarukuGoogleSearchConsoleData> {
  const queries = buildGoogleSearchConsoleAccountQueries(propertyUrls, weeks);
  const results = await Promise.allSettled([
    executeQuery(queries.queries),
    executeQuery(queries.pages),
    executeQuery(queries.summary),
  ]);
  const errors: string[] = [];
  const queryResult = normalizeSettledRows<GscQueryDbRow, ZarukuGoogleSearchConsoleQueryRow>(
    results[0],
    "queries",
    normalizeGscQueryRow,
    errors,
  );
  const pageResult = normalizeSettledRows<GscPageDbRow, ZarukuGoogleSearchConsolePageRow>(
    results[1],
    "pages",
    normalizeGscPageRow,
    errors,
  );
  const summaryResult = normalizeSettledRows<GscSummaryDbRow, ZarukuGoogleSearchConsoleSummaryRow>(
    results[2],
    "summary",
    normalizeGscSummaryRow,
    errors,
  );
  const successfulQueries = [queryResult.available, pageResult.available, summaryResult.available].filter(Boolean).length;
  const weeksAvailable = [
    ...new Set([...summaryResult.rows, ...queryResult.rows, ...pageResult.rows].map((row) => row.week)),
  ].sort();
  const hasRows = weeksAvailable.length > 0;
  const status = successfulQueries === 3 && errors.length === 0 && hasRows
    ? "available"
    : successfulQueries > 0 && hasRows
      ? "partial"
      : "unavailable";

  return {
    available: status === "available",
    status,
    error: errors.length > 0 ? errors.join("; ") : null,
    data_availability: {
      queries: queryResult.available,
      pages: pageResult.available,
    },
    weeks: weeksAvailable,
    latest_week: weeksAvailable.at(-1) ?? null,
    summary: summaryResult.rows,
    queries: queryResult.rows,
    pages: pageResult.rows,
  };
}

export async function loadGoogleSearchConsoleFacts(
  accountId: string,
  weeks?: string[],
  executeQuery: GscQueryExecutor = executeGscQuery,
): Promise<ZarukuGoogleSearchConsoleData> {
  const propertyUrl = accountId.startsWith("http") || accountId.startsWith("sc-domain:")
    ? accountId
    : "https://zaruku.ru/";
  return loadZarukuGoogleSearchConsoleData([propertyUrl], weeks, executeQuery);
}

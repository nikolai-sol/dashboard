import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type {
  ZarukuYandexWebmasterData,
  ZarukuYandexWebmasterPageRow,
  ZarukuYandexWebmasterQueryRow,
} from "@/lib/types";

export type SqlQuery = { sql: string; params: string[] };
export type WebmasterQueryExecutor = (query: SqlQuery) => Promise<unknown[]>;

type WebmasterQueryDbRow = {
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
};

type WebmasterPageDbRow = {
  week_key: string;
  page_url: string;
  device_type: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
};

function buildInClause(values: readonly string[]) {
  return values.map(() => "?").join(", ");
}

function normalizeAccountIds(counterIds: string[]) {
  const normalized = counterIds.map((counterId) => counterId.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : ["66624469"];
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

function formatDate(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function weekClause(weeks: string[] | undefined, params: string[]) {
  const normalizedWeeks = (weeks ?? []).map((week) => week.trim()).filter(Boolean);
  if (normalizedWeeks.length === 0) return "";
  params.push(...normalizedWeeks);
  return `AND week_key IN (${buildInClause(normalizedWeeks)})`;
}

export function normalizeWebmasterQueryRow(row: WebmasterQueryDbRow): ZarukuYandexWebmasterQueryRow {
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
  };
}

export function normalizeWebmasterPageRow(row: WebmasterPageDbRow): ZarukuYandexWebmasterPageRow {
  return {
    week: String(row.week_key),
    url: String(row.page_url),
    device: String(row.device_type),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
  };
}

export function buildWebmasterAccountQueries(counterIds: string[], weeks?: string[]): Record<"queries" | "pages", SqlQuery> {
  const normalizedCounterIds = normalizeAccountIds(counterIds);
  const queryParams = [...normalizedCounterIds];
  const pageParams = [...normalizedCounterIds];
  const queryWeekClause = weekClause(weeks, queryParams);
  const pageWeekClause = weekClause(weeks, pageParams);
  const accountScope = buildInClause(normalizedCounterIds);

  return {
    queries: {
      sql: `
        SELECT week_key, query_id, query_text, device_type, impressions, clicks, ctr, average_position, week_from, week_to
        FROM seo_webmaster_queries_weekly
        WHERE analytics_account_id IN (${accountScope})
          ${queryWeekClause}
        ORDER BY week_key ASC, impressions DESC, clicks DESC, query_text ASC
      `,
      params: queryParams,
    },
    pages: {
      sql: `
        SELECT week_key, page_url, device_type, impressions, clicks, ctr, average_position, week_from, week_to
        FROM seo_webmaster_pages_weekly
        WHERE analytics_account_id IN (${accountScope})
          ${pageWeekClause}
        ORDER BY week_key ASC, impressions DESC, clicks DESC, page_url ASC
      `,
      params: pageParams,
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

async function executeWebmasterQuery(query: SqlQuery) {
  const [rows] = await pool.execute<RowDataPacket[]>(query.sql, query.params);
  return rows;
}

export async function loadZarukuYandexWebmasterData(
  counterIds: string[],
  weeks?: string[],
  executeQuery: WebmasterQueryExecutor = executeWebmasterQuery,
): Promise<ZarukuYandexWebmasterData> {
  const queries = buildWebmasterAccountQueries(counterIds, weeks);
  const results = await Promise.allSettled([executeQuery(queries.queries), executeQuery(queries.pages)]);
  const errors: string[] = [];
  const queryResult = normalizeSettledRows<WebmasterQueryDbRow, ZarukuYandexWebmasterQueryRow>(
    results[0],
    "queries",
    normalizeWebmasterQueryRow,
    errors,
  );
  const pageResult = normalizeSettledRows<WebmasterPageDbRow, ZarukuYandexWebmasterPageRow>(
    results[1],
    "pages",
    normalizeWebmasterPageRow,
    errors,
  );
  const successfulQueries = [queryResult.available, pageResult.available].filter(Boolean).length;
  const status = successfulQueries === 2 && errors.length === 0 ? "available" : successfulQueries > 0 ? "partial" : "unavailable";
  const availableWeeks = [...new Set([...queryResult.rows, ...pageResult.rows].map((row) => row.week))].sort();

  return {
    available: status === "available",
    status,
    error: errors.length > 0 ? errors.join("; ") : null,
    data_availability: {
      queries: queryResult.available,
      pages: pageResult.available,
    },
    weeks: availableWeeks,
    latest_week: availableWeeks.at(-1) ?? null,
    queries: queryResult.rows,
    pages: pageResult.rows,
  };
}

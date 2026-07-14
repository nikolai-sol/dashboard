import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type {
  ZarukuSeoAiVisibilityAggregateRow,
  ZarukuSeoIntelligenceData,
  ZarukuSeoSovWeeklyRow,
} from "@/lib/types";

export type SqlQuery = { sql: string; params: string[] };
export type SeoIntelligenceQueryExecutor = (query: SqlQuery) => Promise<unknown[]>;

type SeoSovWeeklyDbRow = {
  week_key: string;
  snapshot_date: string | Date | null;
  date_start: string | Date | null;
  date_end: string | Date | null;
  cluster: string;
  query_count: number | string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  impression_share_pct: number | string | null;
  click_share_pct: number | string | null;
  ctr_pct: number | string | null;
  average_position: number | string | null;
  is_noise: number | boolean | null;
  is_medical: number | boolean | null;
  ingestion_run_id: string | null;
};

type SeoAiVisibilityDbRow = {
  engine: string;
  period: string;
  mentions: number | string | null;
  citations: number | string | null;
  presence_rate: number | string | null;
  provenance: string | null;
  captured_at: string | Date | null;
  ingestion_run_id: string | null;
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
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDate(value: string | Date | null) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function formatDateTime(value: string | Date | null) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function formatPeriodLabel(week: string, dateStart: string | null, dateEnd: string | null) {
  return dateStart && dateEnd ? `28d: ${dateStart} — ${dateEnd}` : week;
}

function normalizePresenceRate(value: unknown) {
  const number = asNumber(value);
  return number > 0 && number <= 1 ? number * 100 : number;
}

export function buildSeoSovWeeklyQuery(counterIds: string[]): SqlQuery {
  const accountIds = normalizeAccountIds(counterIds);
  return {
    sql: `
      SELECT
        week_key,
        snapshot_date,
        date_start,
        date_end,
        cluster,
        query_count,
        impressions,
        clicks,
        impression_share_pct,
        click_share_pct,
        ctr_pct,
        average_position,
        is_noise,
        is_medical,
        ingestion_run_id
      FROM seo_sov_weekly
      WHERE analytics_account_id IN (${buildInClause(accountIds)})
      ORDER BY week_key ASC, impression_share_pct DESC, cluster ASC
    `,
    params: accountIds,
  };
}

export function buildSeoAiVisibilityQuery(counterIds: string[]): SqlQuery {
  const accountIds = normalizeAccountIds(counterIds);
  return {
    sql: `
      SELECT engine, period, mentions, citations, presence_rate, provenance, captured_at, ingestion_run_id
      FROM seo_ai_visibility
      WHERE analytics_account_id IN (${buildInClause(accountIds)})
      ORDER BY period ASC, engine ASC
    `,
    params: accountIds,
  };
}

export function normalizeSeoSovWeeklyRow(row: SeoSovWeeklyDbRow): ZarukuSeoSovWeeklyRow {
  const dateStart = formatDate(row.date_start);
  const dateEnd = formatDate(row.date_end);
  return {
    week: String(row.week_key),
    period_label: formatPeriodLabel(String(row.week_key), dateStart, dateEnd),
    snapshot_date: formatDate(row.snapshot_date),
    date_start: dateStart,
    date_end: dateEnd,
    cluster: String(row.cluster),
    query_count: Math.round(asNumber(row.query_count)),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    impressions_share: asNumber(row.impression_share_pct),
    clicks_share: asNumber(row.click_share_pct),
    ctr: asNumber(row.ctr_pct),
    average_position: asNullableNumber(row.average_position),
    is_noise: Boolean(row.is_noise),
    is_medical: Boolean(row.is_medical),
    ingestion_run_id: row.ingestion_run_id == null ? null : String(row.ingestion_run_id),
  };
}

export function normalizeSeoAiVisibilityRow(row: SeoAiVisibilityDbRow): ZarukuSeoAiVisibilityAggregateRow {
  return {
    engine: String(row.engine),
    period: String(row.period),
    mentions: Math.round(asNumber(row.mentions)),
    citations: Math.round(asNumber(row.citations)),
    presence_rate: normalizePresenceRate(row.presence_rate),
    provenance: row.provenance == null ? null : String(row.provenance),
    captured_at: formatDateTime(row.captured_at),
    ingestion_run_id: row.ingestion_run_id == null ? null : String(row.ingestion_run_id),
  };
}

async function executeQuery(query: SqlQuery) {
  const [rows] = await pool.execute<RowDataPacket[]>(query.sql, query.params);
  return rows;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function loadZarukuSeoIntelligenceData(
  counterIds: string[],
  queryExecutor: SeoIntelligenceQueryExecutor = executeQuery,
): Promise<ZarukuSeoIntelligenceData> {
  const normalizedCounterIds = normalizeAccountIds(counterIds);
  const results = await Promise.allSettled([
    queryExecutor(buildSeoSovWeeklyQuery(normalizedCounterIds)),
    queryExecutor(buildSeoAiVisibilityQuery(normalizedCounterIds)),
  ]);
  const errors: string[] = [];

  let sovRows: ZarukuSeoSovWeeklyRow[] = [];
  let sovAvailable = false;
  if (results[0].status === "fulfilled") {
    try {
      sovRows = results[0].value.map((row) => normalizeSeoSovWeeklyRow(row as SeoSovWeeklyDbRow));
      sovAvailable = true;
    } catch (error) {
      errors.push(`seo_sov_weekly: ${errorMessage(error)}`);
    }
  } else {
    errors.push(`seo_sov_weekly: ${errorMessage(results[0].reason)}`);
  }

  let aiRows: ZarukuSeoAiVisibilityAggregateRow[] = [];
  let aiAvailable = false;
  if (results[1].status === "fulfilled") {
    try {
      aiRows = results[1].value.map((row) => normalizeSeoAiVisibilityRow(row as SeoAiVisibilityDbRow));
      aiAvailable = true;
    } catch (error) {
      errors.push(`seo_ai_visibility: ${errorMessage(error)}`);
    }
  } else {
    errors.push(`seo_ai_visibility: ${errorMessage(results[1].reason)}`);
  }

  const availableCount = [sovAvailable, aiAvailable].filter(Boolean).length;
  const status = availableCount === 2 && errors.length === 0 ? "available" : availableCount > 0 ? "partial" : "unavailable";
  const weeks = [...new Set(sovRows.map((row) => row.week))].sort();
  const periods = [...new Set(aiRows.map((row) => row.period))].sort();

  return {
    available: status !== "unavailable",
    status,
    error: errors.length > 0 ? errors.join("; ") : null,
    sov: {
      available: sovAvailable,
      weeks,
      latest_week: weeks.at(-1) ?? null,
      rows: sovRows,
    },
    ai: {
      available: aiAvailable,
      periods,
      latest_period: periods.at(-1) ?? null,
      rows: aiRows,
    },
  };
}

export async function loadSeoIntelligenceData(
  accountId: string,
  queryExecutor: SeoIntelligenceQueryExecutor = executeQuery,
): Promise<ZarukuSeoIntelligenceData> {
  return loadZarukuSeoIntelligenceData([accountId], queryExecutor);
}

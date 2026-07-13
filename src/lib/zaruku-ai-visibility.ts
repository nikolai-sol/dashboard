import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type { ZarukuAiVisibilityData, ZarukuAiVisibilityRow } from "@/lib/types";

export type SqlQuery = { sql: string; params: string[] };
export type AiVisibilityQueryExecutor = (query: SqlQuery) => Promise<unknown[]>;

type AiVisibilityDbRow = {
  week_key: string;
  cluster_id: string;
  query_text: string;
  engine: string;
  region_id: string;
  language_code: string;
  device_type: string;
  mentioned: number | boolean | string;
  mention_count: number | string | null;
  citation_count: number | string | null;
  cited_urls_json: unknown;
  checked_at: string | Date | null;
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

function parseCitedUrls(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function formatDateTime(value: string | Date | null) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  return String(value);
}

export function normalizeAiVisibilityRow(row: AiVisibilityDbRow): ZarukuAiVisibilityRow {
  return {
    week: String(row.week_key),
    cluster_id: String(row.cluster_id),
    query: String(row.query_text),
    engine: String(row.engine),
    region: String(row.region_id),
    language: String(row.language_code),
    device: String(row.device_type),
    mentioned: row.mentioned === true || row.mentioned === 1 || row.mentioned === "1",
    mention_count: Math.round(asNumber(row.mention_count)),
    citation_count: Math.round(asNumber(row.citation_count)),
    cited_urls: parseCitedUrls(row.cited_urls_json),
    checked_at: formatDateTime(row.checked_at),
  };
}

export function buildAiVisibilityQuery(counterIds: string[], weeks?: string[]): SqlQuery {
  const normalizedCounterIds = normalizeAccountIds(counterIds);
  const params = [...normalizedCounterIds];
  const normalizedWeeks = (weeks ?? []).map((week) => week.trim()).filter(Boolean);
  const weekClause = normalizedWeeks.length > 0 ? `AND week_key IN (${buildInClause(normalizedWeeks)})` : "";
  params.push(...normalizedWeeks);

  return {
    sql: `
      SELECT week_key, cluster_id, query_text, engine, region_id, language_code, device_type, mentioned, mention_count, citation_count, cited_urls_json, checked_at
      FROM seo_ai_visibility_weekly
      WHERE analytics_account_id IN (${buildInClause(normalizedCounterIds)})
        ${weekClause}
      ORDER BY week_key ASC, engine ASC, cluster_id ASC
    `,
    params,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function executeAiVisibilityQuery(query: SqlQuery) {
  const [rows] = await pool.execute<RowDataPacket[]>(query.sql, query.params);
  return rows;
}

export async function loadZarukuAiVisibilityData(
  counterIds: string[],
  weeks?: string[],
  executeQuery: AiVisibilityQueryExecutor = executeAiVisibilityQuery,
): Promise<ZarukuAiVisibilityData> {
  try {
    const rows = await executeQuery(buildAiVisibilityQuery(counterIds, weeks));
    const normalizedRows = rows.map((row) => normalizeAiVisibilityRow(row as AiVisibilityDbRow));
    const availableWeeks = [...new Set(normalizedRows.map((row) => row.week))].sort();
    return {
      available: true,
      status: "available",
      error: null,
      weeks: availableWeeks,
      latest_week: availableWeeks.at(-1) ?? null,
      rows: normalizedRows,
    };
  } catch (error) {
    return {
      available: false,
      status: "unavailable",
      error: errorMessage(error),
      weeks: [],
      latest_week: null,
      rows: [],
    };
  }
}

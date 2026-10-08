import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type {
  ZarukuSourceFreshnessRow,
  ZarukuWordstatAction,
  ZarukuWordstatClassification,
  ZarukuWordstatData,
  ZarukuWordstatHistoricalRow,
  ZarukuWordstatIndicators,
  ZarukuWordstatOpportunity,
  ZarukuWordstatObservedDay,
  ZarukuWordstatObservedRegion,
  ZarukuWordstatWeeklyGrowth,
  ZarukuWordstatQueryRow,
  ZarukuWordstatRegionRow,
} from "@/lib/types";

export type WordstatSqlQuery = { sql: string; params: Array<string | number> };
export type WordstatQueryRunner = (query: WordstatSqlQuery) => Promise<unknown[]>;

const WORDSTAT_FRESHNESS_HOURS = 168;
const GROWTH_UNAVAILABLE_REASON = "Предыдущий сопоставимый период Wordstat не собирался, поэтому показатель роста недоступен.";
const REGION_TRAFFIC_UNAVAILABLE_REASON = "Сопоставимый региональный срез Яндекс-органики в Метрике пока не подключён.";

type EndpointStateDbRow = {
  endpoint_publication_at?: string | Date | null;
  endpoint_from: string | Date | null;
  endpoint_to: string | Date | null;
  endpoint_scope_count: number | string | null;
  endpoint_empty_scope_count: number | string | null;
  endpoint_coverage_run_status?: string | null;
  endpoint_last_status: string | null;
  endpoint_last_finished_at: string | Date | null;
  endpoint_last_success_at: string | Date | null;
  endpoint_last_error_at: string | Date | null;
  endpoint_last_error_summary: string | null;
  endpoint_rows_read: number | string | null;
  endpoint_rows_written: number | string | null;
  endpoint_confirmed_dates?: string | string[] | null;
  endpoint_confirmed_day_count?: number | string | null;
  endpoint_confirmed_dates_contiguous?: number | string | boolean | null;
};

type HistoricalDbRow = EndpointStateDbRow & {
  seed_hash: string | null;
  phrase: string | null;
  topic: string | null;
  cluster: string | null;
  classification: string | null;
  review_status: string | null;
  wordstat_count: number | string | null;
  previous_wordstat_count: number | string | null;
  webmaster_impressions: number | string | null;
  webmaster_clicks: number | string | null;
  webmaster_average_position: number | string | null;
};

type CurrentQueryDbRow = EndpointStateDbRow & {
  normalized_query: string | null;
  query: string | null;
  request_kind: string | null;
  device: string | null;
  count: number | string | null;
  share: number | string | null;
  classification: string | null;
  review_status: string | null;
  classification_active: number | string | boolean | null;
  topic: string | null;
  cluster: string | null;
  seo_os_position: number | string | null;
  seo_os_week: string | null;
  confirmed_url: string | null;
  seo_os_eligible: number | string | boolean | null;
};

type CurrentRegionDbRow = EndpointStateDbRow & {
  seed_hash?: string;
  registry_version?: string;
  phrase?: string;
  classification?: string;
  review_status?: string;
  snapshot_date?: string;
  scope_hash?: string;

  region_id: number | string | null;
  region_name: string | null;
  region_type: string | null;
  device: string | null;
  count: number | string | null;
  share: number | string | null;
  affinity_index: number | string | null;
};

type WordstatOpportunityInput = {
  classification: ZarukuWordstatClassification;
  review_status: "reviewed" | "pending";
  wordstat_count: number;
  demand_median: number;
  webmaster_impressions: number;
  webmaster_average_position: number | null;
  visibility_impression_median: number;
  visibility_position_median: number | null;
};

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asNullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function asString(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function formatDate(value: string | Date | null | undefined) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10) || null;
}

function formatDateTime(value: string | Date | null | undefined) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 19).replace("T", " ") : asString(value) || null;
}

function requireUtcDate(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("nowUtc must be a valid date");
  return parsed.toISOString().slice(0, 10);
}

function requireAccountId(accountId: string) {
  const normalized = accountId.trim();
  if (!normalized) throw new Error("accountId is required");
  return normalized;
}

function normalizeClassification(value: unknown): ZarukuWordstatClassification {
  const classification = asString(value);
  return classification === "medical" || classification === "adjacent" || classification === "irrelevant"
    ? classification
    : "unreviewed";
}

function normalizeReviewStatus(value: unknown): "reviewed" | "pending" {
  return asString(value).toLowerCase() === "reviewed" ? "reviewed" : "pending";
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}


function wordstatScopeHash(account: string, endpoint: "dynamics" | "regions" | "top_requests",
  registryVersion: string, seedHash: string, extra: string[]) {
  return createHash("sha256").update(JSON.stringify({
    account, endpoint, extra, registry_version: registryVersion, seed_hash: seedHash,
  })).digest("hex");
}

/** Exactly the collector's sorted, compact JSON bytes, with JSON escaping retained. */
function scopeHashSql(endpoint: "dynamics" | "regions" | "top_requests", fact: string) {
  const extra = endpoint === "dynamics"
    ? `JSON_QUOTE(DATE_FORMAT(coverage.requested_from, '%Y-%m-%d')), ',', JSON_QUOTE(DATE_FORMAT(coverage.requested_to, '%Y-%m-%d'))`
    : `JSON_QUOTE(DATE_FORMAT(${fact}.snapshot_date, '%Y-%m-%d'))`;
  return `SHA2(CONCAT('{"account":', JSON_QUOTE(${fact}.analytics_account_id),
    ',"endpoint":"${endpoint}","extra":[', ${extra}, ',', JSON_QUOTE(${fact}.device_type),
    '],"registry_version":', JSON_QUOTE(${fact}.registry_version),
    ',"seed_hash":', JSON_QUOTE(${fact}.seed_hash), '}'), 256)`;
}

function validCount(value: unknown) {
  const count = asNullableNumber(value);
  return count != null && count >= 0 ? count : null;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function calculateWordstatWeeklyGrowth(days: ZarukuWordstatObservedDay[], nowUtc: Date): ZarukuWordstatWeeklyGrowth {
  requireUtcDate(nowUtc);
  const today = nowUtc.toISOString().slice(0, 10);
  const grouped = new Map<string, { seed_hash: string; registry_version: string; dates: Map<string, number | null> }>();
  for (const day of days) {
    const key = JSON.stringify([day.registry_version, day.seed_hash]);
    let seed = grouped.get(key);
    if (!seed) {
      seed = { seed_hash: day.seed_hash, registry_version: day.registry_version, dates: new Map() };
      grouped.set(key, seed);
    }
    if (!validDate(day.date) || day.date >= today || validCount(day.count) == null) continue;
    const existing = seed.dates.get(day.date);
    seed.dates.set(day.date, existing === undefined || existing === day.count ? day.count : null);
  }
  const addDays = (date: string, count: number) => new Date(Date.parse(date) + count * 86_400_000).toISOString().slice(0, 10);
  const weekSum = (dates: Map<string, number | null>, monday: string) => {
    const values = Array.from({ length: 7 }, (_, i) => dates.get(addDays(monday, i)));
    return values.every((value) => value != null) ? (values as number[]).reduce((sum, value) => sum + value, 0) : null;
  };
  const weeks = new Set<string>();
  for (const seed of grouped.values()) for (const date of seed.dates.keys()) {
    const parsed = new Date(date);
    const monday = addDays(date, -((parsed.getUTCDay() + 6) % 7));
    if (addDays(monday, 6) < today) weeks.add(monday);
  }
  const currentMonday = [...weeks].sort().reverse().find((monday) =>
    [...grouped.values()].some((seed) => weekSum(seed.dates, monday) != null && weekSum(seed.dates, addDays(monday, -7)) != null));
  const previousMonday = currentMonday ? addDays(currentMonday, -7) : null;
  const rows = [...grouped.values()].map((seed) => {
    const previous_count = previousMonday ? weekSum(seed.dates, previousMonday) : null;
    const current_count = currentMonday ? weekSum(seed.dates, currentMonday) : null;
    const absolute_change = previous_count != null && current_count != null ? current_count - previous_count : null;
    return { seed_hash: seed.seed_hash, registry_version: seed.registry_version, previous_count, current_count,
      absolute_change, percent_change: previous_count != null && previous_count > 0 && absolute_change != null
        ? absolute_change / previous_count * 100 : null,
      new_from_zero: previous_count === 0 && current_count != null && current_count > 0 };
  });
  return {
    previous_period: previousMonday ? { from: previousMonday, to: addDays(previousMonday, 6) } : null,
    current_period: currentMonday ? { from: currentMonday, to: addDays(currentMonday, 6) } : null,
    comparable_count: rows.filter((row) => row.absolute_change != null).length,
    growing_count: rows.filter((row) => row.absolute_change != null && row.absolute_change > 0).length,
    rows,
  };
}

export function classifyWordstatOpportunity(row: WordstatOpportunityInput): ZarukuWordstatOpportunity | null {
  if (row.classification !== "medical" || row.review_status !== "reviewed") return null;
  const demandIsHigh = row.wordstat_count >= row.demand_median;
  if (!demandIsHigh) return "watch";
  const weakImpressions = row.webmaster_impressions <= row.visibility_impression_median;
  const weakPosition = row.webmaster_average_position != null
    && row.visibility_position_median != null
    && row.webmaster_average_position >= row.visibility_position_median;
  if (!weakImpressions && !weakPosition) return "covered";
  return row.webmaster_impressions === 0 && row.webmaster_average_position == null ? "high" : "medium";
}

export function buildZarukuWordstatQueries(accountId: string, nowUtc: string | Date = new Date()): Record<
  "historicalRows" | "currentQueries" | "currentRegions" | "observedDays",
  WordstatSqlQuery
> {
  const normalizedAccountId = requireAccountId(accountId);
  const currentUtcDate = requireUtcDate(nowUtc);
  const yesterday = new Date(Date.parse(currentUtcDate) - 86_400_000).toISOString().slice(0, 10);
  return {
    observedDays: {
      sql: `
        /* wordstat:observed-days */
        SELECT dynamics.seed_hash, dynamics.registry_version, seed.phrase_text AS phrase,
          seed.classification, seed.review_status, dynamics.report_date, dynamics.count,
          (SELECT MAX(GREATEST(coverage.updated_at, COALESCE(coverage_run.finished_at, coverage.updated_at)))
           FROM canonical_wordstat_coverage coverage
           JOIN canonical_collector_runs coverage_run ON coverage_run.id = coverage.ingestion_run_id
             AND coverage_run.source_key = coverage.source_key
             AND coverage_run.job_key IN (CONCAT('yandex_wordstat:', ?, ':historical'), CONCAT('yandex_wordstat:', ?, ':all'))
           WHERE coverage.analytics_account_id = dynamics.analytics_account_id
             AND coverage.source_key = dynamics.source_key AND coverage.endpoint = 'dynamics'
             AND coverage.registry_version = dynamics.registry_version
             AND coverage.ingestion_run_id = dynamics.ingestion_run_id
             AND coverage.status IN ('success', 'success_empty')
             AND dynamics.report_date BETWEEN coverage.requested_from AND coverage.requested_to
             AND coverage.scope_hash = ${scopeHashSql("dynamics", "dynamics")}) AS publication_at
        FROM canonical_fact_wordstat_dynamics_daily dynamics
        JOIN canonical_wordstat_seed_registry seed ON seed.analytics_account_id = dynamics.analytics_account_id
          AND seed.seed_hash = dynamics.seed_hash AND seed.registry_version = dynamics.registry_version
          AND seed.is_active = 1
        WHERE dynamics.analytics_account_id = ? AND dynamics.source_key = 'yandex_wordstat'
          AND dynamics.device_type = 'all' AND dynamics.region_scope = 'all' AND dynamics.report_date <= ?
          AND dynamics.count IS NOT NULL AND dynamics.count >= 0
          AND EXISTS (
            SELECT 1 FROM canonical_wordstat_coverage coverage
            JOIN canonical_collector_runs coverage_run ON coverage_run.id = coverage.ingestion_run_id
              AND coverage_run.source_key = coverage.source_key
              AND coverage_run.job_key IN (CONCAT('yandex_wordstat:', ?, ':historical'), CONCAT('yandex_wordstat:', ?, ':all'))
            WHERE coverage.analytics_account_id = dynamics.analytics_account_id
              AND coverage.source_key = dynamics.source_key AND coverage.endpoint = 'dynamics'
              AND coverage.registry_version = dynamics.registry_version
              AND coverage.ingestion_run_id = dynamics.ingestion_run_id
              AND coverage.status IN ('success', 'success_empty')
              AND dynamics.report_date BETWEEN coverage.requested_from AND coverage.requested_to
              AND coverage.scope_hash = ${scopeHashSql("dynamics", "dynamics")}
          )
        ORDER BY dynamics.registry_version, dynamics.seed_hash, dynamics.report_date
      `,
      params: [normalizedAccountId, normalizedAccountId, normalizedAccountId, yesterday, normalizedAccountId, normalizedAccountId],
    },
    historicalRows: {
      sql: `
        /* wordstat:historical-rows */
        WITH ranked_approved_seeds AS (
          SELECT seed_hash, registry_version, normalized_phrase, phrase_text, topic, cluster, classification, review_status,
            ROW_NUMBER() OVER (
              PARTITION BY seed_hash
              ORDER BY updated_at DESC, registry_version DESC
            ) AS registry_rank
          FROM canonical_wordstat_seed_registry
          WHERE analytics_account_id = ?
            AND is_active = 1
            AND classification = 'medical'
            AND review_status = 'reviewed'
        ),
        approved_seeds AS (
          SELECT seed_hash, registry_version, normalized_phrase, phrase_text, topic, cluster, classification, review_status
          FROM ranked_approved_seeds
          WHERE registry_rank = 1
        ),
        confirmed_dynamics_coverage AS (
          SELECT DISTINCT coverage.analytics_account_id, coverage.registry_version, coverage.ingestion_run_id,
            coverage.requested_from, coverage.requested_to, coverage.scope_hash, coverage_run.status AS coverage_run_status
          FROM canonical_wordstat_coverage coverage
          JOIN canonical_collector_runs coverage_run
            ON coverage_run.id = coverage.ingestion_run_id
            AND coverage_run.source_key = coverage.source_key
            AND coverage_run.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':historical'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          JOIN (SELECT DISTINCT registry_version FROM approved_seeds) approved
            ON approved.registry_version = coverage.registry_version
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'dynamics'
            AND coverage.status IN ('success', 'success_empty')
            AND coverage.ingestion_run_id IS NOT NULL
            AND coverage.requested_from <= '${yesterday}'
        ),
        confirmed_dynamics AS (
          SELECT dynamics.registry_version, dynamics.seed_hash, dynamics.report_date, dynamics.count
          FROM canonical_fact_wordstat_dynamics_daily dynamics
          JOIN approved_seeds seed ON seed.seed_hash = dynamics.seed_hash
            AND seed.registry_version = dynamics.registry_version
          WHERE dynamics.source_key = 'yandex_wordstat'
            AND dynamics.analytics_account_id = ?
            AND dynamics.device_type = 'all'
            AND dynamics.region_scope = 'all'
            AND dynamics.report_date <= '${yesterday}'
            AND EXISTS (
              SELECT 1 FROM confirmed_dynamics_coverage coverage
              WHERE coverage.analytics_account_id = dynamics.analytics_account_id
                AND coverage.registry_version = dynamics.registry_version
                AND coverage.ingestion_run_id = dynamics.ingestion_run_id
                AND dynamics.report_date BETWEEN coverage.requested_from AND coverage.requested_to
                AND coverage.scope_hash = ${scopeHashSql("dynamics", "dynamics")}
            )
        ),
        confirmed_webmaster_snapshots AS (
          SELECT summary.source_key, summary.analytics_account_id, summary.host_id, summary.report_date,
            summary.device_type, summary.ingestion_run_id
          FROM canonical_fact_webmaster_summary_daily summary
          JOIN canonical_collector_runs webmaster_run
            ON webmaster_run.id = summary.ingestion_run_id
            AND webmaster_run.source_key = summary.source_key
            AND webmaster_run.status = 'success'
          WHERE summary.source_key = 'yandex_webmaster'
            AND summary.analytics_account_id = ?
            AND summary.device_type = 'ALL'
            AND summary.report_date <= '${yesterday}'
            AND (
              summary.impressions = 0
              OR EXISTS (
                SELECT 1
                FROM canonical_fact_webmaster_queries_daily queries
                WHERE queries.source_key = summary.source_key
                  AND queries.analytics_account_id = summary.analytics_account_id
                  AND queries.host_id = summary.host_id
                  AND queries.report_date = summary.report_date
                  AND queries.device_type = summary.device_type
                  AND queries.ingestion_run_id = summary.ingestion_run_id
              )
            )
        ),
        common_dates AS (
          SELECT DISTINCT dynamics.report_date
          FROM confirmed_dynamics dynamics
          JOIN confirmed_webmaster_snapshots webmaster
            ON webmaster.report_date = dynamics.report_date
        ),
        common_bounds AS (
          SELECT MIN(report_date) AS endpoint_from, MAX(report_date) AS endpoint_to,
            JSON_ARRAYAGG(DATE_FORMAT(report_date, '%Y-%m-%d')) AS endpoint_confirmed_dates,
            COUNT(*) AS endpoint_confirmed_day_count,
            CASE WHEN COUNT(*) > 0 AND DATEDIFF(MAX(report_date), MIN(report_date)) + 1 = COUNT(*)
              THEN 1 ELSE 0 END AS endpoint_confirmed_dates_contiguous
          FROM common_dates
        ),
        current_demand AS (
          SELECT dynamics.registry_version, dynamics.seed_hash, SUM(dynamics.count) AS wordstat_count
          FROM confirmed_dynamics dynamics
          JOIN common_dates dates ON dates.report_date = dynamics.report_date
          GROUP BY dynamics.registry_version, dynamics.seed_hash
        ),
        webmaster_daily AS (
          SELECT queries.query_hash, queries.report_date,
            SUM(queries.impressions) AS impressions,
            SUM(queries.clicks) AS clicks,
            CASE WHEN SUM(queries.impressions) > 0
              THEN SUM(CASE WHEN queries.average_position IS NULL THEN 0 ELSE queries.average_position * queries.impressions END)
                / NULLIF(SUM(CASE WHEN queries.average_position IS NULL THEN 0 ELSE queries.impressions END), 0)
              ELSE NULL END AS average_position
          FROM canonical_fact_webmaster_queries_daily queries
          JOIN confirmed_webmaster_snapshots summary
            ON summary.source_key = queries.source_key
            AND summary.analytics_account_id = queries.analytics_account_id
            AND summary.host_id = queries.host_id
            AND summary.report_date = queries.report_date
            AND summary.device_type = queries.device_type
            AND summary.ingestion_run_id = queries.ingestion_run_id
          JOIN common_dates dates ON dates.report_date = queries.report_date
          WHERE queries.analytics_account_id = ?
          GROUP BY queries.query_hash, queries.report_date
        ),
        webmaster_demand AS (
          SELECT seed.registry_version, seed.seed_hash,
            COALESCE(SUM(webmaster.impressions), 0) AS webmaster_impressions,
            COALESCE(SUM(webmaster.clicks), 0) AS webmaster_clicks,
            CASE WHEN SUM(webmaster.impressions) > 0
              THEN SUM(CASE WHEN webmaster.average_position IS NULL THEN 0 ELSE webmaster.average_position * webmaster.impressions END)
                / NULLIF(SUM(CASE WHEN webmaster.average_position IS NULL THEN 0 ELSE webmaster.impressions END), 0)
              ELSE NULL END AS webmaster_average_position
          FROM approved_seeds seed
          JOIN webmaster_daily webmaster ON webmaster.query_hash = SHA2(seed.normalized_phrase, 256)
          JOIN common_dates dates ON dates.report_date = webmaster.report_date
          GROUP BY seed.registry_version, seed.seed_hash
        ),
        coverage_state AS (
          SELECT COUNT(*) AS endpoint_scope_count, 0 AS endpoint_empty_scope_count,
            CASE WHEN COUNT(*) = 0 THEN NULL
              WHEN SUM(coverage_run_status <> 'success') > 0 THEN 'partial'
              ELSE 'success' END AS endpoint_coverage_run_status
          FROM confirmed_dynamics_coverage
        ),
        latest_endpoint_run AS (
          SELECT runs.status, runs.finished_at, runs.started_at, runs.error_summary, runs.rows_read, runs.rows_written
          FROM canonical_collector_runs runs
          WHERE runs.source_key = 'yandex_wordstat'
            AND runs.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':historical'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          ORDER BY runs.id DESC
          LIMIT 1
        ),
        latest_endpoint_success AS (
          SELECT runs.finished_at, runs.started_at
          FROM canonical_collector_runs runs
          WHERE runs.source_key = 'yandex_wordstat'
            AND runs.status = 'success'
            AND runs.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':historical'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          ORDER BY runs.id DESC
          LIMIT 1
        ),
        endpoint_state AS (
          SELECT
            common_bounds.endpoint_from,
            common_bounds.endpoint_to,
            common_bounds.endpoint_confirmed_dates,
            COALESCE(common_bounds.endpoint_confirmed_day_count, 0) AS endpoint_confirmed_day_count,
            COALESCE(common_bounds.endpoint_confirmed_dates_contiguous, 0) AS endpoint_confirmed_dates_contiguous,
            COALESCE(coverage_state.endpoint_scope_count, 0) AS endpoint_scope_count,
            COALESCE(coverage_state.endpoint_empty_scope_count, 0) AS endpoint_empty_scope_count,
            coverage_state.endpoint_coverage_run_status,
            latest_endpoint_run.status AS endpoint_last_status,
            COALESCE(latest_endpoint_run.finished_at, latest_endpoint_run.started_at) AS endpoint_last_finished_at,
            COALESCE(latest_endpoint_success.finished_at, latest_endpoint_success.started_at) AS endpoint_last_success_at,
            CASE WHEN latest_endpoint_run.status IN ('failed', 'partial')
              THEN COALESCE(latest_endpoint_run.finished_at, latest_endpoint_run.started_at) ELSE NULL END AS endpoint_last_error_at,
            CASE WHEN latest_endpoint_run.status IN ('failed', 'partial')
              THEN latest_endpoint_run.error_summary ELSE NULL END AS endpoint_last_error_summary,
            COALESCE(latest_endpoint_run.rows_read, 0) AS endpoint_rows_read,
            COALESCE(latest_endpoint_run.rows_written, 0) AS endpoint_rows_written
          FROM (SELECT 1 AS anchor) anchor
          LEFT JOIN common_bounds ON TRUE
          LEFT JOIN coverage_state ON TRUE
          LEFT JOIN latest_endpoint_run ON TRUE
          LEFT JOIN latest_endpoint_success ON TRUE
        ),
        historical_results AS (
          SELECT
            seed.seed_hash,
            seed.phrase_text AS phrase,
            seed.topic,
            seed.cluster,
            seed.classification,
            seed.review_status,
            current_demand.wordstat_count,
            NULL AS previous_wordstat_count,
            COALESCE(webmaster_demand.webmaster_impressions, 0) AS webmaster_impressions,
            COALESCE(webmaster_demand.webmaster_clicks, 0) AS webmaster_clicks,
            webmaster_demand.webmaster_average_position
          FROM approved_seeds seed
          JOIN current_demand ON current_demand.seed_hash = seed.seed_hash
            AND current_demand.registry_version = seed.registry_version
          LEFT JOIN webmaster_demand ON webmaster_demand.seed_hash = seed.seed_hash
            AND webmaster_demand.registry_version = seed.registry_version
        )
        SELECT
          endpoint_state.endpoint_from,
          endpoint_state.endpoint_to,
          endpoint_state.endpoint_confirmed_dates,
          endpoint_state.endpoint_confirmed_day_count,
          endpoint_state.endpoint_confirmed_dates_contiguous,
          endpoint_state.endpoint_scope_count,
          endpoint_state.endpoint_empty_scope_count,
          endpoint_state.endpoint_coverage_run_status,
          endpoint_state.endpoint_last_status,
          endpoint_state.endpoint_last_finished_at,
          endpoint_state.endpoint_last_success_at,
          endpoint_state.endpoint_last_error_at,
          endpoint_state.endpoint_last_error_summary,
          endpoint_state.endpoint_rows_read,
          endpoint_state.endpoint_rows_written,
          historical_results.seed_hash,
          historical_results.phrase,
          historical_results.topic,
          historical_results.cluster,
          historical_results.classification,
          historical_results.review_status,
          historical_results.wordstat_count,
          historical_results.previous_wordstat_count,
          historical_results.webmaster_impressions,
          historical_results.webmaster_clicks,
          historical_results.webmaster_average_position
        FROM endpoint_state
        LEFT JOIN historical_results ON TRUE
        ORDER BY historical_results.wordstat_count DESC, historical_results.phrase ASC
      `,
      params: [
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
      ],
    },
    currentQueries: {
      sql: `
        /* wordstat:current-queries */
        WITH latest_snapshot AS (
          SELECT coverage.analytics_account_id, coverage.registry_version, coverage.ingestion_run_id,
            coverage.requested_from, coverage.requested_to,
            coverage_run.status AS selected_coverage_run_status
          FROM canonical_wordstat_coverage coverage
          JOIN canonical_collector_runs coverage_run
            ON coverage_run.id = coverage.ingestion_run_id
            AND coverage_run.source_key = coverage.source_key
            AND coverage_run.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':current'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'top_requests'
            AND coverage.status IN ('success', 'success_empty')
            AND coverage.ingestion_run_id IS NOT NULL
            AND coverage.requested_to <= ?
          ORDER BY coverage.requested_to DESC, coverage.requested_from DESC,
            coverage.updated_at DESC, coverage.id DESC, coverage.ingestion_run_id DESC
          LIMIT 1
        ),
        confirmed_coverage AS (
          SELECT DISTINCT coverage.analytics_account_id, coverage.registry_version, coverage.ingestion_run_id,
            coverage.requested_from AS window_from, coverage.requested_to AS window_to, coverage.scope_hash
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot latest
            ON latest.analytics_account_id = coverage.analytics_account_id
            AND latest.requested_from = coverage.requested_from
            AND latest.requested_to = coverage.requested_to
          JOIN canonical_collector_runs coverage_run
            ON coverage_run.id = coverage.ingestion_run_id
            AND coverage_run.source_key = coverage.source_key
            AND coverage_run.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':current'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'top_requests'
            AND coverage.status IN ('success', 'success_empty')
            AND coverage.ingestion_run_id IS NOT NULL
        ),
        coverage_state AS (
          SELECT
            MIN(coverage.requested_from) AS endpoint_from,
            MAX(coverage.requested_to) AS endpoint_to,
            COUNT(*) AS endpoint_scope_count,
            SUM(coverage.status = 'success_empty') AS endpoint_empty_scope_count,
            MAX(GREATEST(coverage.updated_at, COALESCE(coverage_run.finished_at, coverage.updated_at))) AS endpoint_publication_at,
            CASE WHEN SUM(coverage_run.status <> 'success') > 0 THEN 'partial' ELSE 'success' END AS endpoint_coverage_run_status
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot latest
            ON latest.analytics_account_id = coverage.analytics_account_id
            AND latest.requested_from = coverage.requested_from
            AND latest.requested_to = coverage.requested_to
          JOIN canonical_collector_runs coverage_run
            ON coverage_run.id = coverage.ingestion_run_id
            AND coverage_run.source_key = coverage.source_key
            AND coverage_run.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':current'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'top_requests'
            AND coverage.status IN ('success', 'success_empty')
        ),
        latest_endpoint_run AS (
          SELECT runs.status, runs.finished_at, runs.started_at, runs.error_summary, runs.rows_read, runs.rows_written
          FROM canonical_collector_runs runs
          WHERE runs.source_key = 'yandex_wordstat'
            AND runs.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':current'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          ORDER BY runs.id DESC
          LIMIT 1
        ),
        latest_endpoint_success AS (
          SELECT runs.finished_at, runs.started_at
          FROM canonical_collector_runs runs
          WHERE runs.source_key = 'yandex_wordstat'
            AND runs.status = 'success'
            AND runs.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':current'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          ORDER BY runs.id DESC
          LIMIT 1
        ),
        endpoint_state AS (
          SELECT
            coverage_state.endpoint_publication_at,
            coverage_state.endpoint_from,
            coverage_state.endpoint_to,
            COALESCE(coverage_state.endpoint_scope_count, 0) AS endpoint_scope_count,
            COALESCE(coverage_state.endpoint_empty_scope_count, 0) AS endpoint_empty_scope_count,
            coverage_state.endpoint_coverage_run_status,
            latest_endpoint_run.status AS endpoint_last_status,
            COALESCE(latest_endpoint_run.finished_at, latest_endpoint_run.started_at) AS endpoint_last_finished_at,
            COALESCE(latest_endpoint_success.finished_at, latest_endpoint_success.started_at) AS endpoint_last_success_at,
            CASE WHEN latest_endpoint_run.status IN ('failed', 'partial')
              THEN COALESCE(latest_endpoint_run.finished_at, latest_endpoint_run.started_at) ELSE NULL END AS endpoint_last_error_at,
            CASE WHEN latest_endpoint_run.status IN ('failed', 'partial')
              THEN latest_endpoint_run.error_summary ELSE NULL END AS endpoint_last_error_summary,
            COALESCE(latest_endpoint_run.rows_read, 0) AS endpoint_rows_read,
            COALESCE(latest_endpoint_run.rows_written, 0) AS endpoint_rows_written
          FROM (SELECT 1 AS anchor) anchor
          LEFT JOIN coverage_state ON TRUE
          LEFT JOIN latest_snapshot ON TRUE
          LEFT JOIN latest_endpoint_run ON TRUE
          LEFT JOIN latest_endpoint_success ON TRUE
        ),
        latest_positions AS (
          SELECT normalized_query, week_key, serp_position, matched_url
          FROM (
            SELECT
              LOWER(TRIM(query)) AS normalized_query,
              week_key,
              serp_position,
              matched_url,
              ROW_NUMBER() OVER (
                PARTITION BY LOWER(TRIM(query))
                ORDER BY week_key DESC, serp_position IS NULL ASC, serp_position ASC, matched_url ASC
              ) AS dedup_rank
            FROM seo_positions_weekly
            WHERE analytics_account_id = ?
          ) ranked_positions
          WHERE dedup_rank = 1
        ),
        requested_query_names AS (
          SELECT DISTINCT facts.normalized_query COLLATE utf8mb4_unicode_ci AS normalized_query
          FROM canonical_fact_wordstat_requests_snapshot facts
          JOIN latest_snapshot selected_snapshot
            ON facts.analytics_account_id = selected_snapshot.analytics_account_id
            AND facts.snapshot_date = selected_snapshot.requested_to
            AND facts.window_from = selected_snapshot.requested_from
            AND facts.window_to = selected_snapshot.requested_to
          WHERE facts.source_key = 'yandex_wordstat'
            AND facts.analytics_account_id = selected_snapshot.analytics_account_id
            AND facts.device_type = 'all'
            AND facts.count IS NOT NULL AND facts.count >= 0
            AND EXISTS (
              SELECT 1 FROM confirmed_coverage coverage
              WHERE facts.analytics_account_id = coverage.analytics_account_id
                AND facts.registry_version = coverage.registry_version
                AND facts.ingestion_run_id = coverage.ingestion_run_id
                AND facts.window_from = coverage.window_from AND facts.window_to = coverage.window_to
                AND coverage.scope_hash = ${scopeHashSql("top_requests", "facts")}
            )
        ),
        confirmed_urls AS (
          SELECT normalized_query, page
          FROM (
            SELECT
              LOWER(TRIM(query)) AS normalized_query,
              page,
              ROW_NUMBER() OVER (
                PARTITION BY LOWER(TRIM(query))
                ORDER BY report_date DESC, clicks DESC, impressions DESC, page ASC
              ) AS dedup_rank
            FROM canonical_fact_gsc_queries_daily gsc
            WHERE analytics_account_id = ?
              AND country = 'rus'
              AND page IS NOT NULL
              AND page <> ''
              AND EXISTS (
                SELECT 1 FROM requested_query_names requested
                WHERE requested.normalized_query COLLATE utf8mb4_unicode_ci = LOWER(TRIM(gsc.query)) COLLATE utf8mb4_unicode_ci
              )
          ) ranked_urls
          WHERE dedup_rank = 1
        ),
        ranked_requests AS (
          SELECT
            facts.normalized_query,
            facts.query_text AS query,
            facts.request_kind,
            facts.device_type AS device,
            facts.count,
            facts.share,
            CASE
              WHEN classifications.is_active = 1
                AND classifications.review_status = 'reviewed'
                AND classifications.classification IN ('medical', 'adjacent', 'irrelevant', 'unreviewed')
              THEN classifications.classification
              ELSE 'unreviewed'
            END AS classification,
            CASE WHEN classifications.is_active = 1 AND classifications.review_status = 'reviewed'
              THEN 'reviewed' ELSE 'pending' END AS review_status,
            CASE WHEN classifications.is_active = 1 THEN 1 ELSE 0 END AS classification_active,
            CASE
              WHEN classifications.is_active = 1
                AND classifications.review_status = 'reviewed'
                AND classifications.classification = 'medical'
              THEN 1 ELSE 0
            END AS seo_os_eligible,
            COALESCE(classifications.topic, facts.topic) AS topic,
            COALESCE(classifications.cluster, facts.cluster) AS cluster,
            positions.serp_position AS seo_os_position,
            positions.week_key AS seo_os_week,
            COALESCE(urls.page, positions.matched_url) AS confirmed_url,
            ROW_NUMBER() OVER (
              PARTITION BY facts.device_type, facts.normalized_query
              ORDER BY CASE WHEN facts.request_kind = 'popular' THEN 0 ELSE 1 END,
                facts.count DESC, facts.seed_hash ASC
            ) AS duplicate_rank
          FROM canonical_fact_wordstat_requests_snapshot facts
          JOIN latest_snapshot selected_snapshot
            ON facts.analytics_account_id = selected_snapshot.analytics_account_id
            AND facts.snapshot_date = selected_snapshot.requested_to
            AND facts.window_from = selected_snapshot.requested_from
            AND facts.window_to = selected_snapshot.requested_to
          LEFT JOIN canonical_wordstat_query_classifications classifications
            ON classifications.analytics_account_id = facts.analytics_account_id
            AND classifications.registry_version = facts.registry_version
            AND classifications.query_hash = facts.query_hash
          LEFT JOIN latest_positions positions ON positions.normalized_query COLLATE utf8mb4_unicode_ci = facts.normalized_query COLLATE utf8mb4_unicode_ci
          LEFT JOIN confirmed_urls urls ON urls.normalized_query COLLATE utf8mb4_unicode_ci = facts.normalized_query COLLATE utf8mb4_unicode_ci
          WHERE facts.source_key = 'yandex_wordstat'
            AND facts.analytics_account_id = ?
            AND facts.device_type = 'all'
            AND facts.count IS NOT NULL AND facts.count >= 0
            AND EXISTS (
              SELECT 1 FROM confirmed_coverage coverage
              WHERE facts.analytics_account_id = coverage.analytics_account_id
                AND facts.registry_version = coverage.registry_version
                AND facts.ingestion_run_id = coverage.ingestion_run_id
                AND facts.window_from = coverage.window_from AND facts.window_to = coverage.window_to
                AND coverage.scope_hash = ${scopeHashSql("top_requests", "facts")}
            )
        ),
        selected_requests AS (
          SELECT normalized_query, query, request_kind, device, count, share, classification, review_status,
            classification_active, seo_os_eligible,
            topic, cluster, seo_os_position, seo_os_week, confirmed_url
          FROM ranked_requests
          WHERE duplicate_rank = 1
        )
        SELECT
          endpoint_state.endpoint_publication_at,
          endpoint_state.endpoint_from,
          endpoint_state.endpoint_to,
          endpoint_state.endpoint_scope_count,
          endpoint_state.endpoint_empty_scope_count,
          endpoint_state.endpoint_coverage_run_status,
          endpoint_state.endpoint_last_status,
          endpoint_state.endpoint_last_finished_at,
          endpoint_state.endpoint_last_success_at,
          endpoint_state.endpoint_last_error_at,
          endpoint_state.endpoint_last_error_summary,
          endpoint_state.endpoint_rows_read,
          endpoint_state.endpoint_rows_written,
          selected_requests.normalized_query,
          selected_requests.query,
          selected_requests.request_kind,
          selected_requests.device,
          selected_requests.count,
          selected_requests.share,
          selected_requests.classification,
          selected_requests.review_status,
          selected_requests.classification_active,
          selected_requests.seo_os_eligible,
          selected_requests.topic,
          selected_requests.cluster,
          selected_requests.seo_os_position,
          selected_requests.seo_os_week,
          selected_requests.confirmed_url
        FROM endpoint_state
        LEFT JOIN selected_requests ON TRUE
        ORDER BY selected_requests.count DESC, selected_requests.query ASC,
          selected_requests.request_kind ASC, selected_requests.device ASC
      `,
      params: [
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        currentUtcDate,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
      ],
    },
    currentRegions: {
      sql: `
        /* wordstat:current-regions */
        WITH latest_snapshot AS (
          SELECT coverage.analytics_account_id, coverage.registry_version, coverage.ingestion_run_id,
            coverage.requested_from, coverage.requested_to,
            coverage_run.status AS selected_coverage_run_status
          FROM canonical_wordstat_coverage coverage
          JOIN canonical_collector_runs coverage_run
            ON coverage_run.id = coverage.ingestion_run_id
            AND coverage_run.source_key = coverage.source_key
            AND coverage_run.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':regions'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'regions'
            AND coverage.status IN ('success', 'success_empty')
            AND coverage.ingestion_run_id IS NOT NULL
            AND coverage.requested_to <= ?
          ORDER BY coverage.requested_to DESC, coverage.requested_from DESC,
            coverage.updated_at DESC, coverage.id DESC, coverage.ingestion_run_id DESC
          LIMIT 1
        ),
        confirmed_coverage AS (
          SELECT DISTINCT coverage.analytics_account_id, coverage.registry_version, coverage.ingestion_run_id,
            coverage.requested_from AS window_from, coverage.requested_to AS window_to, coverage.scope_hash
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot latest
            ON latest.analytics_account_id = coverage.analytics_account_id
            AND latest.requested_from = coverage.requested_from
            AND latest.requested_to = coverage.requested_to
          JOIN canonical_collector_runs coverage_run
            ON coverage_run.id = coverage.ingestion_run_id
            AND coverage_run.source_key = coverage.source_key
            AND coverage_run.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':regions'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'regions'
            AND coverage.status IN ('success', 'success_empty')
            AND coverage.ingestion_run_id IS NOT NULL
        ),
        coverage_state AS (
          SELECT
            MIN(coverage.requested_from) AS endpoint_from,
            MAX(coverage.requested_to) AS endpoint_to,
            COUNT(*) AS endpoint_scope_count,
            SUM(coverage.status = 'success_empty') AS endpoint_empty_scope_count,
            MAX(GREATEST(coverage.updated_at, COALESCE(coverage_run.finished_at, coverage.updated_at))) AS endpoint_publication_at,
            CASE WHEN SUM(coverage_run.status <> 'success') > 0 THEN 'partial' ELSE 'success' END AS endpoint_coverage_run_status
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot latest
            ON latest.analytics_account_id = coverage.analytics_account_id
            AND latest.requested_from = coverage.requested_from
            AND latest.requested_to = coverage.requested_to
          JOIN canonical_collector_runs coverage_run
            ON coverage_run.id = coverage.ingestion_run_id
            AND coverage_run.source_key = coverage.source_key
            AND coverage_run.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':regions'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'regions'
            AND coverage.status IN ('success', 'success_empty')
        ),
        latest_endpoint_run AS (
          SELECT runs.status, runs.finished_at, runs.started_at, runs.error_summary, runs.rows_read, runs.rows_written
          FROM canonical_collector_runs runs
          WHERE runs.source_key = 'yandex_wordstat'
            AND runs.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':regions'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          ORDER BY runs.id DESC
          LIMIT 1
        ),
        latest_endpoint_success AS (
          SELECT runs.finished_at, runs.started_at
          FROM canonical_collector_runs runs
          WHERE runs.source_key = 'yandex_wordstat'
            AND runs.status = 'success'
            AND runs.job_key IN (
              CONCAT('yandex_wordstat:', ?, ':regions'),
              CONCAT('yandex_wordstat:', ?, ':all')
            )
          ORDER BY runs.id DESC
          LIMIT 1
        ),
        endpoint_state AS (
          SELECT
            coverage_state.endpoint_publication_at,
            coverage_state.endpoint_from,
            coverage_state.endpoint_to,
            COALESCE(coverage_state.endpoint_scope_count, 0) AS endpoint_scope_count,
            COALESCE(coverage_state.endpoint_empty_scope_count, 0) AS endpoint_empty_scope_count,
            coverage_state.endpoint_coverage_run_status,
            latest_endpoint_run.status AS endpoint_last_status,
            COALESCE(latest_endpoint_run.finished_at, latest_endpoint_run.started_at) AS endpoint_last_finished_at,
            COALESCE(latest_endpoint_success.finished_at, latest_endpoint_success.started_at) AS endpoint_last_success_at,
            CASE WHEN latest_endpoint_run.status IN ('failed', 'partial')
              THEN COALESCE(latest_endpoint_run.finished_at, latest_endpoint_run.started_at) ELSE NULL END AS endpoint_last_error_at,
            CASE WHEN latest_endpoint_run.status IN ('failed', 'partial')
              THEN latest_endpoint_run.error_summary ELSE NULL END AS endpoint_last_error_summary,
            COALESCE(latest_endpoint_run.rows_read, 0) AS endpoint_rows_read,
            COALESCE(latest_endpoint_run.rows_written, 0) AS endpoint_rows_written
          FROM (SELECT 1 AS anchor) anchor
          LEFT JOIN coverage_state ON TRUE
          LEFT JOIN latest_snapshot ON TRUE
          LEFT JOIN latest_endpoint_run ON TRUE
          LEFT JOIN latest_endpoint_success ON TRUE
        ),
        ranked_approved_seeds AS (
          SELECT seed_hash, registry_version, phrase_text, classification, review_status,
            ROW_NUMBER() OVER (
              PARTITION BY seed_hash
              ORDER BY updated_at DESC, registry_version DESC
            ) AS registry_rank
          FROM canonical_wordstat_seed_registry
          WHERE analytics_account_id = ?
            AND is_active = 1
        ),
        approved_seeds AS (
          SELECT seed_hash, registry_version, phrase_text, classification, review_status
          FROM ranked_approved_seeds
          WHERE registry_rank = 1
        ),
        ranked_regions AS (
          SELECT
            facts.seed_hash, facts.registry_version, seed.phrase_text AS phrase, seed.classification, seed.review_status,
            facts.region_id,
            regions.region_name,
            regions.region_type,
            facts.device_type AS device,
            facts.count,
            facts.share,
            facts.affinity_index,
            ROW_NUMBER() OVER (
              PARTITION BY facts.seed_hash, facts.registry_version, facts.region_id, facts.device_type
              ORDER BY facts.count DESC, facts.seed_hash ASC
            ) AS duplicate_rank
          FROM canonical_fact_wordstat_regions_snapshot facts
          JOIN latest_snapshot selected_snapshot
            ON facts.analytics_account_id = selected_snapshot.analytics_account_id
            AND facts.snapshot_date = selected_snapshot.requested_to
            AND facts.window_from = selected_snapshot.requested_from
            AND facts.window_to = selected_snapshot.requested_to
          JOIN approved_seeds seed ON seed.seed_hash = facts.seed_hash
            AND seed.registry_version = facts.registry_version
          LEFT JOIN canonical_dim_wordstat_regions regions ON regions.region_id = facts.region_id
          WHERE facts.source_key = 'yandex_wordstat'
            AND facts.analytics_account_id = ?
            AND facts.device_type = 'all'
            AND facts.count IS NOT NULL AND facts.count >= 0
            AND EXISTS (
              SELECT 1 FROM confirmed_coverage coverage
              WHERE facts.analytics_account_id = coverage.analytics_account_id
                AND facts.registry_version = coverage.registry_version
                AND facts.ingestion_run_id = coverage.ingestion_run_id
                AND facts.window_from = coverage.window_from AND facts.window_to = coverage.window_to
                AND coverage.scope_hash = ${scopeHashSql("regions", "facts")}
            )
        ),
        selected_regions AS (
          SELECT seed_hash, registry_version, phrase, classification, review_status, region_id, region_name, region_type, device, count, share, affinity_index
          FROM ranked_regions
          WHERE duplicate_rank = 1
        )
        SELECT
          endpoint_state.endpoint_publication_at,
          endpoint_state.endpoint_from,
          endpoint_state.endpoint_to,
          endpoint_state.endpoint_scope_count,
          endpoint_state.endpoint_empty_scope_count,
          endpoint_state.endpoint_coverage_run_status,
          endpoint_state.endpoint_last_status,
          endpoint_state.endpoint_last_finished_at,
          endpoint_state.endpoint_last_success_at,
          endpoint_state.endpoint_last_error_at,
          endpoint_state.endpoint_last_error_summary,
          endpoint_state.endpoint_rows_read,
          endpoint_state.endpoint_rows_written,
          selected_regions.seed_hash, selected_regions.registry_version, selected_regions.phrase,
          selected_regions.classification, selected_regions.review_status,
          selected_regions.region_id,
          selected_regions.region_name,
          selected_regions.region_type,
          selected_regions.device,
          selected_regions.count,
          selected_regions.share,
          selected_regions.affinity_index
        FROM endpoint_state
        LEFT JOIN selected_regions ON TRUE
        ORDER BY selected_regions.count DESC, selected_regions.region_name ASC, selected_regions.device ASC
      `,
      params: [
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        currentUtcDate,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
        normalizedAccountId,
      ],
    },
  };
}

async function executeWordstatQuery(query: WordstatSqlQuery) {
  const [rows] = await pool.execute<RowDataPacket[]>(query.sql, query.params);
  return rows;
}

function periodFromValues(from: string | Date | null | undefined, to: string | Date | null | undefined) {
  const start = formatDate(from);
  const end = formatDate(to);
  return start && end ? { from: start, to: end } : null;
}

function confirmedDatesFromValue(value: string | string[] | null | undefined) {
  let values: string[];
  if (Array.isArray(value)) values = value;
  else {
    const text = asString(value);
    if (text.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(text);
        values = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        values = [];
      }
    } else values = text.split(",");
  }
  return Array.from(new Set(values.map((item) => formatDate(item)).filter((item): item is string => item != null)))
    .filter(validDate)
    .sort();
}

function normalizeHistoricalRows(rows: unknown[]): ZarukuWordstatHistoricalRow[] {
  const rawRows = rows.map((row) => row as HistoricalDbRow);
  const eligibleRows = rawRows.filter(
    (row) => normalizeClassification(row.classification) === "medical" && normalizeReviewStatus(row.review_status) === "reviewed",
  );
  const demandMedian = median(eligibleRows.map((row) => asNumber(row.wordstat_count)));
  const impressionMedian = median(eligibleRows.map((row) => asNumber(row.webmaster_impressions)));
  const positionMedian = median(eligibleRows.map((row) => asNullableNumber(row.webmaster_average_position)).filter((value): value is number => value != null));
  return eligibleRows.map((row): ZarukuWordstatHistoricalRow | null => {
    const wordstatCount = Math.round(asNumber(row.wordstat_count));
    const classification = normalizeClassification(row.classification);
    const reviewStatus = normalizeReviewStatus(row.review_status);
    if (classification !== "medical" || reviewStatus !== "reviewed") return null;
    const historical = {
      seed_hash: asString(row.seed_hash),
      phrase: asString(row.phrase),
      topic: asString(row.topic) || null,
      cluster: asString(row.cluster) || null,
      classification,
      review_status: reviewStatus,
      wordstat_count: wordstatCount,
      previous_wordstat_count: null,
      demand_change: null,
      webmaster_impressions: Math.round(asNumber(row.webmaster_impressions)),
      webmaster_clicks: Math.round(asNumber(row.webmaster_clicks)),
      webmaster_average_position: asNullableNumber(row.webmaster_average_position),
    } satisfies Omit<ZarukuWordstatHistoricalRow, "opportunity">;
    return {
      ...historical,
      opportunity: classifyWordstatOpportunity({
        classification: historical.classification,
        review_status: historical.review_status,
        wordstat_count: historical.wordstat_count,
        demand_median: demandMedian,
        webmaster_impressions: historical.webmaster_impressions,
        webmaster_average_position: historical.webmaster_average_position,
        visibility_impression_median: impressionMedian,
        visibility_position_median: positionMedian || null,
      }),
    };
  }).filter((row): row is ZarukuWordstatHistoricalRow => row != null)
    .sort((left, right) => right.wordstat_count - left.wordstat_count || left.phrase.localeCompare(right.phrase));
}

function actionForQuery(row: Omit<ZarukuWordstatQueryRow, "action">): ZarukuWordstatAction | null {
  if (!row.seo_os_eligible) return null;
  return row.confirmed_url ? "strengthen_page" : "create_material";
}

function normalizeCurrentQueries(rows: unknown[]): ZarukuWordstatQueryRow[] {
  const selected = new Map<string, Omit<ZarukuWordstatQueryRow, "action">>();
  for (const raw of rows as CurrentQueryDbRow[]) {
    const device = asString(raw.device) || "all";
    if (device !== "all" || validCount(raw.count) == null) continue;
    const classificationActive = asBoolean(raw.classification_active);
    const rawClassification = normalizeClassification(raw.classification);
    const rawReviewStatus = normalizeReviewStatus(raw.review_status);
    const reviewStatus = classificationActive ? rawReviewStatus : "pending";
    const classification = classificationActive && reviewStatus === "reviewed" ? rawClassification : "unreviewed";
    const row = {
      normalized_query: asString(raw.normalized_query),
      query: asString(raw.query),
      request_kind: asString(raw.request_kind) === "similar" ? "similar" : "popular",
      device,
      count: Math.round(validCount(raw.count)!),
      share: asNullableNumber(raw.share),
      classification,
      review_status: reviewStatus,
      classification_active: classificationActive,
      topic: asString(raw.topic) || null,
      cluster: asString(raw.cluster) || null,
      seo_os_position: asNullableNumber(raw.seo_os_position),
      seo_os_week: asString(raw.seo_os_week) || null,
      confirmed_url: asString(raw.confirmed_url) || null,
      seo_os_eligible: asBoolean(raw.seo_os_eligible)
        && classificationActive && classification === "medical" && reviewStatus === "reviewed",
    } satisfies Omit<ZarukuWordstatQueryRow, "action">;
    if (!row.normalized_query) continue;
    const key = row.normalized_query;
    const existing = selected.get(key);
    const rowIsPreferredKind = row.request_kind === "popular" && existing?.request_kind === "similar";
    const sameKindIsBetter = existing?.request_kind === row.request_kind
      && (row.count > existing.count || (row.count === existing.count && row.query.localeCompare(existing.query) < 0));
    if (!existing || rowIsPreferredKind || sameKindIsBetter) {
      selected.set(key, row);
    }
  }
  return Array.from(selected.values())
    .map((row) => ({ ...row, action: actionForQuery(row) }))
    .sort((left, right) => right.count - left.count || left.query.localeCompare(right.query) || left.request_kind.localeCompare(right.request_kind));
}


type ObservedDbRow = {
  seed_hash: string; registry_version: string; phrase: string; classification: string; review_status: string;
  report_date: string | Date; count: unknown; scope_hash?: string;
  requested_from?: string; requested_to?: string; device?: string; publication_at?: string | Date;
};

function normalizeObservedDays(rows: unknown[], account: string, nowUtc: Date): ZarukuWordstatObservedDay[] {
  const today = requireUtcDate(nowUtc);
  return (rows as ObservedDbRow[]).flatMap((raw) => {
    const date = formatDate(raw.report_date);
    const count = validCount(raw.count);
    if (!date || !validDate(date) || date >= today || count == null || !raw.seed_hash || !raw.registry_version) return [];
    if (raw.scope_hash && raw.scope_hash !== wordstatScopeHash(account, "dynamics", raw.registry_version,
      raw.seed_hash, [asString(raw.requested_from), asString(raw.requested_to), raw.device ?? "all"])) return [];
    return [{ seed_hash: raw.seed_hash, registry_version: raw.registry_version, phrase: asString(raw.phrase),
      classification: normalizeClassification(raw.classification), review_status: normalizeReviewStatus(raw.review_status),
      date, count }];
  });
}

function normalizeObservedRegions(rows: unknown[], account: string): ZarukuWordstatObservedRegion[] {
  const selected = new Map<string, ZarukuWordstatObservedRegion>();
  for (const raw of rows as CurrentRegionDbRow[]) {
    const count = validCount(raw.count);
    if (!raw.seed_hash || !raw.registry_version || raw.region_id == null || count == null || (raw.device ?? "all") !== "all") continue;
    if (raw.scope_hash && raw.scope_hash !== wordstatScopeHash(account, "regions", raw.registry_version,
      raw.seed_hash, [formatDate(raw.snapshot_date) ?? "", raw.device ?? "all"])) continue;
    const row: ZarukuWordstatObservedRegion = {
      seed_hash: raw.seed_hash, registry_version: raw.registry_version, phrase: asString(raw.phrase),
      classification: normalizeClassification(raw.classification), review_status: normalizeReviewStatus(raw.review_status),
      region_id: asNumber(raw.region_id), region_name: asString(raw.region_name) || "Не указан",
      region_type: asString(raw.region_type) || "unknown", device: "all", count,
      share: asNullableNumber(raw.share), affinity_index: asNullableNumber(raw.affinity_index),
    };
    selected.set(JSON.stringify([row.registry_version, row.seed_hash, row.region_id, row.device]), row);
  }
  return [...selected.values()].sort((a, b) => a.phrase.localeCompare(b.phrase) || b.count - a.count || a.region_id - b.region_id);
}

function normalizeCurrentRegions(rows: unknown[]): ZarukuWordstatRegionRow[] {
  const selected = new Map<string, ZarukuWordstatRegionRow>();
  for (const raw of rows as CurrentRegionDbRow[]) {
    if (raw.region_id == null) continue;
    if (raw.seed_hash && (normalizeClassification(raw.classification) !== "medical" || normalizeReviewStatus(raw.review_status) !== "reviewed")) continue;
    const device = asString(raw.device) || "all";
    if (device !== "all") continue;
    const row = {
      region_id: Math.round(asNumber(raw.region_id)),
      region_name: asString(raw.region_name) || "Не указан",
      region_type: asString(raw.region_type) || "unknown",
      device,
      count: Math.round(asNumber(raw.count)),
      share: asNullableNumber(raw.share),
      affinity_index: asNullableNumber(raw.affinity_index),
    } satisfies ZarukuWordstatRegionRow;
    const key = String(row.region_id);
    const existing = selected.get(key);
    if (!existing || row.count > existing.count) selected.set(key, row);
  }
  return Array.from(selected.values()).sort((left, right) => right.count - left.count || left.region_name.localeCompare(right.region_name));
}

function makeIndicators(historical: ZarukuWordstatHistoricalRow[], queries: ZarukuWordstatQueryRow[]): ZarukuWordstatIndicators {
  const highest = historical
    .filter((row) => row.opportunity === "high" || row.opportunity === "medium")
    .sort((left, right) => right.wordstat_count - left.wordstat_count)[0]?.opportunity ?? null;
  const activeReviewedDemand = queries.filter(
    (row) => row.classification_active && row.review_status === "reviewed" && row.classification !== "unreviewed",
  );
  const totalCurrentDemand = activeReviewedDemand.reduce((sum, row) => sum + row.count, 0);
  const irrelevantDemand = activeReviewedDemand
    .filter((row) => row.classification === "irrelevant")
    .reduce((sum, row) => sum + row.count, 0);
  return {
    growing_medical_topics: null,
    growing_medical_topics_reason: GROWTH_UNAVAILABLE_REASON,
    largest_opportunity: highest,
    irrelevant_demand_share: totalCurrentDemand > 0 ? irrelevantDemand / totalCurrentDemand * 100 : null,
    review_queue_count: queries.filter(
      (row) => row.classification_active && row.classification === "unreviewed" && row.review_status === "pending",
    ).length,
    region_opportunity_count: null,
    region_opportunity_reason: REGION_TRAFFIC_UNAVAILABLE_REASON,
  };
}

type EndpointState = {
  publicationAt: string | null;
  period: { from: string; to: string } | null;
  confirmedDates: string[];
  confirmedDayCount: number;
  confirmedDatesContiguous: boolean;
  scopeCount: number;
  emptyScopeCount: number;
  selectedCoverageRunStatus?: string | null;
  lastStatus: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorSummary: string | null;
  rowsRead: number;
  rowsWritten: number;
};

function endpointStateFromRows(rows: unknown[]): EndpointState | null {
  const raw = rows[0] as Partial<EndpointStateDbRow> | undefined;
  if (!raw) return null;
  const hasSelectedCoverageRunStatus = Object.prototype.hasOwnProperty.call(raw, "endpoint_coverage_run_status");
  return {
    publicationAt: formatDateTime(raw.endpoint_publication_at),
    period: periodFromValues(raw.endpoint_from, raw.endpoint_to),
    confirmedDates: confirmedDatesFromValue(raw.endpoint_confirmed_dates),
    confirmedDayCount: Math.round(asNumber(raw.endpoint_confirmed_day_count)),
    confirmedDatesContiguous: asBoolean(raw.endpoint_confirmed_dates_contiguous),
    scopeCount: Math.round(asNumber(raw.endpoint_scope_count)),
    emptyScopeCount: Math.round(asNumber(raw.endpoint_empty_scope_count)),
    selectedCoverageRunStatus: hasSelectedCoverageRunStatus
      ? asString(raw.endpoint_coverage_run_status) || null
      : undefined,
    lastStatus: asString(raw.endpoint_last_status) || null,
    lastFinishedAt: formatDateTime(raw.endpoint_last_finished_at),
    lastSuccessAt: formatDateTime(raw.endpoint_last_success_at),
    lastErrorAt: formatDateTime(raw.endpoint_last_error_at),
    lastErrorSummary: asString(raw.endpoint_last_error_summary) || null,
    rowsRead: Math.round(asNumber(raw.endpoint_rows_read)),
    rowsWritten: Math.round(asNumber(raw.endpoint_rows_written)),
  };
}

function endpointRunIsProblem(state: EndpointState | null) {
  return state != null
    && state.lastStatus !== "success"
    && (state.scopeCount > 0 || state.lastStatus != null);
}

function selectedCoverageRunIsProblem(state: EndpointState | null) {
  return state != null
    && state.scopeCount > 0
    && state.selectedCoverageRunStatus !== "success";
}

function scopeStatus(
  state: EndpointState | null,
  queryFailed: boolean,
): ZarukuWordstatData["historical"]["status"] {
  if (queryFailed || state == null || state.scopeCount === 0 || state.period == null) return "unavailable";
  if (endpointRunIsProblem(state) || selectedCoverageRunIsProblem(state)) return "partial";
  if (state.emptyScopeCount === state.scopeCount) return "empty";
  return "available";
}

function stateHasRunStatus(state: EndpointState, status: "failed" | "partial" | "running") {
  return state.lastStatus === status || state.selectedCoverageRunStatus === status;
}

function latestEndpointValue(states: Array<EndpointState | null>, key: "lastFinishedAt" | "lastSuccessAt" | "lastErrorAt" | "publicationAt") {
  return states.map((state) => state?.[key] ?? null).filter((value): value is string => value != null).sort().at(-1) ?? null;
}

function utcAgeHours(value: string | null, nowUtc: Date, dateOnly = false) {
  if (!value) return null;
  const normalized = dateOnly
    ? `${value.slice(0, 10)}T00:00:00Z`
    : /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return null;
  return (nowUtc.getTime() - timestamp) / 3_600_000;
}

function makeFreshness(
  states: Array<EndpointState | null>,
  period: { from: string; to: string } | null,
  periodsDiffer: boolean,
  coverageMissing: boolean,
  endpointRunProblem: boolean,
  failedQueries: number,
  nowUtc: Date,
): ZarukuSourceFreshnessRow | null {
  const knownStates = states.filter((state): state is EndpointState => state != null);
  if (knownStates.length === 0) return null;
  const hasFailedRun = knownStates.some((state) => stateHasRunStatus(state, "failed"));
  const hasPartialRun = knownStates.some(
    (state) => stateHasRunStatus(state, "partial") || stateHasRunStatus(state, "running"),
  );
  const snapshotOrRunStale = knownStates.some((state) => {
    const coverageAge = utcAgeHours(state.period?.to ?? null, nowUtc, true);
    const successfulRunAge = utcAgeHours(state.lastSuccessAt, nowUtc);
    return coverageAge == null || successfulRunAge == null
      || coverageAge > WORDSTAT_FRESHNESS_HOURS || successfulRunAge > WORDSTAT_FRESHNESS_HOURS;
  });
  const status = hasFailedRun ? "failed" : hasPartialRun || coverageMissing || endpointRunProblem ? "partial" : "success";
  const freshnessStatus = hasFailedRun
    ? "failed"
    : periodsDiffer || coverageMissing || endpointRunProblem || failedQueries > 0 || hasPartialRun || snapshotOrRunStale
      ? "delayed"
      : period == null
        ? "disabled"
        : "healthy";
  return {
    source_key: "yandex_wordstat",
    label: "Яндекс Wordstat",
    collector: "fetch_yandex_wordstat_canonical.py",
    expected_frequency_hours: 168,
    freshness_status: freshnessStatus,
    freshness_label: freshnessStatus === "healthy"
      ? "актуально"
      : freshnessStatus === "delayed"
        ? "задерживается"
        : freshnessStatus === "failed" ? "ошибка обновления" : "нет данных",
    last_status: status,
    last_finished_at: latestEndpointValue(knownStates, "lastFinishedAt"),
    last_success_at: latestEndpointValue(knownStates, "lastSuccessAt"),
    date_from: period?.from ?? null,
    date_to: period?.to ?? null,
    rows_read: Math.max(...knownStates.map((state) => state.rowsRead)),
    rows_written: Math.max(...knownStates.map((state) => state.rowsWritten)),
    last_error_at: latestEndpointValue(knownStates, "lastErrorAt"),
    last_error_summary: hasFailedRun || hasPartialRun || endpointRunProblem
      ? knownStates.map((state) => state.lastErrorSummary).filter(Boolean).join(" · ") || "Последний релевантный сбор Wordstat завершился с ошибкой или частично."
      : null,
    note: hasFailedRun || hasPartialRun || endpointRunProblem
      ? `Последний сбор выполнен с ошибкой или частично. Подтверждённые публикации отдельных областей показаны; последний полностью успешный сбор указан отдельно. ${knownStates.map((state) => state.lastErrorSummary).filter(Boolean).join(" · ")}`
      : snapshotOrRunStale
      ? `Подтверждённый текущий снимок или его успешный сбор старше ${WORDSTAT_FRESHNESS_HOURS} часов.`
      : periodsDiffer
      ? "Подтверждённые снимки запросов и регионов Wordstat имеют разные периоды."
      : coverageMissing
        ? "Для одной из подтверждённых областей Wordstat пока нет покрытия."
        : endpointRunProblem
          ? "Подтверждённое покрытие Wordstat не имеет успешного account-scoped статуса сбора."
      : period == null
        ? "Подтверждённый снимок Wordstat пока отсутствует."
        : "Период Wordstat отражает подтверждённый rolling snapshot, а не период трафика сайта.",
  };
}

function valueOrEmpty<T>(result: PromiseSettledResult<unknown[]>) {
  return result.status === "fulfilled" ? result.value as T[] : [] as T[];
}

export async function loadZarukuWordstatData(
  accountId: string,
  query: WordstatQueryRunner = executeWordstatQuery,
  nowUtc: Date = new Date(),
): Promise<ZarukuWordstatData> {
  const normalizedAccountId = requireAccountId(accountId);
  if (Number.isNaN(nowUtc.getTime())) throw new Error("nowUtc must be a valid date");
  const queries = buildZarukuWordstatQueries(normalizedAccountId, nowUtc);
  const settled = await Promise.allSettled([
    query(queries.historicalRows),
    query(queries.currentQueries),
    query(queries.currentRegions),
    query(queries.observedDays),
  ]);
  const historicalRows = valueOrEmpty<HistoricalDbRow>(settled[0]);
  const queryRows = valueOrEmpty<CurrentQueryDbRow>(settled[1]);
  const regionRows = valueOrEmpty<CurrentRegionDbRow>(settled[2]);
  const observedRows = valueOrEmpty<ObservedDbRow>(settled[3]);
  const observedDays = normalizeObservedDays(observedRows, normalizedAccountId, nowUtc);
  const observedRegions = normalizeObservedRegions(regionRows, normalizedAccountId);
  const latestPublication = [
    ...observedRows.map((row) => formatDateTime(row.publication_at)),
    ...[...queryRows, ...regionRows].map((row) => formatDateTime(row.endpoint_publication_at)),
  ].filter((value): value is string => value != null).sort().at(-1) ?? null;
  const historicalState = endpointStateFromRows(historicalRows);
  const queryState = endpointStateFromRows(queryRows);
  const regionState = endpointStateFromRows(regionRows);
  const historicalPeriod = historicalState?.period ?? null;
  const historicalConfirmedDates = historicalState?.confirmedDates ?? [];
  const historical = normalizeHistoricalRows(historicalRows);
  const currentQueries = normalizeCurrentQueries(queryRows);
  const currentRegions = normalizeCurrentRegions(regionRows);
  const queryPeriod = queryState?.period ?? null;
  const regionPeriod = regionState?.period ?? null;
  const periodsDiffer = queryPeriod != null
    && regionPeriod != null
    && (queryPeriod.from !== regionPeriod.from || queryPeriod.to !== regionPeriod.to);
  const currentPeriod = periodsDiffer ? null : queryPeriod ?? regionPeriod;
  const queryScopes = queryState?.scopeCount ?? 0;
  const regionScopes = regionState?.scopeCount ?? 0;
  const allCurrentScopesEmpty = queryState != null
    && regionState != null
    && queryScopes > 0
    && regionScopes > 0
    && queryScopes === queryState.emptyScopeCount
    && regionScopes === regionState.emptyScopeCount;
  const failedQueries = settled.filter((result) => result.status === "rejected").length;
  const historicalStatus = scopeStatus(historicalState, settled[0].status === "rejected");
  const queryStatus = scopeStatus(queryState, settled[1].status === "rejected");
  const regionStatus = scopeStatus(regionState, settled[2].status === "rejected");
  const currentEndpointRunProblem = [queryState, regionState].some(
    (state) => endpointRunIsProblem(state) || selectedCoverageRunIsProblem(state),
  );
  const hasFailedEndpointRun = [historicalState, queryState, regionState]
    .filter((state): state is EndpointState => state != null)
    .some((state) => stateHasRunStatus(state, "failed"));
  const hasPartialEndpointRun = [historicalState, queryState, regionState]
    .filter((state): state is EndpointState => state != null)
    .some((state) => stateHasRunStatus(state, "partial") || stateHasRunStatus(state, "running"));
  const currentCoverageMissing = queryState == null
    || regionState == null
    || queryScopes === 0
    || regionScopes === 0;
  const confirmedCurrent = queryScopes > 0 || regionScopes > 0;
  const messages: string[] = [];
  if (failedQueries > 0) messages.push("Часть канонических таблиц Wordstat сейчас недоступна.");
  if (hasFailedEndpointRun) {
    messages.push(confirmedCurrent
      ? "Зафиксирован сбой последнего сбора Wordstat; показан только подтверждённый снимок с его точными датами."
      : "Зафиксирован сбой последнего сбора Wordstat; подтверждённого снимка для показа нет.");
  } else if (hasPartialEndpointRun) {
    messages.push("Последний сбор Wordstat выполнен частично; показаны только подтверждённые области.");
  }
  if (periodsDiffer) {
    messages.push("Подтверждённые снимки запросов и регионов Wordstat имеют разные периоды.");
  }
  if (allCurrentScopesEmpty) messages.push("Нет запросов по выбранным темам в подтверждённом снимке Wordstat.");

  let status: ZarukuWordstatData["status"];
  if (!observedDays.length && historicalStatus === "unavailable" && queryStatus === "unavailable" && regionStatus === "unavailable") {
    status = "unavailable";
  } else if (failedQueries > 0 || periodsDiffer || [historicalStatus, queryStatus, regionStatus].some((value) => value === "partial" || value === "unavailable")) {
    status = "partial";
  } else if (queryStatus === "empty" && regionStatus === "empty") {
    status = "empty";
  } else {
    status = "available";
  }

  return {
    status,
    observed_demand: { days: observedDays, confirmed_dates: [...new Set(observedDays.map((day) => day.date))].sort(),
      growth: calculateWordstatWeeklyGrowth(observedDays, nowUtc) },
    observed_regions: observedRegions,
    latest_confirmed_publication_at: latestPublication,
    historical: {
      status: historicalStatus,
      period: historicalPeriod,
      confirmed_dates: historicalConfirmedDates,
      confirmed_day_count: historicalConfirmedDates.length,
      confirmed_dates_contiguous: historicalConfirmedDates.length > 0
        && historicalState?.confirmedDatesContiguous === true
        && historicalState.confirmedDayCount === historicalConfirmedDates.length,
      rows: historical,
    },
    current: {
      period: currentPeriod,
      query_status: queryStatus,
      region_status: regionStatus,
      query_period: queryPeriod,
      region_period: regionPeriod,
      regional_traffic_comparison: {
        status: "unavailable",
        reason: REGION_TRAFFIC_UNAVAILABLE_REASON,
      },
      queries: currentQueries,
      regions: currentRegions,
    },
    indicators: makeIndicators(historical, currentQueries),
    source_freshness: makeFreshness(
      [queryState, regionState],
      currentPeriod,
      periodsDiffer,
      currentCoverageMissing,
      currentEndpointRunProblem,
      settled.slice(1).filter((result) => result.status === "rejected").length,
      nowUtc,
    ),
    messages,
  };
}

export async function loadWordstatFacts(
  accountId: string,
  query: WordstatQueryRunner = executeWordstatQuery,
) {
  return loadZarukuWordstatData(accountId, query);
}

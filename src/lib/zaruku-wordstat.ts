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
  ZarukuWordstatQueryRow,
  ZarukuWordstatRegionRow,
} from "@/lib/types";

export type WordstatSqlQuery = { sql: string; params: Array<string | number> };
export type WordstatQueryRunner = (query: WordstatSqlQuery) => Promise<unknown[]>;

const HISTORICAL_WINDOW_FROM = "2026-07-10";
const HISTORICAL_WINDOW_TO = "2026-07-31";

type EndpointStateDbRow = {
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
  topic: string | null;
  cluster: string | null;
  seo_os_position: number | string | null;
  seo_os_week: string | null;
  confirmed_url: string | null;
  seo_os_eligible: number | string | boolean | null;
};

type CurrentRegionDbRow = EndpointStateDbRow & {
  region_id: number | string | null;
  region_name: string | null;
  region_type: string | null;
  device: string | null;
  count: number | string | null;
  share: number | string | null;
  affinity_index: number | string | null;
  metrika_visits: number | string | null;
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

export function buildZarukuWordstatQueries(accountId: string): Record<
  "historicalRows" | "currentQueries" | "currentRegions",
  WordstatSqlQuery
> {
  const normalizedAccountId = requireAccountId(accountId);
  return {
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
            coverage.requested_from, coverage.requested_to
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
            AND coverage.requested_from <= '${HISTORICAL_WINDOW_TO}'
            AND coverage.requested_to >= '${HISTORICAL_WINDOW_FROM}'
        ),
        confirmed_dynamics AS (
          SELECT dynamics.registry_version, dynamics.seed_hash, dynamics.report_date, dynamics.count
          FROM canonical_fact_wordstat_dynamics_daily dynamics
          JOIN approved_seeds seed ON seed.seed_hash = dynamics.seed_hash
            AND seed.registry_version = dynamics.registry_version
          JOIN confirmed_dynamics_coverage coverage
            ON coverage.analytics_account_id = dynamics.analytics_account_id
            AND coverage.registry_version = dynamics.registry_version
            AND coverage.ingestion_run_id = dynamics.ingestion_run_id
            AND dynamics.report_date BETWEEN coverage.requested_from AND coverage.requested_to
          WHERE dynamics.source_key = 'yandex_wordstat'
            AND dynamics.analytics_account_id = ?
            AND dynamics.device_type = 'all'
            AND dynamics.region_scope = 'all'
            AND dynamics.report_date BETWEEN '${HISTORICAL_WINDOW_FROM}' AND '${HISTORICAL_WINDOW_TO}'
        ),
        common_dates AS (
          SELECT DISTINCT webmaster.report_date
          FROM canonical_fact_webmaster_queries_daily webmaster
          JOIN confirmed_dynamics_coverage coverage
            ON coverage.analytics_account_id = webmaster.analytics_account_id
            AND webmaster.report_date BETWEEN coverage.requested_from AND coverage.requested_to
          WHERE webmaster.analytics_account_id = ?
            AND webmaster.report_date BETWEEN '${HISTORICAL_WINDOW_FROM}' AND '${HISTORICAL_WINDOW_TO}'
        ),
        common_bounds AS (
          SELECT MIN(report_date) AS endpoint_from, MAX(report_date) AS endpoint_to
          FROM common_dates
        ),
        current_demand AS (
          SELECT dynamics.registry_version, dynamics.seed_hash, SUM(dynamics.count) AS wordstat_count
          FROM confirmed_dynamics dynamics
          JOIN common_dates dates ON dates.report_date = dynamics.report_date
          GROUP BY dynamics.registry_version, dynamics.seed_hash
        ),
        webmaster_daily AS (
          SELECT query_hash, report_date,
            SUM(impressions) AS impressions,
            SUM(clicks) AS clicks,
            CASE WHEN SUM(impressions) > 0
              THEN SUM(CASE WHEN average_position IS NULL THEN 0 ELSE average_position * impressions END)
                / NULLIF(SUM(CASE WHEN average_position IS NULL THEN 0 ELSE impressions END), 0)
              ELSE NULL END AS average_position
          FROM canonical_fact_webmaster_queries_daily
          WHERE analytics_account_id = ?
          GROUP BY query_hash, report_date
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
          SELECT COUNT(*) AS endpoint_scope_count, 0 AS endpoint_empty_scope_count
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
            COALESCE(coverage_state.endpoint_scope_count, 0) AS endpoint_scope_count,
            COALESCE(coverage_state.endpoint_empty_scope_count, 0) AS endpoint_empty_scope_count,
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
          endpoint_state.endpoint_scope_count,
          endpoint_state.endpoint_empty_scope_count,
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
          ORDER BY coverage.requested_to DESC, coverage.requested_from DESC,
            coverage.updated_at DESC, coverage.id DESC, coverage.ingestion_run_id DESC
          LIMIT 1
        ),
        confirmed_coverage AS (
          SELECT DISTINCT coverage.analytics_account_id, coverage.registry_version, coverage.ingestion_run_id,
            coverage.requested_from AS window_from, coverage.requested_to AS window_to
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot latest
            ON latest.analytics_account_id = coverage.analytics_account_id
            AND latest.registry_version = coverage.registry_version
            AND latest.ingestion_run_id = coverage.ingestion_run_id
            AND latest.requested_from = coverage.requested_from
            AND latest.requested_to = coverage.requested_to
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
            SUM(coverage.status = 'success_empty') AS endpoint_empty_scope_count
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot latest
            ON latest.analytics_account_id = coverage.analytics_account_id
            AND latest.registry_version = coverage.registry_version
            AND latest.ingestion_run_id = coverage.ingestion_run_id
            AND latest.requested_from = coverage.requested_from
            AND latest.requested_to = coverage.requested_to
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
            coverage_state.endpoint_from,
            coverage_state.endpoint_to,
            COALESCE(coverage_state.endpoint_scope_count, 0) AS endpoint_scope_count,
            COALESCE(coverage_state.endpoint_empty_scope_count, 0) AS endpoint_empty_scope_count,
            latest_snapshot.selected_coverage_run_status AS endpoint_coverage_run_status,
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
              ) AS row_number
            FROM seo_positions_weekly
            WHERE analytics_account_id = ?
          ) ranked_positions
          WHERE row_number = 1
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
              ) AS row_number
            FROM canonical_fact_gsc_queries_daily
            WHERE analytics_account_id = ?
              AND country = 'rus'
              AND page IS NOT NULL
              AND page <> ''
          ) ranked_urls
          WHERE row_number = 1
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
              WHEN classifications.review_status = 'reviewed'
                AND classifications.classification IN ('medical', 'adjacent', 'irrelevant', 'unreviewed')
              THEN classifications.classification
              ELSE 'unreviewed'
            END AS classification,
            CASE WHEN classifications.review_status = 'reviewed' THEN 'reviewed' ELSE 'pending' END AS review_status,
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
              PARTITION BY facts.request_kind, facts.device_type, facts.normalized_query
              ORDER BY facts.count DESC, facts.seed_hash ASC
            ) AS duplicate_rank
          FROM canonical_fact_wordstat_requests_snapshot facts
          JOIN confirmed_coverage coverage ON facts.analytics_account_id = coverage.analytics_account_id
            AND facts.registry_version = coverage.registry_version
            AND facts.ingestion_run_id = coverage.ingestion_run_id
            AND facts.window_from = coverage.window_from
            AND facts.window_to = coverage.window_to
          LEFT JOIN canonical_wordstat_query_classifications classifications
            ON classifications.analytics_account_id = facts.analytics_account_id
            AND classifications.registry_version = facts.registry_version
            AND classifications.query_hash = facts.query_hash
          LEFT JOIN latest_positions positions ON positions.normalized_query = facts.normalized_query
          LEFT JOIN confirmed_urls urls ON urls.normalized_query = facts.normalized_query
          WHERE facts.source_key = 'yandex_wordstat'
            AND facts.analytics_account_id = ?
        ),
        selected_requests AS (
          SELECT normalized_query, query, request_kind, device, count, share, classification, review_status, seo_os_eligible,
            topic, cluster, seo_os_position, seo_os_week, confirmed_url
          FROM ranked_requests
          WHERE duplicate_rank = 1
        )
        SELECT
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
          ORDER BY coverage.requested_to DESC, coverage.requested_from DESC,
            coverage.updated_at DESC, coverage.id DESC, coverage.ingestion_run_id DESC
          LIMIT 1
        ),
        confirmed_coverage AS (
          SELECT DISTINCT coverage.analytics_account_id, coverage.registry_version, coverage.ingestion_run_id,
            coverage.requested_from AS window_from, coverage.requested_to AS window_to
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot latest
            ON latest.analytics_account_id = coverage.analytics_account_id
            AND latest.registry_version = coverage.registry_version
            AND latest.ingestion_run_id = coverage.ingestion_run_id
            AND latest.requested_from = coverage.requested_from
            AND latest.requested_to = coverage.requested_to
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
            SUM(coverage.status = 'success_empty') AS endpoint_empty_scope_count
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot latest
            ON latest.analytics_account_id = coverage.analytics_account_id
            AND latest.registry_version = coverage.registry_version
            AND latest.ingestion_run_id = coverage.ingestion_run_id
            AND latest.requested_from = coverage.requested_from
            AND latest.requested_to = coverage.requested_to
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
            coverage_state.endpoint_from,
            coverage_state.endpoint_to,
            COALESCE(coverage_state.endpoint_scope_count, 0) AS endpoint_scope_count,
            COALESCE(coverage_state.endpoint_empty_scope_count, 0) AS endpoint_empty_scope_count,
            latest_snapshot.selected_coverage_run_status AS endpoint_coverage_run_status,
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
        snapshot_period AS (
          SELECT requested_from AS window_from, requested_to AS window_to
          FROM latest_snapshot
        ),
        metrika_city_visits AS (
          SELECT LOWER(TRIM(dimension_1_value)) AS region_key, SUM(COALESCE(visits, 0)) AS metrika_visits
          FROM canonical_fact_metrika_breakdowns_daily
          CROSS JOIN snapshot_period period
          WHERE source_key = 'yandex_metrika'
            AND analytics_account_id = ?
            AND report_key = 'map_city_demand'
            AND segment_key = 'russia'
            AND row_kind = 'detail'
            AND report_date BETWEEN period.window_from AND period.window_to
          GROUP BY LOWER(TRIM(dimension_1_value))
        ),
        ranked_approved_seeds AS (
          SELECT seed_hash, registry_version,
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
          SELECT seed_hash, registry_version
          FROM ranked_approved_seeds
          WHERE registry_rank = 1
        ),
        ranked_regions AS (
          SELECT
            facts.region_id,
            regions.region_name,
            regions.region_type,
            facts.device_type AS device,
            facts.count,
            facts.share,
            facts.affinity_index,
            metrika_city_visits.metrika_visits,
            ROW_NUMBER() OVER (
              PARTITION BY facts.region_id, facts.device_type
              ORDER BY facts.count DESC, facts.seed_hash ASC
            ) AS duplicate_rank
          FROM canonical_fact_wordstat_regions_snapshot facts
          JOIN confirmed_coverage coverage ON facts.analytics_account_id = coverage.analytics_account_id
            AND facts.registry_version = coverage.registry_version
            AND facts.ingestion_run_id = coverage.ingestion_run_id
            AND facts.window_from = coverage.window_from
            AND facts.window_to = coverage.window_to
          JOIN approved_seeds seed ON seed.seed_hash = facts.seed_hash
            AND seed.registry_version = facts.registry_version
          LEFT JOIN canonical_dim_wordstat_regions regions ON regions.region_id = facts.region_id
          LEFT JOIN metrika_city_visits ON metrika_city_visits.region_key = LOWER(TRIM(regions.region_name))
          WHERE facts.source_key = 'yandex_wordstat'
            AND facts.analytics_account_id = ?
        ),
        selected_regions AS (
          SELECT region_id, region_name, region_type, device, count, share, affinity_index, metrika_visits
          FROM ranked_regions
          WHERE duplicate_rank = 1
        )
        SELECT
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
          selected_regions.region_id,
          selected_regions.region_name,
          selected_regions.region_type,
          selected_regions.device,
          selected_regions.count,
          selected_regions.share,
          selected_regions.affinity_index,
          selected_regions.metrika_visits
        FROM endpoint_state
        LEFT JOIN selected_regions ON TRUE
        ORDER BY selected_regions.count DESC, selected_regions.region_name ASC, selected_regions.device ASC
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

function normalizeHistoricalRows(rows: unknown[]): ZarukuWordstatHistoricalRow[] {
  const rawRows = rows.map((row) => row as HistoricalDbRow);
  const eligibleRows = rawRows.filter(
    (row) => normalizeClassification(row.classification) === "medical" && normalizeReviewStatus(row.review_status) === "reviewed",
  );
  const demandMedian = median(eligibleRows.map((row) => asNumber(row.wordstat_count)));
  const impressionMedian = median(eligibleRows.map((row) => asNumber(row.webmaster_impressions)));
  const positionMedian = median(eligibleRows.map((row) => asNullableNumber(row.webmaster_average_position)).filter((value): value is number => value != null));
  return eligibleRows.map((row) => {
    const wordstatCount = Math.round(asNumber(row.wordstat_count));
    const previous = asNullableNumber(row.previous_wordstat_count);
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
      previous_wordstat_count: previous == null ? null : Math.round(previous),
      demand_change: previous == null ? null : wordstatCount - Math.round(previous),
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
  if (row.confirmed_url && row.seo_os_position != null && row.seo_os_position > 10) return "strengthen_page";
  if (row.confirmed_url) return "clarify_wording";
  return null;
}

function normalizeCurrentQueries(rows: unknown[]): ZarukuWordstatQueryRow[] {
  const selected = new Map<string, Omit<ZarukuWordstatQueryRow, "action">>();
  for (const raw of rows as CurrentQueryDbRow[]) {
    const classification = normalizeClassification(raw.classification);
    const reviewStatus = normalizeReviewStatus(raw.review_status);
    const row = {
      normalized_query: asString(raw.normalized_query),
      query: asString(raw.query),
      request_kind: asString(raw.request_kind) === "similar" ? "similar" : "popular",
      device: asString(raw.device) || "all",
      count: Math.round(asNumber(raw.count)),
      share: asNullableNumber(raw.share),
      classification: reviewStatus === "reviewed" ? classification : "unreviewed",
      review_status: reviewStatus,
      topic: asString(raw.topic) || null,
      cluster: asString(raw.cluster) || null,
      seo_os_position: asNullableNumber(raw.seo_os_position),
      seo_os_week: asString(raw.seo_os_week) || null,
      confirmed_url: asString(raw.confirmed_url) || null,
      seo_os_eligible: asBoolean(raw.seo_os_eligible) && classification === "medical" && reviewStatus === "reviewed",
    } satisfies Omit<ZarukuWordstatQueryRow, "action">;
    if (!row.normalized_query) continue;
    const key = `${row.request_kind}\u0000${row.device}\u0000${row.normalized_query}`;
    const existing = selected.get(key);
    if (!existing || row.count > existing.count || (row.count === existing.count && row.query.localeCompare(existing.query) < 0)) {
      selected.set(key, row);
    }
  }
  return Array.from(selected.values())
    .map((row) => ({ ...row, action: actionForQuery(row) }))
    .sort((left, right) => right.count - left.count || left.query.localeCompare(right.query) || left.request_kind.localeCompare(right.request_kind));
}

function normalizeCurrentRegions(rows: unknown[]): ZarukuWordstatRegionRow[] {
  const selected = new Map<string, ZarukuWordstatRegionRow>();
  for (const raw of rows as CurrentRegionDbRow[]) {
    if (raw.region_id == null) continue;
    const row = {
      region_id: Math.round(asNumber(raw.region_id)),
      region_name: asString(raw.region_name) || "Не указан",
      region_type: asString(raw.region_type) || "unknown",
      device: asString(raw.device) || "all",
      count: Math.round(asNumber(raw.count)),
      share: asNullableNumber(raw.share),
      affinity_index: asNullableNumber(raw.affinity_index),
      metrika_visits: asNullableNumber(raw.metrika_visits),
    } satisfies ZarukuWordstatRegionRow;
    const key = `${row.region_id}\u0000${row.device}`;
    const existing = selected.get(key);
    if (!existing || row.count > existing.count) selected.set(key, row);
  }
  return Array.from(selected.values()).sort((left, right) => right.count - left.count || left.region_name.localeCompare(right.region_name));
}

function makeIndicators(historical: ZarukuWordstatHistoricalRow[], queries: ZarukuWordstatQueryRow[], regions: ZarukuWordstatRegionRow[]): ZarukuWordstatIndicators {
  const growingTopics = new Set(
    historical.filter((row) => row.demand_change != null && row.demand_change > 0).map((row) => row.topic ?? row.phrase),
  );
  const highest = historical
    .filter((row) => row.opportunity === "high" || row.opportunity === "medium")
    .sort((left, right) => right.wordstat_count - left.wordstat_count)[0]?.opportunity ?? null;
  const nonOverlappingDiscovery = queries.filter((row) => row.request_kind === "popular" && row.device === "all");
  const totalCurrentDemand = nonOverlappingDiscovery.reduce((sum, row) => sum + row.count, 0);
  const irrelevantDemand = nonOverlappingDiscovery
    .filter((row) => row.classification === "irrelevant" && row.review_status === "reviewed")
    .reduce((sum, row) => sum + row.count, 0);
  return {
    growing_medical_topics: growingTopics.size,
    largest_opportunity: highest,
    irrelevant_demand_share: totalCurrentDemand > 0 ? irrelevantDemand / totalCurrentDemand * 100 : null,
    review_queue_count: queries.filter((row) => row.classification === "unreviewed" || row.classification === "adjacent").length,
    region_opportunity_count: regions.filter((row) => (row.affinity_index ?? 0) > 1 && row.metrika_visits != null && row.metrika_visits <= 0).length,
  };
}

type EndpointState = {
  period: { from: string; to: string } | null;
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
    period: periodFromValues(raw.endpoint_from, raw.endpoint_to),
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
    && state.selectedCoverageRunStatus !== undefined
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

function latestEndpointValue(states: Array<EndpointState | null>, key: "lastFinishedAt" | "lastSuccessAt" | "lastErrorAt") {
  return states.map((state) => state?.[key] ?? null).filter((value): value is string => value != null).sort().at(-1) ?? null;
}

function makeFreshness(
  states: Array<EndpointState | null>,
  period: { from: string; to: string } | null,
  periodsDiffer: boolean,
  coverageMissing: boolean,
  endpointRunProblem: boolean,
  failedQueries: number,
): ZarukuSourceFreshnessRow | null {
  const knownStates = states.filter((state): state is EndpointState => state != null);
  if (knownStates.length === 0) return null;
  const hasFailedRun = knownStates.some((state) => stateHasRunStatus(state, "failed"));
  const hasPartialRun = knownStates.some(
    (state) => stateHasRunStatus(state, "partial") || stateHasRunStatus(state, "running"),
  );
  const status = hasFailedRun ? "failed" : hasPartialRun || coverageMissing || endpointRunProblem ? "partial" : "success";
  const freshnessStatus = hasFailedRun
    ? "failed"
    : periodsDiffer || coverageMissing || endpointRunProblem || failedQueries > 0 || hasPartialRun
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
    freshness_label: freshnessStatus,
    last_status: status,
    last_finished_at: latestEndpointValue(knownStates, "lastFinishedAt"),
    last_success_at: latestEndpointValue(knownStates, "lastSuccessAt"),
    date_from: period?.from ?? null,
    date_to: period?.to ?? null,
    rows_read: Math.max(...knownStates.map((state) => state.rowsRead)),
    rows_written: Math.max(...knownStates.map((state) => state.rowsWritten)),
    last_error_at: latestEndpointValue(knownStates, "lastErrorAt"),
    last_error_summary: hasFailedRun || hasPartialRun || endpointRunProblem
      ? "Последний релевантный сбор Wordstat завершился с ошибкой или частично."
      : null,
    note: periodsDiffer
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
): Promise<ZarukuWordstatData> {
  const normalizedAccountId = requireAccountId(accountId);
  const queries = buildZarukuWordstatQueries(normalizedAccountId);
  const settled = await Promise.allSettled([
    query(queries.historicalRows),
    query(queries.currentQueries),
    query(queries.currentRegions),
  ]);
  const historicalRows = valueOrEmpty<HistoricalDbRow>(settled[0]);
  const queryRows = valueOrEmpty<CurrentQueryDbRow>(settled[1]);
  const regionRows = valueOrEmpty<CurrentRegionDbRow>(settled[2]);
  const historicalState = endpointStateFromRows(historicalRows);
  const queryState = endpointStateFromRows(queryRows);
  const regionState = endpointStateFromRows(regionRows);
  const historicalPeriod = historicalState?.period ?? null;
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
  const historicalScopes = historicalState?.scopeCount ?? 0;
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
  const endpointRunProblem = [historicalState, queryState, regionState].some(
    (state) => endpointRunIsProblem(state) || selectedCoverageRunIsProblem(state),
  );
  const hasFailedEndpointRun = [historicalState, queryState, regionState]
    .filter((state): state is EndpointState => state != null)
    .some((state) => stateHasRunStatus(state, "failed"));
  const hasPartialEndpointRun = [historicalState, queryState, regionState]
    .filter((state): state is EndpointState => state != null)
    .some((state) => stateHasRunStatus(state, "partial") || stateHasRunStatus(state, "running"));
  const coverageMissing = historicalState == null
    || queryState == null
    || regionState == null
    || historicalScopes === 0
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
  if (historicalStatus === "unavailable" && queryStatus === "unavailable" && regionStatus === "unavailable") {
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
    historical: { status: historicalStatus, period: historicalPeriod, rows: historical },
    current: {
      period: currentPeriod,
      query_status: queryStatus,
      region_status: regionStatus,
      query_period: queryPeriod,
      region_period: regionPeriod,
      queries: currentQueries,
      regions: currentRegions,
    },
    indicators: makeIndicators(historical, currentQueries, currentRegions),
    source_freshness: makeFreshness(
      [historicalState, queryState, regionState],
      currentPeriod,
      periodsDiffer,
      coverageMissing,
      endpointRunProblem,
      failedQueries,
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

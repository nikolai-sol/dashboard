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

type WordstatMetadataDbRow = {
  query_from: string | Date | null;
  query_to: string | Date | null;
  query_scope_count: number | string | null;
  query_empty_scope_count: number | string | null;
  region_from: string | Date | null;
  region_to: string | Date | null;
  region_scope_count: number | string | null;
  region_empty_scope_count: number | string | null;
  last_status: string | null;
  last_finished_at: string | Date | null;
  last_success_at: string | Date | null;
  last_error_at: string | Date | null;
  last_error_summary: string | null;
  rows_read: number | string | null;
  rows_written: number | string | null;
};

type HistoricalPeriodDbRow = {
  period_from: string | Date | null;
  period_to: string | Date | null;
};

type HistoricalDbRow = {
  seed_hash: string;
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

type CurrentQueryDbRow = {
  normalized_query: string;
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
};

type CurrentRegionDbRow = {
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
  "metadata" | "historicalPeriod" | "historicalRows" | "currentQueries" | "currentRegions",
  WordstatSqlQuery
> {
  const normalizedAccountId = requireAccountId(accountId);
  return {
    metadata: {
      sql: `
        /* wordstat:metadata */
        WITH latest_query_snapshot AS (
          SELECT MAX(requested_to) AS snapshot_date
          FROM canonical_wordstat_coverage
          WHERE source_key = 'yandex_wordstat'
            AND analytics_account_id = ?
            AND endpoint = 'top_requests'
            AND status IN ('success', 'success_empty')
        ),
        query_coverage AS (
          SELECT
            MIN(c.requested_from) AS query_from,
            MAX(c.requested_to) AS query_to,
            COUNT(*) AS query_scope_count,
            SUM(c.status = 'success_empty') AS query_empty_scope_count
          FROM canonical_wordstat_coverage c
          JOIN latest_query_snapshot latest ON latest.snapshot_date = c.requested_to
          WHERE c.source_key = 'yandex_wordstat'
            AND c.analytics_account_id = ?
            AND c.endpoint = 'top_requests'
            AND c.status IN ('success', 'success_empty')
        ),
        latest_region_snapshot AS (
          SELECT MAX(requested_to) AS snapshot_date
          FROM canonical_wordstat_coverage
          WHERE source_key = 'yandex_wordstat'
            AND analytics_account_id = ?
            AND endpoint = 'regions'
            AND status IN ('success', 'success_empty')
        ),
        region_coverage AS (
          SELECT
            MIN(c.requested_from) AS region_from,
            MAX(c.requested_to) AS region_to,
            COUNT(*) AS region_scope_count,
            SUM(c.status = 'success_empty') AS region_empty_scope_count
          FROM canonical_wordstat_coverage c
          JOIN latest_region_snapshot latest ON latest.snapshot_date = c.requested_to
          WHERE c.source_key = 'yandex_wordstat'
            AND c.analytics_account_id = ?
            AND c.endpoint = 'regions'
            AND c.status IN ('success', 'success_empty')
        ),
        account_coverage_runs AS (
          SELECT DISTINCT coverage.ingestion_run_id
          FROM canonical_wordstat_coverage coverage
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint IN ('top_requests', 'regions')
            AND coverage.ingestion_run_id IS NOT NULL
        ),
        latest_run AS (
          SELECT runs.status, runs.finished_at, runs.started_at, runs.error_summary, runs.rows_read, runs.rows_written
          FROM canonical_collector_runs runs
          JOIN account_coverage_runs coverage ON coverage.ingestion_run_id = runs.id
          WHERE runs.source_key = 'yandex_wordstat'
          ORDER BY runs.id DESC
          LIMIT 1
        ),
        latest_success AS (
          SELECT runs.finished_at, runs.started_at
          FROM canonical_collector_runs runs
          JOIN account_coverage_runs coverage ON coverage.ingestion_run_id = runs.id
          WHERE runs.source_key = 'yandex_wordstat'
            AND runs.status = 'success'
          ORDER BY runs.id DESC
          LIMIT 1
        )
        SELECT
          query_coverage.query_from,
          query_coverage.query_to,
          COALESCE(query_coverage.query_scope_count, 0) AS query_scope_count,
          COALESCE(query_coverage.query_empty_scope_count, 0) AS query_empty_scope_count,
          region_coverage.region_from,
          region_coverage.region_to,
          COALESCE(region_coverage.region_scope_count, 0) AS region_scope_count,
          COALESCE(region_coverage.region_empty_scope_count, 0) AS region_empty_scope_count,
          latest_run.status AS last_status,
          COALESCE(latest_run.finished_at, latest_run.started_at) AS last_finished_at,
          COALESCE(latest_success.finished_at, latest_success.started_at) AS last_success_at,
          CASE WHEN latest_run.status IN ('failed', 'partial') THEN COALESCE(latest_run.finished_at, latest_run.started_at) ELSE NULL END AS last_error_at,
          CASE WHEN latest_run.status IN ('failed', 'partial') THEN latest_run.error_summary ELSE NULL END AS last_error_summary,
          COALESCE(latest_run.rows_read, 0) AS rows_read,
          COALESCE(latest_run.rows_written, 0) AS rows_written
        FROM query_coverage
        CROSS JOIN region_coverage
        LEFT JOIN latest_run ON TRUE
        LEFT JOIN latest_success ON TRUE
      `,
      params: [normalizedAccountId, normalizedAccountId, normalizedAccountId, normalizedAccountId, normalizedAccountId],
    },
    historicalPeriod: {
      sql: `
        /* wordstat:historical-period */
        WITH common_dates AS (
          SELECT DISTINCT webmaster.report_date
          FROM canonical_fact_webmaster_queries_daily webmaster
          WHERE webmaster.analytics_account_id = ?
            AND EXISTS (
              SELECT 1
              FROM canonical_wordstat_coverage coverage
              WHERE coverage.source_key = 'yandex_wordstat'
                AND coverage.analytics_account_id = ?
                AND coverage.endpoint = 'dynamics'
                AND coverage.status IN ('success', 'success_empty')
                AND webmaster.report_date BETWEEN coverage.requested_from AND coverage.requested_to
            )
        )
        SELECT MIN(report_date) AS period_from, MAX(report_date) AS period_to
        FROM common_dates
      `,
      params: [normalizedAccountId, normalizedAccountId],
    },
    historicalRows: {
      sql: `
        /* wordstat:historical-rows */
        WITH common_dates AS (
          SELECT DISTINCT webmaster.report_date
          FROM canonical_fact_webmaster_queries_daily webmaster
          WHERE webmaster.analytics_account_id = ?
            AND EXISTS (
              SELECT 1
              FROM canonical_wordstat_coverage coverage
              WHERE coverage.source_key = 'yandex_wordstat'
                AND coverage.analytics_account_id = ?
                AND coverage.endpoint = 'dynamics'
                AND coverage.status IN ('success', 'success_empty')
                AND webmaster.report_date BETWEEN coverage.requested_from AND coverage.requested_to
            )
        ),
        common_bounds AS (
          SELECT MIN(report_date) AS period_from, MAX(report_date) AS period_to
          FROM common_dates
        ),
        ranked_approved_seeds AS (
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
        current_demand AS (
          SELECT dynamics.registry_version, dynamics.seed_hash, SUM(dynamics.count) AS wordstat_count
          FROM canonical_fact_wordstat_dynamics_daily dynamics
          JOIN approved_seeds seed ON seed.seed_hash = dynamics.seed_hash
            AND dynamics.registry_version = seed.registry_version
          JOIN common_dates dates ON dates.report_date = dynamics.report_date
          WHERE dynamics.source_key = 'yandex_wordstat'
            AND dynamics.analytics_account_id = ?
            AND dynamics.device_type = 'all'
            AND dynamics.region_scope = 'all'
          GROUP BY dynamics.registry_version, dynamics.seed_hash
        ),
        previous_demand AS (
          SELECT dynamics.registry_version, dynamics.seed_hash, SUM(dynamics.count) AS previous_wordstat_count
          FROM canonical_fact_wordstat_dynamics_daily dynamics
          JOIN approved_seeds seed ON seed.seed_hash = dynamics.seed_hash
            AND dynamics.registry_version = seed.registry_version
          CROSS JOIN common_bounds bounds
          WHERE dynamics.source_key = 'yandex_wordstat'
            AND dynamics.analytics_account_id = ?
            AND dynamics.device_type = 'all'
            AND dynamics.region_scope = 'all'
            AND bounds.period_from IS NOT NULL
            AND dynamics.report_date BETWEEN DATE_SUB(bounds.period_from, INTERVAL (DATEDIFF(bounds.period_to, bounds.period_from) + 1) DAY)
              AND DATE_SUB(bounds.period_from, INTERVAL 1 DAY)
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
        )
        SELECT
          seed.seed_hash,
          seed.phrase_text AS phrase,
          seed.topic,
          seed.cluster,
          seed.classification,
          seed.review_status,
          current_demand.wordstat_count,
          previous_demand.previous_wordstat_count,
          COALESCE(webmaster_demand.webmaster_impressions, 0) AS webmaster_impressions,
          COALESCE(webmaster_demand.webmaster_clicks, 0) AS webmaster_clicks,
          webmaster_demand.webmaster_average_position
        FROM approved_seeds seed
        JOIN current_demand ON current_demand.seed_hash = seed.seed_hash
          AND current_demand.registry_version = seed.registry_version
        LEFT JOIN previous_demand ON previous_demand.seed_hash = seed.seed_hash
          AND previous_demand.registry_version = seed.registry_version
        LEFT JOIN webmaster_demand ON webmaster_demand.seed_hash = seed.seed_hash
          AND webmaster_demand.registry_version = seed.registry_version
        ORDER BY current_demand.wordstat_count DESC, seed.phrase_text ASC
      `,
      params: [
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
        WITH latest_snapshot_window AS (
          SELECT MAX(requested_to) AS window_to
          FROM canonical_wordstat_coverage
          WHERE source_key = 'yandex_wordstat'
            AND analytics_account_id = ?
            AND endpoint = 'top_requests'
            AND status IN ('success', 'success_empty')
        ),
        confirmed_coverage AS (
          SELECT DISTINCT coverage.ingestion_run_id, coverage.requested_from AS window_from, coverage.requested_to AS window_to
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot_window latest ON latest.window_to = coverage.requested_to
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'top_requests'
            AND coverage.status IN ('success', 'success_empty')
            AND coverage.ingestion_run_id IS NOT NULL
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
          JOIN confirmed_coverage coverage ON facts.ingestion_run_id = coverage.ingestion_run_id
            AND facts.window_from = coverage.window_from
            AND facts.window_to = coverage.window_to
          LEFT JOIN canonical_wordstat_query_classifications classifications
            ON classifications.analytics_account_id = facts.analytics_account_id
            AND classifications.registry_version = facts.registry_version
            AND classifications.query_hash = facts.query_hash
            AND classifications.is_active = 1
          LEFT JOIN latest_positions positions ON positions.normalized_query = facts.normalized_query
          LEFT JOIN confirmed_urls urls ON urls.normalized_query = facts.normalized_query
          WHERE facts.source_key = 'yandex_wordstat'
            AND facts.analytics_account_id = ?
        )
        SELECT normalized_query, query, request_kind, device, count, share, classification, review_status,
          topic, cluster, seo_os_position, seo_os_week, confirmed_url
        FROM ranked_requests
        WHERE duplicate_rank = 1
        ORDER BY count DESC, query ASC, request_kind ASC, device ASC
      `,
      params: [normalizedAccountId, normalizedAccountId, normalizedAccountId, normalizedAccountId, normalizedAccountId],
    },
    currentRegions: {
      sql: `
        /* wordstat:current-regions */
        WITH latest_snapshot_window AS (
          SELECT MAX(requested_to) AS window_to
          FROM canonical_wordstat_coverage
          WHERE source_key = 'yandex_wordstat'
            AND analytics_account_id = ?
            AND endpoint = 'regions'
            AND status IN ('success', 'success_empty')
        ),
        confirmed_coverage AS (
          SELECT DISTINCT coverage.ingestion_run_id, coverage.requested_from AS window_from, coverage.requested_to AS window_to
          FROM canonical_wordstat_coverage coverage
          JOIN latest_snapshot_window latest ON latest.window_to = coverage.requested_to
          WHERE coverage.source_key = 'yandex_wordstat'
            AND coverage.analytics_account_id = ?
            AND coverage.endpoint = 'regions'
            AND coverage.status IN ('success', 'success_empty')
            AND coverage.ingestion_run_id IS NOT NULL
        ),
        snapshot_period AS (
          SELECT MIN(requested_from) AS window_from, MAX(requested_to) AS window_to
          FROM confirmed_coverage
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
          JOIN confirmed_coverage coverage ON facts.ingestion_run_id = coverage.ingestion_run_id
            AND facts.window_from = coverage.window_from
            AND facts.window_to = coverage.window_to
          JOIN approved_seeds seed ON seed.seed_hash = facts.seed_hash
            AND seed.registry_version = facts.registry_version
          LEFT JOIN canonical_dim_wordstat_regions regions ON regions.region_id = facts.region_id
          LEFT JOIN metrika_city_visits ON metrika_city_visits.region_key = LOWER(TRIM(regions.region_name))
          WHERE facts.source_key = 'yandex_wordstat'
            AND facts.analytics_account_id = ?
        )
        SELECT region_id, region_name, region_type, device, count, share, affinity_index, metrika_visits
        FROM ranked_regions
        WHERE duplicate_rank = 1
        ORDER BY count DESC, region_name ASC, device ASC
      `,
      params: [normalizedAccountId, normalizedAccountId, normalizedAccountId, normalizedAccountId, normalizedAccountId],
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
  const demandMedian = median(rawRows.map((row) => asNumber(row.wordstat_count)));
  const impressionMedian = median(rawRows.map((row) => asNumber(row.webmaster_impressions)));
  const positionMedian = median(rawRows.map((row) => asNullableNumber(row.webmaster_average_position)).filter((value): value is number => value != null));
  return rawRows.map((row) => {
    const wordstatCount = Math.round(asNumber(row.wordstat_count));
    const previous = asNullableNumber(row.previous_wordstat_count);
    const classification = normalizeClassification(row.classification);
    const reviewStatus = normalizeReviewStatus(row.review_status);
    const historical = {
      seed_hash: asString(row.seed_hash),
      phrase: asString(row.phrase),
      topic: asString(row.topic) || null,
      cluster: asString(row.cluster) || null,
      classification: classification === "medical" ? classification : "medical",
      review_status: reviewStatus === "reviewed" ? reviewStatus : "reviewed",
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
  }).sort((left, right) => right.wordstat_count - left.wordstat_count || left.phrase.localeCompare(right.phrase));
}

function actionForQuery(row: Omit<ZarukuWordstatQueryRow, "action">): ZarukuWordstatAction | null {
  if (row.classification !== "medical" || row.review_status !== "reviewed") return null;
  if (row.confirmed_url && row.seo_os_position != null && row.seo_os_position > 10) return "strengthen_page";
  if (row.confirmed_url) return "clarify_wording";
  return "create_material";
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
  const totalCurrentDemand = queries.reduce((sum, row) => sum + row.count, 0);
  const irrelevantDemand = queries
    .filter((row) => row.classification === "irrelevant" && row.review_status === "reviewed")
    .reduce((sum, row) => sum + row.count, 0);
  return {
    growing_medical_topics: growingTopics.size,
    largest_opportunity: highest,
    irrelevant_demand_share: totalCurrentDemand > 0 ? irrelevantDemand / totalCurrentDemand * 100 : null,
    review_queue_count: queries.filter((row) => row.classification === "unreviewed" || row.classification === "adjacent").length,
    region_opportunity_count: regions.filter((row) => (row.affinity_index ?? 0) > 1 && (row.metrika_visits == null || row.metrika_visits <= 0)).length,
  };
}

function makeFreshness(metadata: WordstatMetadataDbRow | null): ZarukuSourceFreshnessRow | null {
  if (!metadata) return null;
  const period = periodFromValues(metadata.query_from, metadata.query_to)
    ?? periodFromValues(metadata.region_from, metadata.region_to);
  const status = asString(metadata.last_status) || null;
  const freshnessStatus = status === "failed" ? "failed" : period == null ? "disabled" : status === "partial" ? "delayed" : "healthy";
  return {
    source_key: "yandex_wordstat",
    label: "Яндекс Wordstat",
    collector: "fetch_yandex_wordstat_canonical.py",
    expected_frequency_hours: 168,
    freshness_status: freshnessStatus,
    freshness_label: freshnessStatus,
    last_status: status,
    last_finished_at: formatDateTime(metadata.last_finished_at),
    last_success_at: formatDateTime(metadata.last_success_at),
    date_from: period?.from ?? null,
    date_to: period?.to ?? null,
    rows_read: Math.round(asNumber(metadata.rows_read)),
    rows_written: Math.round(asNumber(metadata.rows_written)),
    last_error_at: formatDateTime(metadata.last_error_at),
    last_error_summary: status === "failed" || status === "partial" ? "Последний сбор Wordstat завершился с ошибкой." : null,
    note: period == null
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
    query(queries.metadata),
    query(queries.historicalPeriod),
    query(queries.historicalRows),
    query(queries.currentQueries),
    query(queries.currentRegions),
  ]);
  const metadata = valueOrEmpty<WordstatMetadataDbRow>(settled[0])[0] ?? null;
  const historicalPeriodRow = valueOrEmpty<HistoricalPeriodDbRow>(settled[1])[0] ?? { period_from: null, period_to: null };
  const historicalPeriod = periodFromValues(historicalPeriodRow.period_from, historicalPeriodRow.period_to);
  const historical = normalizeHistoricalRows(valueOrEmpty<HistoricalDbRow>(settled[2]));
  const currentQueries = normalizeCurrentQueries(valueOrEmpty<CurrentQueryDbRow>(settled[3]));
  const currentRegions = normalizeCurrentRegions(valueOrEmpty<CurrentRegionDbRow>(settled[4]));
  const currentPeriod = metadata
    ? periodFromValues(metadata.query_from, metadata.query_to)
      ?? periodFromValues(metadata.region_from, metadata.region_to)
    : null;
  const queryScopes = metadata ? asNumber(metadata.query_scope_count) : 0;
  const regionScopes = metadata ? asNumber(metadata.region_scope_count) : 0;
  const allCurrentScopesEmpty = metadata != null
    && queryScopes > 0
    && regionScopes > 0
    && queryScopes === asNumber(metadata.query_empty_scope_count)
    && regionScopes === asNumber(metadata.region_empty_scope_count);
  const failedQueries = settled.filter((result) => result.status === "rejected").length;
  const latestStatus = asString(metadata?.last_status);
  const confirmedCurrent = queryScopes > 0 || regionScopes > 0;
  const messages: string[] = [];
  if (failedQueries > 0) messages.push("Часть канонических таблиц Wordstat сейчас недоступна.");
  if (latestStatus === "failed") {
    messages.push(confirmedCurrent
      ? "Зафиксирован сбой последнего сбора Wordstat; показан только подтверждённый снимок с его точными датами."
      : "Зафиксирован сбой последнего сбора Wordstat; подтверждённого снимка для показа нет.");
  } else if (latestStatus === "partial") {
    messages.push("Последний сбор Wordstat выполнен частично; показаны только подтверждённые области.");
  }
  if (allCurrentScopesEmpty) messages.push("Нет запросов по выбранным темам в подтверждённом снимке Wordstat.");

  let status: ZarukuWordstatData["status"];
  if (!metadata || (!confirmedCurrent && !historicalPeriod)) {
    status = "unavailable";
  } else if (allCurrentScopesEmpty && failedQueries === 0 && latestStatus !== "failed" && latestStatus !== "partial") {
    status = "empty";
  } else if (failedQueries > 0 || latestStatus === "failed" || latestStatus === "partial" || queryScopes === 0 || regionScopes === 0) {
    status = "partial";
  } else {
    status = "available";
  }

  return {
    status,
    historical: { period: historicalPeriod, rows: historical },
    current: { period: currentPeriod, queries: currentQueries, regions: currentRegions },
    indicators: makeIndicators(historical, currentQueries, currentRegions),
    source_freshness: makeFreshness(metadata),
    messages,
  };
}

export async function loadWordstatFacts(
  accountId: string,
  query: WordstatQueryRunner = executeWordstatQuery,
) {
  return loadZarukuWordstatData(accountId, query);
}

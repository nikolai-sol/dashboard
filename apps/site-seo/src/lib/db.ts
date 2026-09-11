import { createHash } from "node:crypto";
import type { DatasetMeta, ManualSheet, Metrics, Period, SourceScope } from "@reportingdash/site-seo-contract";
import mysql from "mysql2/promise";
import type { GscReadRows } from "./gsc.ts";
import {
  buildManualCoverageReadQuery,
  buildManualDailyReadQuery,
  buildManualDimensionsReadQuery,
  buildManualIndexingReadQuery,
  type ManualCoverageRow,
  type ManualGscDailyRow,
  type ManualGscDimensionRow,
  type ManualGscIndexingRow,
  type ManualImportRow,
  type ManualReadScope,
} from "../../../../src/db/site-seo/manual-period-query.ts";

export type CanonicalDatasetReadQuery = Readonly<{
  name: "gsc" | "dataset";
  scope: SourceScope;
  period: Period;
  publicationId: string | null;
  filters: Readonly<Record<string, string>>;
}>;

export type AvailableMetrikaWeeksReadQuery = Readonly<{
  name: "available_metrika_weeks";
  scope: SourceScope;
  timezone: string;
}>;

export type CanonicalReadQuery = CanonicalDatasetReadQuery;

export type AvailableMetrikaWeeks = Readonly<{
  kind: "available_metrika_weeks";
  weeks: readonly Period[];
}>;

export type MetrikaTrafficMetrics = Readonly<{
  visits: number;
  pageviews: number;
  bounceRate: number | null;
  avgVisitDurationSeconds: number | null;
  pageDepth: number | null;
}>;

export type MetrikaBreakdownRow = MetrikaTrafficMetrics & Readonly<{
  id: string | null;
  label: string;
}>;

export type MetrikaCanonicalData = DatasetMeta & Readonly<{
  kind: "metrika";
  /** Users are retained at their canonical daily grain and never period-summed. */
  summary: Readonly<{ visits: number; pageviews: number }> | null;
  trafficMeta?: DatasetMeta;
  trafficHealth?: MetrikaTrafficMetrics | null;
  channels?: readonly MetrikaBreakdownRow[];
  searchEngines?: readonly MetrikaBreakdownRow[];
  daily: readonly Readonly<{ date: string; visits: number; pageviews: number; users: number | null }>[];
  topPages: readonly Readonly<{ page: string; visits: number; pageviews: number }>[];
}>;

export type WebmasterCanonicalMetrics = Readonly<{
  clicks: number;
  impressions: number;
  ctrPct: number | null;
  averagePosition: number | null;
  /** Impressions represented by averagePosition; excludes rows where position is null. */
  positionedImpressions?: number;
}>;

export type WebmasterCanonicalData = DatasetMeta & Readonly<{
  kind: "webmaster";
  summary: WebmasterCanonicalMetrics | null;
  daily: readonly Readonly<{ date: string; metrics: WebmasterCanonicalMetrics }>[];
  topPages: readonly Readonly<{ page: string; metrics: WebmasterCanonicalMetrics }>[];
  queryFacts?: readonly Readonly<{ query: string; metrics: WebmasterCanonicalMetrics }>[];
}>;

export type WordstatCanonicalData = DatasetMeta & Readonly<{
  kind: "wordstat";
  demand: number | null;
  /** Latest current-demand snapshot; independent from the selected traffic week. */
  snapshotPeriod: Period | null;
  queries: readonly Readonly<{
    query: string;
    count: number;
    kind: string;
    /** A rolling snapshot is never represented as an exact selected week. */
    window: Readonly<{ from: string; to: string; snapshotDate: string; registryVersion: string; importId: string | null }>;
  }>[];
}>;

export type AliceCanonicalData = DatasetMeta & Readonly<{
  kind: "alice";
  officialSovPct: number | null;
  samplePresencePct: number | null;
  competitors: readonly string[];
  sources: readonly string[];
  queries: readonly Readonly<{
    query: string;
    portalPresent: boolean;
    portalPosition: number | null;
    portalUrl: string | null;
    sources: readonly Readonly<{ rank: number; domain: string; url: string }>[];
  }>[];
}>;

export type SeoOsCanonicalData = DatasetMeta & Readonly<{
  kind: "seo_os";
  rows: readonly Readonly<{ engine: string; mentions: number; citations: number; evidence: string | null }>[];
  recommendations: readonly Readonly<{
    kind: string | null;
    topic: string | null;
    pageUrl: string | null;
    action: string | null;
    sourceIds: readonly string[];
    sourcePeriods: readonly string[];
    ruleVersion: string | null;
    publicationStatus: string | null;
  }>[];
  tasks: readonly Readonly<{ id: string; status: string }>[];
}>;

export type CanonicalDatasetData = MetrikaCanonicalData | WebmasterCanonicalData | WordstatCanonicalData | AliceCanonicalData | SeoOsCanonicalData;

/**
 * The runtime implementation is supplied by the site's MySQL-only adapter.
 * Keeping this boundary injected lets fixtures verify scope without accepting
 * request-provided source identifiers or reading import artifacts.
 */
export type CanonicalReadExecutor = (
  query: CanonicalReadQuery,
) => Promise<GscReadRows | DatasetMeta | CanonicalDatasetData>;

export type AvailableMetrikaWeeksReadExecutor = (
  query: AvailableMetrikaWeeksReadQuery,
) => Promise<AvailableMetrikaWeeks>;

export class MissingCanonicalReadMappingError extends Error {
  constructor() {
    super("Canonical site-seo read mapping is not installed");
    this.name = "MissingCanonicalReadMappingError";
  }
}

/** Fails closed until T1–T3 publish the canonical table/row mapping. */
export const missingCanonicalReadExecutor: CanonicalReadExecutor = async () => {
  throw new MissingCanonicalReadMappingError();
};

type CanonicalDatabase = Readonly<{
  execute(sql: string, params: unknown[]): Promise<[unknown, unknown]>;
}>;

function stableFiltersHash(filters: Readonly<Record<string, string>>): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(filters).sort(([left], [right]) => left.localeCompare(right))));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function manualScope(scope: SourceScope, filters: Readonly<Record<string, string>>): ManualReadScope {
  return { ...scope, filtersHash: stableFiltersHash(filters) };
}

function numeric(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function nullableNumeric(value: unknown): number | null {
  return value === null || value === undefined ? null : numeric(value);
}

function rowPeriod(row: ManualImportRow): Period {
  return {
    kind: row.period_kind,
    from: String(row.period_from),
    to: String(row.period_to),
    key: row.period_key,
    sourceTimezone: row.source_timezone,
  };
}

function stateForCoverage(state: ManualCoverageRow["coverage_state"]): Pick<DatasetMeta, "state" | "completeness"> {
  if (state === "complete") return { state: "ready", completeness: "complete" };
  if (state === "complete_empty") return { state: "complete_empty", completeness: "complete" };
  if (state === "limited") return { state: "partial", completeness: "limited" };
  if (state === "unknown") return { state: "partial", completeness: "unknown" };
  return { state: "missing", completeness: "unknown" };
}

function missingMeta(sourceKey: SourceScope["sourceKey"], collectionMode: DatasetMeta["collectionMode"]): DatasetMeta {
  return {
    sourceKey, period: null, state: "missing", collectionMode, completeness: "unknown",
    importId: null, exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none",
  };
}

type DatasetMetaRow = Readonly<{
  coverage_rows?: unknown;
  current_coverage_rows?: unknown;
  current_success_rows?: unknown;
  current_import_id?: unknown;
  historical_coverage_rows?: unknown;
  historical_success_rows?: unknown;
  historical_import_id?: unknown;
  covered_days?: unknown;
  success_rows?: unknown;
  incomplete_rows?: unknown;
  row_count?: unknown;
  status?: unknown;
  job_key?: unknown;
  import_id?: unknown;
  loaded_at?: unknown;
}>;

function periodDays(period: Period): number {
  const from = Date.parse(`${period.from}T00:00:00Z`);
  const to = Date.parse(`${period.to}T00:00:00Z`);
  return Number.isFinite(from) && Number.isFinite(to) && to >= from
    ? Math.floor((to - from) / 86_400_000) + 1
    : 0;
}

function datasetMeta(
  query: CanonicalDatasetReadQuery,
  row: DatasetMetaRow | undefined,
  collectionMode: DatasetMeta["collectionMode"],
  state: DatasetMeta["state"],
  completeness: DatasetMeta["completeness"],
): DatasetMeta {
  if (!row || state === "missing") return missingMeta(query.scope.sourceKey, collectionMode);
  return {
    sourceKey: query.scope.sourceKey,
    period: query.period,
    state,
    collectionMode,
    completeness,
    importId: row.import_id === null || row.import_id === undefined ? null : String(row.import_id),
    exportedAt: null,
    loadedAt: row.loaded_at === null || row.loaded_at === undefined ? null : String(row.loaded_at),
    freshness: "unknown",
    latestAttempt: "success",
  };
}

function metaFromRow(
  row: ManualImportRow,
  coverage?: ManualCoverageRow,
  period: Period = rowPeriod(row),
): DatasetMeta {
  const state = coverage ? stateForCoverage(coverage.coverage_state) : { state: "ready" as const, completeness: "complete" as const };
  return {
    sourceKey: row.source_key as SourceScope["sourceKey"], period, ...state,
    collectionMode: "manual", importId: row.import_uid, exportedAt: row.exported_at ? String(row.exported_at) : null,
    loadedAt: null, freshness: "unknown", latestAttempt: "success",
  };
}

function preferredCoverage(rows: readonly ManualCoverageRow[], layer?: string, importId?: number): ManualCoverageRow | undefined {
  return rows
    .filter((row) => (layer === undefined || row.layer_name === layer) && (importId === undefined || numeric(row.import_id) === importId))
    .sort((left, right) => numeric(right.publication_priority) - numeric(left.publication_priority)
      || numeric(right.revision) - numeric(left.revision)
      || numeric(right.import_id) - numeric(left.import_id))[0];
}

function metrics(row: { clicks: unknown; impressions: unknown; ctr_pct: unknown; average_position: unknown }): Metrics {
  return { clicks: numeric(row.clicks), impressions: numeric(row.impressions), ctrPct: nullableNumeric(row.ctr_pct), averagePosition: nullableNumeric(row.average_position) };
}

async function rowsFor<T>(database: CanonicalDatabase, query: { sql: string; params: readonly unknown[] }): Promise<T[]> {
  const [result] = await database.execute(query.sql, [...query.params]);
  if (!Array.isArray(result)) throw new Error("Canonical MySQL read returned an invalid row set");
  return result as T[];
}

async function readManualGsc(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<GscReadRows> {
  const scope = manualScope(query.scope, query.filters);
  const period = { kind: query.period.kind, from: query.period.from, to: query.period.to, key: query.period.key };
  const indexing = buildManualIndexingReadQuery(scope, query.period.to, query.publicationId);
  const [coverage, daily, dimensions, indexingRows] = await Promise.all([
    rowsFor<ManualCoverageRow>(database, buildManualCoverageReadQuery(scope, period, query.publicationId)),
    rowsFor<ManualGscDailyRow>(database, buildManualDailyReadQuery(scope, query.period.from, query.period.to, query.publicationId)),
    rowsFor<ManualGscDimensionRow>(database, buildManualDimensionsReadQuery(scope, period, query.publicationId)),
    rowsFor<ManualGscIndexingRow>(database, indexing.totals),
  ]);
  const representative = preferredCoverage(coverage) ?? daily[0] ?? dimensions[0];
  const meta = representative
    ? metaFromRow(representative, "layer_name" in representative ? representative : preferredCoverage(coverage, undefined, numeric(representative.import_id)))
    : missingMeta("google_search_console", "manual");
  const dailyRows = daily.map((row) => ({
    date: String(row.report_date), metrics: metrics(row),
    meta: metaFromRow(row, preferredCoverage(coverage, "daily", numeric(row.import_id))),
  }));
  const dimensionRows = dimensions.map((row) => ({
    dimension: row.dimension_name, value: row.dimension_value, metrics: metrics(row),
    meta: metaFromRow(row, preferredCoverage(coverage, row.dimension_name, numeric(row.import_id))),
  }));
  const dimensionCoverage: Partial<Record<ManualSheet, DatasetMeta>> = {};
  for (const layer of ["query", "page", "country", "device", "appearance"] as const) {
    const row = preferredCoverage(coverage, layer);
    if (row) dimensionCoverage[layer] = metaFromRow(row, row);
  }
  const clicks = dailyRows.reduce((sum, row) => sum + row.metrics.clicks, 0);
  const impressions = dailyRows.reduce((sum, row) => sum + row.metrics.impressions, 0);
  const positioned = dailyRows.filter((row) => row.metrics.averagePosition !== null);
  const positionedImpressions = positioned.reduce((sum, row) => sum + row.metrics.impressions, 0);
  const summary = dailyRows.length === 0 ? null : {
    clicks,
    impressions,
    ctrPct: impressions > 0 ? clicks / impressions * 100 : null,
    averagePosition: positionedImpressions > 0
      ? positioned.reduce((sum, row) => sum + row.metrics.impressions * row.metrics.averagePosition!, 0) / positionedImpressions
      : null,
  };
  const indexingMeta = indexingRows[0]
    ? metaFromRow(indexingRows[0], undefined, { kind: "snapshot", from: String(indexingRows[0].snapshot_date), to: String(indexingRows[0].snapshot_date), key: String(indexingRows[0].snapshot_date), sourceTimezone: indexingRows[0].source_timezone })
    : missingMeta("google_search_console", "manual");
  return { meta, summary, daily: dailyRows, dimensions: dimensionRows, dimensionCoverage, indexing: indexingMeta };
}

async function readMetrikaMeta(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta> {
  const rows = await rowsFor<DatasetMetaRow>(database, {
    sql: `SELECT COUNT(*) AS coverage_rows,
                 COUNT(DISTINCT report_date) AS covered_days,
                 SUM(status = 'success') AS success_rows,
                 SUM(pagination_complete = 0) AS incomplete_rows,
                 MAX(ingestion_run_id) AS import_id,
                 MAX(updated_at) AS loaded_at
            FROM canonical_metrika_breakdown_coverage_daily
           WHERE source_key = ? AND analytics_account_id = ?
             AND report_key = 'search_engines' AND segment_key = 'russia'
             AND report_date BETWEEN ? AND ?`,
    params: [query.scope.sourceKey, query.scope.analyticsAccountId, query.period.from, query.period.to],
  });
  const row = rows[0];
  const coverageRows = numeric(row?.coverage_rows);
  if (coverageRows === 0) return missingMeta(query.scope.sourceKey, "automated");
  const complete = numeric(row?.covered_days) === periodDays(query.period) && numeric(row?.incomplete_rows) === 0;
  if (!complete) return datasetMeta(query, row, "automated", "partial", "limited");
  return numeric(row?.success_rows) === 0
    ? datasetMeta(query, row, "automated", "complete_empty", "complete")
    : datasetMeta(query, row, "automated", "ready", "complete");
}

type MetrikaSummaryRow = Readonly<{ visits?: unknown; pageviews?: unknown }>;
type MetrikaDailyRow = Readonly<{ report_date: unknown; visits?: unknown; pageviews?: unknown; users?: unknown }>;
type MetrikaPageRow = Readonly<{ page_url: unknown; visits?: unknown; pageviews?: unknown }>;
type MetrikaTrafficRow = Readonly<{
  id?: unknown;
  label?: unknown;
  visits?: unknown;
  pageviews?: unknown;
  bounce_rate?: unknown;
  avg_visit_duration_seconds?: unknown;
  page_depth?: unknown;
  row_count?: unknown;
  covered_days?: unknown;
  import_id?: unknown;
  loaded_at?: unknown;
}>;

function metrikaTrafficMetrics(row: MetrikaTrafficRow): MetrikaTrafficMetrics {
  return {
    visits: numeric(row.visits),
    pageviews: numeric(row.pageviews),
    bounceRate: nullableNumeric(row.bounce_rate),
    avgVisitDurationSeconds: nullableNumeric(row.avg_visit_duration_seconds),
    pageDepth: nullableNumeric(row.page_depth),
  };
}

function metrikaBreakdownRow(row: MetrikaTrafficRow): MetrikaBreakdownRow {
  return {
    id: row.id === null || row.id === undefined ? null : String(row.id),
    label: String(row.label ?? ""),
    ...metrikaTrafficMetrics(row),
  };
}

/**
 * The Metrika fact schema is account-grained (there is no resource_id column).
 * The registered resource is verified before this reader is called; SQL therefore
 * uses the full fact grain available in canonical MySQL: source, account, report,
 * segment, row kind and date.
 */
async function readMetrikaData(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta | MetrikaCanonicalData> {
  const params = [query.scope.sourceKey, query.scope.analyticsAccountId, query.period.from, query.period.to];
  const [meta, [trafficHealthRows, channelRows]] = await Promise.all([
    readMetrikaMeta(database, query),
    Promise.all([
      rowsFor<MetrikaTrafficRow>(database, {
        sql: `/* site-seo:metrika-traffic-health */
              SELECT COUNT(*) AS row_count,
                     COUNT(DISTINCT report_date) AS covered_days,
                     MAX(ingestion_run_id) AS import_id,
                     MAX(updated_at) AS loaded_at,
                     SUM(COALESCE(visits, 0)) AS visits,
                     SUM(COALESCE(pageviews, 0)) AS pageviews,
                     SUM(bounce_rate * COALESCE(visits, 0)) /
                       NULLIF(SUM(CASE WHEN bounce_rate IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS bounce_rate,
                     SUM(avg_visit_duration_seconds * COALESCE(visits, 0)) /
                       NULLIF(SUM(CASE WHEN avg_visit_duration_seconds IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS avg_visit_duration_seconds,
                     SUM(page_depth * COALESCE(visits, 0)) /
                       NULLIF(SUM(CASE WHEN page_depth IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS page_depth
                FROM canonical_fact_site_analytics_daily
               WHERE source_key = ? AND analytics_account_id = ?
                 AND analytics_scope = 'other'
                 AND report_date BETWEEN ? AND ?`,
        params,
      }),
      rowsFor<MetrikaTrafficRow>(database, {
        sql: `/* site-seo:metrika-channels */
              SELECT NULL AS id,
                     COALESCE(traffic_source, 'Unknown') AS label,
                     SUM(COALESCE(visits, 0)) AS visits,
                     SUM(COALESCE(pageviews, 0)) AS pageviews,
                     SUM(bounce_rate * COALESCE(visits, 0)) /
                       NULLIF(SUM(CASE WHEN bounce_rate IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS bounce_rate,
                     SUM(avg_visit_duration_seconds * COALESCE(visits, 0)) /
                       NULLIF(SUM(CASE WHEN avg_visit_duration_seconds IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS avg_visit_duration_seconds,
                     SUM(page_depth * COALESCE(visits, 0)) /
                       NULLIF(SUM(CASE WHEN page_depth IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS page_depth
                FROM canonical_fact_site_analytics_daily
               WHERE source_key = ? AND analytics_account_id = ?
                 AND analytics_scope = 'other'
                 AND report_date BETWEEN ? AND ?
               GROUP BY COALESCE(traffic_source, 'Unknown')
              HAVING SUM(COALESCE(visits, 0)) > 0 OR SUM(COALESCE(pageviews, 0)) > 0
               ORDER BY visits DESC, pageviews DESC, label ASC`,
        params,
      }),
    ]),
  ]);
  const trafficHealthRow = trafficHealthRows[0];
  const hasTrafficRows = numeric(trafficHealthRow?.row_count) > 0;
  const hasCompleteTrafficWeek = hasTrafficRows && numeric(trafficHealthRow?.covered_days) === periodDays(query.period);
  const trafficMeta = hasTrafficRows
    ? datasetMeta(query, trafficHealthRow, "automated", hasCompleteTrafficWeek ? "ready" : "partial", hasCompleteTrafficWeek ? "complete" : "unknown")
    : missingMeta(query.scope.sourceKey, "automated");
  if (meta.state === "missing" && trafficMeta.state === "missing") return meta;

  const [summaryRows, dailyRows, pageRows, searchEngineRows] = meta.state === "missing"
    ? [[], [], [], []] as const
    : await Promise.all([
    rowsFor<MetrikaSummaryRow>(database, {
      sql: `/* site-seo:metrika-summary */
            SELECT SUM(COALESCE(visits, 0)) AS visits,
                   SUM(COALESCE(pageviews, 0)) AS pageviews
              FROM canonical_fact_metrika_breakdowns_daily
             WHERE source_key = ? AND analytics_account_id = ?
               AND report_key = 'search_engines' AND segment_key = 'russia' AND row_kind = 'total'
               AND report_date BETWEEN ? AND ?`,
      params,
    }),
    rowsFor<MetrikaDailyRow>(database, {
      sql: `/* site-seo:metrika-daily */
            SELECT report_date,
                   SUM(COALESCE(visits, 0)) AS visits,
                   SUM(COALESCE(pageviews, 0)) AS pageviews,
                   MAX(users) AS users
              FROM canonical_fact_metrika_breakdowns_daily
             WHERE source_key = ? AND analytics_account_id = ?
               AND report_key = 'search_engines' AND segment_key = 'russia' AND row_kind = 'total'
               AND report_date BETWEEN ? AND ?
             GROUP BY report_date
             ORDER BY report_date ASC`,
      params,
    }),
    rowsFor<MetrikaPageRow>(database, {
      sql: `/* site-seo:metrika-pages */
            SELECT page_url,
                   SUM(COALESCE(visits, 0)) AS visits,
                   SUM(COALESCE(pageviews, 0)) AS pageviews
              FROM canonical_fact_metrika_breakdowns_daily
             WHERE source_key = ? AND analytics_account_id = ?
               AND report_key = 'organic_landing' AND segment_key = 'russia' AND row_kind = 'detail'
               AND page_url IS NOT NULL AND page_url <> ''
               AND report_date BETWEEN ? AND ?
             GROUP BY page_url
             ORDER BY visits DESC, pageviews DESC, page_url ASC
             LIMIT 20`,
      params,
    }),
    rowsFor<MetrikaTrafficRow>(database, {
      sql: `/* site-seo:metrika-search-engines */
            SELECT dimension_1_id AS id,
                   COALESCE(dimension_1_value, dimension_1_id, 'Unknown') AS label,
                   SUM(COALESCE(visits, 0)) AS visits,
                   SUM(COALESCE(pageviews, 0)) AS pageviews,
                   SUM(bounce_rate * COALESCE(visits, 0)) /
                     NULLIF(SUM(CASE WHEN bounce_rate IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS bounce_rate,
                   SUM(avg_visit_duration_seconds * COALESCE(visits, 0)) /
                     NULLIF(SUM(CASE WHEN avg_visit_duration_seconds IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS avg_visit_duration_seconds,
                   SUM(page_depth * COALESCE(visits, 0)) /
                     NULLIF(SUM(CASE WHEN page_depth IS NOT NULL THEN COALESCE(visits, 0) ELSE 0 END), 0) AS page_depth
              FROM canonical_fact_metrika_breakdowns_daily
             WHERE source_key = ? AND analytics_account_id = ?
               AND report_key = 'search_engines' AND segment_key = 'russia' AND row_kind = 'detail'
               AND report_date BETWEEN ? AND ?
             GROUP BY dimension_1_id, dimension_1_value
            HAVING SUM(COALESCE(visits, 0)) > 0 OR SUM(COALESCE(pageviews, 0)) > 0
             ORDER BY visits DESC, pageviews DESC, label ASC`,
      params,
    }),
  ]);
  const summaryRow = summaryRows[0];
  const hasSummary = summaryRow !== undefined && (summaryRow.visits !== null || summaryRow.pageviews !== null);
  return {
    ...meta,
    kind: "metrika",
    summary: hasSummary ? { visits: numeric(summaryRow?.visits), pageviews: numeric(summaryRow?.pageviews) } : null,
    trafficMeta,
    trafficHealth: hasTrafficRows ? metrikaTrafficMetrics(trafficHealthRow!) : null,
    channels: channelRows.map(metrikaBreakdownRow),
    searchEngines: searchEngineRows.map(metrikaBreakdownRow),
    daily: dailyRows.map((row) => ({ date: String(row.report_date), visits: numeric(row.visits), pageviews: numeric(row.pageviews), users: nullableNumeric(row.users) })),
    topPages: pageRows.map((row) => ({ page: String(row.page_url), visits: numeric(row.visits), pageviews: numeric(row.pageviews) })),
  };
}

async function readWebmasterMeta(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta> {
  const rows = await rowsFor<DatasetMetaRow>(database, {
    sql: `/* site-seo:webmaster-meta */
           SELECT COUNT(*) AS row_count,
                 COUNT(DISTINCT report_date) AS covered_days,
                 MAX(ingestion_run_id) AS import_id,
                 MAX(updated_at) AS loaded_at
           FROM canonical_fact_webmaster_summary_daily
           WHERE source_key = ? AND analytics_account_id = ? AND host_id = ?
             AND device_type = 'ALL'
             AND report_date BETWEEN ? AND ?`,
    params: [query.scope.sourceKey, query.scope.analyticsAccountId, query.scope.resourceId, query.period.from, query.period.to],
  });
  const row = rows[0];
  if (numeric(row?.row_count) === 0) return missingMeta(query.scope.sourceKey, "automated");
  // This legacy fact table has no successful-empty coverage contract. Presence is useful,
  // but cannot honestly prove a complete period.
  return datasetMeta(query, row, "automated", "partial", "unknown");
}

type WebmasterFactRow = Readonly<{
  report_date?: unknown;
  page_url?: unknown;
  query_text?: unknown;
  clicks?: unknown;
  impressions?: unknown;
  ctr_pct?: unknown;
  average_position?: unknown;
  positioned_impressions?: unknown;
}>;

function webmasterMetrics(row: WebmasterFactRow): WebmasterCanonicalMetrics {
  return {
    clicks: numeric(row.clicks),
    impressions: numeric(row.impressions),
    ctrPct: nullableNumeric(row.ctr_pct),
    averagePosition: nullableNumeric(row.average_position),
    ...(row.positioned_impressions === null || row.positioned_impressions === undefined
      ? {}
      : { positionedImpressions: numeric(row.positioned_impressions) }),
  };
}

const webmasterMetricsSql = `SUM(COALESCE(clicks, 0)) AS clicks,
                   SUM(COALESCE(impressions, 0)) AS impressions,
                   SUM(COALESCE(clicks, 0)) / NULLIF(SUM(COALESCE(impressions, 0)), 0) * 100 AS ctr_pct,
                   SUM(CASE WHEN average_position IS NOT NULL THEN COALESCE(impressions, 0) ELSE 0 END) AS positioned_impressions,
                   SUM(CASE WHEN average_position IS NOT NULL THEN average_position * COALESCE(impressions, 0) END)
                     / NULLIF(SUM(CASE WHEN average_position IS NOT NULL THEN COALESCE(impressions, 0) END), 0) AS average_position`;

async function readWebmasterData(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta | WebmasterCanonicalData> {
  const meta = await readWebmasterMeta(database, query);
  if (meta.state === "missing") return meta;
  const params = [query.scope.sourceKey, query.scope.analyticsAccountId, query.scope.resourceId, query.period.from, query.period.to];
  const where = `source_key = ? AND analytics_account_id = ? AND host_id = ?
               AND device_type = 'ALL' AND report_date BETWEEN ? AND ?`;
  const [summaryRows, dailyRows, pageRows, queryRows] = await Promise.all([
    rowsFor<WebmasterFactRow>(database, {
      sql: `/* site-seo:webmaster-summary */
            SELECT ${webmasterMetricsSql}
              FROM canonical_fact_webmaster_summary_daily
             WHERE ${where}`,
      params,
    }),
    rowsFor<WebmasterFactRow>(database, {
      sql: `/* site-seo:webmaster-daily */
            SELECT report_date, ${webmasterMetricsSql}
              FROM canonical_fact_webmaster_summary_daily
             WHERE ${where}
             GROUP BY report_date
             ORDER BY report_date ASC`,
      params,
    }),
    rowsFor<WebmasterFactRow>(database, {
      sql: `/* site-seo:webmaster-pages */
            SELECT page_url, ${webmasterMetricsSql}
              FROM canonical_fact_webmaster_pages_daily
             WHERE ${where}
             GROUP BY page_url
             ORDER BY impressions DESC, clicks DESC, page_url ASC`,
      params,
    }),
    rowsFor<WebmasterFactRow>(database, {
      sql: `/* site-seo:webmaster-queries */
            SELECT query_text, ${webmasterMetricsSql}
              FROM canonical_fact_webmaster_queries_daily
             WHERE ${where}
             GROUP BY query_text
             ORDER BY impressions DESC, clicks DESC, query_text ASC`,
      params,
    }),
  ]);
  const summaryRow = summaryRows[0];
  const hasSummary = summaryRow !== undefined && (summaryRow.clicks !== null || summaryRow.impressions !== null);
  return {
    ...meta,
    kind: "webmaster",
    summary: hasSummary ? webmasterMetrics(summaryRow!) : null,
    daily: dailyRows.map((row) => ({ date: String(row.report_date), metrics: webmasterMetrics(row) })),
    topPages: pageRows.map((row) => ({ page: String(row.page_url), metrics: webmasterMetrics(row) })),
    queryFacts: queryRows.map((row) => ({ query: String(row.query_text), metrics: webmasterMetrics(row) })),
  };
}

async function readWordstatMeta(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<Readonly<{ meta: DatasetMeta; hasCoverage: boolean }>> {
  const currentJob = `yandex_wordstat:${query.scope.analyticsAccountId}:current`;
  const historicalJob = `yandex_wordstat:${query.scope.analyticsAccountId}:historical`;
  const allJob = `yandex_wordstat:${query.scope.analyticsAccountId}:all`;
  const [rows, currentAttempts, historicalAttempts] = await Promise.all([
    rowsFor<DatasetMetaRow>(database, {
      sql: `SELECT COUNT(*) AS coverage_rows,
                   SUM(endpoint = 'top_requests') AS current_coverage_rows,
                   SUM(endpoint = 'top_requests' AND status = 'success') AS current_success_rows,
                   MAX(CASE WHEN endpoint = 'top_requests' THEN ingestion_run_id END) AS current_import_id,
                   SUM(endpoint = 'dynamics') AS historical_coverage_rows,
                   SUM(endpoint = 'dynamics' AND status = 'success') AS historical_success_rows,
                   MAX(CASE WHEN endpoint = 'dynamics' THEN ingestion_run_id END) AS historical_import_id,
                   MAX(ingestion_run_id) AS import_id,
                   MAX(updated_at) AS loaded_at
             FROM canonical_wordstat_coverage
             WHERE source_key = ? AND analytics_account_id = ?
               AND (
                 endpoint = 'top_requests'
                 OR (endpoint = 'dynamics' AND requested_from <= ? AND requested_to >= ?)
               )`,
      params: [query.scope.sourceKey, query.scope.analyticsAccountId, query.period.from, query.period.to],
    }),
    rowsFor<DatasetMetaRow>(database, {
      sql: `/* site-seo:wordstat-current-attempts */
            WITH ranked_runs AS (
              SELECT job_key, status, id AS import_id,
                     COALESCE(finished_at, started_at) AS loaded_at,
                     ROW_NUMBER() OVER (
                       PARTITION BY job_key
                       ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
                     ) AS dedup_rank
                FROM canonical_collector_runs
               WHERE source_key = ?
                 AND job_key IN (?, ?)
                 AND status IN ('success', 'failed', 'partial')
            )
            SELECT job_key, status, import_id, loaded_at
              FROM ranked_runs
             WHERE dedup_rank = 1`,
      params: [query.scope.sourceKey, currentJob, allJob],
    }),
    rowsFor<DatasetMetaRow>(database, {
      sql: `/* site-seo:wordstat-historical-attempts */
            WITH ranked_runs AS (
              SELECT job_key, status, id AS import_id,
                     COALESCE(finished_at, started_at) AS loaded_at,
                     ROW_NUMBER() OVER (
                       PARTITION BY job_key
                       ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
                     ) AS dedup_rank
                FROM canonical_collector_runs
               WHERE source_key = ?
                 AND job_key IN (?, ?)
                 AND date_from <= ? AND date_to >= ?
                 AND status IN ('success', 'failed', 'partial')
            )
            SELECT job_key, status, import_id, loaded_at
              FROM ranked_runs
             WHERE dedup_rank = 1`,
      params: [query.scope.sourceKey, historicalJob, allJob, query.period.from, query.period.to],
    }),
  ]);
  const row = rows[0];
  const newest = (attempts: readonly DatasetMetaRow[], jobKeys: readonly string[]): DatasetMetaRow | undefined => attempts
    .filter((attempt) => jobKeys.includes(String(attempt.job_key)))
    .sort((left, right) => numeric(right.import_id) - numeric(left.import_id))[0];
  const currentAttempt = newest(currentAttempts, [currentJob, allJob]);
  const historicalAttempt = newest(historicalAttempts, [historicalJob, allJob]);
  const failed = (attempt: DatasetMetaRow | undefined, coverageRun: unknown): boolean => (
    attempt?.status === "failed" || attempt?.status === "partial"
  ) && (numeric(coverageRun) === 0 || numeric(attempt.import_id) >= numeric(coverageRun));
  const failures = [
    failed(currentAttempt, row?.current_import_id) ? currentAttempt : undefined,
    failed(historicalAttempt, row?.historical_import_id) ? historicalAttempt : undefined,
  ].filter((attempt): attempt is DatasetMetaRow => attempt !== undefined);
  const hasCurrentCoverage = numeric(row?.current_coverage_rows) > 0;
  const hasHistoricalCoverage = numeric(row?.historical_coverage_rows) > 0;
  const hasCoverage = hasCurrentCoverage || hasHistoricalCoverage;

  if (!hasCoverage) {
    const failure = failures.sort((left, right) => numeric(right.import_id) - numeric(left.import_id))[0];
    if (!failure) return { meta: missingMeta(query.scope.sourceKey, "automated"), hasCoverage: false };
    return { meta: {
      ...missingMeta(query.scope.sourceKey, "automated"),
      period: query.period,
      state: failure.status === "failed" ? "failed" : "partial",
      importId: failure.import_id === null || failure.import_id === undefined ? null : String(failure.import_id),
      loadedAt: failure.loaded_at === null || failure.loaded_at === undefined ? null : String(failure.loaded_at),
      latestAttempt: "failed",
    }, hasCoverage: false };
  }

  const fullyCovered = hasCurrentCoverage && hasHistoricalCoverage;
  const anyFacts = numeric(row?.current_success_rows) + numeric(row?.historical_success_rows) > 0;
  const confirmedEmpty = fullyCovered
    && currentAttempt?.status === "success"
    && historicalAttempt?.status === "success";
  const base = failures.length > 0 || !fullyCovered
    ? datasetMeta(query, row, "automated", "partial", "unknown")
    : anyFacts
      ? datasetMeta(query, row, "automated", "ready", "complete")
      : confirmedEmpty
        ? datasetMeta(query, row, "automated", "complete_empty", "complete")
        : datasetMeta(query, row, "automated", "partial", "unknown");
  return {
    meta: failures.length > 0 ? { ...base, latestAttempt: "failed" } : base,
    hasCoverage: true,
  };
}

type WordstatRow = Readonly<{
  demand?: unknown;
  query_text?: unknown;
  count?: unknown;
  request_kind?: unknown;
  snapshot_date?: unknown;
  window_from?: unknown;
  window_to?: unknown;
  registry_version?: unknown;
  ingestion_run_id?: unknown;
}>;

function wordstatRegionScope(resourceId: string) {
  return resourceId.startsWith("region:") ? resourceId.slice("region:".length) : resourceId;
}

async function readWordstatData(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta | WordstatCanonicalData> {
  const { meta, hasCoverage } = await readWordstatMeta(database, query);
  if (!hasCoverage) return meta;
  const params = [query.scope.sourceKey, query.scope.analyticsAccountId, wordstatRegionScope(query.scope.resourceId), query.period.from, query.period.to];
  const [summaryRows, queryRows] = await Promise.all([
    rowsFor<WordstatRow>(database, {
      sql: `/* site-seo:wordstat-demand */
            SELECT SUM(count) AS demand
              FROM canonical_fact_wordstat_dynamics_daily
             WHERE source_key = ? AND analytics_account_id = ? AND region_scope = ?
               AND device_type = 'all' AND report_date BETWEEN ? AND ?`, params,
    }),
    rowsFor<WordstatRow>(database, {
      sql: `/* site-seo:wordstat-queries */
            WITH selected_snapshot AS (
              SELECT snapshot_date, window_from, window_to, registry_version, ingestion_run_id
                FROM canonical_fact_wordstat_requests_snapshot
               WHERE source_key = ? AND analytics_account_id = ? AND device_type = 'all'
               ORDER BY window_to DESC, snapshot_date DESC, ingestion_run_id DESC, registry_version DESC
               LIMIT 1
            )
            SELECT fact.query_text, fact.count, fact.request_kind,
                   fact.snapshot_date, fact.window_from, fact.window_to,
                   fact.registry_version, fact.ingestion_run_id
              FROM canonical_fact_wordstat_requests_snapshot fact
              JOIN selected_snapshot selected
                ON fact.snapshot_date = selected.snapshot_date
               AND fact.window_from = selected.window_from
               AND fact.window_to = selected.window_to
               AND fact.registry_version = selected.registry_version
               AND fact.ingestion_run_id <=> selected.ingestion_run_id
             WHERE fact.source_key = ? AND fact.analytics_account_id = ?
               AND fact.device_type = 'all'
               AND fact.request_kind = 'popular'
             ORDER BY fact.count DESC, fact.query_text ASC
             LIMIT 20`, params: [query.scope.sourceKey, query.scope.analyticsAccountId, query.scope.sourceKey, query.scope.analyticsAccountId],
    }),
  ]);
  const summary = summaryRows[0];
  const window = queryRows[0] && {
    from: String(queryRows[0].window_from), to: String(queryRows[0].window_to),
    snapshotDate: String(queryRows[0].snapshot_date), registryVersion: String(queryRows[0].registry_version),
    importId: queryRows[0].ingestion_run_id == null ? null : String(queryRows[0].ingestion_run_id),
  };
  const snapshotPeriod: Period | null = window
    ? { kind: "custom", key: `rolling:${window.from}:${window.to}`, from: window.from, to: window.to, sourceTimezone: query.period.sourceTimezone }
    : null;
  return { ...meta, kind: "wordstat", demand: summary && summary.demand !== null ? numeric(summary.demand) : null, snapshotPeriod,
    queries: window ? queryRows.map((row) => ({ query: String(row.query_text), count: numeric(row.count), kind: String(row.request_kind), window: {
      from: String(row.window_from), to: String(row.window_to), snapshotDate: String(row.snapshot_date), registryVersion: String(row.registry_version), importId: row.ingestion_run_id == null ? null : String(row.ingestion_run_id),
    } })) : [] };
}

async function readAliceMeta(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta> {
  const rows = await rowsFor<DatasetMetaRow>(database, {
    sql: `SELECT COUNT(*) AS row_count,
                 MAX(ingestion_run_id) AS import_id,
                 MAX(updated_at) AS loaded_at
            FROM canonical_alice_visibility_snapshots
           WHERE source_key = ? AND analytics_account_id = ? AND domain = ?
             AND period_month BETWEEN ? AND ?
             AND publication_status = 'published'`,
    params: [query.scope.sourceKey, query.scope.analyticsAccountId, query.scope.resourceId, query.period.from, query.period.to],
  });
  const row = rows[0];
  return numeric(row?.row_count) > 0
    ? datasetMeta(query, row, "manual", "ready", "complete")
    : missingMeta(query.scope.sourceKey, "manual");
}

type AliceRow = Readonly<{
  official_sov_pct?: unknown;
  sample_presence_pct?: unknown;
  site_domain?: unknown;
  query_id?: unknown;
  query_text?: unknown;
  portal_present?: unknown;
  portal_position?: unknown;
  portal_url?: unknown;
  source_rank?: unknown;
  source_domain?: unknown;
  source_url?: unknown;
}>;

async function readAliceData(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta | AliceCanonicalData> {
  const meta = await readAliceMeta(database, query);
  if (meta.state === "missing") return meta;
  const params = [query.scope.sourceKey, query.scope.analyticsAccountId, query.scope.resourceId, query.period.from, query.period.to];
  const [snapshotRows, competitorRows, queryRows] = await Promise.all([
    rowsFor<AliceRow>(database, { sql: `/* site-seo:alice-summary */
      SELECT official_sov_pct, sample_presence_pct
      FROM canonical_alice_visibility_snapshots
      WHERE source_key = ? AND analytics_account_id = ? AND domain = ? AND period_month BETWEEN ? AND ? AND publication_status = 'published'
      ORDER BY period_month DESC, id DESC LIMIT 1`, params }),
    rowsFor<AliceRow>(database, { sql: `/* site-seo:alice-competitors */
      SELECT featured.site_domain
      FROM canonical_alice_visibility_featured_sites featured
      JOIN canonical_alice_visibility_snapshots snapshot ON snapshot.id = featured.snapshot_id
      WHERE snapshot.source_key = ? AND snapshot.analytics_account_id = ? AND snapshot.domain = ? AND snapshot.period_month BETWEEN ? AND ? AND snapshot.publication_status = 'published'
      ORDER BY snapshot.period_month DESC, featured.display_order ASC LIMIT 20`, params }),
    rowsFor<AliceRow>(database, { sql: `/* site-seo:alice-queries */
      WITH selected_snapshot AS (
        SELECT id FROM canonical_alice_visibility_snapshots
         WHERE source_key = ? AND analytics_account_id = ? AND domain = ?
           AND period_month BETWEEN ? AND ? AND publication_status = 'published'
         ORDER BY period_month DESC, id DESC LIMIT 1
      )
      SELECT query_row.id AS query_id, query_row.query_text, query_row.portal_present,
             query_row.portal_position, query_row.portal_url, source.source_rank,
             source.source_domain, source.source_url
        FROM canonical_alice_visibility_queries query_row
        JOIN selected_snapshot selected ON selected.id = query_row.snapshot_id
        LEFT JOIN canonical_alice_visibility_sources source ON source.query_id = query_row.id
       ORDER BY query_row.id ASC, source.source_rank ASC
       LIMIT 100`, params }),
  ]);
  const snapshot = snapshotRows[0];
  const queries = new Map<string, {
    query: string; portalPresent: boolean; portalPosition: number | null; portalUrl: string | null;
    sources: { rank: number; domain: string; url: string }[];
  }>();
  for (const row of queryRows) {
    const id = String(row.query_id);
    let item = queries.get(id);
    if (!item) {
      item = {
        query: String(row.query_text), portalPresent: numeric(row.portal_present) !== 0,
        portalPosition: nullableNumeric(row.portal_position), portalUrl: row.portal_url == null ? null : String(row.portal_url), sources: [],
      };
      queries.set(id, item);
    }
    if (row.source_rank != null && row.source_domain != null && row.source_url != null) {
      item.sources.push({ rank: numeric(row.source_rank), domain: String(row.source_domain), url: String(row.source_url) });
    }
  }
  const queryList = [...queries.values()];
  return { ...meta, kind: "alice", officialSovPct: snapshot ? nullableNumeric(snapshot.official_sov_pct) : null,
    samplePresencePct: snapshot ? nullableNumeric(snapshot.sample_presence_pct) : null,
    competitors: competitorRows.map((row) => String(row.site_domain)),
    sources: [...new Set(queryList.flatMap((item) => item.sources.map((source) => source.domain)))],
    queries: queryList };
}

type SeoOsRow = Readonly<{ run_id?: unknown; status?: unknown; stages?: unknown; loaded_at?: unknown; task_id?: unknown }>;

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringsValue(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : JSON.stringify(item)) : [];
}

function seoOsRecommendations(stages: unknown, publicationStatus: string | null): SeoOsCanonicalData["recommendations"] {
  const recommendations = objectValue(jsonValue(stages))?.recommendations;
  if (!Array.isArray(recommendations)) return [];
  return recommendations.flatMap((value) => {
    const row = objectValue(value);
    if (!row) return [];
    const evidence = objectValue(row.evidence);
    return [{
      kind: stringValue(row.kind), topic: stringValue(row.topic), pageUrl: stringValue(row.pageUrl), action: stringValue(row.action),
      sourceIds: stringsValue(row.sourceIds), sourcePeriods: stringsValue(row.sourcePeriods), ruleVersion: stringValue(evidence?.ruleVersion), publicationStatus,
    }];
  });
}

async function readSeoOsData(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta | SeoOsCanonicalData> {
  const [runRows, taskRows] = await Promise.all([
    rowsFor<SeoOsRow>(database, { sql: `/* site-seo:seo-os-run */
      SELECT id AS run_id, status, stages_json AS stages, finished_at AS loaded_at
      FROM seo_weekly_runs
      WHERE analytics_account_id = ? AND week_key = ?
      ORDER BY finished_at DESC, id DESC LIMIT 1`, params: [query.scope.analyticsAccountId, query.period.key] }),
    rowsFor<SeoOsRow>(database, { sql: `/* site-seo:seo-os-tasks */
      SELECT task_id, status
      FROM seo_tasks WHERE analytics_account_id = ? AND week_key = ? ORDER BY task_id ASC LIMIT 20`, params: [query.scope.analyticsAccountId, query.period.key] }),
  ]);
  const run = runRows[0];
  if (!run) return missingMeta("seo_os", "derived");
  const meta = datasetMeta(query, { import_id: run.run_id, loaded_at: run.loaded_at }, "derived", "partial", "unknown");
  return {
    ...meta,
    kind: "seo_os",
    rows: [],
    recommendations: seoOsRecommendations(run.stages, stringValue(run.status)),
    tasks: taskRows.map((row) => ({ id: String(row.task_id), status: String(row.status) })),
  };
}

async function readDatasetMeta(database: CanonicalDatabase, query: CanonicalDatasetReadQuery): Promise<DatasetMeta | CanonicalDatasetData> {
  switch (query.scope.sourceKey) {
    case "yandex_metrika": return readMetrikaData(database, query);
    case "yandex_webmaster": return readWebmasterData(database, query);
    case "yandex_wordstat": return readWordstatData(database, query);
    case "yandex_webmaster_alice_manual": return readAliceData(database, query);
    case "seo_os": return readSeoOsData(database, query);
    case "google_search_console": return missingMeta("google_search_console", "manual");
  }
}

type AvailableWeekRow = Readonly<{ week_key: unknown; period_from: unknown; period_to: unknown }>;

async function readAvailableMetrikaWeeks(database: CanonicalDatabase, query: AvailableMetrikaWeeksReadQuery): Promise<AvailableMetrikaWeeks> {
  const rows = await rowsFor<AvailableWeekRow>(database, {
    sql: `/* site-seo:available-metrika-weeks */
          SELECT CONCAT(FLOOR(iso_yearweek / 100), '-W', LPAD(MOD(iso_yearweek, 100), 2, '0')) AS week_key,
                 period_from,
                 period_to
            FROM (
                  SELECT YEARWEEK(report_date, 3) AS iso_yearweek,
                         MIN(report_date) AS period_from,
                         MAX(report_date) AS period_to
                    FROM canonical_metrika_breakdown_coverage_daily
                   WHERE source_key = ? AND analytics_account_id = ?
                     AND report_key = 'search_engines' AND segment_key = 'russia'
                   GROUP BY iso_yearweek
                  HAVING COUNT(DISTINCT report_date) = 7
                     AND WEEKDAY(MIN(report_date)) = 0
                     AND WEEKDAY(MAX(report_date)) = 6
                     AND SUM(CASE WHEN status IN ('success', 'empty') THEN 0 ELSE 1 END) = 0
                     AND SUM(pagination_complete = 0) = 0
                 ) AS completed_weeks
           ORDER BY period_from DESC`,
    params: [query.scope.sourceKey, query.scope.analyticsAccountId],
  });
  return {
    kind: "available_metrika_weeks",
    weeks: rows.map((row) => ({
      kind: "iso_week",
      key: String(row.week_key),
      from: String(row.period_from),
      to: String(row.period_to),
      sourceTimezone: query.timezone,
    })),
  };
}

/** Canonical MySQL is the sole request-time data plane; source APIs and import files are never read here. */
export function createCanonicalReadExecutor(database: CanonicalDatabase): CanonicalReadExecutor {
  return async (query) => {
    if (query.name === "gsc") return readManualGsc(database, query);
    return readDatasetMeta(database, query);
  };
}

export function createAvailableMetrikaWeeksReadExecutor(database: CanonicalDatabase): AvailableMetrikaWeeksReadExecutor {
  return (query) => readAvailableMetrikaWeeks(database, query);
}

function mysqlPool() {
  return mysql.createPool({
    host: process.env.DB_HOST ?? process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? 3306),
    user: process.env.DB_USER ?? process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME ?? process.env.MYSQL_DB ?? "report_bd",
    dateStrings: ["DATE"], waitForConnections: true, connectionLimit: 5, queueLimit: 0,
  });
}

let defaultPool: mysql.Pool | null = null;

function defaultMysqlPool(): mysql.Pool {
  defaultPool ??= mysqlPool();
  return defaultPool;
}

export const canonicalReadExecutor: CanonicalReadExecutor = async (query) => createCanonicalReadExecutor({
  execute: async (sql, params) => defaultMysqlPool().execute(sql, params as never[]),
})(query);

export const availableMetrikaWeeksReadExecutor: AvailableMetrikaWeeksReadExecutor = async (query) => createAvailableMetrikaWeeksReadExecutor({
  execute: async (sql, params) => defaultMysqlPool().execute(sql, params as never[]),
})(query);

/** Uses only the canonical dashboard credential authority; no source credentials or APIs. */
export async function loadCurrentCredentialVersion(dashboardId: number): Promise<number | null> {
  const [rows] = await defaultMysqlPool().execute<mysql.RowDataPacket[]>(
    "SELECT credential_version FROM dashboard_shared_access_settings WHERE dashboard_id = ? LIMIT 1",
    [dashboardId],
  );
  const value = Number(rows[0]?.credential_version);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

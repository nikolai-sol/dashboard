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

export type CanonicalReadQuery = Readonly<{
  name: "gsc" | "dataset";
  scope: SourceScope;
  period: Period;
  publicationId: string | null;
  filters: Readonly<Record<string, string>>;
}>;

/**
 * The runtime implementation is supplied by the site's MySQL-only adapter.
 * Keeping this boundary injected lets fixtures verify scope without accepting
 * request-provided source identifiers or reading import artifacts.
 */
export type CanonicalReadExecutor = (
  query: CanonicalReadQuery,
) => Promise<GscReadRows | DatasetMeta>;

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
  covered_days?: unknown;
  success_rows?: unknown;
  incomplete_rows?: unknown;
  row_count?: unknown;
  status?: unknown;
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
  query: CanonicalReadQuery,
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

async function readManualGsc(database: CanonicalDatabase, query: CanonicalReadQuery): Promise<GscReadRows> {
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

async function readMetrikaMeta(database: CanonicalDatabase, query: CanonicalReadQuery): Promise<DatasetMeta> {
  const rows = await rowsFor<DatasetMetaRow>(database, {
    sql: `SELECT COUNT(*) AS coverage_rows,
                 COUNT(DISTINCT report_date) AS covered_days,
                 SUM(status = 'success') AS success_rows,
                 SUM(pagination_complete = 0) AS incomplete_rows,
                 MAX(ingestion_run_id) AS import_id,
                 MAX(updated_at) AS loaded_at
            FROM canonical_metrika_breakdown_coverage_daily
           WHERE source_key = ? AND analytics_account_id = ?
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

async function readWebmasterMeta(database: CanonicalDatabase, query: CanonicalReadQuery): Promise<DatasetMeta> {
  const rows = await rowsFor<DatasetMetaRow>(database, {
    sql: `SELECT COUNT(*) AS row_count,
                 COUNT(DISTINCT report_date) AS covered_days,
                 MAX(ingestion_run_id) AS import_id,
                 MAX(updated_at) AS loaded_at
            FROM canonical_fact_webmaster_summary_daily
           WHERE source_key = ? AND analytics_account_id = ? AND host_id = ?
             AND report_date BETWEEN ? AND ?`,
    params: [query.scope.sourceKey, query.scope.analyticsAccountId, query.scope.resourceId, query.period.from, query.period.to],
  });
  const row = rows[0];
  if (numeric(row?.row_count) === 0) return missingMeta(query.scope.sourceKey, "automated");
  // This legacy fact table has no successful-empty coverage contract. Presence is useful,
  // but cannot honestly prove a complete period.
  return datasetMeta(query, row, "automated", "partial", "unknown");
}

async function readWordstatMeta(database: CanonicalDatabase, query: CanonicalReadQuery): Promise<DatasetMeta> {
  const rows = await rowsFor<DatasetMetaRow>(database, {
    sql: `SELECT 1 AS coverage_rows, status,
                 ingestion_run_id AS import_id, updated_at AS loaded_at
            FROM canonical_wordstat_coverage
           WHERE source_key = ? AND analytics_account_id = ?
             AND requested_from <= ? AND requested_to >= ?
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`,
    params: [query.scope.sourceKey, query.scope.analyticsAccountId, query.period.from, query.period.to],
  });
  const row = rows[0];
  if (!row || numeric(row.coverage_rows) === 0) return missingMeta(query.scope.sourceKey, "automated");
  return row.status === "success_empty"
    ? datasetMeta(query, row, "automated", "complete_empty", "complete")
    : datasetMeta(query, row, "automated", "ready", "complete");
}

async function readAliceMeta(database: CanonicalDatabase, query: CanonicalReadQuery): Promise<DatasetMeta> {
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

async function readDatasetMeta(database: CanonicalDatabase, query: CanonicalReadQuery): Promise<DatasetMeta> {
  switch (query.scope.sourceKey) {
    case "yandex_metrika": return readMetrikaMeta(database, query);
    case "yandex_webmaster": return readWebmasterMeta(database, query);
    case "yandex_wordstat": return readWordstatMeta(database, query);
    case "yandex_webmaster_alice_manual": return readAliceMeta(database, query);
    case "seo_os": return missingMeta("seo_os", "derived");
    case "google_search_console": return missingMeta("google_search_console", "manual");
  }
}

/** Canonical MySQL is the sole request-time data plane; source APIs and import files are never read here. */
export function createCanonicalReadExecutor(database: CanonicalDatabase): CanonicalReadExecutor {
  return async (query) => {
    if (query.name === "gsc") return readManualGsc(database, query);
    return readDatasetMeta(database, query);
  };
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

/** Uses only the canonical dashboard credential authority; no source credentials or APIs. */
export async function loadCurrentCredentialVersion(dashboardId: number): Promise<number | null> {
  const [rows] = await defaultMysqlPool().execute<mysql.RowDataPacket[]>(
    "SELECT credential_version FROM dashboard_shared_access_settings WHERE dashboard_id = ? LIMIT 1",
    [dashboardId],
  );
  const value = Number(rows[0]?.credential_version);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

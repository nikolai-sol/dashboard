import { createHash } from "node:crypto";
import type { DatasetMeta, Metrics, Period, SourceScope } from "@reportingdash/site-seo-contract";
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
  return { meta, summary, daily: dailyRows, dimensions: dimensionRows, indexing: indexingMeta };
}

/** Canonical MySQL is the sole request-time data plane; source APIs and import files are never read here. */
export function createCanonicalReadExecutor(database: CanonicalDatabase): CanonicalReadExecutor {
  return async (query) => {
    if (query.name === "gsc") return readManualGsc(database, query);
    return missingMeta(query.scope.sourceKey, query.scope.sourceKey === "yandex_webmaster_alice_manual" ? "manual" : "automated");
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

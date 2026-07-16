import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import {
  ABBOTT_DATASET_KEY,
  ABBOTT_PRIVATE_SOURCE_KINDS,
  type AbbottActiveRelease,
  type AbbottAggregateJourneyTransition,
  type AbbottAggregatePrivateData,
  type AbbottAggregateWorkbookData,
  type AbbottBitrixPageFact,
  type AbbottContentMetadata,
  type AbbottPrivateSessionJourneyRow,
  type AbbottPrivateSessionJourneysData,
  type AbbottPrivateSnapshotMetadata,
  type AbbottPrivateSourceKind,
  type AbbottResolvedSnapshot,
  type ParsedAbbottWorkbook,
  type ParsedBitrixAnalytics,
} from "./abbott-private-types";

export type AbbottPrivateStoreErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_DASHBOARD"
  | "INVALID_ACTIVE_RELEASE"
  | "PRIVATE_DATA_UNAVAILABLE";

export class AbbottPrivateStoreError extends Error {
  constructor(
    public readonly code: AbbottPrivateStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AbbottPrivateStoreError";
  }
}

export interface AbbottPrivateQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
}

type SnapshotRow = Record<string, unknown> & {
  id?: unknown;
  source_kind?: unknown;
  import_status?: unknown;
  source_generated_at?: unknown;
  period_min_date?: unknown;
  period_max_date?: unknown;
};

const PRIVATE_UNAVAILABLE_MESSAGE = "Abbott private data is unavailable";

function storeError(code: AbbottPrivateStoreErrorCode, message: string): AbbottPrivateStoreError {
  return new AbbottPrivateStoreError(code, message);
}

function sanitizeFailure(error: unknown): AbbottPrivateStoreError {
  return error instanceof AbbottPrivateStoreError
    ? error
    : storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
}

async function queryRows(
  executor: AbbottPrivateQueryExecutor,
  sql: string,
  params: readonly unknown[],
): Promise<readonly Record<string, unknown>[]> {
  try {
    return await executor.query(sql, params);
  } catch (error) {
    throw sanitizeFailure(error);
  }
}

function integerId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rawIdentifier(value: unknown, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
  }
  return value;
}

function metric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanOrNull(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function parseReferencedSnapshotIds(value: unknown): number[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
  }
  const ids = parsed.map(integerId);
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length) {
    throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
  }
  return ids as number[];
}

function toSnapshot(row: SnapshotRow, sourceKind: AbbottPrivateSourceKind): AbbottResolvedSnapshot {
  const id = integerId(row.id);
  if (id === null) throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
  return {
    id,
    sourceKind,
    generatedAt: nullableText(row.source_generated_at),
    periodFrom: nullableText(row.period_min_date),
    periodTo: nullableText(row.period_max_date),
  };
}

export async function resolveActiveAbbottRelease(
  executor: AbbottPrivateQueryExecutor,
): Promise<AbbottActiveRelease> {
  const releaseRows = await queryRows(
    executor,
    `SELECT
       active_release.canonical_release_id,
       data_release.release_status,
       data_release.source_snapshot_ids
     FROM \`report_bd\`.\`portal_active_data_releases\` AS active_release
     INNER JOIN \`report_bd\`.\`portal_data_releases\` AS data_release
       ON data_release.dataset_key = active_release.dataset_key
      AND data_release.id = active_release.canonical_release_id
     WHERE active_release.dataset_key = ?
       AND data_release.dataset_key = ?
     LIMIT 2`,
    [ABBOTT_DATASET_KEY, ABBOTT_DATASET_KEY],
  );
  if (releaseRows.length !== 1 || releaseRows[0]?.release_status !== "active") {
    throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
  }

  const releaseId = integerId(releaseRows[0]?.canonical_release_id);
  if (releaseId === null) throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
  const snapshotIds = parseReferencedSnapshotIds(releaseRows[0]?.source_snapshot_ids);
  const placeholders = snapshotIds.map(() => "?").join(", ");
  const snapshotRows = (await queryRows(
    executor,
    `SELECT id, source_kind, import_status, source_generated_at, period_min_date, period_max_date
     FROM \`report_bd\`.\`portal_dataset_snapshots\`
     WHERE dataset_key = ?
       AND id IN (${placeholders})
     ORDER BY id`,
    [ABBOTT_DATASET_KEY, ...snapshotIds],
  )) as readonly SnapshotRow[];

  const returnedIds = snapshotRows.map((row) => integerId(row.id));
  if (
    snapshotRows.length !== snapshotIds.length ||
    returnedIds.some((id) => id === null) ||
    new Set(returnedIds).size !== snapshotIds.length ||
    returnedIds.some((id) => id === null || !snapshotIds.includes(id)) ||
    snapshotRows.some((row) => row.import_status !== "imported")
  ) {
    throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
  }

  const byKind = new Map<string, SnapshotRow[]>();
  snapshotRows.forEach((row) => {
    const kind = text(row.source_kind);
    byKind.set(kind, [...(byKind.get(kind) ?? []), row]);
  });

  const requireOne = (sourceKind: AbbottPrivateSourceKind): AbbottResolvedSnapshot => {
    const rows = byKind.get(sourceKind) ?? [];
    if (rows.length !== 1) throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
    return toSnapshot(rows[0]!, sourceKind);
  };
  const optionalOne = (sourceKind: AbbottPrivateSourceKind): AbbottResolvedSnapshot | null => {
    const rows = byKind.get(sourceKind) ?? [];
    if (rows.length > 1) throw storeError("INVALID_ACTIVE_RELEASE", "Abbott active release is invalid");
    return rows.length === 1 ? toSnapshot(rows[0]!, sourceKind) : null;
  };

  return {
    id: releaseId,
    snapshots: {
      workbookJson: requireOne(ABBOTT_PRIVATE_SOURCE_KINDS.workbookJson),
      workbookCatalog: requireOne(ABBOTT_PRIVATE_SOURCE_KINDS.workbookCatalog),
      bitrixPages: optionalOne(ABBOTT_PRIVATE_SOURCE_KINDS.bitrixPages),
      bitrixJourneys: optionalOne(ABBOTT_PRIVATE_SOURCE_KINDS.bitrixJourneys),
    },
  };
}

async function requireActiveAbbottDashboard(executor: AbbottPrivateQueryExecutor, dashboardId: number): Promise<void> {
  if (!Number.isSafeInteger(dashboardId) || dashboardId <= 0) {
    throw storeError("INVALID_DASHBOARD", "Abbott dashboard is unavailable");
  }
  const rows = await queryRows(
    executor,
    `SELECT id
     FROM \`report_bd\`.\`dashboards\`
     WHERE id = ? AND dashboard_type = ? AND is_active = TRUE
     LIMIT 2`,
    [dashboardId, "abbott_bi"],
  );
  if (rows.length !== 1 || integerId(rows[0]?.id) !== dashboardId) {
    throw storeError("INVALID_DASHBOARD", "Abbott dashboard is unavailable");
  }
}

function contentMetadata(row: Record<string, unknown>): AbbottContentMetadata {
  return {
    direction: nullableText(row.direction_key),
    material_type: nullableText(row.material_type),
    access: nullableText(row.access_label),
    is_active: booleanOrNull(row.is_active),
  };
}

function slugFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

async function loadAggregateWorkbook(
  executor: AbbottPrivateQueryExecutor,
  release: AbbottActiveRelease,
): Promise<AbbottAggregateWorkbookData> {
  const catalogRows = await queryRows(
    executor,
    `SELECT page_title, material_type, direction_key, normalized_path, access_label, is_active
     FROM \`report_bd\`.\`portal_content_catalog\`
     WHERE canonical_release_id = ? AND source_snapshot_id = ?
     ORDER BY id`,
    [release.id, release.snapshots.workbookCatalog.id],
  );
  const materialRows = await queryRows(
    executor,
    `SELECT material_title, normalized_path
     FROM \`report_bd\`.\`portal_general_materials\`
     WHERE canonical_release_id = ? AND source_snapshot_id = ?
     ORDER BY id`,
    [release.id, release.snapshots.workbookJson.id],
  );
  const eventRows = await queryRows(
    executor,
    `SELECT event_title, registration_url, direction_key, access_label
     FROM \`report_bd\`.\`portal_event_catalog\`
     WHERE canonical_release_id = ? AND source_snapshot_id = ?
     ORDER BY id`,
    [release.id, release.snapshots.workbookJson.id],
  );

  const contentByTitle = new Map<string, AbbottContentMetadata>();
  const contentByTitleAndType = new Map<string, AbbottContentMetadata>();
  const contentBySlug = new Map<string, AbbottContentMetadata>();
  const urlReturnDirections = new Map<string, string | null>();
  catalogRows.forEach((row) => {
    const title = text(row.page_title);
    const path = text(row.normalized_path);
    const metadata = contentMetadata(row);
    if (title) contentByTitle.set(title, metadata);
    if (title && metadata.material_type) contentByTitleAndType.set(`${metadata.material_type}::${title}`, metadata);
    const slug = slugFromPath(path);
    if (slug) contentBySlug.set(slug, metadata);
    if (path) urlReturnDirections.set(path, metadata.direction);
  });

  return {
    generalMaterials: materialRows
      .map((row) => ({ name: text(row.material_title), url: text(row.normalized_path) }))
      .filter((row) => row.name && row.url),
    externalEvents: eventRows
      .map((row) => ({
        title: text(row.event_title),
        direction: nullableText(row.direction_key),
        registration_url: text(row.registration_url),
        access: nullableText(row.access_label),
      }))
      .filter((row) => row.title && row.registration_url),
    contentByTitle,
    contentByTitleAndType,
    contentBySlug,
    urlReturnDirections,
    ymUrlReturn: [],
  };
}

export async function loadActiveAbbottWorkbookDataWithExecutor(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
): Promise<ParsedAbbottWorkbook> {
  await requireActiveAbbottDashboard(executor, dashboardId);
  const release = await resolveActiveAbbottRelease(executor);
  const workbook = await loadAggregateWorkbook(executor, release);
  const directionRows = await queryRows(
    executor,
    `SELECT raw_user_id, normalized_direction
     FROM \`report_bd_private\`.\`portal_user_directions_private\`
     WHERE canonical_release_id = ? AND source_snapshot_id = ?
     ORDER BY id`,
    [release.id, release.snapshots.workbookJson.id],
  );
  const userDirections = new Map<string, string | null>();
  directionRows.forEach((row) => {
    const id = rawIdentifier(row.raw_user_id, false);
    if (id === null) throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
    if (userDirections.has(id)) throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
    userDirections.set(id, nullableText(row.normalized_direction));
  });
  return { ...workbook, userDirections };
}

function sourceMetadata(snapshot: AbbottResolvedSnapshot | null): AbbottPrivateSnapshotMetadata {
  return snapshot
    ? {
        source_status: "test_dump",
        test_dump: true,
        snapshot_id: snapshot.id,
        generated_at: snapshot.generatedAt,
        period_from: snapshot.periodFrom,
        period_to: snapshot.periodTo,
      }
    : {
        source_status: "missing",
        test_dump: true,
        snapshot_id: null,
        generated_at: null,
        period_from: null,
        period_to: null,
      };
}

function parseBitrixRows(rows: readonly Record<string, unknown>[]): AbbottBitrixPageFact[] {
  return rows.map((row) => ({
    report_date: text(row.report_date),
    url: text(row.normalized_path),
    path: text(row.normalized_path),
    material_id: nullableText(row.material_id),
    pageviews: metric(row.pageviews),
    sessions: metric(row.visits),
    users: metric(row.unique_visitors),
  }));
}

async function loadBitrixPagesForRelease(
  executor: AbbottPrivateQueryExecutor,
  release: AbbottActiveRelease,
  table: "private" | "aggregate",
): Promise<ParsedBitrixAnalytics> {
  const snapshot = release.snapshots.bitrixPages;
  const source = sourceMetadata(snapshot);
  if (!snapshot) return { source, summary: null, rows: [] };
  const qualifiedTable =
    table === "private"
      ? "`report_bd_private`.`portal_bitrix_page_facts`"
      : "`report_bd`.`portal_bitrix_page_facts`";
  const rows = await queryRows(
    executor,
    `SELECT report_date, normalized_path, material_id, pageviews, visits, unique_visitors
     FROM ${qualifiedTable}
     WHERE canonical_release_id = ? AND source_snapshot_id = ?
     ORDER BY report_date, normalized_path_hash`,
    [release.id, snapshot.id],
  );
  return {
    source,
    summary: {
      date_from: snapshot.periodFrom ?? "",
      date_to: snapshot.periodTo ?? "",
      page_rows: rows.length,
    },
    rows: parseBitrixRows(rows),
  };
}

export async function loadActiveAbbottBitrixAnalyticsWithExecutor(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
): Promise<ParsedBitrixAnalytics> {
  await requireActiveAbbottDashboard(executor, dashboardId);
  const release = await resolveActiveAbbottRelease(executor);
  return loadBitrixPagesForRelease(executor, release, "private");
}

export async function loadActiveAbbottSessionJourneysWithExecutor(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
): Promise<AbbottPrivateSessionJourneysData> {
  await requireActiveAbbottDashboard(executor, dashboardId);
  const release = await resolveActiveAbbottRelease(executor);
  const snapshot = release.snapshots.bitrixJourneys;
  const source = sourceMetadata(snapshot);
  if (!snapshot) return { source, rows: [] };
  const rows = await queryRows(
    executor,
    `SELECT report_date, raw_user_id, protected_visit_id, event_sequence, event_at, normalized_path, event_kind
     FROM \`report_bd_private\`.\`portal_bitrix_journeys_private\`
     WHERE canonical_release_id = ? AND source_snapshot_id = ?
     ORDER BY report_date, protected_visit_id, event_sequence`,
    [release.id, snapshot.id],
  );
  const grouped = new Map<string, AbbottPrivateSessionJourneyRow>();
  rows.forEach((row) => {
    const protectedVisitId = rawIdentifier(row.protected_visit_id, false);
    if (protectedVisitId === null) throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
    const rawUserId = rawIdentifier(row.raw_user_id, true);
    const reportDate = text(row.report_date);
    const key = JSON.stringify([reportDate, protectedVisitId]);
    const current = grouped.get(key) ?? {
      protected_visit_id: protectedVisitId,
      raw_user_id: rawUserId,
      report_date: reportDate,
      events: [],
    };
    if (current.raw_user_id !== rawUserId) throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
    current.events.push({
      sequence: metric(row.event_sequence),
      event_at: nullableText(row.event_at),
      normalized_path: text(row.normalized_path),
      event_kind: text(row.event_kind),
    });
    grouped.set(key, current);
  });
  return { source, rows: [...grouped.values()] };
}

export async function loadActiveAbbottAggregateDataWithExecutor(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
): Promise<AbbottAggregatePrivateData> {
  await requireActiveAbbottDashboard(executor, dashboardId);
  const release = await resolveActiveAbbottRelease(executor);
  const workbook = await loadAggregateWorkbook(executor, release);
  const bitrixPages = await loadBitrixPagesForRelease(executor, release, "aggregate");
  const journeySnapshot = release.snapshots.bitrixJourneys;
  const transitionRows = journeySnapshot
    ? await queryRows(
        executor,
        `SELECT report_date, from_path, to_path, transitions
         FROM \`report_bd\`.\`portal_bitrix_journey_transitions\`
         WHERE canonical_release_id = ? AND source_snapshot_id = ?
         ORDER BY report_date, from_path, to_path`,
        [release.id, journeySnapshot.id],
      )
    : [];
  const journeyTransitions: AbbottAggregateJourneyTransition[] = transitionRows.map((row) => ({
    report_date: text(row.report_date),
    from_path: text(row.from_path),
    to_path: text(row.to_path),
    transitions: metric(row.transitions),
  }));
  return {
    workbook,
    bitrixPages,
    journeyTransitions: { source: sourceMetadata(journeySnapshot), rows: journeyTransitions },
  };
}

type PrivatePoolGlobal = typeof globalThis & { __abbottPrivateMysqlPool?: Pool };

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw storeError("INVALID_CONFIGURATION", "Abbott private database is not configured");
  }
  return value;
}

async function getPrivatePool(): Promise<Pool> {
  if (typeof window !== "undefined") {
    throw storeError("INVALID_CONFIGURATION", "Abbott private store is server-only");
  }
  const shared = globalThis as PrivatePoolGlobal;
  if (shared.__abbottPrivateMysqlPool) return shared.__abbottPrivateMysqlPool;
  const host = requiredEnvironment("ABBOTT_PRIVATE_DB_HOST");
  const rawPort = requiredEnvironment("ABBOTT_PRIVATE_DB_PORT");
  const user = requiredEnvironment("ABBOTT_PRIVATE_DB_USER");
  const password = requiredEnvironment("ABBOTT_PRIVATE_DB_PASSWORD");
  const database = requiredEnvironment("ABBOTT_PRIVATE_DB_NAME");
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65_535 || database !== "report_bd_private") {
    throw storeError("INVALID_CONFIGURATION", "Abbott private database is not configured");
  }
  const mysql = await import("mysql2/promise");
  shared.__abbottPrivateMysqlPool = mysql.createPool({
    host,
    port: Number(rawPort),
    user,
    password,
    database,
    dateStrings: ["DATE", "DATETIME"],
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    multipleStatements: false,
  });
  return shared.__abbottPrivateMysqlPool;
}

function connectionExecutor(connection: PoolConnection): AbbottPrivateQueryExecutor {
  return {
    async query(sql, params) {
      const [rows] = await connection.execute<RowDataPacket[]>(sql, params as never[]);
      return rows as unknown as readonly Record<string, unknown>[];
    },
  };
}

async function withReadOnlyPrivateExecutor<T>(
  work: (executor: AbbottPrivateQueryExecutor) => Promise<T>,
): Promise<T> {
  let connection: PoolConnection | undefined;
  try {
    connection = await (await getPrivatePool()).getConnection();
    await connection.query("SET TRANSACTION READ ONLY");
    await connection.beginTransaction();
    const result = await work(connectionExecutor(connection));
    await connection.commit();
    return result;
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // The sanitized store error below deliberately hides connection details.
      }
    }
    throw sanitizeFailure(error);
  } finally {
    connection?.release();
  }
}

export async function loadActiveAbbottWorkbookData(dashboardId: number): Promise<ParsedAbbottWorkbook> {
  return withReadOnlyPrivateExecutor((executor) => loadActiveAbbottWorkbookDataWithExecutor(executor, dashboardId));
}

export async function loadActiveAbbottBitrixAnalytics(dashboardId: number): Promise<ParsedBitrixAnalytics> {
  return withReadOnlyPrivateExecutor((executor) => loadActiveAbbottBitrixAnalyticsWithExecutor(executor, dashboardId));
}

export async function loadActiveAbbottSessionJourneys(
  dashboardId: number,
): Promise<AbbottPrivateSessionJourneysData> {
  return withReadOnlyPrivateExecutor((executor) => loadActiveAbbottSessionJourneysWithExecutor(executor, dashboardId));
}

export async function loadActiveAbbottAggregateData(dashboardId: number): Promise<AbbottAggregatePrivateData> {
  return withReadOnlyPrivateExecutor((executor) => loadActiveAbbottAggregateDataWithExecutor(executor, dashboardId));
}

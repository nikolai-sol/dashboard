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
  type AbbottPrivateAudience,
  type AbbottReleaseBundle,
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

function nullableMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
     WHERE id = ?
       AND LOWER(TRIM(client_id)) = ?
       AND dashboard_type = ?
       AND is_active = TRUE
     LIMIT 2`,
    [dashboardId, ABBOTT_DATASET_KEY, "abbott_bi"],
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

function addUniqueLookup<T>(map: Map<string, T>, key: string, value: T): void {
  if (!key) return;
  if (map.has(key)) throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
  map.set(key, value);
}

async function loadAggregateWorkbook(
  executor: AbbottPrivateQueryExecutor,
  release: AbbottActiveRelease,
): Promise<AbbottAggregateWorkbookData> {
  const catalogRows = await queryRows(
    executor,
    `SELECT projection.lookup_kind, projection.lookup_key_hash, projection.resolution_status,
            catalog.material_type, catalog.direction_key, catalog.access_label, catalog.is_active
     FROM \`report_bd\`.\`portal_content_lookup_projection\` AS projection
     INNER JOIN \`report_bd\`.\`portal_content_catalog\` AS catalog
       ON catalog.canonical_release_id = projection.canonical_release_id
      AND catalog.source_snapshot_id = projection.source_snapshot_id
      AND catalog.source_row_fingerprint = projection.selected_source_row_fingerprint
     WHERE projection.canonical_release_id = ? AND projection.source_snapshot_id = ?
       AND projection.resolution_status IN ('unique', 'identical_collapsed')
     ORDER BY projection.lookup_kind, projection.lookup_key_hash`,
    [release.id, release.snapshots.workbookCatalog.id],
  );
  const qualityRows = await queryRows(
    executor,
    `SELECT
       SUM(resolution_status = 'ambiguous') AS ambiguous_groups,
       SUM(resolution_status = 'identical_collapsed') AS collapsed_groups
     FROM \`report_bd\`.\`portal_content_lookup_projection\`
     WHERE canonical_release_id = ? AND source_snapshot_id = ?`,
    [release.id, release.snapshots.workbookCatalog.id],
  );
  const materialRows = await queryRows(
    executor,
    `SELECT material_title, normalized_url
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
  const contentBySlug = new Map<string, AbbottContentMetadata>();
  const urlReturnDirections = new Map<string, AbbottContentMetadata>();
  catalogRows.forEach((row) => {
    const lookupKind = text(row.lookup_kind);
    const lookupKeyHash = text(row.lookup_key_hash);
    if (!/^[a-f0-9]{64}$/.test(lookupKeyHash)) {
      throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
    }
    const metadata = contentMetadata(row);
    if (lookupKind === "title") addUniqueLookup(contentByTitle, lookupKeyHash, metadata);
    else if (lookupKind === "slug") addUniqueLookup(contentBySlug, lookupKeyHash, metadata);
    else if (lookupKind === "path") addUniqueLookup(urlReturnDirections, lookupKeyHash, metadata);
    else throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
  });
  const quality = qualityRows[0] ?? {};

  return {
    generalMaterials: materialRows
      .map((row) => ({ name: text(row.material_title), url: text(row.normalized_url) }))
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
    contentBySlug,
    urlReturnDirections,
    lookupQuality: {
      ambiguousGroups: metric(quality.ambiguous_groups),
      collapsedGroups: metric(quality.collapsed_groups),
    },
    ymUrlReturn: [],
  };
}

async function loadManagerWorkbookForRelease(
  executor: AbbottPrivateQueryExecutor,
  release: AbbottActiveRelease,
): Promise<ParsedAbbottWorkbook> {
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

export async function loadActiveAbbottWorkbookDataWithExecutor(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
): Promise<ParsedAbbottWorkbook> {
  await requireActiveAbbottDashboard(executor, dashboardId);
  const release = await resolveActiveAbbottRelease(executor);
  return loadManagerWorkbookForRelease(executor, release);
}

function sourceMetadata(
  snapshot: AbbottResolvedSnapshot | null,
  status: AbbottPrivateSnapshotMetadata["source_status"] = snapshot ? "test_dump" : "missing",
): AbbottPrivateSnapshotMetadata {
  return snapshot
    ? {
        source_status: status,
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

function isValidDateRange(from: string, to: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return false;
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) return false;
  return fromDate.toISOString().slice(0, 10) === from && toDate.toISOString().slice(0, 10) === to;
}

function snapshotOverlapsRange(snapshot: AbbottResolvedSnapshot, from: string, to: string): boolean {
  if (snapshot.periodFrom && to < snapshot.periodFrom) return false;
  if (snapshot.periodTo && from > snapshot.periodTo) return false;
  return true;
}

function overlapRange(snapshot: AbbottResolvedSnapshot, from: string, to: string): { from: string; to: string } {
  return {
    from: snapshot.periodFrom && snapshot.periodFrom > from ? snapshot.periodFrom : from,
    to: snapshot.periodTo && snapshot.periodTo < to ? snapshot.periodTo : to,
  };
}

function parseBitrixRows(rows: readonly Record<string, unknown>[]): AbbottBitrixPageFact[] {
  return rows.map((row) => ({
    report_date: text(row.report_date),
    url: text(row.normalized_path),
    path: text(row.normalized_path),
    material_id: nullableText(row.material_id),
    material_type_hint: nullableText(row.material_type_hint),
    pageviews: metric(row.pageviews),
    sessions: metric(row.sessions),
    users: metric(row.users),
    guests: metric(row.guests),
    logged_in_hits: metric(row.logged_in_hits),
    anonymous_hits: metric(row.anonymous_hits),
    logged_in_sessions: metric(row.logged_in_sessions),
    anonymous_sessions: metric(row.anonymous_sessions),
    entry_sessions: metric(row.entry_sessions),
    exit_sessions: metric(row.exit_sessions),
    avg_session_duration_seconds: nullableMetric(row.avg_session_duration_seconds),
    top_utm_source: nullableText(row.top_utm_source),
    top_utm_medium: nullableText(row.top_utm_medium),
    top_utm_campaign: nullableText(row.top_utm_campaign),
  }));
}

async function loadBitrixPagesForRelease(
  executor: AbbottPrivateQueryExecutor,
  release: AbbottActiveRelease,
  table: "private" | "aggregate",
  requestedFrom?: string,
  requestedTo?: string,
): Promise<ParsedBitrixAnalytics> {
  const snapshot = release.snapshots.bitrixPages;
  const source = sourceMetadata(snapshot);
  if (!snapshot) return { source, summary: null, rows: [] };
  if (requestedFrom && requestedTo && !snapshotOverlapsRange(snapshot, requestedFrom, requestedTo)) {
    return { source: sourceMetadata(snapshot, "out_of_period"), summary: null, rows: [] };
  }
  const qualifiedTable =
    table === "private"
      ? "`report_bd_private`.`portal_bitrix_page_facts`"
      : "`report_bd`.`portal_bitrix_page_facts`";
  const rows = await queryRows(
    executor,
    `SELECT report_date, normalized_path, material_id, material_type_hint,
            pageviews, sessions, users, guests,
            logged_in_hits, anonymous_hits, logged_in_sessions, anonymous_sessions,
            entry_sessions, exit_sessions, avg_session_duration_seconds,
            top_utm_source, top_utm_medium, top_utm_campaign
     FROM ${qualifiedTable}
     WHERE canonical_release_id = ? AND source_snapshot_id = ?${
       requestedFrom && requestedTo ? "\n       AND report_date >= ? AND report_date <= ?" : ""
     }
     ORDER BY report_date, normalized_path_hash`,
    requestedFrom && requestedTo
      ? [release.id, snapshot.id, requestedFrom, requestedTo]
      : [release.id, snapshot.id],
  );
  const summaryRange = requestedFrom && requestedTo
    ? overlapRange(snapshot, requestedFrom, requestedTo)
    : { from: snapshot.periodFrom ?? "", to: snapshot.periodTo ?? "" };
  return {
    source,
    summary: {
      date_from: summaryRange.from,
      date_to: summaryRange.to,
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

async function loadManagerJourneysForRelease(
  executor: AbbottPrivateQueryExecutor,
  release: AbbottActiveRelease,
  requestedFrom?: string,
  requestedTo?: string,
): Promise<AbbottPrivateSessionJourneysData> {
  const snapshot = release.snapshots.bitrixJourneys;
  const source = sourceMetadata(snapshot);
  if (!snapshot) return { source, rows: [] };
  if (requestedFrom && requestedTo && !snapshotOverlapsRange(snapshot, requestedFrom, requestedTo)) {
    return { source: sourceMetadata(snapshot, "out_of_period"), rows: [] };
  }
  const rows = await queryRows(
    executor,
    `SELECT report_date, raw_user_id, protected_visit_id, event_sequence, event_at, normalized_path, event_kind
     FROM \`report_bd_private\`.\`portal_bitrix_journeys_private\`
     WHERE canonical_release_id = ? AND source_snapshot_id = ?${
       requestedFrom && requestedTo ? "\n       AND report_date >= ? AND report_date <= ?" : ""
     }
     ORDER BY report_date, protected_visit_id, event_sequence`,
    requestedFrom && requestedTo
      ? [release.id, snapshot.id, requestedFrom, requestedTo]
      : [release.id, snapshot.id],
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

export async function loadActiveAbbottSessionJourneysWithExecutor(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
): Promise<AbbottPrivateSessionJourneysData> {
  await requireActiveAbbottDashboard(executor, dashboardId);
  const release = await resolveActiveAbbottRelease(executor);
  return loadManagerJourneysForRelease(executor, release);
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
        `SELECT report_date, from_path, to_path, transition_count
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
    transitions: metric(row.transition_count),
  }));
  return {
    workbook,
    bitrixPages,
    journeyTransitions: { source: sourceMetadata(journeySnapshot), rows: journeyTransitions },
  };
}

export async function loadActiveAbbottReleaseBundleWithExecutor(
  executor: AbbottPrivateQueryExecutor,
  dashboardId: number,
  audience: AbbottPrivateAudience,
  from: string,
  to: string,
): Promise<AbbottReleaseBundle> {
  if (audience !== "manager" && audience !== "embed") {
    throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
  }
  if (!isValidDateRange(from, to)) {
    throw storeError("PRIVATE_DATA_UNAVAILABLE", PRIVATE_UNAVAILABLE_MESSAGE);
  }
  await requireActiveAbbottDashboard(executor, dashboardId);
  const release = await resolveActiveAbbottRelease(executor);

  if (audience === "manager") {
    const workbook = await loadManagerWorkbookForRelease(executor, release);
    const bitrixPages = await loadBitrixPagesForRelease(executor, release, "private", from, to);
    const journeys = await loadManagerJourneysForRelease(executor, release, from, to);
    return { releaseId: release.id, audience, workbook, bitrixPages, journeys };
  }

  const workbook = await loadAggregateWorkbook(executor, release);
  const bitrixPages = await loadBitrixPagesForRelease(executor, release, "aggregate", from, to);
  const journeySnapshot = release.snapshots.bitrixJourneys;
  const journeyInRange = journeySnapshot ? snapshotOverlapsRange(journeySnapshot, from, to) : false;
  const transitionRows = journeySnapshot && journeyInRange
    ? await queryRows(
        executor,
        `SELECT report_date, from_path, to_path, transition_count
         FROM \`report_bd\`.\`portal_bitrix_journey_transitions\`
         WHERE canonical_release_id = ? AND source_snapshot_id = ?
           AND report_date >= ? AND report_date <= ?
         ORDER BY report_date, from_path, to_path`,
        [release.id, journeySnapshot.id, from, to],
      )
    : [];
  return {
    releaseId: release.id,
    audience,
    workbook,
    bitrixPages,
    journeyTransitions: {
      source: journeySnapshot && !journeyInRange
        ? sourceMetadata(journeySnapshot, "out_of_period")
        : sourceMetadata(journeySnapshot),
      rows: transitionRows.map((row) => ({
        report_date: text(row.report_date),
        from_path: text(row.from_path),
        to_path: text(row.to_path),
        transitions: metric(row.transition_count),
      })),
    },
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

export async function loadActiveAbbottReleaseBundle(
  dashboardId: number,
  audience: AbbottPrivateAudience,
  from: string,
  to: string,
): Promise<AbbottReleaseBundle> {
  return withReadOnlyPrivateExecutor((executor) =>
    loadActiveAbbottReleaseBundleWithExecutor(executor, dashboardId, audience, from, to));
}

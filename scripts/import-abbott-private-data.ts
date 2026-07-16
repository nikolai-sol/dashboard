#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import * as XLSX from "xlsx";

const DATASET_KEY = "abbott";
const PRIMARY_SCHEMA = "report_bd";
const PRIVATE_SCHEMA = "report_bd_private";
const ALLOWED_SOURCE_KINDS = [
  "abbott_workbook_json",
  "abbott_workbook_catalog",
  "abbott_bitrix_pages",
  "abbott_bitrix_journeys",
] as const;
const ALLOWED_TABLES = new Set([
  `${PRIMARY_SCHEMA}.portal_content_catalog`,
  `${PRIMARY_SCHEMA}.portal_general_materials`,
  `${PRIMARY_SCHEMA}.portal_event_catalog`,
  `${PRIMARY_SCHEMA}.portal_bitrix_page_facts`,
  `${PRIMARY_SCHEMA}.portal_bitrix_journey_transitions`,
  `${PRIVATE_SCHEMA}.portal_user_directions_private`,
  `${PRIVATE_SCHEMA}.portal_bitrix_page_facts`,
  `${PRIVATE_SCHEMA}.portal_bitrix_journeys_private`,
]);

export type AbbottSourceKind = (typeof ALLOWED_SOURCE_KINDS)[number];

type QueryResult = [unknown, unknown];

export interface AbbottImportConnection {
  beginTransaction(): Promise<unknown>;
  execute(sql: string, params?: readonly unknown[]): Promise<QueryResult>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
}

export interface ImportBatch {
  table: string;
  columns: string[];
  rows: unknown[][];
  fingerprints: string[];
  fingerprintColumn?: string;
  countsTowardImportedRows?: boolean;
}

export interface PreparedAbbottSource {
  sourceKind: AbbottSourceKind;
  basename: string;
  contentSha256: string;
  contentBytes: number;
  sourceRowCount: number;
  importedRowCount: number;
  rejectedRowCount: number;
  parserVersion: string;
  codeRevision: string;
  archiveLocator: string;
  periodMinDate: string | null;
  periodMaxDate: string | null;
  generatedAt: string | null;
  manifest: Record<string, unknown>;
  batches: ImportBatch[];
}

interface WorkbookJsonRow {
  id?: unknown;
  direction?: unknown;
}

interface GeneralMaterialRow {
  materialKey: string;
  materialTitle: string;
  materialType: string | null;
  normalizedUrl: string;
  normalizedPath: string;
  direction: string | null;
}

interface EventCatalogRow {
  eventTitle: string;
  direction: string | null;
  registrationUrl: string;
  access: string | null;
  fingerprint: string;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function rawIdentifier(value: unknown, label: string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be supplied as lossless text`);
  }
  const result = text(value);
  if (!result) throw new Error(`${label} is blank`);
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} must be a non-negative integer`);
  return result;
}

function optionalNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be non-negative`);
  return result;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalRowFingerprint(fields: readonly unknown[]): string {
  const hash = createHash("sha256");
  for (const field of fields) {
    const value = field === null || field === undefined ? "" : String(field);
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
    hash.update(";");
  }
  return hash.digest("hex");
}

export function normalizeAbbottUrl(rawValue: unknown): string {
  const raw = text(rawValue).replaceAll("&amp;", "&");
  if (!raw) return "";
  const hasAuthority = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  try {
    const parsed = new URL(hasAuthority ? raw : raw.startsWith("/") ? `https://placeholder.invalid${raw}` : `https://placeholder.invalid/${raw}`);
    const pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/g, "") || "/";
    if (!hasAuthority) return pathname;
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    return `${protocol}//${host}${pathname}`;
  } catch {
    const stripped = raw.split("#", 1)[0]?.split("?", 1)[0] ?? "";
    return stripped.replace(/\/{2,}/g, "/").replace(/\/+$/g, "") || "/";
  }
}

function normalizedPath(rawValue: unknown): string {
  const normalized = normalizeAbbottUrl(rawValue);
  if (!normalized) return "";
  try {
    return new URL(normalized).pathname;
  } catch {
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }
}

function rejectDuplicate(seen: Set<string>, key: string, label: string): void {
  if (seen.has(key)) throw new Error(`Duplicate ${label}`);
  seen.add(key);
}

function sanitizedBasename(value: string): string {
  const basename = path.basename(value).replace(/[^A-Za-z0-9._-]+/g, "_");
  return basename.slice(0, 255) || "source";
}

function assertSanitizedEvidence(value: unknown): void {
  const forbiddenKeys = /(?:raw_?user|user_?id|session_?id|visit_?id|protected_?visit|source_locator|archive_locator|normalized_?url|registration_?url|normalized_?path|from_?path|to_?path)/i;
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      const forbiddenValue = /(?:[a-z][a-z0-9+.-]*:\/\/|^[/\\]|^[A-Za-z]:[\\/]|[?#].*=|\s->\s)/i;
      if (forbiddenValue.test(candidate)) throw new Error("Manifest contains row-level evidence");
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
      if (forbiddenKeys.test(key)) throw new Error("Manifest contains row-level evidence");
      visit(nested);
    }
  };
  visit(value);
}

export function assertPrivateImportPath(value: string, label: string): string {
  if (!value || !value.trim()) throw new Error(`${label} requires an explicit path`);
  let existingAncestor = path.resolve(value);
  const missingSegments: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const resolved = path.join(realpathSync.native(existingAncestor), ...missingSegments);
  const segments = resolved.split(path.sep).filter(Boolean);
  if (segments.some((segment) => segment.toLowerCase() === "public")) {
    throw new Error(`${label} must not be under public`);
  }
  return resolved;
}

export function parseWorkbookJson(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Workbook JSON must be an object");
  const source = payload as {
    id?: WorkbookJsonRow[];
    general_materials?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
  };
  const privateUserDirections: Array<{
    rawUserId: string;
    rawUserIdHash: string;
    normalizedDirection: string;
    normalizedSpecialization: string | null;
  }> = [];
  let rejectedCount = 0;
  const userKeys = new Set<string>();
  for (const row of source.id ?? []) {
    if (row.id === null || row.id === undefined || text(row.id) === "") {
      rejectedCount += 1;
      continue;
    }
    const rawUserId = rawIdentifier(row.id, "raw user ID");
    const direction = text(row.direction);
    if (!direction) {
      rejectedCount += 1;
      continue;
    }
    const rawUserIdHash = sha256(rawUserId);
    rejectDuplicate(userKeys, rawUserIdHash, "user direction ID");
    privateUserDirections.push({
      rawUserId,
      rawUserIdHash,
      normalizedDirection: direction,
      normalizedSpecialization: null,
    });
  }

  const generalMaterials: GeneralMaterialRow[] = [];
  const materialKeys = new Set<string>();
  for (const row of source.general_materials ?? []) {
    const materialTitle = text(row.name ?? row.title);
    const normalizedUrl = normalizeAbbottUrl(row.url);
    if (!materialTitle || !normalizedUrl) {
      rejectedCount += 1;
      continue;
    }
    const materialKey = canonicalRowFingerprint([materialTitle, normalizedUrl]);
    rejectDuplicate(materialKeys, materialKey, "general material target key");
    generalMaterials.push({
      materialKey,
      materialTitle,
      materialType: text(row.material_type) || null,
      normalizedUrl,
      normalizedPath: normalizedPath(normalizedUrl),
      direction: text(row.direction) || null,
    });
  }

  const eventCatalog: EventCatalogRow[] = [];
  const eventKeys = new Set<string>();
  for (const row of source.events ?? []) {
    const eventTitle = text(row.title);
    const registrationUrl = normalizeAbbottUrl(row.registration_url);
    const direction = text(row.direction) || null;
    const access = text(row.access) || null;
    if (!eventTitle || !registrationUrl) {
      rejectedCount += 1;
      continue;
    }
    const fingerprint = canonicalRowFingerprint([eventTitle, direction, registrationUrl, access]);
    rejectDuplicate(eventKeys, fingerprint, "event catalog target key");
    eventCatalog.push({ eventTitle, direction, registrationUrl, access, fingerprint });
  }

  const manifest = {
    source_kind: "abbott_workbook_json",
    direction_count: privateUserDirections.length,
    general_material_count: generalMaterials.length,
    event_catalog_count: eventCatalog.length,
    rejected_count: rejectedCount,
  };
  assertSanitizedEvidence(manifest);
  return {
    privateUserDirections,
    generalMaterials,
    eventCatalog,
    sourceRowCount: (source.id ?? []).length + (source.general_materials ?? []).length + (source.events ?? []).length,
    rejectedCount,
    manifest,
  };
}

const CONTENT_SHEETS: Array<{
  name: string;
  materialType: string | null;
  directionKey?: string;
  accessKey?: string;
  typeKey?: string;
}> = [
  { name: "pages", materialType: null, directionKey: "Направление", accessKey: "Доступ", typeKey: "Тип материала" },
  { name: "Статьи", materialType: "Статьи", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Видео", materialType: "Видео", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Клинические случаи", materialType: "Клинические случаи", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Научно-образовательные брошюры", materialType: "Научно-образовательные брошюры", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Подкасты", materialType: "Подкасты", directionKey: "Направление" },
  { name: "Калькуляторы", materialType: "Калькуляторы", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Проверить знания", materialType: "Проверить знания", directionKey: "Направление" },
  { name: "Помощник фармацевта", materialType: "Помощник фармацевта" },
  { name: "Алгоритмы фармацевтического кон", materialType: "Алгоритмы", directionKey: "Направление" },
  { name: "Клинические рекомендации", materialType: "Клинические рекомендации", directionKey: "Направления" },
  { name: "Таблицы", materialType: "Таблицы", directionKey: "Направление", accessKey: "Доступ" },
];

export function parseWorkbookXlsx(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
  const rows: Array<{
    pageTitle: string;
    materialType: string | null;
    sourceSlug: string | null;
    direction: string | null;
    access: string | null;
    isActive: boolean;
    fingerprint: string;
  }> = [];
  const fingerprints = new Set<string>();
  const titleKeys = new Set<string>();
  const titleAndTypeKeys = new Set<string>();
  const slugKeys = new Set<string>();
  for (const config of CONTENT_SHEETS) {
    const worksheet = workbook.Sheets[config.name];
    if (!worksheet) continue;
    for (const row of XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: true })) {
      const pageTitle = text(row["Название"]);
      const sourceSlug = text(row["Символьный код"]) || null;
      if (!pageTitle && !sourceSlug) continue;
      if (!pageTitle) throw new Error(`Workbook content title is blank in ${config.name}`);
      const materialType = text(config.typeKey ? row[config.typeKey] : config.materialType) || config.materialType;
      const direction = text(config.directionKey ? row[config.directionKey] : "") || null;
      const access = text(config.accessKey ? row[config.accessKey] : "") || null;
      const activeLabel = text(row["Активность"]).toLocaleLowerCase("ru-RU");
      let isActive = true;
      if (["нет", "no", "false", "0"].includes(activeLabel)) isActive = false;
      else if (activeLabel && !["да", "yes", "true", "1"].includes(activeLabel)) {
        throw new Error(`Workbook content active state is invalid in ${config.name}`);
      }
      rejectDuplicate(titleKeys, pageTitle, "content title");
      rejectDuplicate(titleAndTypeKeys, canonicalRowFingerprint([pageTitle, materialType]), "content title and type");
      if (sourceSlug) rejectDuplicate(slugKeys, sourceSlug, "content slug");
      const fingerprint = canonicalRowFingerprint([config.name, pageTitle, materialType, sourceSlug, direction, access, isActive]);
      rejectDuplicate(fingerprints, fingerprint, "content source row");
      rows.push({ pageTitle, materialType, sourceSlug, direction, access, isActive, fingerprint });
    }
  }
  if (rows.length === 0) throw new Error("Workbook XLSX has no content catalog rows");
  const manifest = { source_kind: "abbott_workbook_catalog", content_count: rows.length, rejected_count: 0 };
  assertSanitizedEvidence(manifest);
  return { rows, manifest };
}

function assertCompleteManifest(payload: Record<string, unknown>, label: string): Record<string, unknown> {
  const manifest = payload.manifest;
  if (!manifest || typeof manifest !== "object") throw new Error(`${label} requires a completeness manifest`);
  const status = manifest as Record<string, unknown>;
  if (status.complete !== true || status.truncated !== false) throw new Error(`${label} is truncated or incomplete`);
  return status;
}

function requiredManifestCount(manifest: Record<string, unknown>, key: string, label: string): number {
  if (!(key in manifest)) throw new Error(`${label} completeness manifest is missing count ${key}`);
  return nonNegativeInteger(manifest[key], `${label} ${key}`);
}

export function parseBitrixPagePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Bitrix page payload must be an object");
  const source = payload as Record<string, unknown>;
  const completeness = assertCompleteManifest(source, "Bitrix page payload");
  if (source.grain !== "normalized_path x report_date") throw new Error("Bitrix page payload must contain daily rows");
  const rows: Array<Record<string, unknown>> = [];
  const fingerprints = new Set<string>();
  for (const raw of Array.isArray(source.rows) ? source.rows : []) {
    const row = raw as Record<string, unknown>;
    const reportDate = text(row.report_date).slice(0, 10);
    const pathValue = normalizedPath(row.normalized_path ?? row.url);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !pathValue) throw new Error("Bitrix page row requires report_date and normalized_path");
    const fingerprint = canonicalRowFingerprint([reportDate, pathValue]);
    rejectDuplicate(fingerprints, fingerprint, "Bitrix page fingerprint");
    rows.push({
      reportDate,
      normalizedPath: pathValue,
      normalizedPathHash: sha256(pathValue),
      materialId: text(row.material_id) || null,
      materialTypeHint: text(row.material_type_hint) || null,
      pageviews: nonNegativeInteger(row.pageviews, "pageviews"),
      sessions: nonNegativeInteger(row.sessions, "sessions"),
      users: nonNegativeInteger(row.users, "users"),
      guests: nonNegativeInteger(row.guests, "guests"),
      loggedInHits: nonNegativeInteger(row.logged_in_hits, "logged_in_hits"),
      anonymousHits: nonNegativeInteger(row.anonymous_hits, "anonymous_hits"),
      loggedInSessions: nonNegativeInteger(row.logged_in_sessions, "logged_in_sessions"),
      anonymousSessions: nonNegativeInteger(row.anonymous_sessions, "anonymous_sessions"),
      entrySessions: nonNegativeInteger(row.entry_sessions, "entry_sessions"),
      exitSessions: nonNegativeInteger(row.exit_sessions, "exit_sessions"),
      averageSessionSeconds: optionalNumber(row.avg_session_duration_seconds, "avg_session_duration_seconds"),
      topUtmSource: text(row.top_utm_source) || null,
      topUtmMedium: text(row.top_utm_medium) || null,
      topUtmCampaign: text(row.top_utm_campaign) || null,
      fingerprint,
    });
  }
  if (rows.length === 0) throw new Error("Bitrix page payload has no daily rows");
  const sourceHitRows = requiredManifestCount(completeness, "source_hit_rows", "Bitrix page payload");
  const acceptedHitRows = requiredManifestCount(completeness, "accepted_hit_rows", "Bitrix page payload");
  const rejectedHitRows = requiredManifestCount(completeness, "rejected_hit_rows", "Bitrix page payload");
  const outputRows = requiredManifestCount(completeness, "output_rows", "Bitrix page payload");
  if (sourceHitRows !== acceptedHitRows + rejectedHitRows || outputRows !== rows.length) {
    throw new Error("Bitrix page payload completeness counts do not reconcile");
  }
  const dates = rows.map((row) => String(row.reportDate)).sort();
  const manifest = {
    source_kind: "abbott_bitrix_pages",
    imported_count: rows.length,
    rejected_count: 0,
    period_min_date: dates[0],
    period_max_date: dates.at(-1),
    source_hit_rows: sourceHitRows,
    accepted_hit_rows: acceptedHitRows,
    rejected_hit_rows: rejectedHitRows,
    output_rows: outputRows,
    complete: true,
    truncated: false,
  };
  assertSanitizedEvidence(manifest);
  return { rows, manifest };
}

export function parseBitrixJourneyPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Bitrix journey payload must be an object");
  const source = payload as Record<string, unknown>;
  const schema = source.schema as Record<string, unknown> | undefined;
  if (schema?.grain !== "protected_visit_id x event_sequence" || schema.ordered_events !== true) {
    throw new Error("Bitrix journeys require ordered event-grain rows");
  }
  const completeness = assertCompleteManifest(source, "Bitrix journey payload");
  const rows: Array<Record<string, unknown>> = [];
  const eventKeys = new Set<string>();
  const byVisit = new Map<string, Array<Record<string, unknown>>>();
  for (const raw of Array.isArray(source.rows) ? source.rows : []) {
    const row = raw as Record<string, unknown>;
    const reportDate = text(row.report_date).slice(0, 10);
    const protectedVisitId = rawIdentifier(row.protected_visit_id, "protected visit ID");
    const rawUserId = row.raw_user_id === null || row.raw_user_id === undefined || row.raw_user_id === ""
      ? null
      : rawIdentifier(row.raw_user_id, "raw user ID");
    const eventSequence = nonNegativeInteger(row.event_sequence, "event_sequence");
    const eventAt = text(row.event_at);
    const pathValue = normalizedPath(row.normalized_path ?? row.url);
    const eventKind = text(row.event_kind);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !eventAt || !pathValue || !eventKind) {
      throw new Error("Journey event requires date, time, path, and kind");
    }
    const databaseKey = canonicalRowFingerprint([reportDate, protectedVisitId, eventSequence]);
    rejectDuplicate(eventKeys, databaseKey, "journey database key");
    const fingerprint = canonicalRowFingerprint([reportDate, protectedVisitId, eventSequence, eventAt, pathValue, eventKind]);
    const parsed = {
      reportDate,
      protectedVisitId,
      protectedVisitIdHash: sha256(protectedVisitId),
      rawUserId,
      rawUserIdHash: rawUserId ? sha256(rawUserId) : null,
      sourceEventId: text(row.source_event_id) || null,
      eventSequence,
      eventAt,
      normalizedPath: pathValue,
      normalizedPathHash: sha256(pathValue),
      eventKind,
      fingerprint,
    };
    rows.push(parsed);
    const visitKey = canonicalRowFingerprint([reportDate, protectedVisitId]);
    const events = byVisit.get(visitKey) ?? [];
    events.push(parsed);
    byVisit.set(visitKey, events);
  }
  if (rows.length === 0) throw new Error("Bitrix journey payload has no event rows");
  const sourceHitRows = requiredManifestCount(completeness, "source_hit_rows", "Bitrix journey payload");
  const emittedEventRows = requiredManifestCount(completeness, "emitted_event_rows", "Bitrix journey payload");
  const rejectedHitRows = requiredManifestCount(completeness, "rejected_hit_rows", "Bitrix journey payload");
  if (sourceHitRows !== emittedEventRows + rejectedHitRows || emittedEventRows !== rows.length) {
    throw new Error("Bitrix journey payload completeness counts do not reconcile");
  }

  const transitionMap = new Map<string, Record<string, unknown>>();
  for (const events of byVisit.values()) {
    events.sort((left, right) => Number(left.eventSequence) - Number(right.eventSequence));
    events.forEach((event, index) => {
      if (Number(event.eventSequence) !== index) throw new Error("Journey event sequence must be contiguous and start at zero");
      if (index > 0 && String(event.eventAt) < String(events[index - 1]?.eventAt)) throw new Error("Journey events must be timestamp ordered");
    });
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1]!;
      const current = events[index]!;
      const key = canonicalRowFingerprint([current.reportDate, previous.normalizedPath, current.normalizedPath]);
      const existing = transitionMap.get(key);
      if (existing) existing.transitionCount = Number(existing.transitionCount) + 1;
      else {
        transitionMap.set(key, {
          reportDate: current.reportDate,
          fromPath: previous.normalizedPath,
          fromPathHash: previous.normalizedPathHash,
          toPath: current.normalizedPath,
          toPathHash: current.normalizedPathHash,
          transitionCount: 1,
        });
      }
    }
  }
  const transitions = [...transitionMap.values()].sort((a, b) =>
    `${a.reportDate}\0${a.fromPath}\0${a.toPath}`.localeCompare(`${b.reportDate}\0${b.fromPath}\0${b.toPath}`),
  );
  const dates = rows.map((row) => String(row.reportDate)).sort();
  const manifest = {
    source_kind: "abbott_bitrix_journeys",
    imported_count: rows.length,
    transition_count: transitions.length,
    rejected_count: 0,
    period_min_date: dates[0],
    period_max_date: dates.at(-1),
    source_hit_rows: sourceHitRows,
    emitted_event_rows: emittedEventRows,
    rejected_hit_rows: rejectedHitRows,
    complete: true,
    truncated: false,
  };
  assertSanitizedEvidence(manifest);
  return { rows, transitions, manifest };
}

function rowsFromResult(result: QueryResult): Array<Record<string, unknown>> {
  return Array.isArray(result[0]) ? (result[0] as Array<Record<string, unknown>>) : [];
}

function insertIdFromResult(result: QueryResult): number {
  const header = result[0] as { insertId?: number };
  const insertId = Number(header?.insertId);
  if (!Number.isSafeInteger(insertId) || insertId <= 0) throw new Error("Snapshot insert did not return an ID");
  return insertId;
}

function parseSnapshotIds(value: unknown): number[] {
  const decoded = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(decoded)) throw new Error("Release source_snapshot_ids must be an array");
  const ids = decoded.map((item) => {
    const id = Number(item);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Release source_snapshot_ids is malformed");
    return id;
  });
  return [...new Set(ids)];
}

function assertIdentifier(identifier: string): void {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error("Unsafe SQL identifier");
}

async function verifyBatch(
  connection: AbbottImportConnection,
  canonicalReleaseId: number,
  snapshotId: number,
  batch: ImportBatch,
): Promise<void> {
  if (!ALLOWED_TABLES.has(batch.table)) throw new Error("Import table is not allowed");
  batch.columns.forEach(assertIdentifier);
  if (batch.rows.some((row) => row.length !== batch.columns.length)) throw new Error("Import batch width mismatch");
  if (batch.rows.length !== batch.fingerprints.length) throw new Error("Import batch fingerprint count mismatch");
  if (new Set(batch.fingerprints).size !== batch.fingerprints.length) throw new Error("Duplicate import batch fingerprint");
  if (batch.rows.length === 0) return;
  const countResult = await connection.execute(
    `SELECT COUNT(*) AS row_count FROM ${batch.table} WHERE canonical_release_id = ? AND source_snapshot_id = ?`,
    [canonicalReleaseId, snapshotId],
  );
  const actualCount = Number(rowsFromResult(countResult)[0]?.row_count);
  if (actualCount !== batch.rows.length) throw new Error("Imported row count verification failed");
  if (batch.fingerprintColumn) {
    assertIdentifier(batch.fingerprintColumn);
    const fingerprintResult = await connection.execute(
      `SELECT ${batch.fingerprintColumn} AS fingerprint FROM ${batch.table} WHERE canonical_release_id = ? AND source_snapshot_id = ? ORDER BY ${batch.fingerprintColumn}`,
      [canonicalReleaseId, snapshotId],
    );
    const actual = rowsFromResult(fingerprintResult).map((row) => String(row.fingerprint)).sort();
    const expected = [...batch.fingerprints].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Imported fingerprint verification failed");
  }
}

async function insertAndVerifyBatch(
  connection: AbbottImportConnection,
  canonicalReleaseId: number,
  snapshotId: number,
  batch: ImportBatch,
): Promise<void> {
  if (!ALLOWED_TABLES.has(batch.table)) throw new Error("Import table is not allowed");
  batch.columns.forEach(assertIdentifier);
  if (batch.rows.some((row) => row.length !== batch.columns.length)) throw new Error("Import batch width mismatch");
  if (batch.rows.length !== batch.fingerprints.length) throw new Error("Import batch fingerprint count mismatch");
  if (new Set(batch.fingerprints).size !== batch.fingerprints.length) throw new Error("Duplicate import batch fingerprint");
  if (batch.rows.length === 0) return;
  const columns = ["canonical_release_id", "source_snapshot_id", ...batch.columns];
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  for (let offset = 0; offset < batch.rows.length; offset += 500) {
    const chunk = batch.rows.slice(offset, offset + 500);
    const params = chunk.flatMap((row) => [canonicalReleaseId, snapshotId, ...row]);
    await connection.execute(
      `INSERT INTO ${batch.table} (${columns.join(", ")}) VALUES ${chunk.map(() => placeholders).join(", ")}`,
      params,
    );
  }
  await verifyBatch(connection, canonicalReleaseId, snapshotId, batch);
}

export async function runAbbottImportTransaction(
  connection: AbbottImportConnection,
  canonicalReleaseId: number,
  sources: PreparedAbbottSource[],
) {
  if (!Number.isSafeInteger(canonicalReleaseId) || canonicalReleaseId <= 0) throw new Error("canonical release ID is invalid");
  if (sources.length === 0) throw new Error("No Abbott sources were prepared");
  const kinds = new Set<AbbottSourceKind>();
  for (const source of sources) {
    if (!ALLOWED_SOURCE_KINDS.includes(source.sourceKind)) throw new Error("Unsupported source kind");
    if (kinds.has(source.sourceKind)) throw new Error("Duplicate source kind");
    kinds.add(source.sourceKind);
    if (!/^[a-f0-9]{64}$/.test(source.contentSha256)) throw new Error("Invalid source checksum");
    assertSanitizedEvidence(source.manifest);
    if (source.manifest.source_kind !== source.sourceKind) throw new Error("Manifest source kind does not match prepared source");
    if (source.sourceRowCount !== source.importedRowCount + source.rejectedRowCount) {
      throw new Error("Source row counts do not reconcile");
    }
    const importedBatchRows = source.batches
      .filter((batch) => batch.countsTowardImportedRows !== false)
      .reduce((sum, batch) => sum + batch.rows.length, 0);
    if (importedBatchRows !== source.importedRowCount) throw new Error("Imported batch counts do not reconcile");
  }

  await connection.beginTransaction();
  try {
    const releaseResult = await connection.execute(
      `SELECT id, dataset_key, release_status, source_snapshot_ids
         FROM ${PRIMARY_SCHEMA}.portal_data_releases
        WHERE id = ? AND dataset_key = ?
        FOR UPDATE`,
      [canonicalReleaseId, DATASET_KEY],
    );
    const releaseRows = rowsFromResult(releaseResult);
    if (releaseRows.length !== 1 || releaseRows[0]?.dataset_key !== DATASET_KEY || releaseRows[0]?.release_status !== "staging") {
      throw new Error("Canonical release is not the fixed Abbott staging release");
    }
    const existingReferencedIds = parseSnapshotIds(releaseRows[0].source_snapshot_ids);
    const existingReferencedSnapshots: Array<Record<string, unknown>> = [];
    const existingReferencedById = new Map<number, Record<string, unknown>>();
    if (existingReferencedIds.length > 0) {
      const referencedResult = await connection.execute(
        `SELECT id, dataset_key, source_kind, import_status
           FROM ${PRIMARY_SCHEMA}.portal_dataset_snapshots
          WHERE id IN (${existingReferencedIds.map(() => "?").join(", ")})
          FOR UPDATE`,
        existingReferencedIds,
      );
      existingReferencedSnapshots.push(...rowsFromResult(referencedResult));
      existingReferencedSnapshots.forEach((row) => existingReferencedById.set(Number(row.id), row));
      if (existingReferencedById.size !== existingReferencedIds.length) throw new Error("Release references a missing source snapshot");
      for (const id of existingReferencedIds) {
        const row = existingReferencedById.get(id);
        if (row?.dataset_key !== DATASET_KEY || row.import_status !== "imported" || !text(row.source_kind)) {
          throw new Error("Release references an invalid source snapshot");
        }
      }
    }

    const snapshotIds: Partial<Record<AbbottSourceKind, number>> = {};
    const idempotentKinds: AbbottSourceKind[] = [];
    for (const source of sources) {
      const existingResult = await connection.execute(
        `SELECT id, import_status, imported_row_count
           FROM ${PRIMARY_SCHEMA}.portal_dataset_snapshots
          WHERE dataset_key = ? AND source_kind = ? AND content_sha256 = ?`,
        [DATASET_KEY, source.sourceKind, source.contentSha256],
      );
      const existingRows = rowsFromResult(existingResult);
      if (existingRows.length > 1) throw new Error("Conflicting source checksum rows");
      if (existingRows.length === 1) {
        const existing = existingRows[0]!;
        if (existing.import_status !== "imported" || Number(existing.imported_row_count) !== source.importedRowCount) {
          throw new Error("Existing checksum is not an equivalent imported snapshot");
        }
        const existingSnapshotId = Number(existing.id);
        if (!Number.isSafeInteger(existingSnapshotId) || existingSnapshotId <= 0) throw new Error("Existing snapshot ID is invalid");
        for (const batch of source.batches) {
          await verifyBatch(connection, canonicalReleaseId, existingSnapshotId, batch);
        }
        snapshotIds[source.sourceKind] = existingSnapshotId;
        idempotentKinds.push(source.sourceKind);
        continue;
      }

      const snapshotKey = `abbott-${source.sourceKind}-${source.contentSha256.slice(0, 20)}-${randomUUID().slice(0, 8)}`;
      const snapshotResult = await connection.execute(
        `INSERT INTO ${PRIMARY_SCHEMA}.portal_dataset_snapshots
          (snapshot_key, dataset_key, source_kind, source_locator, content_sha256, content_bytes,
           source_generated_at, period_min_date, period_max_date, source_row_count, parser_version,
           import_status, imported_row_count, rejected_row_count, private_archive_locator, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importing', 0, 0, ?, ?)`,
        [
          snapshotKey,
          DATASET_KEY,
          source.sourceKind,
          source.basename,
          source.contentSha256,
          source.contentBytes,
          source.generatedAt,
          source.periodMinDate,
          source.periodMaxDate,
          source.sourceRowCount,
          source.parserVersion,
          source.archiveLocator,
          JSON.stringify(source.manifest),
        ],
      );
      const snapshotId = insertIdFromResult(snapshotResult);
      snapshotIds[source.sourceKind] = snapshotId;
      for (const batch of source.batches) {
        await insertAndVerifyBatch(connection, canonicalReleaseId, snapshotId, batch);
      }
      await connection.execute(
        `UPDATE ${PRIMARY_SCHEMA}.portal_dataset_snapshots
            SET import_status = 'imported', imported_row_count = ?, rejected_row_count = ?,
                manifest_json = ?, imported_at = UTC_TIMESTAMP()
          WHERE id = ? AND dataset_key = ? AND source_kind = ? AND import_status = 'importing'`,
        [
          source.importedRowCount,
          source.rejectedRowCount,
          JSON.stringify(source.manifest),
          snapshotId,
          DATASET_KEY,
          source.sourceKind,
        ],
      );
    }

    const importedKinds = new Set(sources.map((source) => source.sourceKind));
    const preservedIds = existingReferencedIds.filter((id) => {
      const row = existingReferencedById.get(id);
      return row && !importedKinds.has(text(row.source_kind) as AbbottSourceKind);
    });
    const attachedIds = [...new Set([...preservedIds, ...sources.map((source) => snapshotIds[source.sourceKind]!)])];
    await connection.execute(
      `UPDATE ${PRIMARY_SCHEMA}.portal_data_releases
          SET source_snapshot_ids = ?
        WHERE id = ? AND dataset_key = ? AND release_status = 'staging'`,
      [JSON.stringify(attachedIds), canonicalReleaseId, DATASET_KEY],
    );
    await connection.commit();
    return { canonicalReleaseId, snapshotIds, idempotentKinds };
  } catch {
    try {
      await connection.rollback();
    } catch {
      // The caller receives one sanitized domain error regardless of DB details.
    }
    throw new Error("Abbott private import failed");
  }
}

export interface CliOptions {
  canonicalReleaseId: number;
  workbookJsonPath: string;
  workbookXlsxPath: string;
  bitrixPagesPath: string | null;
  bitrixJourneysPath: string | null;
  parserVersion: string;
  codeRevision: string;
  archiveDir: string;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("All importer options require explicit values");
    if (values.has(key)) throw new Error(`Duplicate importer option ${key}`);
    values.set(key, value);
  }
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new Error(`Missing required option ${key}`);
    return value;
  };
  const allowed = new Set([
    "--canonical-release-id",
    "--workbook-json",
    "--workbook-xlsx",
    "--bitrix-pages",
    "--bitrix-journeys",
    "--parser-version",
    "--code-revision",
    "--archive-dir",
  ]);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`Unknown importer option ${key}`);
  const canonicalReleaseId = Number(required("--canonical-release-id"));
  if (!Number.isSafeInteger(canonicalReleaseId) || canonicalReleaseId <= 0) throw new Error("Invalid --canonical-release-id");
  const parserVersion = required("--parser-version").trim();
  const codeRevision = required("--code-revision").trim();
  if (!parserVersion || !/^[A-Za-z0-9._-]+$/.test(parserVersion)) throw new Error("Invalid parser version");
  if (!codeRevision || !/^[A-Za-z0-9._-]+$/.test(codeRevision)) throw new Error("Invalid code revision");
  return {
    canonicalReleaseId,
    workbookJsonPath: assertPrivateImportPath(required("--workbook-json"), "workbook JSON"),
    workbookXlsxPath: assertPrivateImportPath(required("--workbook-xlsx"), "workbook XLSX"),
    bitrixPagesPath: values.has("--bitrix-pages")
      ? assertPrivateImportPath(values.get("--bitrix-pages")!, "Bitrix pages")
      : null,
    bitrixJourneysPath: values.has("--bitrix-journeys")
      ? assertPrivateImportPath(values.get("--bitrix-journeys")!, "Bitrix journeys")
      : null,
    parserVersion,
    codeRevision,
    archiveDir: assertPrivateImportPath(required("--archive-dir"), "private archive directory"),
  };
}

async function archiveSource(sourcePath: string, sourceKind: AbbottSourceKind, archiveDir: string, bytes: Buffer) {
  await mkdir(archiveDir, { recursive: true, mode: 0o700 });
  await chmod(archiveDir, 0o700);
  const checksum = sha256(bytes);
  const filename = `${sourceKind}-${checksum.slice(0, 16)}-${sanitizedBasename(sourcePath)}`;
  const destination = path.join(archiveDir, filename);
  try {
    const existing = await readFile(destination);
    if (sha256(existing) !== checksum) throw new Error("Archive checksum mismatch");
    await chmod(destination, 0o600);
    return { destination, checksum };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = path.join(archiveDir, `.${filename}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return { destination, checksum };
}

function withSourceMetadata(
  sourceKind: AbbottSourceKind,
  sourcePath: string,
  bytes: Buffer,
  archiveLocator: string,
  options: CliOptions,
  details: Pick<PreparedAbbottSource, "sourceRowCount" | "importedRowCount" | "rejectedRowCount" | "periodMinDate" | "periodMaxDate" | "generatedAt" | "manifest" | "batches">,
): PreparedAbbottSource {
  const manifest = {
    ...details.manifest,
    source_kind: sourceKind,
    content_sha256: sha256(bytes),
    content_bytes: bytes.byteLength,
    parser_version: options.parserVersion,
    code_revision: options.codeRevision,
    basename: sanitizedBasename(sourcePath),
  };
  assertSanitizedEvidence(manifest);
  return {
    sourceKind,
    basename: sanitizedBasename(sourcePath),
    contentSha256: sha256(bytes),
    contentBytes: bytes.byteLength,
    parserVersion: options.parserVersion,
    codeRevision: options.codeRevision,
    archiveLocator,
    ...details,
    manifest,
  };
}

function workbookJsonSource(parsed: ReturnType<typeof parseWorkbookJson>, sourcePath: string, bytes: Buffer, archiveLocator: string, options: CliOptions) {
  const directionRows = parsed.privateUserDirections.map((row) => [row.rawUserId, row.rawUserIdHash, row.normalizedDirection, row.normalizedSpecialization]);
  const materialRows = parsed.generalMaterials.map((row) => [
    row.materialKey,
    row.materialTitle,
    row.materialType,
    row.normalizedUrl,
    sha256(row.normalizedUrl),
    row.normalizedPath,
    sha256(row.normalizedPath),
    row.direction,
    null,
    null,
  ]);
  const eventRows = parsed.eventCatalog.map((row) => [
    row.eventTitle,
    row.direction,
    row.registrationUrl,
    sha256(row.registrationUrl),
    row.access,
    row.fingerprint,
  ]);
  const importedRowCount = directionRows.length + materialRows.length + eventRows.length;
  return withSourceMetadata("abbott_workbook_json", sourcePath, bytes, archiveLocator, options, {
    sourceRowCount: parsed.sourceRowCount,
    importedRowCount,
    rejectedRowCount: parsed.rejectedCount,
    periodMinDate: null,
    periodMaxDate: null,
    generatedAt: null,
    manifest: parsed.manifest,
    batches: [
      {
        table: `${PRIVATE_SCHEMA}.portal_user_directions_private`,
        columns: ["raw_user_id", "raw_user_id_hash", "normalized_direction", "normalized_specialization"],
        rows: directionRows,
        fingerprints: parsed.privateUserDirections.map((row) => canonicalRowFingerprint([row.rawUserId, row.normalizedDirection, row.normalizedSpecialization])),
      },
      {
        table: `${PRIMARY_SCHEMA}.portal_general_materials`,
        columns: ["material_key", "material_title", "material_type", "normalized_url", "normalized_url_hash", "normalized_path", "normalized_path_hash", "direction_key", "published_at", "metadata_json"],
        rows: materialRows,
        fingerprints: parsed.generalMaterials.map((row) => canonicalRowFingerprint([row.materialKey, row.materialTitle, row.normalizedUrl])),
      },
      {
        table: `${PRIMARY_SCHEMA}.portal_event_catalog`,
        columns: ["event_title", "direction_key", "registration_url", "registration_url_hash", "access_label", "source_row_fingerprint"],
        rows: eventRows,
        fingerprints: parsed.eventCatalog.map((row) => row.fingerprint),
        fingerprintColumn: "source_row_fingerprint",
      },
    ],
  });
}

function workbookXlsxSource(parsed: ReturnType<typeof parseWorkbookXlsx>, sourcePath: string, bytes: Buffer, archiveLocator: string, options: CliOptions) {
  const rows = parsed.rows.map((row) => [
    null,
    null,
    null,
    row.pageTitle,
    null,
    row.materialType,
    row.sourceSlug,
    row.sourceSlug ? sha256(row.sourceSlug) : null,
    row.access,
    row.isActive,
    row.fingerprint,
    null,
    row.direction,
    null,
    "1970-01-01 00:00:00",
    null,
  ]);
  return withSourceMetadata("abbott_workbook_catalog", sourcePath, bytes, archiveLocator, options, {
    sourceRowCount: rows.length,
    importedRowCount: rows.length,
    rejectedRowCount: 0,
    periodMinDate: null,
    periodMaxDate: null,
    generatedAt: null,
    manifest: parsed.manifest,
    batches: [{
      table: `${PRIMARY_SCHEMA}.portal_content_catalog`,
      columns: ["normalized_url", "normalized_url_hash", "normalized_path", "page_title", "material_id", "material_type", "source_slug", "source_slug_hash", "access_label", "is_active", "source_row_fingerprint", "section_key", "direction_key", "published_at", "valid_from", "valid_to"],
      rows,
      fingerprints: parsed.rows.map((row) => row.fingerprint),
      fingerprintColumn: "source_row_fingerprint",
    }],
  });
}

function bitrixPageSource(parsed: ReturnType<typeof parseBitrixPagePayload>, sourcePath: string, bytes: Buffer, archiveLocator: string, options: CliOptions, payload: Record<string, unknown>) {
  const rows = parsed.rows.map((row) => [
    "abbott_bitrix", row.reportDate, row.normalizedPath, row.normalizedPathHash, row.materialId,
    row.materialTypeHint, row.pageviews, row.sessions, row.users, row.guests, row.loggedInHits,
    row.anonymousHits, row.loggedInSessions, row.anonymousSessions, row.entrySessions, row.exitSessions,
    row.averageSessionSeconds, row.topUtmSource, row.topUtmMedium, row.topUtmCampaign, row.fingerprint,
  ]);
  return withSourceMetadata("abbott_bitrix_pages", sourcePath, bytes, archiveLocator, options, {
    sourceRowCount: rows.length,
    importedRowCount: rows.length,
    rejectedRowCount: 0,
    periodMinDate: text(parsed.manifest.period_min_date),
    periodMaxDate: text(parsed.manifest.period_max_date),
    generatedAt: text(payload.generated_at) || null,
    manifest: parsed.manifest,
    batches: [
      {
        table: `${PRIVATE_SCHEMA}.portal_bitrix_page_facts`,
        columns: ["analytics_account_id", "report_date", "normalized_path", "normalized_path_hash", "material_id", "material_type_hint", "pageviews", "sessions", "users", "guests", "logged_in_hits", "anonymous_hits", "logged_in_sessions", "anonymous_sessions", "entry_sessions", "exit_sessions", "avg_session_duration_seconds", "top_utm_source", "top_utm_medium", "top_utm_campaign", "source_row_fingerprint"],
        rows,
        fingerprints: parsed.rows.map((row) => String(row.fingerprint)),
        fingerprintColumn: "source_row_fingerprint",
      },
      {
        table: `${PRIMARY_SCHEMA}.portal_bitrix_page_facts`,
        columns: ["analytics_account_id", "report_date", "normalized_path", "normalized_path_hash", "material_id", "material_type_hint", "pageviews", "sessions", "users", "guests", "logged_in_hits", "anonymous_hits", "logged_in_sessions", "anonymous_sessions", "entry_sessions", "exit_sessions", "avg_session_duration_seconds", "top_utm_source", "top_utm_medium", "top_utm_campaign", "source_row_fingerprint"],
        rows,
        fingerprints: parsed.rows.map((row) => String(row.fingerprint)),
        fingerprintColumn: "source_row_fingerprint",
        countsTowardImportedRows: false,
      },
    ],
  });
}

function bitrixJourneySource(parsed: ReturnType<typeof parseBitrixJourneyPayload>, sourcePath: string, bytes: Buffer, archiveLocator: string, options: CliOptions, payload: Record<string, unknown>) {
  const rows = parsed.rows.map((row) => [
    "abbott_bitrix", row.reportDate, row.rawUserId, row.rawUserIdHash, row.protectedVisitId,
    row.protectedVisitIdHash, row.sourceEventId, row.sourceEventId ? sha256(String(row.sourceEventId)) : null,
    row.eventSequence, row.eventAt, row.normalizedPath, row.normalizedPathHash, row.eventKind, row.fingerprint,
  ]);
  const transitions = parsed.transitions.map((row) => [
    "abbott_bitrix", row.reportDate, row.fromPath, row.fromPathHash, row.toPath, row.toPathHash, row.transitionCount,
  ]);
  return withSourceMetadata("abbott_bitrix_journeys", sourcePath, bytes, archiveLocator, options, {
    sourceRowCount: rows.length,
    importedRowCount: rows.length,
    rejectedRowCount: 0,
    periodMinDate: text(parsed.manifest.period_min_date),
    periodMaxDate: text(parsed.manifest.period_max_date),
    generatedAt: text(payload.generated_at) || null,
    manifest: parsed.manifest,
    batches: [
      {
        table: `${PRIVATE_SCHEMA}.portal_bitrix_journeys_private`,
        columns: ["analytics_account_id", "report_date", "raw_user_id", "raw_user_id_hash", "protected_visit_id", "protected_visit_id_hash", "source_event_id", "source_event_id_hash", "event_sequence", "event_at", "normalized_path", "normalized_path_hash", "event_kind", "source_row_fingerprint"],
        rows,
        fingerprints: parsed.rows.map((row) => String(row.fingerprint)),
        fingerprintColumn: "source_row_fingerprint",
      },
      {
        table: `${PRIMARY_SCHEMA}.portal_bitrix_journey_transitions`,
        columns: ["analytics_account_id", "report_date", "from_path", "from_path_hash", "to_path", "to_path_hash", "transition_count"],
        rows: transitions,
        fingerprints: parsed.transitions.map((row) => canonicalRowFingerprint([row.reportDate, row.fromPath, row.toPath])),
        countsTowardImportedRows: false,
      },
    ],
  });
}

export async function prepareAbbottSources(options: CliOptions): Promise<PreparedAbbottSource[]> {
  const specifications: Array<{ kind: AbbottSourceKind; sourcePath: string }> = [
    { kind: "abbott_workbook_json", sourcePath: options.workbookJsonPath },
    { kind: "abbott_workbook_catalog", sourcePath: options.workbookXlsxPath },
  ];
  if (options.bitrixPagesPath) specifications.push({ kind: "abbott_bitrix_pages", sourcePath: options.bitrixPagesPath });
  if (options.bitrixJourneysPath) specifications.push({ kind: "abbott_bitrix_journeys", sourcePath: options.bitrixJourneysPath });
  const prepared: PreparedAbbottSource[] = [];
  for (const specification of specifications) {
    const bytes = await readFile(specification.sourcePath);
    if ((await stat(specification.sourcePath)).isDirectory()) throw new Error("Source path must be a file");
    let parsed: unknown;
    if (specification.kind === "abbott_workbook_json") parsed = parseWorkbookJson(JSON.parse(bytes.toString("utf8")));
    else if (specification.kind === "abbott_workbook_catalog") parsed = parseWorkbookXlsx(bytes);
    else if (specification.kind === "abbott_bitrix_pages") parsed = parseBitrixPagePayload(JSON.parse(bytes.toString("utf8")));
    else parsed = parseBitrixJourneyPayload(JSON.parse(bytes.toString("utf8")));
    const archive = await archiveSource(specification.sourcePath, specification.kind, options.archiveDir, bytes);
    if (specification.kind === "abbott_workbook_json") prepared.push(workbookJsonSource(parsed as ReturnType<typeof parseWorkbookJson>, specification.sourcePath, bytes, archive.destination, options));
    else if (specification.kind === "abbott_workbook_catalog") prepared.push(workbookXlsxSource(parsed as ReturnType<typeof parseWorkbookXlsx>, specification.sourcePath, bytes, archive.destination, options));
    else if (specification.kind === "abbott_bitrix_pages") {
      prepared.push(bitrixPageSource(parsed as ReturnType<typeof parseBitrixPagePayload>, specification.sourcePath, bytes, archive.destination, options, JSON.parse(bytes.toString("utf8")) as Record<string, unknown>));
    } else {
      prepared.push(bitrixJourneySource(parsed as ReturnType<typeof parseBitrixJourneyPayload>, specification.sourcePath, bytes, archive.destination, options, JSON.parse(bytes.toString("utf8")) as Record<string, unknown>));
    }
  }
  return prepared;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required importer environment ${name}`);
  return value;
}

async function main(): Promise<void> {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const sources = await prepareAbbottSources(options);
    const port = Number(requiredEnv("ABBOTT_IMPORT_DB_PORT"));
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid importer database port");
    const connection = await mysql.createConnection({
      host: requiredEnv("ABBOTT_IMPORT_DB_HOST"),
      port,
      user: requiredEnv("ABBOTT_IMPORT_DB_USER"),
      password: requiredEnv("ABBOTT_IMPORT_DB_PASSWORD"),
      database: PRIMARY_SCHEMA,
      charset: "utf8mb4",
      dateStrings: true,
      multipleStatements: false,
    });
    try {
      const result = await runAbbottImportTransaction(connection as unknown as AbbottImportConnection, options.canonicalReleaseId, sources);
      process.stdout.write(`Abbott import committed release=${result.canonicalReleaseId} sources=${sources.length} idempotent=${result.idempotentKinds.length}\n`);
    } finally {
      await connection.end();
    }
  } catch (error) {
    const errorClass = error instanceof Error ? error.constructor.name : "Error";
    process.stderr.write(`Abbott import failed class=${errorClass}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) void main();

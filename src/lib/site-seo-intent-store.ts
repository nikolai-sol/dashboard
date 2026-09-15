import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_TARGET_INTENT_UPLOAD_BYTES,
  parseTargetIntentWorkbook,
  type TargetIntentImportError,
  type TargetIntentImportResult,
  type TargetIntentImportRow,
} from "./site-seo-intent-import";

export type TargetIntentScope = Readonly<{
  siteId: string;
  dashboardId: number;
}>;

export type TargetIntentSqlConnection = {
  execute(sql: string, params?: readonly unknown[]): Promise<unknown>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
};

export type TargetIntentStoreDependencies = Readonly<{
  scope: TargetIntentScope;
  database: { getConnection(): Promise<TargetIntentSqlConnection> };
  snapshots: {
    save(
      bytes: Buffer,
      evidence: Readonly<{ contentSha256: string; sourceIdentityHash: string }>,
    ): Promise<{
      protectedRef: string;
      release(): Promise<void>;
      discard(): Promise<void>;
    }>;
  };
  googleSheets?: {
    fetchSnapshot(normalizedUrl: string): Promise<{ bytes: Buffer | Uint8Array; filename: string }>;
  };
  now?: () => Date;
}>;

export type TargetIntentPreviewInput =
  | Readonly<{ transport: "upload"; filename: string; bytes: Buffer | Uint8Array; actor: string }>
  | Readonly<{ transport: "google_sheet"; sourceUrl: string; actor: string }>;

export type TargetIntentPreviewReceipt = Readonly<{
  previewId: string;
  state: "valid" | "invalid" | "failed";
  sourceTransport: "upload" | "google_sheet";
  sourceIdentity: string;
  sourceIdentityHash: string;
  contentSha256: string;
  filename: string | null;
  worksheet: string | null;
  ruleCount: number;
  duplicateCount: number;
  conflictCount: number;
  rows: readonly TargetIntentImportRow[];
  errors: readonly TargetIntentImportError[];
  importedBy: string;
  createdAt: string;
}>;

export type TargetIntentPublicationReceipt = Readonly<{
  publicationId: string;
  versionId: string;
  previousVersionId: string | null;
  kind: "publish" | "restore";
  label: string;
  publishedBy: string;
  publishedAt: string;
}>;

export type TargetIntentHistoryEntry = Readonly<{
  publicationId: string;
  versionId: string;
  previousVersionId: string | null;
  kind: "publish" | "restore";
  label: string;
  ruleCount: number;
  sourceTransport: "upload" | "google_sheet";
  sourceIdentity: string;
  sourceIdentityHash: string;
  contentSha256: string;
  importId: string;
  publishedBy: string;
  publishedAt: string;
  comment: string | null;
  active: boolean;
}>;

export type TargetIntentAdminState = Readonly<{
  activeVersionId: string | null;
  history: readonly TargetIntentHistoryEntry[];
  previews: readonly TargetIntentPreviewReceipt[];
}>;

type StoredImportRow = {
  id: string | number;
  import_uid?: string;
  source_transport: "upload" | "google_sheet";
  source_identity: string;
  source_identity_hash: string;
  original_filename: string | null;
  accepted_worksheet: string | null;
  protected_artifact_ref?: string;
  content_sha256: string;
  validation_state: "valid" | "invalid" | "failed";
  validation_result_json: string | TargetIntentImportResult;
  rule_count: string | number;
  duplicate_count: string | number;
  conflict_count: string | number;
  imported_by: string;
  created_at: string | Date;
};

function requiredText(value: unknown, field: string, max: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > max) throw new Error(`${field} is too long`);
  return text;
}

function normalizedActor(value: unknown): string {
  return requiredText(value, "actor", 255).toLocaleLowerCase("en-US");
}

function positiveId(value: unknown, field: string): number {
  const text = String(value ?? "").trim();
  if (!/^\d+$/u.test(text)) throw new Error(`${field} must be a positive integer`);
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${field} must be a positive integer`);
  return id;
}

function scopeFrom(deps: TargetIntentStoreDependencies): TargetIntentScope {
  const siteId = requiredText(deps.scope.siteId, "siteId", 96);
  const dashboardId = positiveId(deps.scope.dashboardId, "dashboardId");
  return { siteId, dashboardId };
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableUid(...parts: readonly (string | number | null)[]): string {
  return sha256(parts.map((part) => `${String(part).length}:${String(part)}`).join("|"));
}

function rowsFrom(result: unknown): unknown[] {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : result;
}

function firstRow<T>(result: unknown): T | null {
  const row = rowsFrom(result)[0];
  return row && typeof row === "object" ? row as T : null;
}

function insertId(result: unknown): number {
  const candidate = Array.isArray(result) ? result[0] : result;
  const value = candidate && typeof candidate === "object"
    ? Number((candidate as { insertId?: unknown }).insertId)
    : Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Database insert did not return an id");
  return value;
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid database timestamp");
  return date.toISOString();
}

function sqlTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function parseValidation(value: unknown): TargetIntentImportResult {
  const candidate = typeof value === "string" ? JSON.parse(value) : value;
  if (!candidate || typeof candidate !== "object") throw new Error("Invalid preview validation receipt");
  const parsed = candidate as TargetIntentImportResult;
  if (!Array.isArray(parsed.rows) || !Array.isArray(parsed.errors)) {
    throw new Error("Invalid preview validation receipt");
  }
  return parsed;
}

function previewReceipt(row: StoredImportRow): TargetIntentPreviewReceipt {
  const validation = parseValidation(row.validation_result_json);
  return {
    previewId: String(row.id),
    state: row.validation_state,
    sourceTransport: row.source_transport,
    sourceIdentity: row.source_identity,
    sourceIdentityHash: row.source_identity_hash,
    contentSha256: row.content_sha256,
    filename: row.original_filename,
    worksheet: row.accepted_worksheet,
    ruleCount: Number(row.rule_count),
    duplicateCount: Number(row.duplicate_count),
    conflictCount: Number(row.conflict_count),
    rows: validation.rows,
    errors: validation.errors,
    importedBy: row.imported_by,
    createdAt: isoTimestamp(row.created_at),
  };
}

export function normalizeGoogleSheetsUrl(value: string): string {
  try {
    const url = new URL(value);
    const source = value.match(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/u);
    if (!source) throw new Error("invalid");
    const [, authority, rawPath, query = "", fragment = ""] = source;
    const rawHostname = authority.endsWith(":") ? authority.slice(0, -1) : authority;
    const sheet = rawPath.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/.*)?$/u);
    const gids = [...new URLSearchParams(query), ...new URLSearchParams(fragment)]
      .filter(([key]) => key === "gid")
      .map(([, parameterValue]) => parameterValue);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "docs.google.com" ||
      rawHostname.toLocaleLowerCase("en-US") !== "docs.google.com" ||
      url.username ||
      url.password ||
      authority.includes("@") ||
      (authority.includes(":") && !authority.endsWith(":")) ||
      !sheet ||
      gids.length > 1 ||
      (gids.length === 1 && !/^\d+$/u.test(gids[0]))
    ) throw new Error("invalid");
    const gid = gids.length === 0 ? "0" : gids[0].replace(/^0+/u, "") || "0";
    return `https://docs.google.com/spreadsheets/d/${sheet[1]}#gid=${gid}`;
  } catch {
    throw new Error("source_url must be a Google Sheets URL");
  }
}

export function createFilesystemTargetIntentSnapshotStore(directory: string) {
  const root = path.resolve(requiredText(directory, "SITE_SEO_INTENT_SPOOL_DIR", 4096));
  if (!path.isAbsolute(directory)) {
    throw new Error("SITE_SEO_INTENT_SPOOL_DIR must be an absolute path");
  }
  return {
    async save(
      bytes: Buffer,
      evidence: Readonly<{ contentSha256: string; sourceIdentityHash: string }>,
    ) {
      const expectedHash = requiredText(evidence.contentSha256, "contentSha256", 64).toLocaleLowerCase("en-US");
      if (!/^[a-f0-9]{64}$/u.test(expectedHash) || sha256(bytes) !== expectedHash) {
        throw new Error("Snapshot content hash does not match its protected evidence");
      }
      if (!/^[a-f0-9]{64}$/u.test(requiredText(evidence.sourceIdentityHash, "sourceIdentityHash", 64))) {
        throw new Error("Invalid source identity hash");
      }
      await mkdir(root, { recursive: true, mode: 0o750 });
      const rootMetadata = await lstat(root);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
        throw new Error("Protected snapshot root must be a directory, not a symlink");
      }
      const artifacts = path.join(root, "artifacts");
      await mkdir(artifacts, { recursive: true, mode: 0o750 });
      const artifactMetadata = await lstat(artifacts);
      if (!artifactMetadata.isDirectory() || artifactMetadata.isSymbolicLink()) {
        throw new Error("Protected snapshot artifact path must be a directory, not a symlink");
      }
      const protectedRef = path.join(artifacts, `${expectedHash}.bin`);
      let handle;
      try {
        handle = await open(
          protectedRef,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o640,
        );
        await handle.writeFile(bytes);
        await handle.chmod(0o640);
        await handle.sync();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readFile(protectedRef);
        if (sha256(existing) !== expectedHash) {
          throw new Error("Protected snapshot content-address collision");
        }
      } finally {
        await handle?.close();
      }
      return {
        protectedRef,
        release: async () => {},
        // Content-addressed evidence may already belong to another immutable
        // preview, so duplicate/error cleanup never unlinks the shared blob.
        discard: async () => {},
      };
    },
  };
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createGoogleSheetsSnapshotTransport(fetchImpl: FetchLike = fetch) {
  return {
    async fetchSnapshot(normalizedUrl: string): Promise<{ bytes: Buffer; filename: string }> {
      const identity = normalizeGoogleSheetsUrl(normalizedUrl);
      const parsed = new URL(identity);
      const gid = new URLSearchParams(parsed.hash.slice(1)).get("gid") ?? "0";
      const exportUrl = `https://docs.google.com${parsed.pathname}/export?format=xlsx&gid=${gid}`;
      const response = await fetchImpl(exportUrl, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
      if (!response.ok || !response.body) throw new Error("Google Sheets snapshot request failed");
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_TARGET_INTENT_UPLOAD_BYTES) {
        throw new Error("Google Sheets snapshot exceeds the upload limit");
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_TARGET_INTENT_UPLOAD_BYTES) {
            await reader.cancel();
            throw new Error("Google Sheets snapshot exceeds the upload limit");
          }
          chunks.push(Buffer.from(chunk.value));
        }
      } finally {
        reader.releaseLock();
      }
      if (size === 0) throw new Error("Google Sheets snapshot is empty");
      return { bytes: Buffer.concat(chunks), filename: "target-intent.xlsx" };
    },
  };
}

function importSelectSql(): string {
  return `SELECT id, import_uid, source_transport, source_identity, source_identity_hash,
                 original_filename, accepted_worksheet, protected_artifact_ref, content_sha256,
                 validation_state, validation_result_json, rule_count, duplicate_count,
                 conflict_count, imported_by, created_at
            FROM site_seo_intent_imports
           WHERE site_id = ? AND dashboard_id = ? AND import_uid = ?
           LIMIT 1`;
}

export async function previewTargetIntent(
  input: TargetIntentPreviewInput,
  deps: TargetIntentStoreDependencies,
): Promise<TargetIntentPreviewReceipt> {
  const scope = scopeFrom(deps);
  const actor = normalizedActor(input.actor);
  let sourceIdentity: string;
  let filename: string;
  let bytes: Buffer;
  let sourceFailure = false;
  if (input.transport === "upload") {
    filename = requiredText(input.filename, "filename", 255);
    sourceIdentity = filename;
    bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  } else {
    sourceIdentity = normalizeGoogleSheetsUrl(input.sourceUrl);
    if (!deps.googleSheets) throw new Error("Google Sheets transport is unavailable");
    let snapshot: { bytes: Buffer | Uint8Array; filename: string };
    try {
      snapshot = await deps.googleSheets.fetchSnapshot(sourceIdentity);
    } catch {
      sourceFailure = true;
      snapshot = {
        filename: "target-intent.xlsx",
        bytes: Buffer.from(JSON.stringify({
          schemaVersion: 1,
          sourceIdentityHash: sha256(sourceIdentity),
          outcome: "fetch_failed",
        })),
      };
    }
    filename = requiredText(snapshot.filename, "filename", 255);
    bytes = Buffer.isBuffer(snapshot.bytes) ? snapshot.bytes : Buffer.from(snapshot.bytes);
  }

  const validation: TargetIntentImportResult = sourceFailure
    ? {
        state: "invalid",
        format: "xlsx",
        worksheet: null,
        rows: [],
        errors: [{
          row: null,
          code: "source_unavailable",
          message: "Не удалось получить снимок Google Sheets",
        }],
        duplicateCount: 0,
        conflictCount: 0,
      }
    : parseTargetIntentWorkbook(bytes, filename);
  const contentSha256 = sha256(bytes);
  const sourceIdentityHash = sha256(sourceIdentity);
  const importUid = stableUid(
    "target-intent-preview-v1",
    scope.siteId,
    scope.dashboardId,
    input.transport,
    sourceIdentityHash,
    contentSha256,
  );
  const artifact = await deps.snapshots.save(bytes, { contentSha256, sourceIdentityHash });
  const connection = await deps.database.getConnection();
  try {
    await connection.execute(
      `INSERT INTO site_seo_intent_imports
         (site_id, dashboard_id, import_uid, source_transport, source_identity,
          source_identity_hash, original_filename, accepted_worksheet, protected_artifact_ref,
          content_sha256, validation_state, validation_result_json, rule_count,
          duplicate_count, conflict_count, imported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        scope.siteId,
        scope.dashboardId,
        importUid,
        input.transport,
        sourceIdentity,
        sourceIdentityHash,
        input.transport === "upload" ? filename : null,
        validation.worksheet,
        artifact.protectedRef,
        contentSha256,
        sourceFailure ? "failed" : validation.state,
        JSON.stringify(validation),
        validation.rows.length,
        validation.duplicateCount,
        validation.conflictCount,
        actor,
      ],
    );
    const persisted = firstRow<StoredImportRow>(await connection.execute(
      importSelectSql(),
      [scope.siteId, scope.dashboardId, importUid],
    ));
    if (!persisted) throw new Error("Preview receipt was not persisted");
    if (persisted.protected_artifact_ref === artifact.protectedRef) await artifact.release();
    else await artifact.discard();
    return previewReceipt(persisted);
  } catch (error) {
    try { await artifact.discard(); } catch { /* Preserve the primary failure. */ }
    throw error;
  } finally {
    connection.release();
  }
}

function validPreviewRows(row: {
  validation_state: string;
  validation_result_json: unknown;
  rule_count: unknown;
}): readonly TargetIntentImportRow[] {
  if (row.validation_state !== "valid") throw new Error("Предпросмотр содержит ошибки и не может быть опубликован");
  const validation = parseValidation(row.validation_result_json);
  if (
    validation.state !== "valid" ||
    validation.errors.length !== 0 ||
    validation.rows.length === 0 ||
    validation.rows.length !== Number(row.rule_count)
  ) throw new Error("Предпросмотр содержит ошибки и не может быть опубликован");
  return validation.rows;
}

type ExistingPublicationRow = {
  publication_id: string | number;
  version_id: string | number;
  previous_version_id: string | number | null;
  publication_kind: "publish" | "restore";
  published_by: string;
  published_at: string | Date;
  label: string;
};

function publicationReceipt(row: ExistingPublicationRow): TargetIntentPublicationReceipt {
  return {
    publicationId: String(row.publication_id),
    versionId: String(row.version_id),
    previousVersionId: row.previous_version_id == null ? null : String(row.previous_version_id),
    kind: row.publication_kind,
    label: row.label,
    publishedBy: row.published_by,
    publishedAt: isoTimestamp(row.published_at),
  };
}

async function lockScope(connection: TargetIntentSqlConnection, scope: TargetIntentScope): Promise<void> {
  const dashboard = firstRow<{ id: string | number }>(await connection.execute(
    `SELECT id
       FROM dashboards
      WHERE id = ? AND dashboard_type = 'site_seo'
      LIMIT 1
      FOR UPDATE`,
    [scope.dashboardId],
  ));
  if (!dashboard) throw new Error("Дашборд не найден или не поддерживает целевой интент");
}

async function activeVersionId(connection: TargetIntentSqlConnection, scope: TargetIntentScope): Promise<number | null> {
  const active = firstRow<{ version_id: string | number }>(await connection.execute(
    `SELECT version_id
       FROM site_seo_intent_active
      WHERE site_id = ? AND dashboard_id = ?
      LIMIT 1
      FOR UPDATE`,
    [scope.siteId, scope.dashboardId],
  ));
  return active ? positiveId(active.version_id, "active version id") : null;
}

async function existingPublication(
  connection: TargetIntentSqlConnection,
  scope: TargetIntentScope,
  requestUid: string,
): Promise<TargetIntentPublicationReceipt | null> {
  const existing = firstRow<ExistingPublicationRow>(await connection.execute(
    `SELECT publication.id AS publication_id, publication.version_id,
            publication.previous_version_id, publication.publication_kind,
            publication.published_by, publication.published_at, version.label
       FROM site_seo_intent_publications AS publication
       JOIN site_seo_intent_versions AS version
         ON version.site_id = publication.site_id
        AND version.dashboard_id = publication.dashboard_id
        AND version.id = publication.version_id
      WHERE publication.site_id = ? AND publication.dashboard_id = ?
        AND publication.request_uid = ?
      LIMIT 1
      FOR UPDATE`,
    [scope.siteId, scope.dashboardId, requestUid],
  ));
  return existing ? publicationReceipt(existing) : null;
}

async function writeVersionAndPublication(
  connection: TargetIntentSqlConnection,
  input: Readonly<{
    scope: TargetIntentScope;
    importId: number;
    sourceVersionId: number | null;
    label: string;
    actor: string;
    rows: readonly TargetIntentImportRow[];
    kind: "publish" | "restore";
    requestUid: string;
    now: Date;
    previousVersionId: number | null;
  }>,
): Promise<TargetIntentPublicationReceipt> {
  const versionUid = stableUid("target-intent-version-v1", input.requestUid);
  const versionId = insertId(await connection.execute(
    `INSERT INTO site_seo_intent_versions
       (site_id, dashboard_id, version_uid, import_id, label, rule_count, created_by, version_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.scope.siteId, input.scope.dashboardId, versionUid, input.importId,
      input.label, input.rows.length, input.actor,
      input.sourceVersionId === null ? null : `Restored from version ${input.sourceVersionId}`,
    ],
  ));
  for (const row of input.rows) {
    await connection.execute(
      `INSERT INTO site_seo_intent_rules
         (site_id, dashboard_id, version_id, source_row_ordinal, rule_key,
          normalized_key, group_label, match_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.scope.siteId, input.scope.dashboardId, versionId, row.sourceRowOrdinal,
        row.key, row.normalizedKey, row.group, row.matchType,
      ],
    );
  }
  const publishedAt = sqlTimestamp(input.now);
  await connection.execute(
    `UPDATE site_seo_intent_versions
        SET sealed_by = ?, sealed_at = ?
      WHERE site_id = ? AND dashboard_id = ? AND id = ? AND sealed_at IS NULL`,
    [input.actor, publishedAt, input.scope.siteId, input.scope.dashboardId, versionId],
  );
  const publicationId = insertId(await connection.execute(
    `INSERT INTO site_seo_intent_publications
       (site_id, dashboard_id, request_uid, version_id, previous_version_id, import_id,
        publication_kind, published_by, published_at, publication_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.scope.siteId, input.scope.dashboardId, input.requestUid, versionId,
      input.previousVersionId, input.importId, input.kind, input.actor, publishedAt,
      input.sourceVersionId === null ? null : `Restored from version ${input.sourceVersionId}`,
    ],
  ));
  await connection.execute(
    `INSERT INTO site_seo_intent_active
       (site_id, dashboard_id, version_id, publication_id, activated_by, activated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       version_id = VALUES(version_id), publication_id = VALUES(publication_id),
       activated_by = VALUES(activated_by), activated_at = VALUES(activated_at)`,
    [input.scope.siteId, input.scope.dashboardId, versionId, publicationId, input.actor, publishedAt],
  );
  return {
    publicationId: String(publicationId),
    versionId: String(versionId),
    previousVersionId: input.previousVersionId === null ? null : String(input.previousVersionId),
    kind: input.kind,
    label: input.label,
    publishedBy: input.actor,
    publishedAt: input.now.toISOString(),
  };
}

export async function publishTargetIntent(
  previewId: string | number,
  label: string,
  actorValue: string,
  deps: TargetIntentStoreDependencies,
): Promise<TargetIntentPublicationReceipt> {
  const scope = scopeFrom(deps);
  const importId = positiveId(previewId, "previewId");
  const normalizedLabel = requiredText(label, "label", 191);
  const actor = normalizedActor(actorValue);
  const requestUid = stableUid("target-intent-publish-v1", scope.siteId, scope.dashboardId, importId, normalizedLabel, actor);
  const connection = await deps.database.getConnection();
  try {
    await connection.beginTransaction();
    await lockScope(connection, scope);
    const previousVersionId = await activeVersionId(connection, scope);
    const repeated = await existingPublication(connection, scope, requestUid);
    if (repeated) {
      await connection.commit();
      return repeated;
    }
    const imported = firstRow<{
      id: string | number;
      validation_state: string;
      validation_result_json: unknown;
      rule_count: unknown;
    }>(await connection.execute(
      `SELECT id, validation_state, validation_result_json, rule_count
         FROM site_seo_intent_imports
        WHERE site_id = ? AND dashboard_id = ? AND id = ?
        LIMIT 1
        FOR UPDATE`,
      [scope.siteId, scope.dashboardId, importId],
    ));
    if (!imported) throw new Error("Предпросмотр не найден");
    const rows = validPreviewRows(imported);
    const receipt = await writeVersionAndPublication(connection, {
      scope, importId, sourceVersionId: null, label: normalizedLabel, actor, rows,
      kind: "publish", requestUid, now: deps.now?.() ?? new Date(), previousVersionId,
    });
    await connection.commit();
    return receipt;
  } catch {
    try { await connection.rollback(); } catch { /* Preserve the safe service error. */ }
    throw new Error("Не удалось опубликовать каталог");
  } finally {
    connection.release();
  }
}

export async function restoreTargetIntent(
  versionIdValue: string | number,
  actorValue: string,
  deps: TargetIntentStoreDependencies,
): Promise<TargetIntentPublicationReceipt> {
  const scope = scopeFrom(deps);
  const sourceVersionId = positiveId(versionIdValue, "versionId");
  const actor = normalizedActor(actorValue);
  const requestUid = stableUid("target-intent-restore-v1", scope.siteId, scope.dashboardId, sourceVersionId, actor);
  const connection = await deps.database.getConnection();
  try {
    await connection.beginTransaction();
    await lockScope(connection, scope);
    const previousVersionId = await activeVersionId(connection, scope);
    const repeated = await existingPublication(connection, scope, requestUid);
    if (repeated) {
      await connection.commit();
      return repeated;
    }
    const historical = firstRow<{ id: unknown; import_id: unknown; label: unknown; rule_count: unknown }>(await connection.execute(
      `SELECT version.id, version.import_id, version.label, version.rule_count
         FROM site_seo_intent_versions AS version
        WHERE version.site_id = ? AND version.dashboard_id = ? AND version.id = ?
          AND version.sealed_at IS NOT NULL
        LIMIT 1
        FOR UPDATE`,
      [scope.siteId, scope.dashboardId, sourceVersionId],
    ));
    if (!historical) throw new Error("Историческая версия не найдена");
    const ruleRecords = rowsFrom(await connection.execute(
      `SELECT version.id, version.import_id, version.label, version.rule_count,
              rules.source_row_ordinal, rules.rule_key, rules.normalized_key,
              rules.group_label, rules.match_type
         FROM site_seo_intent_versions AS version
         JOIN site_seo_intent_rules AS rules
           ON rules.site_id = version.site_id
          AND rules.dashboard_id = version.dashboard_id
          AND rules.version_id = version.id
        WHERE version.site_id = ? AND version.dashboard_id = ? AND version.id = ?
        ORDER BY rules.source_row_ordinal`,
      [scope.siteId, scope.dashboardId, sourceVersionId],
    )) as Array<Record<string, unknown>>;
    if (ruleRecords.length !== Number(historical.rule_count) || ruleRecords.length === 0) {
      throw new Error("Историческая версия повреждена");
    }
    const rows: TargetIntentImportRow[] = ruleRecords.map((row) => ({
      sourceRowOrdinal: positiveId(row.source_row_ordinal, "source row ordinal"),
      key: requiredText(row.rule_key, "rule key", 512),
      normalizedKey: requiredText(row.normalized_key, "normalized key", 512),
      group: row.group_label == null ? null : requiredText(row.group_label, "group", 255),
      matchType: row.match_type === "exact" || row.match_type === "phrase" ? row.match_type : (() => { throw new Error("Invalid historical match type"); })(),
    }));
    const receipt = await writeVersionAndPublication(connection, {
      scope,
      importId: positiveId(historical.import_id, "importId"),
      sourceVersionId,
      label: requiredText(historical.label, "label", 191),
      actor,
      rows,
      kind: "restore",
      requestUid,
      now: deps.now?.() ?? new Date(),
      previousVersionId,
    });
    await connection.commit();
    return receipt;
  } catch {
    try { await connection.rollback(); } catch { /* Preserve the safe service error. */ }
    throw new Error("Не удалось восстановить каталог");
  } finally {
    connection.release();
  }
}

export async function restorePublishedTargetIntent(
  publicationIdValue: string | number,
  actorValue: string,
  deps: TargetIntentStoreDependencies,
): Promise<TargetIntentPublicationReceipt> {
  const scope = scopeFrom(deps);
  const publicationId = positiveId(publicationIdValue, "publicationId");
  const connection = await deps.database.getConnection();
  let versionId: string;
  try {
    const publication = firstRow<{ version_id: string | number }>(await connection.execute(
      `SELECT publication.version_id
         FROM site_seo_intent_publications AS publication
        WHERE publication.site_id = ? AND publication.dashboard_id = ?
          AND publication.id = ?
        LIMIT 1`,
      [scope.siteId, scope.dashboardId, publicationId],
    ));
    if (!publication) throw new Error("Историческая публикация не найдена");
    versionId = String(publication.version_id);
  } finally {
    connection.release();
  }
  return restoreTargetIntent(versionId, actorValue, deps);
}

export async function readTargetIntentState(
  deps: TargetIntentStoreDependencies,
): Promise<TargetIntentAdminState> {
  const scope = scopeFrom(deps);
  const connection = await deps.database.getConnection();
  try {
    const active = firstRow<{ version_id: string | number }>(await connection.execute(
      `SELECT version_id
         FROM site_seo_intent_active
        WHERE site_id = ? AND dashboard_id = ?
        LIMIT 1`,
      [scope.siteId, scope.dashboardId],
    ));
    const activeId = active ? String(active.version_id) : null;
    const historyRows = rowsFrom(await connection.execute(
      `SELECT publication.id AS publication_id, publication.version_id,
              publication.previous_version_id, publication.publication_kind,
              publication.published_by, publication.published_at,
              publication.publication_comment, version.label, version.rule_count,
              imported.source_transport, imported.source_identity,
              imported.source_identity_hash, imported.content_sha256,
              imported.id AS import_id
         FROM site_seo_intent_publications AS publication
         JOIN site_seo_intent_versions AS version
           ON version.site_id = publication.site_id
          AND version.dashboard_id = publication.dashboard_id
          AND version.id = publication.version_id
         JOIN site_seo_intent_imports AS imported
           ON imported.site_id = version.site_id
          AND imported.dashboard_id = version.dashboard_id
          AND imported.id = version.import_id
        WHERE publication.site_id = ? AND publication.dashboard_id = ?
        ORDER BY publication.published_at DESC, publication.id DESC`,
      [scope.siteId, scope.dashboardId],
    )) as Array<Record<string, unknown>>;
    const previewRows = rowsFrom(await connection.execute(
      `SELECT id, import_uid, source_transport, source_identity, source_identity_hash,
              original_filename, accepted_worksheet, content_sha256, validation_state,
              validation_result_json, rule_count, duplicate_count, conflict_count,
              imported_by, created_at
         FROM site_seo_intent_imports AS imported
        WHERE imported.site_id = ? AND imported.dashboard_id = ?
        ORDER BY imported.created_at DESC, imported.id DESC
        LIMIT 50`,
      [scope.siteId, scope.dashboardId],
    )) as StoredImportRow[];
    return {
      activeVersionId: activeId,
      history: historyRows.map((row) => ({
        publicationId: String(row.publication_id),
        versionId: String(row.version_id),
        previousVersionId: row.previous_version_id == null ? null : String(row.previous_version_id),
        kind: row.publication_kind === "restore" ? "restore" : "publish",
        label: String(row.label),
        ruleCount: Number(row.rule_count),
        sourceTransport: row.source_transport === "google_sheet" ? "google_sheet" : "upload",
        sourceIdentity: String(row.source_identity),
        sourceIdentityHash: String(row.source_identity_hash),
        contentSha256: String(row.content_sha256),
        importId: String(row.import_id),
        publishedBy: String(row.published_by),
        publishedAt: isoTimestamp(row.published_at),
        comment: row.publication_comment == null ? null : String(row.publication_comment),
        active: String(row.version_id) === activeId,
      })),
      previews: previewRows.map(previewReceipt),
    };
  } finally {
    connection.release();
  }
}

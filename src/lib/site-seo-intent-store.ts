import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
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
  clientId: string;
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

export class TargetIntentServiceError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "TargetIntentServiceError";
  }
}

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
  const clientId = requiredText(deps.scope.clientId, "clientId", 255);
  const dashboardId = positiveId(deps.scope.dashboardId, "dashboardId");
  return { siteId, clientId, dashboardId };
}

function operationId(value: unknown): string {
  const id = requiredText(value, "operationId", 36).toLocaleLowerCase("en-US");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) {
    throw new Error("operationId must be a UUID");
  }
  return id;
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
  const configured = requiredText(directory, "SITE_SEO_INTENT_SPOOL_DIR", 4096);
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
      const { absolute } = configuredProtectedSpoolPath(configured);
      const root = await protectedDirectory(configured, true);
      let artifacts: ProtectedDirectory | null = null;
      let temporary: string | null = null;
      let target: string | null = null;
      let filename: string | null = null;
      try {
        artifacts = await openProtectedChild(root, "artifacts", true);
        const anchoredArtifacts = descriptorPath(artifacts.handle);
        filename = `${randomUUID()}.bin`;
        target = path.join(anchoredArtifacts, filename);
        temporary = path.join(anchoredArtifacts, `.${randomUUID()}.tmp`);
        const file = await open(temporary, FILE_CREATE_FLAGS, 0o640);
        try {
          await file.writeFile(bytes);
          await file.chmod(0o640);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, target);
        temporary = null;
        await artifacts.handle.sync();
        const protectedRef = path.join(absolute, "artifacts", filename);
        const retainedArtifacts = artifacts.handle;
        artifacts = null;
        return {
          protectedRef,
          release: () => retainedArtifacts.close(),
          discard: () => removeProtectedArtifact(retainedArtifacts, filename!),
        };
      } catch (error) {
        if (temporary) await rm(temporary, { force: true });
        if (target) await rm(target, { force: true });
        throw error;
      } finally {
        if (artifacts) await artifacts.handle.close();
        await root.handle.close();
      }
    },
  };
}

const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

type ProtectedDirectory = { handle: FileHandle };

function requireDescriptorAnchoredWrites(): void {
  if (process.platform !== "linux") {
    throw new Error("Protected spool descriptor-anchored writes are only supported on Linux");
  }
}

function descriptorPath(handle: FileHandle): string {
  requireDescriptorAnchoredWrites();
  return path.join("/proc/self/fd", String(handle.fd));
}

function configuredProtectedSpoolPath(directory: string): { absolute: string; components: string[] } {
  if (!path.isAbsolute(directory)) {
    throw new Error("SITE_SEO_INTENT_SPOOL_DIR must be an absolute path");
  }
  const parsed = path.parse(directory);
  const components = directory.slice(parsed.root.length).split(path.sep).filter(Boolean);
  if (components.some((component) => component === "." || component === "..")) {
    throw new Error("Protected spool path may not contain traversal components");
  }
  return { absolute: path.join(parsed.root, ...components), components };
}

function protectedSpoolError(entry: string, error: unknown): Error | null {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ELOOP") return new Error(`Protected spool path may not contain symlinks: ${entry}`);
  if (code === "ENOTDIR") return new Error(`Protected spool path must be a directory: ${entry}`);
  return null;
}

async function openNoFollowDirectory(entry: string): Promise<FileHandle> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(entry, DIRECTORY_OPEN_FLAGS);
    const metadata = await handle.stat();
    if (!metadata.isDirectory()) throw new Error(`Protected spool path must be a directory: ${entry}`);
    return handle;
  } catch (error) {
    await handle?.close();
    const safeError = protectedSpoolError(entry, error);
    if (safeError) throw safeError;
    throw error;
  }
}

async function openProtectedChild(parent: ProtectedDirectory, name: string, create: boolean): Promise<ProtectedDirectory> {
  const anchored = path.join(descriptorPath(parent.handle), name);
  try {
    return { handle: await openNoFollowDirectory(anchored) };
  } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await mkdir(anchored, { mode: 0o750 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return { handle: await openNoFollowDirectory(anchored) };
}

async function protectedDirectory(directory: string, create: boolean): Promise<ProtectedDirectory> {
  requireDescriptorAnchoredWrites();
  const { absolute, components } = configuredProtectedSpoolPath(directory);
  const parsed = path.parse(absolute);
  let current: ProtectedDirectory = { handle: await openNoFollowDirectory(parsed.root) };
  try {
    for (const component of components) {
      const child = await openProtectedChild(current, component, create);
      await current.handle.close();
      current = child;
    }
    await current.handle.chmod(0o750);
    return current;
  } catch (error) {
    await current.handle.close();
    throw error;
  }
}

async function removeProtectedArtifact(directory: FileHandle, filename: string): Promise<void> {
  let failed = false;
  let failure: unknown;
  try {
    await rm(path.join(descriptorPath(directory), filename), { force: true });
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try {
      await directory.close();
    } catch (closeError) {
      if (!failed) throw closeError;
    }
  }
  if (failed) throw failure;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function cancelAndReleaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel()
      .catch(() => undefined)
      .finally(() => {
        try { reader.releaseLock(); } catch { /* The response owns final stream cleanup. */ }
      });
  } catch {
    try { reader.releaseLock(); } catch { /* The response owns final stream cleanup. */ }
  }
}

export function createGoogleSheetsSnapshotTransport(
  fetchImpl: FetchLike = fetch,
  options: Readonly<{ timeoutMs?: number }> = {},
) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new Error("Google Sheets timeout must be between 1 and 60000 milliseconds");
  }
  return {
    async fetchSnapshot(normalizedUrl: string): Promise<{ bytes: Buffer; filename: string }> {
      const identity = normalizeGoogleSheetsUrl(normalizedUrl);
      const parsed = new URL(identity);
      const gid = new URLSearchParams(parsed.hash.slice(1)).get("gid") ?? "0";
      const exportUrl = `https://docs.google.com${parsed.pathname}/export?format=xlsx&gid=${gid}`;
      const abort = new AbortController();
      let timedOut = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let rejectDeadline: ((error: Error) => void) | null = null;
      const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
      const timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
        rejectDeadline?.(new Error("Google Sheets snapshot request timed out"));
      }, timeoutMs);
      try {
        const response = await Promise.race([
          fetchImpl(exportUrl, {
            method: "GET",
            redirect: "error",
            credentials: "omit",
            signal: abort.signal,
            headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          }),
          deadline,
        ]);
        if (!response.ok || !response.body) throw new Error("Google Sheets snapshot request failed");
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_TARGET_INTENT_UPLOAD_BYTES) {
          throw new Error("Google Sheets snapshot exceeds the upload limit");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        reader = response.body.getReader();
        while (true) {
          const chunk = await Promise.race([reader.read(), deadline]);
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_TARGET_INTENT_UPLOAD_BYTES) {
            const oversizedReader = reader;
            reader = null;
            cancelAndReleaseReader(oversizedReader);
            throw new Error("Google Sheets snapshot exceeds the upload limit");
          }
          chunks.push(Buffer.from(chunk.value));
        }
        if (size === 0) throw new Error("Google Sheets snapshot is empty");
        return { bytes: Buffer.concat(chunks), filename: "target-intent.xlsx" };
      } catch (error) {
        abort.abort();
        if (reader) {
          const failedReader = reader;
          reader = null;
          cancelAndReleaseReader(failedReader);
        }
        if (timedOut) throw new Error("Google Sheets snapshot request timed out");
        throw error;
      } finally {
        clearTimeout(timer);
        reader?.releaseLock();
      }
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
  let connection: TargetIntentSqlConnection | null = null;
  let transactionStarted = false;
  let committed = false;
  let artifactReferenced = false;
  let artifactSettled = false;
  try {
    connection = await deps.database.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    try {
      await connection.execute(
        `INSERT INTO site_seo_intent_imports
           (site_id, dashboard_id, import_uid, source_transport, source_identity,
            source_identity_hash, original_filename, accepted_worksheet, protected_artifact_ref,
            content_sha256, validation_state, validation_result_json, rule_count,
            duplicate_count, conflict_count, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ER_DUP_ENTRY") throw error;
    }
    const persisted = firstRow<StoredImportRow>(await connection.execute(
      importSelectSql(),
      [scope.siteId, scope.dashboardId, importUid],
    ));
    if (!persisted) throw new Error("Preview receipt was not persisted");
    artifactReferenced = persisted.protected_artifact_ref === artifact.protectedRef;
    await connection.commit();
    committed = true;
    artifactSettled = true;
    if (artifactReferenced) await artifact.release();
    else await artifact.discard();
    return previewReceipt(persisted);
  } catch (error) {
    if (connection && transactionStarted && !committed) {
      try { await connection.rollback(); } catch { /* Preserve the primary failure. */ }
    }
    if (!artifactSettled) {
      try {
        if (committed && artifactReferenced) await artifact.release();
        else await artifact.discard();
      } catch { /* Preserve the primary failure. */ }
    }
    throw error;
  } finally {
    connection?.release();
  }
}

function validPreviewRows(row: {
  validation_state: string;
  validation_result_json: unknown;
  rule_count: unknown;
}): readonly TargetIntentImportRow[] {
  try {
    if (row.validation_state !== "valid") throw new Error("invalid state");
    const validation = parseValidation(row.validation_result_json);
    if (
      validation.state !== "valid" ||
      validation.errors.length !== 0 ||
      validation.rows.length === 0 ||
      validation.rows.length !== Number(row.rule_count)
    ) throw new Error("invalid validation receipt");
    return validation.rows;
  } catch {
    throw new TargetIntentServiceError(422, "Предпросмотр содержит ошибки и не может быть опубликован");
  }
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
  const dashboard = firstRow<{ id: string | number; client_id: string }>(await connection.execute(
    `SELECT id, client_id
       FROM dashboards
      WHERE id = ? AND client_id = ? AND dashboard_type = 'site_seo' AND is_active = TRUE
      LIMIT 1
      FOR UPDATE`,
    [scope.dashboardId, scope.clientId],
  ));
  if (!dashboard) throw new TargetIntentServiceError(409, "Область дашборда изменилась");
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
  operationIdValue: string,
): Promise<TargetIntentPublicationReceipt> {
  const scope = scopeFrom(deps);
  const importId = positiveId(previewId, "previewId");
  const normalizedLabel = requiredText(label, "label", 191);
  const actor = normalizedActor(actorValue);
  const requestUid = stableUid(
    "target-intent-publish-v2",
    scope.siteId,
    scope.dashboardId,
    operationId(operationIdValue),
    importId,
    normalizedLabel,
  );
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
    if (!imported) throw new TargetIntentServiceError(404, "Предпросмотр не найден");
    const rows = validPreviewRows(imported);
    const receipt = await writeVersionAndPublication(connection, {
      scope, importId, sourceVersionId: null, label: normalizedLabel, actor, rows,
      kind: "publish", requestUid, now: deps.now?.() ?? new Date(), previousVersionId,
    });
    await connection.commit();
    return receipt;
  } catch (error) {
    try { await connection.rollback(); } catch { /* Preserve the safe service error. */ }
    if (error instanceof TargetIntentServiceError) throw error;
    throw new Error("Не удалось опубликовать каталог");
  } finally {
    connection.release();
  }
}

export async function restoreTargetIntent(
  versionIdValue: string | number,
  actorValue: string,
  deps: TargetIntentStoreDependencies,
  operationIdValue: string,
): Promise<TargetIntentPublicationReceipt> {
  const scope = scopeFrom(deps);
  const sourceVersionId = positiveId(versionIdValue, "versionId");
  const actor = normalizedActor(actorValue);
  const requestUid = stableUid(
    "target-intent-restore-v2",
    scope.siteId,
    scope.dashboardId,
    operationId(operationIdValue),
    sourceVersionId,
  );
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
    if (!historical) throw new TargetIntentServiceError(404, "Историческая версия не найдена");
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
      throw new TargetIntentServiceError(409, "Историческая версия повреждена");
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
  } catch (error) {
    try { await connection.rollback(); } catch { /* Preserve the safe service error. */ }
    if (error instanceof TargetIntentServiceError) throw error;
    throw new Error("Не удалось восстановить каталог");
  } finally {
    connection.release();
  }
}

export async function restorePublishedTargetIntent(
  publicationIdValue: string | number,
  actorValue: string,
  deps: TargetIntentStoreDependencies,
  operationIdValue: string,
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
    if (!publication) throw new TargetIntentServiceError(404, "Историческая публикация не найдена");
    versionId = String(publication.version_id);
  } finally {
    connection.release();
  }
  return restoreTargetIntent(versionId, actorValue, deps, operationIdValue);
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

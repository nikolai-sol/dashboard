import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

export const MAX_IMPORT_UPLOAD_BYTES = 20 * 1024 * 1024;

type ImportSqlValue = string | number | boolean | null | Buffer;
type ImportStatus = "pending" | "processing" | "retryable" | "published" | "rejected" | "failed";

type ImportConnection = {
  execute(sql: string, params?: ImportSqlValue[]): Promise<unknown>;
};

export type CanonicalImportInput = {
  advertiserKey: string;
  sourceKey: string;
  platformAccountId: string;
  transport: "upload" | "google_sheet";
  upload?: {
    filename: string;
    contentBase64: string;
  };
  sourceUrl?: string;
  sheetSnapshotKey?: string;
  adapterConfig: Record<string, unknown>;
};

export type EnqueueCanonicalImportOptions = {
  spoolDir?: string;
  requestedBy?: string | null;
};

export type EnqueuedCanonicalImport = {
  requestId: number;
  status: ImportStatus;
  contentSha256: string | null;
  protectedRef: string | null;
  discardCreatedArtifact: () => Promise<void>;
};

type PersistedRequest = {
  id: number | string;
  status: ImportStatus;
  content_sha256: string | null;
  protected_ref: string | null;
};

function requiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function decodeUpload(contentBase64: string): Buffer {
  const encoded = contentBase64.trim();
  const maxEncodedLength = 4 * Math.ceil(MAX_IMPORT_UPLOAD_BYTES / 3);
  if (!encoded || encoded.length % 4 !== 0 || encoded.length > maxEncodedLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Upload content must be valid base64 within the upload limit");
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedLength = (encoded.length / 4) * 3 - padding;
  if (decodedLength === 0 || decodedLength > MAX_IMPORT_UPLOAD_BYTES) {
    throw new Error(`Upload must be between 1 byte and ${MAX_IMPORT_UPLOAD_BYTES} bytes`);
  }
  const data = Buffer.from(encoded, "base64");
  if (data.length !== decodedLength || data.toString("base64") !== encoded) {
    throw new Error("Upload content must be canonical base64");
  }
  return data;
}

function googleSheetExportUrl(value: string): string {
  try {
    const url = new URL(value);
    const authority = value.match(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\/([^/?#]*)/)?.[1];
    const sheet = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/.*)?$/);
    const gid = new URLSearchParams(url.hash.replace(/^#/, "")).get("gid") ?? url.searchParams.get("gid");
    if (
      url.protocol !== "https:"
      || authority !== "docs.google.com"
      || !sheet
      || !gid
      || !/^\d+$/.test(gid)
    ) {
      throw new Error("source_url must be a Google Sheets URL");
    }
    return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv&gid=${gid}`;
  } catch {
    throw new Error("source_url must be a Google Sheets URL");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

type ProtectedDirectory = {
  path: string;
  handle: FileHandle;
};

function descriptorPath(handle: FileHandle): string | null {
  return process.platform === "linux" ? path.join("/proc/self/fd", String(handle.fd)) : null;
}

async function assertOriginalDirectory(entry: string): Promise<boolean> {
  try {
    const metadata = await lstat(entry);
    if (metadata.isSymbolicLink()) throw new Error(`Protected spool path may not contain symlinks: ${entry}`);
    if (!metadata.isDirectory()) throw new Error(`Protected spool path must be a directory: ${entry}`);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function openProtectedChild(parent: ProtectedDirectory, name: string): Promise<ProtectedDirectory> {
  const anchoredPath = path.join(descriptorPath(parent.handle) ?? parent.path, name);
  if (!await assertOriginalDirectory(anchoredPath)) {
    await mkdir(anchoredPath, { mode: 0o750 });
    await assertOriginalDirectory(anchoredPath);
  }

  const handle = await open(anchoredPath, DIRECTORY_OPEN_FLAGS);
  try {
    const metadata = await handle.stat();
    if (!metadata.isDirectory()) throw new Error(`Protected spool path must be a directory: ${anchoredPath}`);
    return { path: path.join(parent.path, name), handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function protectedDirectory(directory: string): Promise<ProtectedDirectory> {
  const absolute = path.resolve(directory);
  if (!await assertOriginalDirectory(absolute)) {
    await mkdir(absolute, { recursive: true, mode: 0o750 });
    await assertOriginalDirectory(absolute);
  }

  const handle = await open(absolute, DIRECTORY_OPEN_FLAGS);
  try {
    const metadata = await handle.stat();
    if (!metadata.isDirectory()) throw new Error(`Protected spool path must be a directory: ${absolute}`);
    await handle.chmod(0o750);
    return { path: absolute, handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function writeProtectedArtifact(spoolDir: string, data: Buffer): Promise<string> {
  const root = await protectedDirectory(spoolDir);
  let uploads: ProtectedDirectory | null = null;
  let target: string | null = null;
  let temporary: string | null = null;

  try {
    uploads = await openProtectedChild(root, "uploads");
    const filename = `${randomUUID()}.bin`;
    const uploadsPath = descriptorPath(uploads.handle) ?? uploads.path;
    target = path.join(uploadsPath, filename);
    temporary = path.join(uploadsPath, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, FILE_CREATE_FLAGS, 0o640);
    try {
      await handle.writeFile(data);
      await handle.chmod(0o640);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    await uploads.handle.sync();
    return path.join(uploads.path, filename);
  } catch (error) {
    if (temporary) await rm(temporary, { force: true });
    if (target) await rm(target, { force: true });
    throw error;
  } finally {
    if (uploads) await uploads.handle.close();
    await root.handle.close();
  }
}

function firstRow(result: unknown): PersistedRequest | null {
  if (!Array.isArray(result)) return null;
  const rows = Array.isArray(result[0]) ? result[0] : result;
  const row = rows[0];
  return row && typeof row === "object" ? row as PersistedRequest : null;
}

export async function enqueueCanonicalImport(
  conn: ImportConnection,
  input: CanonicalImportInput,
  options: EnqueueCanonicalImportOptions = {},
): Promise<EnqueuedCanonicalImport> {
  const advertiserKey = requiredText(input.advertiserKey, "advertiser_key");
  const sourceKey = requiredText(input.sourceKey, "source_key");
  const platformAccountId = requiredText(input.platformAccountId, "platform_account_id");
  const adapterConfigVersion = requiredText(input.adapterConfig.adapter_config_version, "adapter_config_version");
  if (input.adapterConfig.source_key !== sourceKey || input.adapterConfig.platform_account_id !== platformAccountId) {
    throw new Error("adapter_config must match the reviewed source account");
  }

  let createdArtifactRef: string | null = null;
  const discardCreatedArtifact = async () => {
    if (!createdArtifactRef) return;
    const artifact = createdArtifactRef;
    createdArtifactRef = null;
    await rm(artifact, { force: true });
  };

  let protectedRef: string | null = null;
  let sourceUrl: string | null = null;
  let originalName: string | null = null;
  let contentSha256: string | null = null;
  let sheetSnapshotKey: string | null = null;

  try {
    if (input.transport === "upload") {
      if (!input.upload) throw new Error("upload is required for upload transport");
      const content = decodeUpload(input.upload.contentBase64);
      const spoolDir = requiredText(options.spoolDir ?? process.env.AD_IMPORT_SPOOL_DIR, "AD_IMPORT_SPOOL_DIR");
      protectedRef = await writeProtectedArtifact(spoolDir, content);
      createdArtifactRef = protectedRef;
      originalName = requiredText(input.upload.filename, "upload filename").slice(0, 255);
      contentSha256 = createHash("sha256").update(content).digest("hex");
    } else {
      sourceUrl = googleSheetExportUrl(requiredText(input.sourceUrl, "source_url"));
      sheetSnapshotKey = requiredText(input.sheetSnapshotKey, "sheet_snapshot_key").toLowerCase();
      if (!isUuid(sheetSnapshotKey)) throw new Error("sheet_snapshot_key must be a UUID");
    }

    await conn.execute(
      `INSERT INTO canonical_ad_import_requests
         (advertiser_key, source_key, platform_account_id, transport, protected_ref, source_url, original_name,
          content_sha256, sheet_snapshot_key, adapter_config, adapter_config_version, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        advertiserKey,
        sourceKey,
        platformAccountId,
        input.transport,
        protectedRef,
        sourceUrl,
        originalName,
        contentSha256,
        sheetSnapshotKey,
        JSON.stringify(input.adapterConfig),
        adapterConfigVersion,
        options.requestedBy?.trim() || null,
      ],
    );
    const persisted = firstRow(await conn.execute(
      `SELECT id, status, content_sha256, protected_ref
         FROM canonical_ad_import_requests
        WHERE id = LAST_INSERT_ID()`,
    ));
    if (!persisted) throw new Error("Canonical import request was not persisted");

    if (createdArtifactRef && persisted.protected_ref !== createdArtifactRef) await discardCreatedArtifact();
    return {
      requestId: Number(persisted.id),
      status: persisted.status,
      contentSha256: persisted.content_sha256,
      protectedRef: persisted.protected_ref,
      discardCreatedArtifact,
    };
  } catch (error) {
    await discardCreatedArtifact();
    throw error;
  }
}

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
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

function normalizeGoogleSheetUrl(value: string): string {
  try {
    const url = new URL(value);
    const source = value.match(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/);
    if (!source) throw new Error("source_url must be a Google Sheets URL");
    const [, authority, rawPath, query = "", fragment = ""] = source;
    const sheet = rawPath.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/.*)?/);
    const gid = [...new URLSearchParams(query), ...new URLSearchParams(fragment)]
      .filter(([key]) => key === "gid")
      .map(([, parameterValue]) => parameterValue);
    if (
      url.protocol !== "https:"
      || url.hostname !== "docs.google.com"
      || url.username
      || url.password
      || authority.includes("@")
      || (authority.includes(":") && !authority.endsWith(":"))
      || !sheet
      || gid.length > 1
      || (gid.length === 1 && !/^\d+$/.test(gid[0]))
    ) {
      throw new Error("source_url must be a Google Sheets URL");
    }
    return `https://docs.google.com/spreadsheets/d/${sheet[1]}#gid=${gid.length === 0 ? "0" : gid[0].replace(/^0+/, "") || "0"}`;
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
  handle: FileHandle;
};

type CreatedArtifact = {
  protectedRef: string;
  discard: () => Promise<void>;
};

function requireDescriptorAnchoredWrites(): void {
  if (process.platform !== "linux") {
    throw new Error("Protected spool descriptor-anchored writes are only supported on Linux");
  }
}

function descriptorPath(handle: FileHandle): string {
  requireDescriptorAnchoredWrites();
  return path.join("/proc/self/fd", String(handle.fd));
}

function protectedSpoolError(entry: string, error: unknown): Error | null {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ELOOP") return new Error(`Protected spool path may not contain symlinks: ${entry}`);
  if (code === "ENOTDIR") return new Error(`Protected spool path must be a directory: ${entry}`);
  return null;
}

function configuredSpoolPath(directory: string): { absolute: string; components: string[] } {
  if (!path.isAbsolute(directory)) {
    throw new Error("AD_IMPORT_SPOOL_DIR must be an absolute path");
  }
  const parsed = path.parse(directory);
  const components = directory.slice(parsed.root.length).split(path.sep).filter(Boolean);
  if (components.some((component) => component === "." || component === "..")) {
    throw new Error("Protected spool path may not contain traversal components");
  }
  return { absolute: path.join(parsed.root, ...components), components };
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
    const protectedError = protectedSpoolError(entry, error);
    if (protectedError) throw protectedError;
    throw error;
  }
}

async function openProtectedChild(parent: ProtectedDirectory, name: string, create: boolean): Promise<ProtectedDirectory> {
  const anchoredPath = path.join(descriptorPath(parent.handle), name);
  try {
    return { handle: await openNoFollowDirectory(anchoredPath) };
  } catch (error: unknown) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await mkdir(anchoredPath, { mode: 0o750 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return { handle: await openNoFollowDirectory(anchoredPath) };
}

async function protectedDirectory(directory: string, create: boolean): Promise<ProtectedDirectory> {
  requireDescriptorAnchoredWrites();
  const { absolute, components } = configuredSpoolPath(directory);
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

async function removeProtectedArtifact(spoolDir: string, filename: string): Promise<void> {
  const root = await protectedDirectory(spoolDir, false);
  let uploads: ProtectedDirectory | null = null;
  try {
    uploads = await openProtectedChild(root, "uploads", false);
    await rm(path.join(descriptorPath(uploads.handle), filename), { force: true });
  } finally {
    if (uploads) await uploads.handle.close();
    await root.handle.close();
  }
}

async function writeProtectedArtifact(spoolDir: string, data: Buffer): Promise<CreatedArtifact> {
  const { absolute } = configuredSpoolPath(spoolDir);
  const root = await protectedDirectory(spoolDir, true);
  let uploads: ProtectedDirectory | null = null;
  let target: string | null = null;
  let temporary: string | null = null;
  let filename: string | null = null;

  try {
    uploads = await openProtectedChild(root, "uploads", true);
    filename = `${randomUUID()}.bin`;
    const uploadsPath = descriptorPath(uploads.handle);
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
    const protectedRef = path.join(absolute, "uploads", filename);
    return {
      protectedRef,
      discard: () => removeProtectedArtifact(spoolDir, filename!),
    };
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

  let createdArtifact: CreatedArtifact | null = null;
  const discardCreatedArtifact = async () => {
    if (!createdArtifact) return;
    const artifact = createdArtifact;
    createdArtifact = null;
    await artifact.discard();
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
      createdArtifact = await writeProtectedArtifact(spoolDir, content);
      protectedRef = createdArtifact.protectedRef;
      originalName = requiredText(input.upload.filename, "upload filename").slice(0, 255);
      contentSha256 = createHash("sha256").update(content).digest("hex");
    } else {
      sourceUrl = normalizeGoogleSheetUrl(requiredText(input.sourceUrl, "source_url"));
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

    if (createdArtifact && persisted.protected_ref !== createdArtifact.protectedRef) await discardCreatedArtifact();
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

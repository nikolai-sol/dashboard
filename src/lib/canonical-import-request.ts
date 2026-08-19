import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

export const MAX_IMPORT_UPLOAD_BYTES = 20 * 1024 * 1024;

type ImportSqlValue = string | number | boolean | null | Buffer;

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
  reviewedContent?: Buffer;
  adapterConfig: Record<string, unknown>;
};

export type EnqueueCanonicalImportOptions = {
  spoolDir?: string;
  requestedBy?: string | null;
};

export type EnqueuedCanonicalImport = {
  requestId: number;
  status: "pending";
  contentSha256: string;
  protectedRef: string | null;
};

function requiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function decodeUpload(contentBase64: string): Buffer {
  const encoded = contentBase64.trim();
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Upload content must be valid base64");
  }
  const data = Buffer.from(encoded, "base64");
  if (data.toString("base64") !== encoded) {
    throw new Error("Upload content must be canonical base64");
  }
  if (data.length === 0 || data.length > MAX_IMPORT_UPLOAD_BYTES) {
    throw new Error(`Upload must be between 1 byte and ${MAX_IMPORT_UPLOAD_BYTES} bytes`);
  }
  return data;
}

function isGoogleSheetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "docs.google.com" && /^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

export function googleSheetExportUrl(value: string): string {
  if (!isGoogleSheetUrl(value)) throw new Error("source_url must be a Google Sheets URL");
  const url = new URL(value);
  const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
  const sheetId = match?.[1];
  if (!sheetId) throw new Error("source_url must include a Google Sheet id");
  const gid = new URLSearchParams(url.hash.replace(/^#/, "")).get("gid") ?? url.searchParams.get("gid") ?? "0";
  if (!/^\d+$/.test(gid)) throw new Error("source_url must include a numeric Google Sheet gid");
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeProtectedArtifact(spoolDir: string, data: Buffer): Promise<string> {
  const root = path.resolve(spoolDir);
  const uploadsDir = path.join(root, "uploads");
  await mkdir(uploadsDir, { recursive: true, mode: 0o750 });
  await chmod(root, 0o750);
  await chmod(uploadsDir, 0o750);

  const target = path.join(uploadsDir, `${randomUUID()}.bin`);
  const temporary = path.join(uploadsDir, `.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o640);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporary, target);
    await chmod(target, 0o640);
    await fsyncDirectory(uploadsDir);
    return target;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
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

  let protectedRef: string | null = null;
  let sourceUrl: string | null = null;
  let originalName: string | null = null;
  let content: Buffer;

  if (input.transport === "upload") {
    if (!input.upload) throw new Error("upload is required for upload transport");
    content = decodeUpload(input.upload.contentBase64);
    const spoolDir = requiredText(options.spoolDir ?? process.env.AD_IMPORT_SPOOL_DIR, "AD_IMPORT_SPOOL_DIR");
    protectedRef = await writeProtectedArtifact(spoolDir, content);
    originalName = requiredText(input.upload.filename, "upload filename").slice(0, 255);
  } else {
    sourceUrl = requiredText(input.sourceUrl, "source_url");
    if (!isGoogleSheetUrl(sourceUrl)) throw new Error("source_url must be a Google Sheets URL");
    if (!input.reviewedContent || input.reviewedContent.length === 0 || input.reviewedContent.length > MAX_IMPORT_UPLOAD_BYTES) {
      throw new Error(`Reviewed Google Sheet content must be between 1 byte and ${MAX_IMPORT_UPLOAD_BYTES} bytes`);
    }
    content = input.reviewedContent;
  }

  const contentSha256 = createHash("sha256").update(content).digest("hex");
  await conn.execute(
    `INSERT INTO canonical_source_accounts
       (source_key, platform_account_id, account_name, advertiser_name, account_status, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE last_seen_at = UTC_TIMESTAMP()`,
    [sourceKey, platformAccountId, platformAccountId, advertiserKey],
  );
  await conn.execute(
    `INSERT INTO canonical_advertiser_source_accounts
       (advertiser_key, source_key, platform_account_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    [advertiserKey, sourceKey, platformAccountId],
  );
  const response = (await conn.execute(
    `INSERT INTO canonical_ad_import_requests
       (advertiser_key, source_key, platform_account_id, transport, protected_ref, source_url, original_name,
        content_sha256, adapter_config, adapter_config_version, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(input.adapterConfig),
      adapterConfigVersion,
      options.requestedBy?.trim() || null,
    ],
  )) as [{ insertId?: number }];

  return {
    requestId: Number(response[0]?.insertId ?? 0),
    status: "pending",
    contentSha256,
    protectedRef,
  };
}

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from "@/lib/access-auth";
import { enqueueCanonicalImport, type EnqueuedCanonicalImport } from "@/lib/canonical-import-request";
import { resolveReviewedAdvertisingSource } from "@/lib/admin-dashboards";

type ConfirmRequestBody = {
  dashboard_id?: unknown;
  source_id?: unknown;
  source_config?: unknown;
};

type SourceRow = RowDataPacket & {
  id: number;
  dashboard_id: number;
  platform: string;
  source_config: string | Record<string, unknown> | null;
};

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function ids(body: ConfirmRequestBody): { dashboardId: number; sourceId: number } | null {
  const dashboardId = Number(body.dashboard_id);
  const sourceId = Number(body.source_id);
  return Number.isFinite(dashboardId) && Number.isFinite(sourceId) ? { dashboardId, sourceId } : null;
}

function adminEmail(request: Request): string | null {
  return verifyAdminSession(parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE))?.email ?? null;
}

type CanonicalAccountBinding = RowDataPacket & {
  advertiser_key: string;
  source_key: string;
  platform_account_id: string;
};

type ImportStatusRow = RowDataPacket & {
  status: "pending" | "processing" | "retryable" | "published" | "rejected" | "failed";
  error_summary: string | null;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
};

class ConfirmError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function safeErrorSummary(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[external URL]")
    .replace(/\b(token|authorization|password|secret)=\S+/gi, "$1=[redacted]")
    .trim();
  return text ? text.slice(0, 500) : null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ConfirmRequestBody;
  const requestIds = ids(body);
  if (!requestIds) {
    return NextResponse.json({ error: "dashboard_id and source_id are required" }, { status: 400 });
  }
  const requestedBy = adminEmail(request);
  if (!requestedBy) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await pool.getConnection();
  let queued: EnqueuedCanonicalImport | null = null;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<SourceRow[]>(
      `SELECT id, dashboard_id, platform, source_config
       FROM dashboard_sources WHERE id = ? AND dashboard_id = ? LIMIT 1 FOR UPDATE`,
      [requestIds.sourceId, requestIds.dashboardId],
    );
    const source = rows[0];
    if (!source || source.platform !== "manual_data") {
      throw new ConfirmError(404, "Manual data source not found");
    }

    const existingSourceConfig = parseJson(source.source_config);
    if (Number.isFinite(Number(existingSourceConfig.import_request_id))) {
      throw new ConfirmError(409, "A canonical import request is already linked to this source");
    }
    const incomingSourceConfig =
      body.source_config && typeof body.source_config === "object"
        ? (body.source_config as Record<string, unknown>)
        : {};
    if (Object.prototype.hasOwnProperty.call(incomingSourceConfig, "adapter_config")) {
      throw new ConfirmError(400, "adapter_config is derived from the reviewed source");
    }
    const sourceConfig = { ...existingSourceConfig, ...incomingSourceConfig };
    const reviewed = resolveReviewedAdvertisingSource(sourceConfig);
    const upload = sourceConfig.upload_file;
    const sheetUrl = String(sourceConfig.sheet_url ?? "").trim();
    const hasUpload = upload && typeof upload === "object";
    if (hasUpload === Boolean(sheetUrl)) {
      throw new ConfirmError(400, "Provide exactly one upload or Google Sheet URL");
    }

    const transport = hasUpload ? "upload" : "google_sheet";
    const [bindings] = await conn.execute<CanonicalAccountBinding[]>(
      `SELECT advertiser_key, source_key, platform_account_id
       FROM canonical_advertiser_source_accounts
       WHERE advertiser_key = ? AND source_key = ? AND platform_account_id = ?
       LIMIT 1 FOR UPDATE`,
      [reviewed.advertiserKey, reviewed.sourceKey, reviewed.platformAccountId],
    );
    const binding = bindings[0];
    if (!binding) {
      throw new ConfirmError(403, "The reviewed advertiser source account is not authorized for import");
    }
    queued = await enqueueCanonicalImport(
      conn,
      {
        advertiserKey: binding.advertiser_key,
        sourceKey: binding.source_key,
        platformAccountId: binding.platform_account_id,
        transport,
        upload: hasUpload
          ? {
              filename: String((upload as Record<string, unknown>).filename ?? "").trim(),
              contentBase64: String((upload as Record<string, unknown>).content_base64 ?? "").trim(),
            }
          : undefined,
        sourceUrl: sheetUrl || undefined,
        sheetSnapshotKey: transport === "google_sheet" ? randomUUID() : undefined,
        adapterConfig: reviewed.adapterConfig,
      },
      { requestedBy },
    );
    const reviewedSourceConfig: Record<string, unknown> = {
      ...sourceConfig,
      advertiser_key: reviewed.advertiserKey,
      source_key: reviewed.sourceKey,
      platform_account_id: reviewed.platformAccountId,
      account_ids: [reviewed.platformAccountId],
      transport,
      import_request_id: queued.requestId,
      import_status: queued.status,
      content_sha256: queued.contentSha256,
      adapter_config: reviewed.adapterConfig,
      upload_file: null,
    };
    delete reviewedSourceConfig.confirmed_manual_data;
    const [updated] = await conn.execute<ResultSetHeader>(
      `UPDATE dashboard_sources
       SET platform = ?, schema_file = ?, source_config = ?
       WHERE id = ?
         AND dashboard_id = ?
         AND platform = 'manual_data'
         AND COALESCE(JSON_CONTAINS_PATH(source_config, 'one', '$.import_request_id'), 0) = 0`,
      [reviewed.platform, reviewed.schemaFile, JSON.stringify(reviewedSourceConfig), requestIds.sourceId, requestIds.dashboardId],
    );
    if (updated.affectedRows !== 1) {
      throw new ConfirmError(409, "The source was updated by another confirmation request");
    }
    await conn.commit();

    return NextResponse.json({
      status: queued.status,
      import_request_id: queued.requestId,
      content_sha256: queued.contentSha256,
      reviewed_source: {
        platform: reviewed.platform,
        schema_file: reviewed.schemaFile,
        source_config: reviewedSourceConfig,
      },
    });
  } catch (error) {
    await conn.rollback();
    await queued?.discardCreatedArtifact();
    return NextResponse.json(
      { error: error instanceof ConfirmError ? error.message : "Failed to queue canonical advertising import" },
      { status: error instanceof ConfirmError ? error.status : 500 },
    );
  } finally {
    conn.release();
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestIds = ids({
    dashboard_id: url.searchParams.get("dashboard_id"),
    source_id: url.searchParams.get("source_id"),
  });
  if (!requestIds) {
    return NextResponse.json({ error: "dashboard_id and source_id are required" }, { status: 400 });
  }
  if (!adminEmail(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await pool.getConnection();
  try {
    const [sources] = await conn.execute<SourceRow[]>(
      `SELECT id, dashboard_id, platform, source_config
       FROM dashboard_sources WHERE id = ? AND dashboard_id = ? LIMIT 1`,
      [requestIds.sourceId, requestIds.dashboardId],
    );
    const importRequestId = Number(parseJson(sources[0]?.source_config).import_request_id);
    if (!sources[0] || !Number.isFinite(importRequestId)) {
      return NextResponse.json({ error: "Canonical import source not found" }, { status: 404 });
    }
    const [requests] = await conn.execute<ImportStatusRow[]>(
      `SELECT status, error_summary, attempt_count, max_attempts, next_attempt_at
       FROM canonical_ad_import_requests WHERE id = ? LIMIT 1`,
      [importRequestId],
    );
    if (!requests[0]) return NextResponse.json({ error: "Import request not found" }, { status: 404 });
    return NextResponse.json({
      status: requests[0].status,
      import_request_id: importRequestId,
      error_summary: safeErrorSummary(requests[0].error_summary),
      attempt_count: Number(requests[0].attempt_count),
      max_attempts: Number(requests[0].max_attempts),
      next_attempt_at: requests[0].next_attempt_at,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load canonical import status" },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ConfirmRequestBody;
  const requestIds = ids(body);
  if (!requestIds) {
    return NextResponse.json({ error: "dashboard_id and source_id are required" }, { status: 400 });
  }
  if (!adminEmail(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<SourceRow[]>(
      `SELECT id, dashboard_id, platform, source_config
       FROM dashboard_sources WHERE id = ? AND dashboard_id = ? LIMIT 1 FOR UPDATE`,
      [requestIds.sourceId, requestIds.dashboardId],
    );
    const source = rows[0];
    if (!source) {
      await conn.rollback();
      return NextResponse.json({ error: "Dashboard source not found" }, { status: 404 });
    }
    const sourceConfig = parseJson(source.source_config);
    if (source.platform !== "manual_data" && !Number.isFinite(Number(sourceConfig.import_request_id))) {
      await conn.rollback();
      return NextResponse.json({ error: "Canonical import source not found" }, { status: 404 });
    }
    await conn.execute("DELETE FROM dashboard_campaign_filters WHERE dashboard_source_id = ?", [requestIds.sourceId]);
    await conn.execute("DELETE FROM dashboard_sources WHERE id = ? AND dashboard_id = ?", [requestIds.sourceId, requestIds.dashboardId]);
    await conn.commit();
    return NextResponse.json({ status: "unlinked", source_id: requestIds.sourceId });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to unlink canonical import source", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

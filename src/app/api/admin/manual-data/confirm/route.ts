import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from "@/lib/access-auth";
import { enqueueCanonicalImport, googleSheetExportUrl, MAX_IMPORT_UPLOAD_BYTES } from "@/lib/canonical-import-request";
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

async function reviewedGoogleSheetContent(sourceUrl: string): Promise<Buffer> {
  const response = await fetch(googleSheetExportUrl(sourceUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Reviewed Google Sheet returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_UPLOAD_BYTES) {
    throw new Error(`Reviewed Google Sheet exceeds ${MAX_IMPORT_UPLOAD_BYTES} bytes`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length === 0 || content.length > MAX_IMPORT_UPLOAD_BYTES) {
    throw new Error(`Reviewed Google Sheet must be between 1 byte and ${MAX_IMPORT_UPLOAD_BYTES} bytes`);
  }
  return content;
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
  try {
    const [rows] = await conn.execute<SourceRow[]>(
      `SELECT id, dashboard_id, platform, source_config
       FROM dashboard_sources WHERE id = ? AND dashboard_id = ? LIMIT 1`,
      [requestIds.sourceId, requestIds.dashboardId],
    );
    const source = rows[0];
    if (!source || source.platform !== "manual_data") {
      return NextResponse.json({ error: "Manual data source not found" }, { status: 404 });
    }

    const existingSourceConfig = parseJson(source.source_config);
    const incomingSourceConfig =
      body.source_config && typeof body.source_config === "object"
        ? (body.source_config as Record<string, unknown>)
        : {};
    const sourceConfig = { ...existingSourceConfig, ...incomingSourceConfig };
    const reviewed = resolveReviewedAdvertisingSource(sourceConfig);
    const upload = sourceConfig.upload_file;
    const sheetUrl = String(sourceConfig.sheet_url ?? "").trim();
    const hasUpload = upload && typeof upload === "object";
    if (hasUpload === Boolean(sheetUrl)) {
      return NextResponse.json({ error: "Provide exactly one upload or Google Sheet URL" }, { status: 400 });
    }

    const transport = hasUpload ? "upload" : "google_sheet";
    const reviewedContent = transport === "google_sheet" ? await reviewedGoogleSheetContent(sheetUrl) : undefined;
    await conn.beginTransaction();
    const queued = await enqueueCanonicalImport(
      conn,
      {
        advertiserKey: reviewed.advertiserKey,
        sourceKey: reviewed.sourceKey,
        platformAccountId: reviewed.platformAccountId,
        transport,
        upload: hasUpload
          ? {
              filename: String((upload as Record<string, unknown>).filename ?? "").trim(),
              contentBase64: String((upload as Record<string, unknown>).content_base64 ?? "").trim(),
            }
          : undefined,
        sourceUrl: sheetUrl || undefined,
        reviewedContent,
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
    await conn.execute(
      `UPDATE dashboard_sources
       SET platform = ?, schema_file = ?, source_config = ?
       WHERE id = ? AND dashboard_id = ?`,
      [reviewed.platform, reviewed.schemaFile, JSON.stringify(reviewedSourceConfig), requestIds.sourceId, requestIds.dashboardId],
    );
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
    return NextResponse.json(
      { error: "Failed to queue canonical advertising import", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
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
    const [requests] = await conn.execute<Array<RowDataPacket & { status: string }>>(
      "SELECT status FROM canonical_ad_import_requests WHERE id = ? LIMIT 1",
      [importRequestId],
    );
    if (!requests[0]) return NextResponse.json({ error: "Import request not found" }, { status: 404 });
    return NextResponse.json({ status: requests[0].status, import_request_id: importRequestId });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load canonical import status", details: error instanceof Error ? error.message : String(error) },
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

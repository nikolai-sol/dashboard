import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { fetchManualDataFromSourceConfig, type ManualDataSourceConfig } from "@/lib/manual-data-fetcher";
import {
  aggregateManualRows,
  buildConfirmedManualDataMeta,
  buildManualSourceKey,
  deleteDashboardManualFacts,
  replaceDashboardManualFacts,
} from "@/lib/manual-data-store";

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
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ConfirmRequestBody;
  const dashboardId = Number(body.dashboard_id);
  const sourceId = Number(body.source_id);

  if (!Number.isFinite(dashboardId) || !Number.isFinite(sourceId)) {
    return NextResponse.json({ error: "dashboard_id and source_id are required" }, { status: 400 });
  }

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute<SourceRow[]>(
      `SELECT id, dashboard_id, platform, source_config
       FROM dashboard_sources
       WHERE id = ? AND dashboard_id = ?
       LIMIT 1`,
      [sourceId, dashboardId],
    );
    const source = rows[0];
    if (!source || source.platform !== "manual_data") {
      return NextResponse.json({ error: "Manual data source not found" }, { status: 404 });
    }

    const existingSourceConfig = parseJson(source.source_config);
    const incomingSourceConfig =
      body.source_config && typeof body.source_config === "object"
        ? (body.source_config as Record<string, unknown>)
        : existingSourceConfig;
    const mergedSourceConfig = { ...existingSourceConfig, ...incomingSourceConfig } as Record<string, unknown>;

    let manualSourceKey = String(mergedSourceConfig.manual_source_key ?? "").trim();
    if (!manualSourceKey) {
      manualSourceKey = buildManualSourceKey();
    }

    const parsedRows = await fetchManualDataFromSourceConfig(mergedSourceConfig as ManualDataSourceConfig);
    const aggregatedRows = aggregateManualRows(parsedRows);
    const uploadName =
      mergedSourceConfig.upload_file && typeof mergedSourceConfig.upload_file === "object"
        ? String((mergedSourceConfig.upload_file as Record<string, unknown>).filename ?? "").trim() || null
        : null;
    const confirmedMeta = buildConfirmedManualDataMeta(aggregatedRows, uploadName);

    await conn.beginTransaction();
    await replaceDashboardManualFacts(conn, dashboardId, manualSourceKey, aggregatedRows, uploadName);

    const reviewedSourceConfig: Record<string, unknown> = {
      ...mergedSourceConfig,
      manual_source_key: manualSourceKey,
      upload_file: null,
      confirmed_manual_data: confirmedMeta,
    };

    await conn.execute(
      `UPDATE dashboard_sources
       SET source_config = ?
       WHERE id = ? AND dashboard_id = ?`,
      [JSON.stringify(reviewedSourceConfig), sourceId, dashboardId],
    );

    await conn.commit();

    return NextResponse.json({
      reviewed_source_config: reviewedSourceConfig,
      confirmed_manual_data: confirmedMeta,
      rows_written: aggregatedRows.length,
    });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to confirm manual data", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ConfirmRequestBody;
  const dashboardId = Number(body.dashboard_id);
  const sourceId = Number(body.source_id);

  if (!Number.isFinite(dashboardId) || !Number.isFinite(sourceId)) {
    return NextResponse.json({ error: "dashboard_id and source_id are required" }, { status: 400 });
  }

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute<SourceRow[]>(
      `SELECT id, dashboard_id, platform, source_config
       FROM dashboard_sources
       WHERE id = ? AND dashboard_id = ?
       LIMIT 1`,
      [sourceId, dashboardId],
    );
    const source = rows[0];
    if (!source || source.platform !== "manual_data") {
      return NextResponse.json({ error: "Manual data source not found" }, { status: 404 });
    }

    const sourceConfig = parseJson(source.source_config);
    const manualSourceKey = String(sourceConfig.manual_source_key ?? "").trim();

    await conn.beginTransaction();
    if (manualSourceKey) {
      await deleteDashboardManualFacts(conn, dashboardId, manualSourceKey);
    }

    const nextSourceConfig: Record<string, unknown> = {
      ...sourceConfig,
      upload_file: null,
    };
    delete nextSourceConfig.confirmed_manual_data;

    await conn.execute(
      `UPDATE dashboard_sources
       SET source_config = ?
       WHERE id = ? AND dashboard_id = ?`,
      [JSON.stringify(nextSourceConfig), sourceId, dashboardId],
    );

    await conn.commit();

    return NextResponse.json({
      reviewed_source_config: nextSourceConfig,
      deleted: true,
    });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to delete confirmed manual data", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

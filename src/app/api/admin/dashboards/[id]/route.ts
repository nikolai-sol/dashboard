import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  cleanupRemovedManualDataSources,
  insertSourcesWithFilters,
  loadDashboardWithSources,
  normalizeDashboardPayload,
  replaceMediaPlanBindings,
  summarizeDashboardPayloadForLog,
  syncDashboardMediaPlanStorage,
  validateDashboardPayload,
} from "@/lib/admin-dashboards";
import { getDefaultKpiCards, getDefaultSectionOrder } from "@/lib/dashboard-presets";

function parseConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

type DashboardConfigRow = RowDataPacket & {
  config: string | Record<string, unknown> | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = Number(id);
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const conn = await pool.getConnection();
  try {
    const dashboard = await loadDashboardWithSources(conn, dashboardId);
    if (!dashboard) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    return NextResponse.json({ dashboard });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load dashboard", details: String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = Number(id);
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const payload = normalizeDashboardPayload(body);
  const payloadSummary = summarizeDashboardPayloadForLog(payload);
  const validationError = validateDashboardPayload(payload);
  if (validationError) {
    console.warn("[PUT /api/admin/dashboards] validation_failed", {
      dashboardId,
      validationError,
      payload: payloadSummary,
    });
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const config: Record<string, unknown> = {
    ...payload.config,
    kpi_cards: Array.isArray(payload.config.kpi_cards)
      ? payload.config.kpi_cards
      : getDefaultKpiCards(payload.dashboard_type, Boolean(payload.config.show_spend ?? true)),
    section_order: Array.isArray(payload.config.section_order)
      ? payload.config.section_order
      : getDefaultSectionOrder(payload.dashboard_type, Boolean(payload.config.show_spend ?? true)),
  };

  const conn = await pool.getConnection();
  try {
    console.info("[PUT /api/admin/dashboards] update_attempt", {
      dashboardId,
      payload: payloadSummary,
    });
    await conn.beginTransaction();

    const [existingRows] = await conn.execute<DashboardConfigRow[]>(
      "SELECT config FROM dashboards WHERE id = ? LIMIT 1",
      [dashboardId],
    );
    const existingRow = existingRows[0];
    if (!existingRow) {
      await conn.rollback();
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    const existingConfig = parseConfig(existingRow.config);
    if (
      !Object.prototype.hasOwnProperty.call(payload.config, "ai_summary_authoring") &&
      Object.prototype.hasOwnProperty.call(existingConfig, "ai_summary_authoring")
    ) {
      config.ai_summary_authoring = existingConfig.ai_summary_authoring;
    }
    if (
      !Object.prototype.hasOwnProperty.call(payload.config, "ai_summary_snapshot") &&
      Object.prototype.hasOwnProperty.call(existingConfig, "ai_summary_snapshot")
    ) {
      config.ai_summary_snapshot = existingConfig.ai_summary_snapshot;
    }

    const [updateResult] = await conn.execute<ResultSetHeader>(
      `UPDATE dashboards
       SET client_id = ?, client_name = ?, dashboard_name = ?, dashboard_type = ?, config = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.client_id,
        payload.client_name,
        payload.dashboard_name,
        payload.dashboard_type,
        JSON.stringify(config),
        dashboardId,
      ],
    );

    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    await conn.execute("DELETE FROM dashboard_sources WHERE dashboard_id = ?", [dashboardId]);
    await insertSourcesWithFilters(conn, dashboardId, payload.sources);
    await replaceMediaPlanBindings(conn, dashboardId, payload.media_plan_bindings);
    await syncDashboardMediaPlanStorage(conn, dashboardId, payload.sources);
    await cleanupRemovedManualDataSources(conn, dashboardId, payload.sources);

    await conn.commit();
    return NextResponse.json({
      id: dashboardId,
      url: `/dashboard/${payload.client_id}`,
      message: "Dashboard updated",
    });
  } catch (error) {
    await conn.rollback();
    console.error("[PUT /api/admin/dashboards] update_failed", {
      dashboardId,
      error,
      payload: payloadSummary,
    });
    const err = error as { message?: string; code?: string; sqlMessage?: string; errno?: number };
    const message = err?.message ?? String(error);
    const parts: string[] = [message];
    if (err?.code) parts.push(`code: ${err.code}`);
    if (err?.sqlMessage && err.sqlMessage !== message) parts.push(err.sqlMessage);
    if (err?.errno) parts.push(`errno: ${err.errno}`);
    return NextResponse.json(
      {
        error: "Failed to update dashboard",
        details: parts.join(" · "),
      },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = Number(id);
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM dashboards WHERE id = ?",
      [dashboardId],
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Dashboard deleted" });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete dashboard", details: String(error) },
      { status: 500 },
    );
  }
}

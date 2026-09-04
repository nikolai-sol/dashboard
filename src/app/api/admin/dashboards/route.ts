import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from "@/lib/access-auth";
import {
  insertSourcesWithFilters,
  normalizeDashboardPayload,
  summarizeDashboardPayloadForLog,
  syncDashboardMediaPlanStorage,
  validateDashboardPayload,
} from "@/lib/admin-dashboards";
import { getDefaultKpiCards, getDefaultSectionOrder } from "@/lib/dashboard-presets";
import { BindingValidationError, replaceEffectiveBindings } from "@/lib/media-plan-binding-store";

export async function GET() {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT d.*, COUNT(ds.id) as sources_count
       FROM dashboards d
       LEFT JOIN dashboard_sources ds ON ds.dashboard_id = d.id
       GROUP BY d.id
       ORDER BY d.updated_at DESC, d.id DESC`,
    );

    const dashboards = rows.map((row) => ({
      id: Number(row.id),
      client_id: String(row.client_id),
      client_name: String(row.client_name),
      dashboard_name: String(row.dashboard_name),
      dashboard_type: String(row.dashboard_type),
      is_active: Boolean(row.is_active),
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      sources_count: Number(row.sources_count ?? 0),
      url: `/dashboard/${row.client_id}`,
    }));

    return NextResponse.json({ dashboards });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load dashboards", details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const actor = verifyAdminSession(
    parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE),
  )?.email ?? null;
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const payload = normalizeDashboardPayload(body);
  const payloadSummary = summarizeDashboardPayloadForLog(payload);
  const validationError = validateDashboardPayload(payload);

  if (validationError) {
    console.warn("[POST /api/admin/dashboards] validation_failed", {
      validationError,
      payload: payloadSummary,
    });
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const config = {
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
    console.info("[POST /api/admin/dashboards] create_attempt", {
      payload: payloadSummary,
    });
    await conn.beginTransaction();

    const [dashResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO dashboards (client_id, client_name, dashboard_name, dashboard_type, config, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [
        payload.client_id,
        payload.client_name,
        payload.dashboard_name,
        payload.dashboard_type,
        JSON.stringify(config),
      ],
    );

    await insertSourcesWithFilters(conn, dashResult.insertId, payload.sources);
    if (["abbott_bi", "zaruku_bi"].includes(payload.dashboard_type)) {
      if (payload.media_plan_bindings.length) {
        throw new BindingValidationError("advertising bindings are not supported for this dashboard");
      }
    } else {
      await replaceEffectiveBindings(
        conn,
        dashResult.insertId,
        actor,
        payload.media_plan_bindings.map((binding) => ({
          line_key: String(binding.line_key ?? binding.channel),
          channel: binding.channel,
          canonical_campaign_id: Number(binding.canonical_campaign_id),
          effective_from: binding.effective_from ?? null,
          effective_to: binding.effective_to ?? null,
        })),
      );
    }
    await syncDashboardMediaPlanStorage(conn, dashResult.insertId, payload.sources);

    await conn.commit();
    return NextResponse.json({
      id: dashResult.insertId,
      url: `/dashboard/${payload.client_id}`,
      message: "Dashboard created",
    });
  } catch (error) {
    await conn.rollback();
    console.error("[POST /api/admin/dashboards] create_failed", {
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
        error: "Failed to create dashboard",
        details: parts.join(" · "),
      },
      { status: error instanceof BindingValidationError ? 400 : 500 },
    );
  } finally {
    conn.release();
  }
}

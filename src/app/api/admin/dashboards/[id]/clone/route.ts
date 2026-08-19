import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from "@/lib/access-auth";
import {
  insertSourcesWithFilters,
  loadDashboardWithSources,
  syncDashboardMediaPlanStorage,
} from "@/lib/admin-dashboards";
import { BindingValidationError, replaceEffectiveBindings } from "@/lib/media-plan-binding-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const actor = verifyAdminSession(
    parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE),
  )?.email ?? null;
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await Promise.resolve(context.params);
  const sourceDashboardId = Number(id);
  if (!Number.isFinite(sourceDashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const original = await loadDashboardWithSources(conn, sourceDashboardId);
    if (!original) {
      await conn.rollback();
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    const newClientId = String(body.client_id ?? `${original.client_id}_copy`)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\-]/g, "_");
    const newClientName = String(body.client_name ?? `${original.client_name} Copy`).trim();
    const newDashboardName = String(body.dashboard_name ?? `${original.dashboard_name} (Copy)`).trim();

    const [insertResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO dashboards (client_id, client_name, dashboard_name, dashboard_type, config, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [
        newClientId,
        newClientName,
        newDashboardName,
        original.dashboard_type,
        JSON.stringify(original.config),
      ],
    );

    await insertSourcesWithFilters(
      conn,
      insertResult.insertId,
      original.sources.map((source) => ({
        platform: source.platform,
        schema_file: source.schema_file,
        role: source.role,
        source_config: source.source_config,
        filters: source.filters,
      })),
    );
    if (["abbott_bi", "zaruku_bi"].includes(original.dashboard_type)) {
      if (original.media_plan_bindings.length) {
        throw new BindingValidationError("advertising bindings are not supported for this dashboard");
      }
    } else {
      await replaceEffectiveBindings(
        conn,
        insertResult.insertId,
        actor,
        original.media_plan_bindings.map((binding) => ({
          line_key: String(binding.line_key ?? binding.channel),
          channel: binding.channel,
          canonical_campaign_id: Number(binding.canonical_campaign_id),
          effective_from: binding.effective_from ?? null,
          effective_to: binding.effective_to ?? null,
        })),
      );
    }
    await syncDashboardMediaPlanStorage(
      conn,
      insertResult.insertId,
      original.sources.map((source) => ({
        platform: source.platform,
        schema_file: source.schema_file,
        role: source.role,
        source_config: source.source_config,
        filters: source.filters,
      })),
    );

    await conn.commit();
    return NextResponse.json({
      id: insertResult.insertId,
      client_id: newClientId,
      url: `/dashboard/${newClientId}`,
      message: "Dashboard cloned",
    });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to clone dashboard", details: String(error) },
      { status: error instanceof BindingValidationError ? 400 : 500 },
    );
  } finally {
    conn.release();
  }
}

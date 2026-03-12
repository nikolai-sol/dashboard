import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";
import {
  insertSourcesWithFilters,
  loadDashboardWithSources,
  normalizeDashboardPayload,
  validateDashboardPayload,
} from "@/lib/admin-dashboards";

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
  const validationError = validateDashboardPayload(payload);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [updateResult] = await conn.execute<ResultSetHeader>(
      `UPDATE dashboards
       SET client_id = ?, client_name = ?, dashboard_name = ?, dashboard_type = ?, config = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.client_id,
        payload.client_name,
        payload.dashboard_name,
        payload.dashboard_type,
        JSON.stringify(payload.config),
        dashboardId,
      ],
    );

    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    await conn.execute("DELETE FROM dashboard_sources WHERE dashboard_id = ?", [dashboardId]);
    await insertSourcesWithFilters(conn, dashboardId, payload.sources);

    await conn.commit();
    return NextResponse.json({
      id: dashboardId,
      url: `/dashboard/${payload.client_id}`,
      message: "Dashboard updated",
    });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to update dashboard", details: String(error) },
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

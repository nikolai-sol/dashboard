import { NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  loadDashboardUtmMatchingPayload,
  normalizeDashboardUtmSourceBindings,
  replaceDashboardUtmSourceBindings,
} from "@/lib/dashboard-utm-matching";

type RequestBody = {
  bindings?: unknown;
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
    const payload = await loadDashboardUtmMatchingPayload(conn, dashboardId);
    if (!payload) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load UTM source matching", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = Number(id);
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const bindings = normalizeDashboardUtmSourceBindings(body.bindings);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await replaceDashboardUtmSourceBindings(conn, dashboardId, bindings);
    await conn.commit();
    return NextResponse.json({
      message: "UTM source bindings updated",
      total: bindings.length,
    });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to save UTM source bindings", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { loadDashboardMetrikaSettingsPayload } from "@/lib/dashboard-metrika-admin";

function parseAccountIds(value: string | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = Number(id);
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const periodFrom = url.searchParams.get("from");
  const periodTo = url.searchParams.get("to");
  const accountIds = parseAccountIds(url.searchParams.get("account_ids"));

  const conn = await pool.getConnection();
  try {
    const payload = await loadDashboardMetrikaSettingsPayload(conn, dashboardId, {
      periodFrom,
      periodTo,
      accountIds,
    });
    if (!payload) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load Metrika settings", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

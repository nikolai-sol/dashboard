import { NextResponse } from "next/server";
import {
  listDashboardAccessUsers,
  replaceDashboardAccessUsers,
} from "@/lib/dashboard-access";

export async function GET(request: Request) {
  const dashboardId = Number(new URL(request.url).searchParams.get("dashboard_id"));
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "dashboard_id is required" }, { status: 400 });
  }

  try {
    const users = await listDashboardAccessUsers(dashboardId);
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load access users", details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const dashboardId = Number(body?.dashboard_id);
  const users = Array.isArray(body?.users) ? body.users : [];

  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "dashboard_id is required" }, { status: 400 });
  }

  try {
    await replaceDashboardAccessUsers(
      dashboardId,
      users.map((item: { email?: unknown; password?: unknown }) => ({
        email: String(item?.email ?? ""),
        password: String(item?.password ?? ""),
      })),
    );
    const nextUsers = await listDashboardAccessUsers(dashboardId);
    return NextResponse.json({ ok: true, users: nextUsers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to save access users", details: message },
      { status: 500 },
    );
  }
}

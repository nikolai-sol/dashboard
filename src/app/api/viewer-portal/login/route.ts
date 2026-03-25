import { NextResponse } from "next/server";
import {
  VIEWER_PORTAL_SESSION_COOKIE,
  cookieOptions,
  createViewerPortalSession,
} from "@/lib/access-auth";
import { listAccessibleDashboardsByCredentials } from "@/lib/dashboard-access";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const dashboards = await listAccessibleDashboardsByCredentials(email, password);
  if (!dashboards.length) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, dashboards });
  response.cookies.set(
    VIEWER_PORTAL_SESSION_COOKIE,
    createViewerPortalSession(email, dashboards.map((dashboard) => dashboard.id)),
    cookieOptions(60 * 60 * 24 * 30, "none"),
  );
  return response;
}

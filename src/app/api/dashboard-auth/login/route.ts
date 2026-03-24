import { NextResponse } from "next/server";
import {
  cookieOptions,
  createViewerSession,
  viewerCookieName,
} from "@/lib/access-auth";
import { verifyDashboardAccessCredentials } from "@/lib/dashboard-access";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const identifier = String(body?.dashboard_id ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!identifier || !email || !password) {
    return NextResponse.json({ error: "Dashboard, email, and password are required" }, { status: 400 });
  }

  const context = await verifyDashboardAccessCredentials(identifier, email, password);
  if (!context) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    dashboard: {
      id: context.id,
      client_id: context.client_id,
      client_name: context.client_name,
      dashboard_name: context.dashboard_name,
    },
  });
  response.cookies.set(
    viewerCookieName(context.id),
    createViewerSession(context.id, email),
    cookieOptions(60 * 60 * 24 * 30),
  );
  return response;
}


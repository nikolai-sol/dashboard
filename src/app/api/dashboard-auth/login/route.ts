import { NextResponse } from "next/server";
import {
  VIEWER_PORTAL_SESSION_COOKIE,
  cookieOptions,
  createViewerPortalSession,
  createViewerSession,
  viewerCookieName,
} from "@/lib/access-auth";
import {
  listAccessibleDashboardsByCredentials,
  verifyDashboardAccessCredentials,
} from "@/lib/dashboard-access";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const identifier = String(body?.dashboard_id ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!identifier || !password) {
    return NextResponse.json({ error: "Dashboard and password are required" }, { status: 400 });
  }

  const context = await verifyDashboardAccessCredentials(identifier, email, password);
  if (!context) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const normalizedEmail = email || `shared-access+${context.client_id}@dashboard.local`;
  const accessibleDashboards =
    context.auth_mode === "email_password"
      ? await listAccessibleDashboardsByCredentials(email, password)
      : [{ id: context.id, client_id: context.client_id, client_name: context.client_name, dashboard_name: context.dashboard_name, url: `/dashboard/${context.client_id}` }];
  const viewerSessionToken = createViewerSession(context.id, normalizedEmail);

  const response = NextResponse.json({
    ok: true,
    access_token: viewerSessionToken,
    dashboard: {
      id: context.id,
      client_id: context.client_id,
      client_name: context.client_name,
      dashboard_name: context.dashboard_name,
    },
  });
  response.cookies.set(
    viewerCookieName(context.id),
    viewerSessionToken,
    cookieOptions(60 * 60 * 24 * 30, "none"),
  );
  response.cookies.set(
    VIEWER_PORTAL_SESSION_COOKIE,
    createViewerPortalSession(normalizedEmail, accessibleDashboards.map((dashboard) => dashboard.id)),
    cookieOptions(60 * 60 * 24 * 30, "none"),
  );
  return response;
}

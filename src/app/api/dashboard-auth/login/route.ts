import { NextResponse } from "next/server";
import { isIP } from "node:net";
import {
  VIEWER_PORTAL_SESSION_COOKIE,
  cookieOptions,
  createViewerPortalSession,
  createViewerSession,
  viewerCookieName,
} from "@/lib/access-auth";
import {
  getDashboardAccessContext,
  listAccessibleDashboardsByCredentials,
  verifyDashboardAccessContextCredentials,
} from "@/lib/dashboard-access";
import { checkRateLimit } from "@/lib/rate-limit";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const defaultDashboardLoginDependencies = {
  checkRateLimit,
  getDashboardAccessContext,
  verifyDashboardAccessContextCredentials,
  listAccessibleDashboardsByCredentials,
  createViewerSession,
  createViewerPortalSession,
};

type DashboardLoginDependencies = typeof defaultDashboardLoginDependencies;

export function getTrustedClientIp(request: Request): string {
  // Deployment contract: nginx overwrites X-Real-IP; client-supplied X-Forwarded-For is ignored.
  const realIp = request.headers.get("x-real-ip")?.trim() || "";
  return isIP(realIp) ? realIp : "untrusted-proxy";
}

function rateLimitResponse(retryAfterSec: number) {
  return NextResponse.json(
    { error: "Too many login attempts. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export function createDashboardLoginHandler(
  overrides: Partial<DashboardLoginDependencies> = {},
) {
  const dependencies = {
    ...defaultDashboardLoginDependencies,
    ...overrides,
  };

  return async function dashboardLogin(request: Request) {
    const body = await request.json().catch(() => null);
    const identifier = String(body?.dashboard_id ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!identifier || !password) {
      return NextResponse.json({ error: "Dashboard and password are required" }, { status: 400 });
    }

    const clientIp = getTrustedClientIp(request);
    const ipLimit = dependencies.checkRateLimit(
      `dashboard-login-ip:${clientIp}`,
      LOGIN_MAX_ATTEMPTS,
      LOGIN_WINDOW_MS,
    );
    if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterSec);

    const accessContext = await dependencies.getDashboardAccessContext(identifier);
    if (!accessContext) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const dashboardLimit = dependencies.checkRateLimit(
      `dashboard-login:${clientIp}:dashboard:${accessContext.id}`,
      LOGIN_MAX_ATTEMPTS,
      LOGIN_WINDOW_MS,
    );
    if (!dashboardLimit.allowed) return rateLimitResponse(dashboardLimit.retryAfterSec);

    const context = await dependencies.verifyDashboardAccessContextCredentials(
      accessContext,
      email,
      password,
    );
    if (!context) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const normalizedEmail = email || `shared-access+${context.client_id}@dashboard.local`;
    const accessibleDashboards =
      context.auth_mode === "email_password"
        ? await dependencies.listAccessibleDashboardsByCredentials(email, password)
        : [{ id: context.id, client_id: context.client_id, client_name: context.client_name, dashboard_name: context.dashboard_name, url: `/dashboard/${context.client_id}` }];
    const viewerSessionToken = dependencies.createViewerSession(
      context.id,
      normalizedEmail,
      "manager",
      context.credentialVersion,
    );

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
      dependencies.createViewerPortalSession(
        normalizedEmail,
        accessibleDashboards.map((dashboard) => dashboard.id),
      ),
      cookieOptions(60 * 60 * 24 * 30, "none"),
    );
    return response;
  };
}

export const POST = createDashboardLoginHandler();

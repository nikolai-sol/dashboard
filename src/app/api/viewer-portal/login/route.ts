import { NextResponse } from "next/server";
import {
  VIEWER_PORTAL_SESSION_COOKIE,
  cookieOptions,
  createViewerPortalSession,
} from "@/lib/access-auth";
import { listAccessibleDashboardsByCredentials } from "@/lib/dashboard-access";
import { checkRateLimit } from "@/lib/rate-limit";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  const rateKey = `viewer-portal-login:${getClientIp(request)}`;
  const limit = checkRateLimit(rateKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

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

import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  parseCookieValue,
  verifyAdminSession,
} from "@/lib/access-auth";
import {
  getSharedPasswordAdminState,
  rotateSharedDashboardPassword,
} from "@/lib/dashboard-shared-access";
import {
  changeSharedPassword,
  readSharedPasswordState,
  type SharedPasswordAdminResponse,
} from "@/lib/shared-password-admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

function jsonResponse(result: SharedPasswordAdminResponse) {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function getAdminEmail(request: Request) {
  try {
    const token = parseCookieValue(
      request.headers.get("cookie"),
      ADMIN_SESSION_COOKIE,
    );
    return verifyAdminSession(token)?.email ?? null;
  } catch {
    return null;
  }
}

function parseDashboardId(value: string) {
  const dashboardId = Number(value);
  return Number.isSafeInteger(dashboardId) && dashboardId > 0
    ? dashboardId
    : null;
}

function unauthorizedResponse() {
  return jsonResponse({
    status: 401,
    body: { error: "Требуется авторизация" },
  });
}

function invalidDashboardResponse() {
  return jsonResponse({
    status: 400,
    body: { error: "Некорректный идентификатор дашборда" },
  });
}

function unexpectedFailureResponse() {
  return jsonResponse({
    status: 500,
    body: { error: "Не удалось сохранить пароль" },
  });
}

export async function GET(request: Request, context: RouteContext) {
  if (!getAdminEmail(request)) return unauthorizedResponse();

  const { id } = await Promise.resolve(context.params);
  const dashboardId = parseDashboardId(id);
  if (dashboardId === null) return invalidDashboardResponse();

  try {
    const result = await readSharedPasswordState(
      { dashboardId },
      { getState: getSharedPasswordAdminState },
    );
    return jsonResponse(result);
  } catch {
    console.error("shared_password_admin_get_failed", dashboardId);
    return unexpectedFailureResponse();
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const adminEmail = getAdminEmail(request);
  if (!adminEmail) return unauthorizedResponse();

  const { id } = await Promise.resolve(context.params);
  const dashboardId = parseDashboardId(id);
  if (dashboardId === null) return invalidDashboardResponse();

  const body = await request.json().catch(() => null);
  try {
    const result = await changeSharedPassword(
      { dashboardId, body, adminEmail },
      {
        getState: getSharedPasswordAdminState,
        rotate: rotateSharedDashboardPassword,
      },
    );
    return jsonResponse(result);
  } catch {
    console.error("shared_password_admin_put_failed", dashboardId);
    return unexpectedFailureResponse();
  }
}

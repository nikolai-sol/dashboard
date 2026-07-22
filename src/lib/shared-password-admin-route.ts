import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  parseCookieValue,
} from "./access-auth";
import type { SharedPasswordAdminResponse } from "./shared-password-admin";

export type SharedPasswordAdminRouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type ChangeSharedPasswordInput = {
  dashboardId: number;
  body: unknown;
  adminEmail: string;
};

type SharedPasswordAdminFailureOperation =
  | "shared_password_admin_get_failed"
  | "shared_password_admin_put_failed";

type SharedPasswordAdminRouteDependencies = {
  verifySession: (
    token: string | null | undefined,
  ) => { email: string } | null;
  readState: (dashboardId: number) => Promise<SharedPasswordAdminResponse>;
  changePassword: (
    input: ChangeSharedPasswordInput,
  ) => Promise<SharedPasswordAdminResponse>;
  logFailure: (
    operation: SharedPasswordAdminFailureOperation,
    dashboardId: number,
  ) => void;
};

function jsonResponse(result: SharedPasswordAdminResponse) {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store" },
  });
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

export function createSharedPasswordAdminRouteHandlers(
  dependencies: SharedPasswordAdminRouteDependencies,
) {
  function getAdminEmail(request: Request) {
    try {
      const token = parseCookieValue(
        request.headers.get("cookie"),
        ADMIN_SESSION_COOKIE,
      );
      return dependencies.verifySession(token)?.email ?? null;
    } catch {
      return null;
    }
  }

  async function GET(
    request: Request,
    context: SharedPasswordAdminRouteContext,
  ) {
    if (!getAdminEmail(request)) return unauthorizedResponse();

    const { id } = await Promise.resolve(context.params);
    const dashboardId = parseDashboardId(id);
    if (dashboardId === null) return invalidDashboardResponse();

    try {
      return jsonResponse(await dependencies.readState(dashboardId));
    } catch {
      dependencies.logFailure("shared_password_admin_get_failed", dashboardId);
      return unexpectedFailureResponse();
    }
  }

  async function PUT(
    request: Request,
    context: SharedPasswordAdminRouteContext,
  ) {
    const adminEmail = getAdminEmail(request);
    if (!adminEmail) return unauthorizedResponse();

    const { id } = await Promise.resolve(context.params);
    const dashboardId = parseDashboardId(id);
    if (dashboardId === null) return invalidDashboardResponse();

    const body = await request.json().catch(() => null);
    try {
      return jsonResponse(
        await dependencies.changePassword({ dashboardId, body, adminEmail }),
      );
    } catch {
      dependencies.logFailure("shared_password_admin_put_failed", dashboardId);
      return unexpectedFailureResponse();
    }
  }

  return { GET, PUT };
}

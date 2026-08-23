import { NextResponse } from "next/server";

import {
  AbbottAdminUsersError,
  addAbbottAdminUserIds,
  listAbbottAdminUserIds,
  removeAbbottAdminUserId,
} from "@/lib/abbott-admin-users";
import { isDashboardAccessAuthorized } from "@/lib/dashboard-access";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

type AbbottAdminUsersRouteDependencies = {
  authorize: typeof isDashboardAccessAuthorized;
  list: typeof listAbbottAdminUserIds;
  add: typeof addAbbottAdminUserIds;
  remove: typeof removeAbbottAdminUserId;
};

const defaultDependencies: AbbottAdminUsersRouteDependencies = {
  authorize: isDashboardAccessAuthorized,
  list: listAbbottAdminUserIds,
  add: addAbbottAdminUserIds,
  remove: removeAbbottAdminUserId,
};

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS },
  });
}

async function boundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
    throw new AbbottAdminUsersError("TOO_MANY_USER_IDS", "Request is too large");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new AbbottAdminUsersError("TOO_MANY_USER_IDS", "Request is too large");
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AbbottAdminUsersError("INVALID_USER_IDS", "Invalid request");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

function errorResponse(error: unknown) {
  if (error instanceof AbbottAdminUsersError) {
    if (error.code === "TOO_MANY_USER_IDS" && error.message === "Request is too large") {
      return privateJson({ error: "Request is too large" }, { status: 413 });
    }
    if (error.code === "INVALID_USER_IDS" || error.code === "TOO_MANY_USER_IDS") {
      return privateJson({ error: "Invalid administrator User ID list" }, { status: 400 });
    }
  }
  return privateJson({ error: "Administrator settings are unavailable" }, { status: 500 });
}

export function createAbbottAdminUsersHandlers(
  overrides: Partial<AbbottAdminUsersRouteDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  async function authorizeManager(
    request: Request,
    context: { params: Promise<{ id: string }> | { id: string } },
  ): Promise<
    | { ok: false; response: NextResponse }
    | { ok: true; dashboardId: number }
  > {
    const { id } = await Promise.resolve(context.params);
    const access = await dependencies.authorize(request, id);
    if (!access.context || access.context.client_id.trim().toLowerCase() !== "abbott") {
      return { ok: false, response: privateJson({ error: "Dashboard not found" }, { status: 404 }) };
    }
    if (!access.authorized) {
      return { ok: false, response: privateJson({ error: "Authentication required" }, { status: 401 }) };
    }
    if (access.audience !== "manager") {
      return { ok: false, response: privateJson({ error: "Manager access required" }, { status: 403 }) };
    }
    return { ok: true, dashboardId: access.context.id };
  }

  return {
    async GET(
      request: Request,
      context: { params: Promise<{ id: string }> | { id: string } },
    ) {
      const access = await authorizeManager(request, context);
      if (!access.ok) return access.response;
      try {
        return privateJson({ user_ids: await dependencies.list(access.dashboardId) });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async POST(
      request: Request,
      context: { params: Promise<{ id: string }> | { id: string } },
    ) {
      const access = await authorizeManager(request, context);
      if (!access.ok) return access.response;
      try {
        const body = await boundedJson(request);
        if (!isRecord(body) || !Array.isArray(body.user_ids)) {
          throw new AbbottAdminUsersError("INVALID_USER_IDS", "Invalid request");
        }
        return privateJson({
          user_ids: await dependencies.add(access.dashboardId, body.user_ids),
        });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async DELETE(
      request: Request,
      context: { params: Promise<{ id: string }> | { id: string } },
    ) {
      const access = await authorizeManager(request, context);
      if (!access.ok) return access.response;
      try {
        const body = await boundedJson(request);
        if (!isRecord(body) || typeof body.user_id !== "string") {
          throw new AbbottAdminUsersError("INVALID_USER_IDS", "Invalid request");
        }
        return privateJson({
          user_ids: await dependencies.remove(access.dashboardId, body.user_id),
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const handlers = createAbbottAdminUsersHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;

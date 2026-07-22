import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  verifyAdminSession,
} from "./access-auth";
import { createSharedPasswordAdminRouteHandlers } from "./shared-password-admin-route";

const routeUrl = "http://localhost/api/admin/dashboards/28/shared-password";

function adminRequest(method: "GET" | "PUT", body?: Record<string, unknown>) {
  const session = createAdminSession("ADMIN@example.test");
  return new Request(routeUrl, {
    method,
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(session)}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function assertPrivateNoStore(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

test("injectable admin route GET returns only safe state without caching", async () => {
  const handlers = createSharedPasswordAdminRouteHandlers({
    verifySession: verifyAdminSession,
    readState: async () => ({
      status: 200,
      body: {
        supported: true,
        configured: true,
        updated_at: "2026-07-22T12:00:00.000Z",
      },
    }),
    changePassword: async () => {
      throw new Error("unexpected");
    },
    logFailure: () => {},
  });

  const response = await handlers.GET(adminRequest("GET"), {
    params: Promise.resolve({ id: "28" }),
  });

  assert.equal(response.status, 200);
  assertPrivateNoStore(response);
  assert.deepEqual(await response.json(), {
    supported: true,
    configured: true,
    updated_at: "2026-07-22T12:00:00.000Z",
  });
});

test("injectable admin route PUT derives actor from a real signed cookie", async () => {
  let receivedInput: {
    dashboardId: number;
    body: unknown;
    adminEmail: string;
  } | null = null;
  const handlers = createSharedPasswordAdminRouteHandlers({
    verifySession: verifyAdminSession,
    readState: async () => {
      throw new Error("unexpected");
    },
    changePassword: async (input) => {
      receivedInput = input;
      return {
        status: 200,
        body: {
          ok: true,
          configured: true,
          updated_at: "2026-07-22T13:00:00.000Z",
        },
      };
    },
    logFailure: () => {},
  });
  const body = {
    new_password: "0123456789",
    confirm_password: "0123456789",
    updated_by: "attacker@example.test",
  };

  const response = await handlers.PUT(adminRequest("PUT", body), {
    params: Promise.resolve({ id: "28" }),
  });

  assert.equal(response.status, 200);
  assertPrivateNoStore(response);
  assert.deepEqual(receivedInput, {
    dashboardId: 28,
    body,
    adminEmail: "admin@example.test",
  });
  assert.deepEqual(await response.json(), {
    ok: true,
    configured: true,
    updated_at: "2026-07-22T13:00:00.000Z",
  });
});

test("injectable admin route propagates a safe missing-dashboard response", async () => {
  const handlers = createSharedPasswordAdminRouteHandlers({
    verifySession: verifyAdminSession,
    readState: async () => ({
      status: 404,
      body: { error: "Дашборд не найден" },
    }),
    changePassword: async () => {
      throw new Error("unexpected");
    },
    logFailure: () => {},
  });

  const response = await handlers.GET(adminRequest("GET"), {
    params: { id: "28" },
  });

  assert.equal(response.status, 404);
  assertPrivateNoStore(response);
  assert.deepEqual(await response.json(), { error: "Дашборд не найден" });
});

test("injectable admin route propagates a safe unsupported-dashboard response", async () => {
  const handlers = createSharedPasswordAdminRouteHandlers({
    verifySession: verifyAdminSession,
    readState: async () => {
      throw new Error("unexpected");
    },
    changePassword: async () => ({
      status: 400,
      body: { error: "Смена пароля недоступна для этого дашборда" },
    }),
    logFailure: () => {},
  });

  const response = await handlers.PUT(
    adminRequest("PUT", {
      new_password: "0123456789",
      confirm_password: "0123456789",
    }),
    { params: { id: "28" } },
  );

  assert.equal(response.status, 400);
  assertPrivateNoStore(response);
  assert.deepEqual(await response.json(), {
    error: "Смена пароля недоступна для этого дашборда",
  });
});

for (const method of ["GET", "PUT"] as const) {
  test(`injectable admin route sanitizes and safely logs unexpected ${method} errors`, async () => {
    const logged: unknown[][] = [];
    const failure = new Error(
      "password=secret hash=private cookie=signed database=internal",
    );
    const handlers = createSharedPasswordAdminRouteHandlers({
      verifySession: verifyAdminSession,
      readState: async () => {
        throw failure;
      },
      changePassword: async () => {
        throw failure;
      },
      logFailure: (...args) => logged.push(args),
    });

    const response = await handlers[method](
      adminRequest(
        method,
        method === "PUT"
          ? {
              new_password: "0123456789",
              confirm_password: "0123456789",
            }
          : undefined,
      ),
      { params: Promise.resolve({ id: "28" }) },
    );

    assert.equal(response.status, 500);
    assertPrivateNoStore(response);
    assert.deepEqual(await response.json(), {
      error: "Не удалось сохранить пароль",
    });
    assert.deepEqual(logged, [
      [`shared_password_admin_${method.toLowerCase()}_failed`, 28],
    ]);
  });
}

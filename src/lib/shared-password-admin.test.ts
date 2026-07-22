import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
} from "./access-auth";
import {
  changeSharedPassword,
  readSharedPasswordState,
} from "./shared-password-admin";
import { SharedPasswordRotationError } from "./dashboard-shared-access";

const configuredState = {
  supported: true,
  configured: true,
  client_id: "zaruku",
  credential_version: 7,
  updated_at: "2026-07-22T10:00:00.000Z",
};

test("admin state read returns only fields safe for the settings UI", async () => {
  const result = await readSharedPasswordState(
    { dashboardId: 28 },
    { getState: async () => configuredState },
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    supported: true,
    configured: true,
    updated_at: "2026-07-22T10:00:00.000Z",
  });
  assert.equal(JSON.stringify(result.body).includes("client_id"), false);
  assert.equal(JSON.stringify(result.body).includes("credential_version"), false);
});

test("admin state reports rowless Abbott fallback as not migrated without authority details", async () => {
  const result = await readSharedPasswordState(
    { dashboardId: 18 },
    {
      getState: async () => ({
        supported: true,
        configured: false,
        client_id: "abbott",
        credential_version: 0,
        updated_at: null,
      }),
    },
  );

  assert.deepEqual(result, {
    status: 200,
    body: { supported: true, configured: false, updated_at: null },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /abbott|fallback|source|hash|version/i);
});

test("admin state read maps a missing dashboard without exposing store details", async () => {
  const result = await readSharedPasswordState(
    { dashboardId: 404 },
    {
      getState: async () => ({
        supported: false,
        configured: false,
        client_id: null,
        credential_version: 0,
        updated_at: null,
      }),
    },
  );

  assert.deepEqual(result, {
    status: 404,
    body: { error: "Дашборд не найден" },
  });
});

test("admin state read rejects an invalid dashboard ID before DB access", async () => {
  let called = false;
  const result = await readSharedPasswordState(
    { dashboardId: 1.5 },
    {
      getState: async () => {
        called = true;
        throw new Error("unexpected");
      },
    },
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Некорректный идентификатор дашборда" },
  });
  assert.equal(called, false);
});

test("admin password change derives actor from session and returns no secret fields", async () => {
  let receivedActor = "";
  const result = await changeSharedPassword(
    {
      dashboardId: 28,
      body: {
        new_password: "zaruku-next",
        confirm_password: "zaruku-next",
        updated_by: "attacker@example.test",
      },
      adminEmail: "ADMIN@example.test",
    },
    {
      rotate: async (_id, _password, actor) => {
        receivedActor = actor;
        return {
          supported: true,
          configured: true,
          client_id: "zaruku",
          credential_version: 2,
          updated_at: "2026-07-22T10:00:00.000Z",
        };
      },
    },
  );

  assert.equal(result.status, 200);
  assert.equal(receivedActor, "admin@example.test");
  assert.deepEqual(result.body, {
    ok: true,
    configured: true,
    updated_at: "2026-07-22T10:00:00.000Z",
  });
  assert.equal(JSON.stringify(result.body).includes("password"), false);
  assert.equal(JSON.stringify(result.body).includes("hash"), false);
});

test("admin password change rejects mismatches before DB rotation", async () => {
  let called = false;
  const result = await changeSharedPassword(
    {
      dashboardId: 28,
      body: {
        new_password: "0123456789",
        confirm_password: "012345678X",
      },
      adminEmail: "admin@example.test",
    },
    {
      rotate: async () => {
        called = true;
        throw new Error("unexpected");
      },
    },
  );

  assert.equal(result.status, 400);
  assert.equal(called, false);
});

test("admin password change rejects an invalid dashboard ID before rotation", async () => {
  let called = false;
  const result = await changeSharedPassword(
    {
      dashboardId: -1,
      body: {
        new_password: "0123456789",
        confirm_password: "0123456789",
      },
      adminEmail: "admin@example.test",
    },
    {
      rotate: async () => {
        called = true;
        throw new Error("unexpected");
      },
    },
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Некорректный идентификатор дашборда" },
  });
  assert.equal(called, false);
});

test("admin password change rejects unsupported dashboards before rotation", async () => {
  let rotated = false;
  const result = await changeSharedPassword(
    {
      dashboardId: 12,
      body: {
        new_password: "0123456789",
        confirm_password: "0123456789",
      },
      adminEmail: "admin@example.test",
    },
    {
      getState: async () => ({
        supported: false,
        configured: false,
        client_id: "other",
        credential_version: 0,
        updated_at: null,
      }),
      rotate: async () => {
        rotated = true;
        throw new Error("unexpected");
      },
    },
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Смена пароля недоступна для этого дашборда" },
  });
  assert.equal(rotated, false);
});

test("admin password change maps a missing dashboard before rotation", async () => {
  let rotated = false;
  const result = await changeSharedPassword(
    {
      dashboardId: 404,
      body: {
        new_password: "0123456789",
        confirm_password: "0123456789",
      },
      adminEmail: "admin@example.test",
    },
    {
      getState: async () => ({
        supported: false,
        configured: false,
        client_id: null,
        credential_version: 0,
        updated_at: null,
      }),
      rotate: async () => {
        rotated = true;
        throw new Error("unexpected");
      },
    },
  );

  assert.deepEqual(result, {
    status: 404,
    body: { error: "Дашборд не найден" },
  });
  assert.equal(rotated, false);
});

test("admin password change maps deletion after preflight from the transaction error", async () => {
  const result = await changeSharedPassword(
    {
      dashboardId: 28,
      body: {
        new_password: "0123456789",
        confirm_password: "0123456789",
      },
      adminEmail: "admin@example.test",
    },
    {
      getState: async () => configuredState,
      rotate: async () => {
        throw new SharedPasswordRotationError("DASHBOARD_NOT_FOUND");
      },
    },
  );

  assert.deepEqual(result, {
    status: 404,
    body: { error: "Дашборд не найден" },
  });
});

test("admin password change maps client change after preflight from the transaction error", async () => {
  const result = await changeSharedPassword(
    {
      dashboardId: 28,
      body: {
        new_password: "0123456789",
        confirm_password: "0123456789",
      },
      adminEmail: "admin@example.test",
    },
    {
      getState: async () => configuredState,
      rotate: async () => {
        throw new SharedPasswordRotationError("UNSUPPORTED_DASHBOARD");
      },
    },
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Смена пароля недоступна для этого дашборда" },
  });
});

test("shared password route rejects a missing signed admin session without caching", async () => {
  const { GET } = await import(
    "../app/api/admin/dashboards/[id]/shared-password/route"
  );
  const response = await GET(
    new Request("http://localhost/api/admin/dashboards/28/shared-password"),
    { params: Promise.resolve({ id: "28" }) },
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Требуется авторизация" });
});

test("shared password route treats a malformed encoded admin cookie as unauthorized", async () => {
  const { GET } = await import(
    "../app/api/admin/dashboards/[id]/shared-password/route"
  );
  const response = await GET(
    new Request("http://localhost/api/admin/dashboards/28/shared-password", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=%` },
    }),
    { params: Promise.resolve({ id: "28" }) },
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("shared password route validates a signed admin PUT before database access", async () => {
  const { PUT } = await import(
    "../app/api/admin/dashboards/[id]/shared-password/route"
  );
  const session = createAdminSession("ADMIN@example.test");
  const request = new Request(
    "http://localhost/api/admin/dashboards/28/shared-password",
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(session)}`,
      },
      body: JSON.stringify({
        new_password: "0123456789",
        confirm_password: "012345678X",
        updated_by: "attacker@example.test",
      }),
    },
  );
  const response = await PUT(request, {
    params: Promise.resolve({ id: "28" }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Пароли не совпадают" });
});

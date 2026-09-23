import assert from "node:assert/strict";
import test from "node:test";

import type { isDashboardAccessAuthorized } from "@/lib/dashboard-access";
import { createAbbottAdminUsersHandlers } from "../../../../../lib/abbott-admin-users-handler";
import { GET, POST, DELETE } from "./route";
import { AbbottAdminUsersError } from "@/lib/abbott-admin-users";

type Access = Awaited<ReturnType<typeof isDashboardAccessAuthorized>>;

const managerAccess = {
  context: {
    id: 18,
    client_id: "abbott",
    dashboard_type: "abbott_bi",
    client_name: "Abbott",
    dashboard_name: "Abbott",
    is_active: true,
    access_users_count: 0,
    auth_mode: "password_only" as const,
  },
  authorized: true as const,
  reason: "authorized" as const,
  audience: "manager" as const,
};

function handlers(overrides: Partial<Parameters<typeof createAbbottAdminUsersHandlers>[0]> = {}) {
  const calls: Array<{ kind: string; dashboardId: number; values?: readonly unknown[] | unknown }> = [];
  const dependencies = {
    authorize: async () => managerAccess as Access,
    list: async (dashboardId: number) => {
      calls.push({ kind: "list", dashboardId });
      return ["001", "20"];
    },
    add: async (dashboardId: number, values: readonly unknown[]) => {
      calls.push({ kind: "add", dashboardId, values });
      return ["001", "20", "30"];
    },
    remove: async (dashboardId: number, value: unknown) => {
      calls.push({ kind: "remove", dashboardId, values: value });
      return ["20"];
    },
    ...overrides,
  };
  return { ...createAbbottAdminUsersHandlers(dependencies), calls };
}

const context = { params: Promise.resolve({ id: "abbott" }) };

test("GET returns the private sorted list using the resolved numeric Abbott dashboard ID", async () => {
  const api = handlers();
  const response = await api.GET(new Request("https://dashboards.test/api/dashboard/abbott/abbott-admin-users"), context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { user_ids: ["001", "20"] });
  assert.deepEqual(api.calls, [{ kind: "list", dashboardId: 18 }]);
});

test("route rejects missing, unauthenticated, embed, and non-Abbott access before storage", async () => {
  const cases: Array<{ access: Access; status: number }> = [
    { access: { context: null, authorized: false, reason: "not_found" }, status: 404 },
    {
      access: {
        context: managerAccess.context,
        authorized: false,
        reason: "auth_required",
      },
      status: 401,
    },
    { access: { ...managerAccess, audience: "embed" } as Access, status: 403 },
    {
      access: { ...managerAccess, context: { ...managerAccess.context, client_id: "zaruku" } } as Access,
      status: 404,
    },
  ];

  for (const item of cases) {
    const api = handlers({ authorize: async () => item.access });
    const response = await api.GET(new Request("https://dashboards.test/api/dashboard/abbott/abbott-admin-users"), context);
    assert.equal(response.status, item.status);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(api.calls, []);
  }
});

test("POST accepts only a bounded user_ids JSON array and returns persisted rows", async () => {
  const api = handlers();
  const response = await api.POST(new Request(
    "https://dashboards.test/api/dashboard/abbott/abbott-admin-users",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: ["001", "30"] }),
    },
  ), context);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user_ids: ["001", "20", "30"] });
  assert.deepEqual(api.calls, [{ kind: "add", dashboardId: 18, values: ["001", "30"] }]);

  for (const body of ["not-json", JSON.stringify({ user_ids: "001" }), JSON.stringify({})]) {
    const invalid = handlers();
    const invalidResponse = await invalid.POST(new Request(
      "https://dashboards.test/api/dashboard/abbott/abbott-admin-users",
      { method: "POST", body },
    ), context);
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(invalid.calls, []);
  }

  const oversized = handlers();
  const oversizedResponse = await oversized.POST(new Request(
    "https://dashboards.test/api/dashboard/abbott/abbott-admin-users",
    { method: "POST", body: "x".repeat(16 * 1024 + 1) },
  ), context);
  assert.equal(oversizedResponse.status, 413);
  assert.deepEqual(oversized.calls, []);
});

test("DELETE removes exactly one textual ID and rejects malformed bodies", async () => {
  const api = handlers();
  const response = await api.DELETE(new Request(
    "https://dashboards.test/api/dashboard/abbott/abbott-admin-users",
    { method: "DELETE", body: JSON.stringify({ user_id: "001" }) },
  ), context);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user_ids: ["20"] });
  assert.deepEqual(api.calls, [{ kind: "remove", dashboardId: 18, values: "001" }]);

  const invalid = handlers();
  const invalidResponse = await invalid.DELETE(new Request(
    "https://dashboards.test/api/dashboard/abbott/abbott-admin-users",
    { method: "DELETE", body: JSON.stringify({ user_id: ["001"] }) },
  ), context);
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(invalid.calls, []);
});

test("storage failures return generic private errors without leaking submitted IDs", async () => {
  const api = handlers({
    add: async () => {
      throw new Error("SQL failed for private ID 900001");
    },
  });
  const response = await api.POST(new Request(
    "https://dashboards.test/api/dashboard/abbott/abbott-admin-users",
    { method: "POST", body: JSON.stringify({ user_ids: ["900001"] }) },
  ), context);
  const body = JSON.stringify(await response.json());

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.doesNotMatch(body, /900001|SQL/);
});

test("isolated route exports Promise-only GET, POST and DELETE", () => {
  for (const method of [GET, POST, DELETE]) assert.equal(typeof method, "function");
});

test("both aliases permit manager reads; all methods deny embed before storage", async () => {
  for (const id of ["18", "abbott"]) {
    const api = handlers();
    assert.equal((await api.GET(new Request("https://example.test"), { params: { id } })).status, 200);
    const embed = handlers({ authorize: async () => ({ ...managerAccess, audience: "embed" }) as Access });
    for (const method of [embed.GET, embed.POST, embed.DELETE]) {
      const response = await method(new Request("https://example.test"), { params: { id } });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.deepEqual(embed.calls, []);
  }
});

test("foreign aliases and resolved numeric/type mismatches fail before private storage", async () => {
  let authCalls = 0;
  const api = handlers({ authorize: async () => { authCalls++; return managerAccess as Access; } });
  for (const method of [api.GET, api.POST, api.DELETE]) {
    assert.equal((await method(new Request("https://example.test"), { params: { id: "28" } })).status, 404);
  }
  assert.equal(authCalls, 0);
  for (const wrong of [{id: 28}, {dashboard_type: "other"}]) {
    const api = handlers({ authorize: async () => ({ ...managerAccess, context: {...managerAccess.context, ...wrong} }) as Access });
    assert.equal((await api.GET(new Request("https://example.test"), context)).status, 404);
    assert.deepEqual(api.calls, []);
  }
});

test("declared and actual body bounds and storage validation preserve 413/400 mappings", async () => {
  for (const method of ["POST", "DELETE"] as const) {
    for (const init of [{ body: "{}", headers: { "content-length": "16385" } }, { body: "x".repeat(16385) }]) {
      const api = handlers();
      const response = await api[method](new Request("https://example.test", { method, ...init }), context);
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), {error: "Request is too large"});
      assert.deepEqual(api.calls, []);
    }
  }
  for (const code of ["INVALID_USER_IDS", "TOO_MANY_USER_IDS"] as const) {
    const api = handlers({ add: async () => { throw new AbbottAdminUsersError(code, "private-id"); } });
    const response = await api.POST(new Request("https://example.test", { method: "POST", body: '{"user_ids":["001","001"]}' }), context);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {error: "Invalid administrator User ID list"});
  }
});

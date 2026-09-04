import assert from "node:assert/strict";
import test from "node:test";
import { createViewerSession } from "@/lib/access-auth";
import { createDashboardAccessAuthorizer, getDashboardAccessContext } from "@/lib/dashboard-access";
import pool from "@/lib/db";
import { createZarukuRouteAuthorizer, isZarukuDashboardIdentity } from "./zaruku-route-access";

const dashboard = {
  id: 28,
  client_id: "zaruku",
  dashboard_type: "zaruku_bi",
  client_name: "Zaruku",
  dashboard_name: "Dashboard",
  is_active: true,
  access_users_count: 0,
  auth_mode: "password_only" as const,
};

test("Zaruku identity requires both canonical client and dashboard type", () => {
  assert.equal(isZarukuDashboardIdentity(dashboard), true);
  for (const context of [null, {}, { ...dashboard, client_id: "abbott" }, { ...dashboard, dashboard_type: "abbott_bi" }, { ...dashboard, dashboard_type: undefined }]) {
    assert.equal(isZarukuDashboardIdentity(context), false);
  }
});

test("isolated authorizer rejects other identifiers before shared authorization", async () => {
  const calls: unknown[] = [];
  const authorize = createZarukuRouteAuthorizer({
    authorize: (async (...args: unknown[]) => { calls.push(args); throw new Error("must not authorize"); }) as never,
  });
  for (const identifier of ["abbott", "28", "gidrofuril"]) {
    const access = await authorize(new Request("https://dash.test/api/dashboard/zaruku"), identifier);
    assert.equal(access.authorized, false);
    assert.equal(access.context, null);
  }
  assert.deepEqual(calls, []);
});

test("isolated authorizer fails closed when shared authorization resolves a foreign identity", async () => {
  for (const context of [{ ...dashboard, client_id: "abbott" }, { ...dashboard, dashboard_type: "awareness" }]) {
    const authorize = createZarukuRouteAuthorizer({
      authorize: (async () => ({ authorized: true, audience: "manager", context })) as never,
    });
    const access = await authorize(new Request("https://dash.test/api/dashboard/zaruku"), "zaruku");
    assert.equal(access.authorized, false);
    assert.equal(access.context, null);
  }
});

test("isolated authorizer keeps the shared signed-session credential rotation gate", async () => {
  const authorize = createZarukuRouteAuthorizer({
    authorize: createDashboardAccessAuthorizer({
      getDashboardAccessContext: async () => dashboard,
      loadSharedPasswordCredential: async () => ({ source: "database", password_hash: "unused", legacy_password: null, credential_version: 7 }),
    }),
  });
  for (const version of [6, 7]) {
    const token = createViewerSession(28, "shared-access+zaruku@dashboard.local", "manager", version);
    const access = await authorize(new Request(`https://dash.test/api/dashboard/zaruku?access_token=${token}`), " ZARUKU ");
    assert.equal(access.authorized, version === 7);
    if (access.authorized) {
      assert.equal(access.audience, "manager");
      assert.equal(access.credentialVersion, 7);
    }
  }
});

test("shared canonical access lookup includes dashboard type in its returned identity", async (t) => {
  t.mock.method(pool, "execute", async (sql: string, parameters: unknown[]) => {
    assert.match(sql, /d\.dashboard_type/);
    assert.deepEqual(parameters, [28, "28"]);
    return [[dashboard], []];
  });
  const context = await getDashboardAccessContext(28);
  assert.equal(context?.id, 28);
  assert.equal(context?.client_id, "zaruku");
  assert.equal(context?.dashboard_type, "zaruku_bi");
  assert.equal(context?.auth_mode, "password_only");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { isDashboardAccessAuthorized } from "../../../../src/lib/dashboard-access";
import {
  createAbbottRouteAuthorizer,
  isAbbottDashboardIdentity,
} from "./abbott-route-access";

type Access = Awaited<ReturnType<typeof isDashboardAccessAuthorized>>;

const request = new Request("https://example.test/api/dashboard/abbott");

function context(overrides: Record<string, unknown> = {}) {
  return {
    id: 18,
    client_id: "abbott",
    client_name: "Abbott",
    dashboard_name: "Abbott BI",
    dashboard_type: "abbott_bi",
    is_active: true,
    access_users_count: 0,
    auth_mode: "password_only",
    ...overrides,
  };
}

function managerAccess(overrides: Record<string, unknown> = {}): Access {
  return {
    context: context(overrides),
    authorized: true,
    reason: "authorized",
    audience: "manager",
    credentialVersion: 1,
  } as unknown as Access;
}

test("both aliases authorize the canonical Abbott identity", async () => {
  const seen: Array<string | number> = [];
  const authorize = (async (_request: Request, identifier: string | number) => {
    seen.push(identifier);
    return managerAccess();
  }) as typeof isDashboardAccessAuthorized;

  for (const id of ["18", "abbott"]) {
    const access = await createAbbottRouteAuthorizer({ authorize })(request, id);
    assert.equal(access.authorized, true);
    assert.equal(access.context?.client_id, "abbott");
  }
  assert.deepEqual(seen, ["18", "abbott"]);
});

test("unowned aliases fail closed before invoking shared authorization", async () => {
  let calls = 0;
  const authorize = (async () => {
    calls += 1;
    return managerAccess();
  }) as typeof isDashboardAccessAuthorized;

  for (const id of ["28", "zaruku", "18/unknown", "abbott-extra"]) {
    const access = await createAbbottRouteAuthorizer({ authorize })(request, id);
    assert.deepEqual(access, { context: null, authorized: false, reason: "not_found" });
  }
  assert.equal(calls, 0);
});

test("authorization requires the exact Abbott id, client and dashboard type", async () => {
  for (const overrides of [
    { id: 28 },
    { client_id: "zaruku" },
    { dashboard_type: "zaruku_bi" },
    { dashboard_type: undefined },
  ]) {
    const authorize = (async () => managerAccess(overrides)) as typeof isDashboardAccessAuthorized;
    const access = await createAbbottRouteAuthorizer({ authorize })(request, "abbott");
    assert.deepEqual(access, { context: null, authorized: false, reason: "not_found" });
  }
});

test("canonical unauthorized access is retained for the current 401 response", async () => {
  const expected = {
    context: context(),
    authorized: false as const,
    reason: "auth_required" as const,
  } as unknown as Access;
  const authorize = (async () => expected) as typeof isDashboardAccessAuthorized;
  assert.strictEqual(
    await createAbbottRouteAuthorizer({ authorize })(request, "18"),
    expected,
  );
});

test("Abbott identity matching is strict and normalization-safe", () => {
  assert.equal(isAbbottDashboardIdentity(context({ client_id: " ABBOTT " })), true);
  assert.equal(isAbbottDashboardIdentity(null), false);
  assert.equal(isAbbottDashboardIdentity({}), false);
  assert.equal(isAbbottDashboardIdentity(context({ id: "18" })), true);
  assert.equal(isAbbottDashboardIdentity(context({ id: "not-18" })), false);
});

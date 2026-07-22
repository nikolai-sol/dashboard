import assert from "node:assert/strict";
import test from "node:test";
import { verifyViewerSession } from "./access-auth";
import { createRateLimiter } from "./rate-limit";
import * as loginRoute from "../app/api/dashboard-auth/login/route";

type LoginHandler = (request: Request) => Promise<Response>;
type LoginHandlerFactory = (dependencies: Record<string, unknown>) => LoginHandler;

const dashboard = {
  id: 28,
  client_id: "abbott",
  client_name: "Abbott",
  dashboard_name: "Dashboard",
  is_active: true,
  access_users_count: 0,
  auth_mode: "password_only" as const,
};

function createLoginHandler(dependencies: Record<string, unknown>) {
  const factory = (loginRoute as unknown as {
    createDashboardLoginHandler?: LoginHandlerFactory;
  }).createDashboardLoginHandler;
  assert.equal(typeof factory, "function");
  return (factory as LoginHandlerFactory)(dependencies);
}

function loginRequest(
  dashboardId: string,
  options: { realIp?: string; forwardedFor?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.realIp) headers.set("x-real-ip", options.realIp);
  if (options.forwardedFor) headers.set("x-forwarded-for", options.forwardedFor);
  return new Request("http://dashboard.test/api/dashboard-auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ dashboard_id: dashboardId, password: "wrong-password" }),
  });
}

test("trusted client IP ignores spoofed forwarded-for and uses a stable safe fallback", () => {
  const getTrustedClientIp = (loginRoute as unknown as {
    getTrustedClientIp?: (request: Request) => string;
  }).getTrustedClientIp;
  assert.equal(typeof getTrustedClientIp, "function");
  const trustedClientIp = getTrustedClientIp as (request: Request) => string;

  assert.equal(
    trustedClientIp(
      loginRequest("28", {
        realIp: "192.0.2.10",
        forwardedFor: "203.0.113.99, 192.0.2.10",
      }),
    ),
    "192.0.2.10",
  );
  assert.equal(
    trustedClientIp(loginRequest("28", { forwardedFor: "203.0.113.99" })),
    "untrusted-proxy",
  );
  assert.equal(
    trustedClientIp(loginRequest("28", { realIp: "not-an-ip" })),
    "untrusted-proxy",
  );
});

test("IP-wide limiter rejects before dashboard lookup or password verification", async () => {
  const calls: string[] = [];
  const handler = createLoginHandler({
    checkRateLimit() {
      calls.push("limit");
      return { allowed: false, remaining: 0, retryAfterSec: 60 };
    },
    async getDashboardAccessContext() {
      calls.push("lookup");
      return dashboard;
    },
    async verifyDashboardAccessContextCredentials() {
      calls.push("verify");
      return null;
    },
  });

  const response = await handler(loginRequest("28", { realIp: "192.0.2.10" }));

  assert.equal(response.status, 429);
  assert.deepEqual(calls, ["limit"]);
});

test("equivalent dashboard identifiers share brute-force protection", async () => {
  const limiter = createRateLimiter({ maxBuckets: 100, now: () => 1_000 });
  const handler = createLoginHandler({
    checkRateLimit: limiter.checkRateLimit,
    async getDashboardAccessContext() {
      return dashboard;
    },
    async verifyDashboardAccessContextCredentials() {
      return null;
    },
  });
  const identifiers = [
    "28",
    "028",
    "28.0",
    "2.8e1",
    "abbott",
    "28",
    "028",
    "28.0",
    "2.8e1",
    "abbott",
    "28",
  ];

  for (const identifier of identifiers.slice(0, 10)) {
    const response = await handler(loginRequest(identifier, { realIp: "192.0.2.10" }));
    assert.equal(response.status, 401);
  }
  const blocked = await handler(loginRequest(identifiers[10], { realIp: "192.0.2.10" }));

  assert.equal(blocked.status, 429);
  const retryAfter = Number(blocked.headers.get("Retry-After"));
  assert.ok(Number.isInteger(retryAfter));
  assert.ok(retryAfter >= 1);
});

test("spoofed forwarded-for values cannot escape the trusted real-IP bucket", async () => {
  const limiter = createRateLimiter({ maxBuckets: 100, now: () => 1_000 });
  const handler = createLoginHandler({
    checkRateLimit: limiter.checkRateLimit,
    async getDashboardAccessContext() {
      return dashboard;
    },
    async verifyDashboardAccessContextCredentials() {
      return null;
    },
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await handler(
      loginRequest("28", {
        realIp: "192.0.2.10",
        forwardedFor: `203.0.113.${attempt}`,
      }),
    );
    assert.equal(response.status, 401);
  }
  const blocked = await handler(
    loginRequest("28", {
      realIp: "192.0.2.10",
      forwardedFor: "198.51.100.200",
    }),
  );

  assert.equal(blocked.status, 429);
});

test("canonical dashboard keys use resolved IDs and unknown identifiers allocate no unique bucket", async () => {
  const keys: string[] = [];
  const handler = createLoginHandler({
    checkRateLimit(key: string) {
      keys.push(key);
      return { allowed: true, remaining: 9, retryAfterSec: 0 };
    },
    async getDashboardAccessContext(identifier: string | number) {
      return String(identifier).startsWith("missing-") ? null : dashboard;
    },
    async verifyDashboardAccessContextCredentials() {
      return null;
    },
  });

  for (const identifier of ["28", "028", "28.0", "2.8e1", "abbott"]) {
    await handler(loginRequest(identifier, { realIp: "192.0.2.10" }));
  }
  await handler(loginRequest("missing-one", { realIp: "192.0.2.10" }));
  await handler(loginRequest("missing-two", { realIp: "192.0.2.10" }));

  const dashboardKeys = keys.filter((key) => key.startsWith("dashboard-login:"));
  assert.deepEqual(dashboardKeys, Array(5).fill("dashboard-login:192.0.2.10:dashboard:28"));
  assert.equal(keys.filter((key) => key === "dashboard-login-ip:192.0.2.10").length, 7);
  assert.equal(keys.length, 12);
});

test("successful shared login returns a manager session with the verified credential version", async () => {
  const handler = createLoginHandler({
    checkRateLimit() {
      return { allowed: true, remaining: 9, retryAfterSec: 0 };
    },
    async getDashboardAccessContext() {
      return dashboard;
    },
    async verifyDashboardAccessContextCredentials() {
      return { ...dashboard, credentialVersion: 7 };
    },
  });

  const response = await handler(loginRequest("abbott", { realIp: "192.0.2.10" }));
  const body = await response.json() as { access_token?: string };
  const payload = verifyViewerSession(body.access_token, dashboard.id);

  assert.equal(response.status, 200);
  assert.equal(payload?.audience, "manager");
  assert.equal(payload?.credential_version, 7);
});

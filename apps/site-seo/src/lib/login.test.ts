import assert from "node:assert/strict";
import test from "node:test";
import type { SiteRegistration } from "@reportingdash/site-seo-contract";
import { createSiteLoginHandler } from "./login.ts";
import { createSignedViewerCookieVerifier } from "./runtime.ts";

const registration = {
  profile: { dashboardId: 41, clientId: "client-roche", siteId: "site-medroche" },
  bindings: [],
} as unknown as SiteRegistration;

test("standalone login issues the existing dashboard-scoped viewer cookie", async () => {
  const response = await createSiteLoginHandler({
    loadRegistration: async () => registration,
    verifyPassword: async (_registration, password) => password === "valid" ? { credentialVersion: 3 } : null,
    secret: "fixture-secret",
  })(new Request("http://localhost/api/dashboard-auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "127.0.0.1" },
    body: JSON.stringify({ dashboard_id: 41, password: "valid" }),
  }));

  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^dashboard_viewer_41=/);
  assert.match(cookie, /HttpOnly/);
  const token = cookie.match(/^dashboard_viewer_41=([^;]+)/)?.[1] ?? null;
  const payload = await createSignedViewerCookieVerifier("fixture-secret")(token, 41);
  assert.equal(payload?.credentialVersion, 3);
});

test("standalone login rejects another dashboard before password verification", async () => {
  let calls = 0;
  const response = await createSiteLoginHandler({
    loadRegistration: async () => registration,
    verifyPassword: async () => { calls += 1; return { credentialVersion: 3 }; },
    secret: "fixture-secret",
  })(new Request("http://localhost/api/dashboard-auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dashboard_id: 28, password: "valid" }),
  }));

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("standalone login does not issue a cookie for an invalid password", async () => {
  const response = await createSiteLoginHandler({
    loadRegistration: async () => registration,
    verifyPassword: async () => null,
    secret: "fixture-secret",
  })(new Request("http://localhost/api/dashboard-auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dashboard_id: 41, password: "invalid" }),
  }));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("standalone login reports a credential database failure without leaking details", async () => {
  const response = await createSiteLoginHandler({
    loadRegistration: async () => registration,
    verifyPassword: async () => { throw new Error("database secret"); },
    secret: "fixture-secret",
  })(new Request("http://localhost/api/dashboard-auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dashboard_id: 41, password: "valid" }),
  }));

  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /database secret/);
});

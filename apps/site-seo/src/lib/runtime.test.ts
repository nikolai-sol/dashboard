import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { SiteRegistration } from "@reportingdash/site-seo-contract";
import { createSignedViewerCookieVerifier, createSiteSeoSessionResolver, loadRuntimeRegistration, parseDashboardReadRequest } from "./runtime.ts";

const registration = {
  profile: { schemaVersion: 1, profileVersion: "fixture", siteId: "site-fixture", clientId: "client-fixture", dashboardId: 42, slug: "fixture", domain: "clinic.example.test", allowedDomains: ["clinic.example.test"], title: "Клиника", logoAsset: null, locale: "ru-RU", businessTimezone: "Europe/Moscow", templateVersion: "fixture", taxonomyVersion: "fixture", seoRulesVersion: "fixture", authPolicyRef: "site-seo", runtime: { route: "/dashboard/fixture", assetPrefix: "/_next-fixture", buildOutputDir: ".next-fixture", processName: "fixture", port: 3010, deployPath: "/var/www/fixture", releaseBranch: "release/fixture", deployLockPath: "/var/www/fixture.lock" }, sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc", importCadence: ["previous_month"] }] },
  bindings: [{ bindingId: "gsc", clientId: "client-fixture", siteId: "site-fixture", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account", resourceId: "resource" }],
} satisfies SiteRegistration;

test("loads and validates exactly one registration from the configured path", async () => {
  const loaded = await loadRuntimeRegistration({ registrationPath: "/fixture/registration.json", readFile: async (path) => { assert.equal(path, "/fixture/registration.json"); return JSON.stringify(registration); }, validateRegistrations: (value) => { assert.ok(Array.isArray(value)); return value as SiteRegistration[]; } });
  assert.equal(loaded.profile.slug, "fixture");
});

test("binds the signed viewer cookie to the registration dashboard, site, and current credential version", async () => {
  const resolve = createSiteSeoSessionResolver({
    verifyViewerCookie: async (token, dashboardId) => token === "signed" && dashboardId === 42 ? { dashboardId: 42, credentialVersion: 7, expiresAt: "2026-10-01T00:00:00Z" } : null,
    loadCredentialVersion: async () => 7,
  });
  const session = await resolve("dashboard_viewer_42=signed", registration);
  assert.deepEqual(session?.siteId, "site-fixture");
  await assert.rejects(createSiteSeoSessionResolver({ verifyViewerCookie: async () => ({ dashboardId: 42, credentialVersion: 6, expiresAt: "2026-10-01T00:00:00Z" }), loadCredentialVersion: async () => 7 })("dashboard_viewer_42=signed", registration), /credential/);
});

test("parses periods, publication, and filters without accepting source IDs from the URL", () => {
  const request = parseDashboardReadRequest(new URL("https://example.test/dashboard/fixture?traffic_week=2026-W01&gsc_period=2026-01&alice_month=2026-01&publication=pub-7&filter_country=RU&analyticsAccountId=attacker"), "fixture", "Europe/Moscow");
  assert.equal(request.publicationId, "pub-7");
  assert.deepEqual(request.filters, { country: "RU", search_type: "web", device: "all" });
  assert.equal(request.selection.gsc.key, "2026-01");
});

test("uses one explicit default GSC filter identity when a dashboard URL has none", () => {
  const request = parseDashboardReadRequest(new URL("https://example.test/dashboard/fixture?traffic_week=2026-W01&gsc_period=2026-01&alice_month=2026-01"), "fixture", "Europe/Moscow");
  assert.deepEqual(request.filters, { country: "all", search_type: "web", device: "all" });
});

test("verifies the existing signed viewer-cookie shape for the exact dashboard", async () => {
  const encode = (value: Buffer) => value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const payload = encode(Buffer.from(JSON.stringify({ type: "viewer", dashboard_id: 42, audience: "manager", credential_version: 7, exp: Math.floor(Date.now() / 1000) + 60 })));
  const token = `${payload}.${encode(crypto.createHmac("sha256", "fixture-secret").update(payload).digest())}`;
  assert.equal((await createSignedViewerCookieVerifier("fixture-secret")(token, 42))?.credentialVersion, 7);
  assert.equal(await createSignedViewerCookieVerifier("fixture-secret")(token, 43), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { Period, SiteProfile, SiteRegistration } from "@reportingdash/site-seo-contract";
import { loadDashboardReadModel } from "./read-model.ts";
import type { CanonicalReadQuery } from "./db.ts";

const profile: SiteProfile = {
  schemaVersion: 1, profileVersion: "fixture-1", siteId: "site-med", clientId: "client-med", dashboardId: 42, slug: "medroche", domain: "clinic.example.test", allowedDomains: ["clinic.example.test"], title: "Синтетическая клиника", logoAsset: null, locale: "ru-RU", businessTimezone: "Europe/Moscow", templateVersion: "fixture", taxonomyVersion: "fixture", seoRulesVersion: "fixture", authPolicyRef: "site-seo",
  runtime: { route: "/dashboard/medroche", assetPrefix: "/_next-medroche", buildOutputDir: ".next-medroche", processName: "fixture", port: 3010, deployPath: "/tmp/fixture", releaseBranch: "fixture", deployLockPath: "/tmp/fixture.lock" },
  sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc-fixture", importCadence: ["previous_month"] }],
};
const registration: SiteRegistration = { profile, bindings: [{ bindingId: "gsc-fixture", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account-fixture", resourceId: "resource-fixture" }] };
const period: Period = { kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" };

test("sends the complete server-resolved scope to the canonical reader", async () => {
  const queries: CanonicalReadQuery[] = [];
  const model = await loadDashboardReadModel({ registration, claim: { dashboardId: 42, siteId: "site-med" }, period, execute: async (query) => {
    queries.push(query);
    return { meta: { sourceKey: "google_search_console", period, state: "complete_empty", collectionMode: "manual", completeness: "complete", importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current", latestAttempt: "success" }, summary: null, daily: [], dimensions: [], indexing: { sourceKey: "google_search_console", period: null, state: "missing", collectionMode: "manual", completeness: "unknown", importId: null, exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none" } };
  }});

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]?.scope, registration.bindings[0]);
  assert.equal(model.gsc.meta.state, "complete_empty");
});

test("reports a missing source instead of querying an invented account", async () => {
  let calls = 0;
  const model = await loadDashboardReadModel({ registration: { ...registration, bindings: [] }, claim: { dashboardId: 42, siteId: "site-med" }, period, execute: async () => { calls += 1; throw new Error("must not run"); } });
  assert.equal(calls, 0);
  assert.equal(model.gsc.meta.state, "missing");
});

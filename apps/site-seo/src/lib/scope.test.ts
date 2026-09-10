import assert from "node:assert/strict";
import test from "node:test";
import type { SiteProfile, SiteRegistration } from "@reportingdash/site-seo-contract";
import { MissingSourceScopeError, resolveSourceScope } from "./scope.ts";

const profile: SiteProfile = {
  schemaVersion: 1, profileVersion: "fixture-1", siteId: "site-med", clientId: "client-med",
  dashboardId: 42, slug: "medroche", domain: "clinic.example.test", allowedDomains: ["clinic.example.test"],
  title: "Синтетическая клиника", logoAsset: null, locale: "ru-RU", businessTimezone: "Europe/Moscow",
  templateVersion: "fixture", taxonomyVersion: "fixture", seoRulesVersion: "fixture", authPolicyRef: "site-seo",
  runtime: { route: "/dashboard/medroche", assetPrefix: "/_next-medroche", buildOutputDir: ".next-medroche", processName: "fixture", port: 3010, deployPath: "/tmp/fixture", releaseBranch: "fixture", deployLockPath: "/tmp/fixture.lock" },
  sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc-fixture", importCadence: ["previous_month"] }],
};

const registration: SiteRegistration = {
  profile,
  bindings: [{ bindingId: "gsc-fixture", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account-fixture", resourceId: "resource-fixture" }],
};

test("resolves a binding only for the authenticated site and dashboard", async () => {
  const scope = await resolveSourceScope(registration, { dashboardId: 42, siteId: "site-med" }, "google_search_console");
  assert.deepEqual(scope, registration.bindings[0]);
});

test("does not substitute a fallback account when the requested binding is absent", async () => {
  await assert.rejects(
    resolveSourceScope({ ...registration, bindings: [] }, { dashboardId: 42, siteId: "site-med" }, "google_search_console"),
    MissingSourceScopeError,
  );
});

test("rejects a session claim from a different site before resolving a binding", async () => {
  await assert.rejects(
    resolveSourceScope(registration, { dashboardId: 42, siteId: "other-site" }, "google_search_console"),
    /site scope does not match/,
  );
});

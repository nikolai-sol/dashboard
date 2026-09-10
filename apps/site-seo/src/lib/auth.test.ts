import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthorizedSiteSession, type SiteSeoSession } from "./auth.ts";
import { createDashboardJsonHandler } from "../app/api/dashboard/[siteSlug]/route.ts";
import { createPeriodSelection } from "./period-selection.ts";

const now = Date.parse("2026-09-10T10:00:00Z");
const session: SiteSeoSession = {
  audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med",
  credentialVersion: 3, expiresAt: "2026-09-10T11:00:00Z",
};

test("accepts only a current session scoped to the requested MedRoche site", () => {
  assert.deepEqual(assertAuthorizedSiteSession(session, { dashboardId: 42, siteId: "site-med", credentialVersion: 3 }, now), session);
});

test("rejects a session issued for another dashboard or credential version", () => {
  assert.throws(() => assertAuthorizedSiteSession(session, { dashboardId: 43, siteId: "site-med", credentialVersion: 3 }, now), /dashboard/);
  assert.throws(() => assertAuthorizedSiteSession(session, { dashboardId: 42, siteId: "site-med", credentialVersion: 4 }, now), /credential/);
});

test("rejects an expired session", () => {
  assert.throws(() => assertAuthorizedSiteSession(session, { dashboardId: 42, siteId: "site-med", credentialVersion: 3 }, Date.parse("2026-09-10T12:00:00Z")), /expired/);
});

test("refuses a direct JSON request for another site slug", async () => {
  const handler = createDashboardJsonHandler({
    registration: { profile: { siteId: "site-med", dashboardId: 42, slug: "medroche" } as never, bindings: [] },
    credentialVersion: 3,
    getSession: async () => session,
    execute: async () => { throw new Error("must not read"); },
  });
  const period = { kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" } as const;
  const response = await handler({ slug: "other-site", selection: createPeriodSelection({ primaryWeek: "2026-W01", aliceMonth: "2026-01", gsc: period }, "Europe/Moscow"), publicationId: null, filters: {} });
  assert.equal(response.status, 404);
});

test("forwards one structured selection, publication, and filters to the JSON read", async () => {
  const queries: unknown[] = [];
  const period = { kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" } as const;
  const handler = createDashboardJsonHandler({
    registration: { profile: { siteId: "site-med", clientId: "client-med", dashboardId: 42, slug: "medroche", sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc", importCadence: [] }] } as never, bindings: [{ bindingId: "gsc", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account", resourceId: "resource" }] },
    credentialVersion: 3,
    getSession: async () => session,
    execute: async (query) => { queries.push(query); return { meta: { sourceKey: "google_search_console", period, state: "complete_empty", collectionMode: "manual", completeness: "complete", importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current", latestAttempt: "success" }, summary: null, daily: [], dimensions: [], indexing: { sourceKey: "google_search_console", period: null, state: "missing", collectionMode: "manual", completeness: "unknown", importId: null, exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none" } }; },
  });
  const response = await handler({ slug: "medroche", selection: createPeriodSelection({ primaryWeek: "2026-W01", aliceMonth: "2026-01", gsc: period }, "Europe/Moscow"), publicationId: "publication-7", filters: { country: "RU" } });
  assert.equal(response.status, 200);
  assert.deepEqual(queries, [{ name: "gsc", scope: { bindingId: "gsc", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account", resourceId: "resource" }, period, publicationId: "publication-7", filters: { country: "RU" } }]);
});

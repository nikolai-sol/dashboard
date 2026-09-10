import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthorizedSiteSession, type SiteSeoSession } from "./auth.ts";
import { createDashboardJsonHandler } from "../app/api/dashboard/[siteSlug]/route.ts";

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
  const response = await handler({ slug: "other-site", period: { kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" } });
  assert.equal(response.status, 404);
});

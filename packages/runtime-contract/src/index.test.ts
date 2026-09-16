import assert from "node:assert/strict";
import test from "node:test";
import { RUNTIME_MANIFESTS, resolveDashboardFamily, runtimeOwnsDashboard, runtimeOwnsPath } from "./index";

test("canonical special dashboards resolve before generic advertising", () => {
  assert.equal(resolveDashboardFamily({ clientId: "zaruku", dashboardType: "zaruku_bi" }), "zaruku");
  assert.equal(resolveDashboardFamily({ clientId: "abbott", dashboardType: "abbott_bi" }), "abbott");
  assert.equal(resolveDashboardFamily({ clientId: "gidrofuril", dashboardType: "performance" }), "advertising");
  assert.equal(resolveDashboardFamily({ clientId: "client-roche", dashboardType: "site_seo", siteSlug: "medroche" }), "site_seo");
});

test("a site-seo runtime owns only its registered site slug and routes", () => {
  const medroche = { clientId: "client-roche", dashboardType: "site_seo", siteSlug: "medroche" };
  const clinic = { clientId: "client-clinic", dashboardType: "site_seo", siteSlug: "example-clinic" };
  assert.equal(runtimeOwnsDashboard("site_seo", medroche, "medroche"), true);
  assert.equal(runtimeOwnsDashboard("site_seo", clinic, "medroche"), false);
  assert.equal(runtimeOwnsPath("site_seo", "/dashboard/medroche", "medroche"), true);
  assert.equal(runtimeOwnsPath("site_seo", "/api/dashboard/medroche/excel", "medroche"), true);
  assert.equal(runtimeOwnsPath("site_seo", "/dashboard/example-clinic", "medroche"), false);
});

test("isolated runtimes fail closed for another dashboard family", () => {
  assert.equal(runtimeOwnsDashboard("zaruku", { clientId: "zaruku", dashboardType: "zaruku_bi" }), true);
  assert.equal(runtimeOwnsDashboard("zaruku", { clientId: "abbott", dashboardType: "abbott_bi" }), false);
});

test("public route ownership preserves current paths", () => {
  assert.equal(runtimeOwnsPath("zaruku", "/dashboard/zaruku"), true);
  assert.equal(runtimeOwnsPath("zaruku", "/api/dashboard/zaruku/excel"), true);
  assert.equal(runtimeOwnsPath("zaruku", "/dashboard/abbott"), false);
  assert.equal(runtimeOwnsPath("advertising", "/admin/settings"), true);
});

test("Zaruku production authority is immutable", () => {
  assert.deepEqual(RUNTIME_MANIFESTS.zaruku, {
    scope: "zaruku", releaseBranch: "release/zaruku", appName: "dashboard-zaruku", port: 3002,
    appDir: "/var/www/dashboard-zaruku", lockDir: "/var/www/.dashboard-zaruku-deploy.lock",
    assetPrefix: "/_next-zaruku",
  });
});

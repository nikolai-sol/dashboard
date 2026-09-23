import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_MANIFESTS,
  normalizeAbbottIdentifier,
  runtimeOwnsPath,
} from "./index";

test("Abbott aliases normalize to the canonical slug", () => {
  assert.equal(normalizeAbbottIdentifier("18"), "abbott");
  assert.equal(normalizeAbbottIdentifier("abbott"), "abbott");
  assert.equal(normalizeAbbottIdentifier("28"), null);
  assert.equal(normalizeAbbottIdentifier("zaruku"), null);
});

test("Abbott runtime owns only approved page and API paths", () => {
  for (const path of [
    "/dashboard/18", "/dashboard/18/", "/dashboard/abbott", "/dashboard/abbott/",
    "/api/dashboard/18", "/api/dashboard/18/pdf", "/api/dashboard/18/excel",
    "/api/dashboard/18/abbott-admin-users", "/api/dashboard/abbott",
    "/api/dashboard/abbott/pdf", "/api/dashboard/abbott/excel",
    "/api/dashboard/abbott/abbott-admin-users",
  ]) assert.equal(runtimeOwnsPath("abbott", path), true, path);

  for (const path of [
    "/dashboard/28", "/dashboard/zaruku", "/dashboard/17",
    "/api/dashboard/18/unknown", "/api/dashboard-auth/login", "/admin",
  ]) assert.equal(runtimeOwnsPath("abbott", path), false, path);
});

test("Abbott release authority is immutable", () => {
  assert.deepEqual(RUNTIME_MANIFESTS.abbott, {
    scope: "abbott",
    releaseBranch: "release/abbott",
    appName: "dashboard-abbott",
    port: 3004,
    appDir: "/var/www/dashboard-abbott",
    lockDir: "/var/www/.dashboard-abbott-deploy.lock",
    assetPrefix: "/_next-abbott",
  });
});

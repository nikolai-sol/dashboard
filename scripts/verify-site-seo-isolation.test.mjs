import assert from "node:assert/strict";
import test from "node:test";

test("the isolation verifier accepts independent MedRoche and clinic identities", async () => {
  const { verifyIsolation } = await import("./verify-site-seo-isolation.mjs");
  const result = verifyIsolation([
    { siteId: "site-medroche", route: "/dashboard/medroche", assetPrefix: "/_next-medroche", buildOutputDir: ".next-medroche", processName: "dashboard-medroche", port: 3003, deployPath: "/var/www/dashboard-medroche", releaseBranch: "release/medroche", deployLockPath: "/var/www/.dashboard-medroche-deploy.lock" },
    { siteId: "site-example-clinic", route: "/dashboard/example-clinic", assetPrefix: "/_next-example-clinic", buildOutputDir: ".next-example-clinic", processName: "dashboard-example-clinic", port: 3004, deployPath: "/var/www/dashboard-example-clinic", releaseBranch: "release/example-clinic", deployLockPath: "/var/www/.dashboard-example-clinic-deploy.lock" },
  ]);
  assert.equal(result.ok, true);
});
test("the isolation verifier rejects cross-site runtime identity reuse", async () => {
  const { verifyIsolation } = await import("./verify-site-seo-isolation.mjs");
  assert.throws(() => verifyIsolation([
    { siteId: "a", route: "/dashboard/a", assetPrefix: "/_next-a", buildOutputDir: ".next-a", processName: "dashboard-a", port: 3003, deployPath: "/var/www/dashboard-a", releaseBranch: "release/a", deployLockPath: "/var/www/.lock-a" },
    { siteId: "b", route: "/dashboard/b", assetPrefix: "/_next-b", buildOutputDir: ".next-b", processName: "dashboard-b", port: 3003, deployPath: "/var/www/dashboard-b", releaseBranch: "release/b", deployLockPath: "/var/www/.lock-b" },
  ]), /collision|unique/i);
});

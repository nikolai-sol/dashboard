import assert from "node:assert/strict";
import test from "node:test";

test("runtime release policy scopes deploy and rollback to its own manifest", async () => {
  const { validateRuntimeManifest, planRuntimeAction } = await import("./site-seo-runtime-release.mjs");
  const manifest = {
    siteId: "site-medroche", releaseBranch: "release/medroche", processName: "dashboard-medroche",
    port: 3003, deployPath: "/var/www/dashboard-medroche", deployLockPath: "/var/www/.dashboard-medroche-deploy.lock",
  };
  assert.deepEqual(validateRuntimeManifest(manifest), manifest);
  assert.deepEqual(planRuntimeAction(manifest, "deploy"), { action: "deploy", siteId: "site-medroche", processName: "dashboard-medroche", deployPath: "/var/www/dashboard-medroche" });
  assert.deepEqual(planRuntimeAction(manifest, "rollback"), { action: "rollback", siteId: "site-medroche", processName: "dashboard-medroche", deployPath: "/var/www/dashboard-medroche" });
  assert.throws(() => planRuntimeAction({ ...manifest, processName: "dashboard-zaruku" }, "deploy"), /scope|process|medroche/i);
});
test("runtime release policy refuses unpinned branches and shared paths", async () => {
  const { validateRuntimeManifest } = await import("./site-seo-runtime-release.mjs");
  assert.throws(() => validateRuntimeManifest({ siteId: "site-medroche", releaseBranch: "main", processName: "dashboard-medroche", port: 3003, deployPath: "/var/www/dashboard-medroche", deployLockPath: "/var/www/.dashboard-medroche-deploy.lock" }), /branch/i);
  assert.throws(() => validateRuntimeManifest({ siteId: "site-medroche", releaseBranch: "release/medroche", processName: "dashboard-medroche", port: 3003, deployPath: "/var/www/dashboard", deployLockPath: "/var/www/.dashboard-medroche-deploy.lock" }), /path|scope/i);
});

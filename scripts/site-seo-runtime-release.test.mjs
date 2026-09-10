import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("deploy and rollback CLIs resolve the repository beside the passed manifest", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "site-seo-cli-"));
  try {
    const manifest = path.join(directory, "release.json");
    writeFileSync(manifest, `${JSON.stringify({ siteId: "site-example-clinic", releaseBranch: "release/example-clinic", processName: "dashboard-example-clinic", port: 3004, deployPath: "/var/www/dashboard-example-clinic", deployLockPath: "/var/www/.dashboard-example-clinic-deploy.lock" })}\n`);
    writeFileSync(path.join(directory, "repository.json"), `${JSON.stringify({ siteId: "site-example-clinic", ref: "refs/heads/release/example-clinic", base: "fixture-base", approvedPredecessor: null })}\n`);
    for (const script of ["site-seo-deploy.mjs", "site-seo-rollback.mjs"]) {
      const result = spawnSync(process.execPath, [path.resolve("scripts", script), "--preview", "--manifest", manifest], { encoding: "utf8" });
      assert.equal(result.status, 0, `${script}: ${result.stderr}`);
      assert.match(result.stdout, /site-example-clinic/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("MedRoche PM2 launch reads only its dedicated runtime secret file", () => {
  const ecosystem = readFileSync("deploy/medroche/ecosystem.config.cjs", "utf8");
  const launcher = readFileSync("deploy/medroche/start.cjs", "utf8");
  assert.match(ecosystem, /script:\s*['"]\/usr\/bin\/env['"]/);
  assert.match(ecosystem, /\/var\/www\/\.dashboard-medroche-launcher\.cjs/);
  assert.doesNotMatch(ecosystem, /DB_PASSWORD|DASHBOARD_AUTH_SECRET/);
  assert.match(launcher, /\/var\/www\/\.dashboard-medroche-secrets\/runtime\.env/);
  assert.match(launcher, /SITE_SEO_REGISTRATION_PATH/);
  assert.match(launcher, /parsed\.HOSTNAME !== '127\.0\.0\.1'/);
  assert.match(launcher, /parsed\.PORT !== '3003'/);
  assert.match(launcher, /apps\/site-seo\/server\.js/);
  assert.doesNotMatch(launcher, /dashboard-zaruku|3002/);
});

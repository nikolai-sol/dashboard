import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("artifact policy accepts only the owned MedRoche runtime identity", async () => {
  const { validateArtifactManifest } = await import("./site-seo-artifact-policy.mjs");
  const manifest = {
    siteId: "site-medroche", profileVersion: "2026.09.10-1", templateVersion: "template-sha",
    schemaVersion: 1, buildOutputDir: ".next-medroche", assetPrefix: "/_next-medroche",
    route: "/dashboard/medroche", processName: "dashboard-medroche", deployPath: "/var/www/dashboard-medroche",
    files: [{ path: "server.js", sha256: "a".repeat(64) }],
  };
  assert.deepEqual(validateArtifactManifest(manifest), manifest);
});

test("artifact inspection rejects a foreign source marker in owned runtime code", async () => {
  const { inspectArtifactDirectory } = await import("./site-seo-artifact-policy.mjs");
  const directory = mkdtempSync(path.join(tmpdir(), "site-seo-artifact-"));
  try {
    const contents = "const endpoint = 'api-metrika.yandex.net';";
    writeFileSync(path.join(directory, "server.js"), contents);
    const manifest = {
      siteId: "site-medroche", profileVersion: "2026.09.10-1", templateVersion: "template-sha",
      schemaVersion: 1, buildOutputDir: ".next-medroche", assetPrefix: "/_next-medroche",
      route: "/dashboard/medroche", processName: "dashboard-medroche", deployPath: "/var/www/dashboard-medroche",
      files: [{ path: "server.js", sha256: createHash("sha256").update(contents).digest("hex") }],
    };
    assert.match(inspectArtifactDirectory(directory, manifest).join("\n"), /foreign marker/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("artifact policy rejects foreign routes, secrets and source API markers", async () => {
  const { validateArtifactManifest } = await import("./site-seo-artifact-policy.mjs");
  const base = { siteId: "site-medroche", profileVersion: "2026.09.10-1", templateVersion: "template-sha", schemaVersion: 1, buildOutputDir: ".next-medroche", assetPrefix: "/_next-medroche", route: "/dashboard/medroche", processName: "dashboard-medroche", deployPath: "/var/www/dashboard-medroche", files: [{ path: "server.js", sha256: "a".repeat(64) }] };
  assert.throws(() => validateArtifactManifest({ ...base, route: "/dashboard/zaruku" }), /route|scope/i);
  assert.throws(() => validateArtifactManifest({ ...base, files: [{ path: ".env", sha256: "a".repeat(64) }] }), /secret|env|artifact/i);
  assert.throws(() => validateArtifactManifest({ ...base, files: [{ path: "api-metrika.yandex.net", sha256: "a".repeat(64) }] }), /source|foreign|artifact/i);
  assert.doesNotThrow(() => validateArtifactManifest({ ...base, files: [{ path: "node_modules/caniuse-lite/data/features/credential-management.js", sha256: "a".repeat(64) }] }));
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { deployLocalFixture, fileSha256, healthCheckLocalFixture, readLocalFixture, rollbackLocalFixture, startLocalFixture, stopLocalFixture, updateLocalFixture } from "./site-seo-local-release.mjs";

test("local deploy/update/rollback keeps the other synthetic site fully unchanged", () => {
  const root = mkdtempSync(path.join(tmpdir(), "site-seo-local-release-"));
  try {
    deployLocalFixture({ root, site: "clinic-a", processName: "dashboard-clinic-a", artifact: "artifact-a-v1", profileHash: "profile-a-v1", releaseId: "a1" });
    deployLocalFixture({ root, site: "clinic-b", processName: "dashboard-clinic-b", artifact: "artifact-b-v1", profileHash: "profile-b-v1", releaseId: "b1" });
    const before = readLocalFixture({ root, site: "clinic-b" });
    updateLocalFixture({ root, site: "clinic-a", processName: "dashboard-clinic-a", artifact: "artifact-a-v2", profileHash: "profile-a-v2", releaseId: "a2" });
    rollbackLocalFixture({ root, site: "clinic-a", releaseId: "a1" });
    const after = readLocalFixture({ root, site: "clinic-b" });
    assert.deepEqual(after, before);
    assert.deepEqual(readLocalFixture({ root, site: "clinic-a" }).current, { releaseId: "a1", artifactSha256: beforeHash("artifact-a-v1"), profileHash: "profile-a-v1", processName: "dashboard-clinic-a", processStartMarker: "dashboard-clinic-a:a1" });
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "sites/clinic-a/history.json"), "utf8")).map((entry) => entry.action), ["deploy", "update", "rollback"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function beforeHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("real local release keeps site B running and canonical history untouched while site A updates and rolls back", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "site-seo-local-runtime-"));
  const canonicalHistory = path.join(path.dirname(root), `site-seo-canonical-${path.basename(root)}.json`);
  const artifactRoot = path.join(root, "artifacts");
  let siteA;
  let siteB;
  try {
    const portA = await freePort();
    const portB = await freePort();
    const a1 = writeArtifact(artifactRoot, "a1");
    const a2 = writeArtifact(artifactRoot, "a2");
    const b1 = writeArtifact(artifactRoot, "b1");
    writeFileSync(canonicalHistory, "canonical-history-sentinel-v1\n");
    const canonicalBefore = fileSha256(canonicalHistory);
    deployLocalFixture({ root, site: "clinic-a", processName: "dashboard-clinic-a", artifactRoot: a1, profileHash: "profile-a-v1", releaseId: "a1", port: portA });
    deployLocalFixture({ root, site: "clinic-b", processName: "dashboard-clinic-b", artifactRoot: b1, profileHash: "profile-b-v1", releaseId: "b1", port: portB });
    siteA = await startLocalFixture({ root, site: "clinic-a" });
    siteB = await startLocalFixture({ root, site: "clinic-b" });
    const siteBBefore = readLocalFixture({ root, site: "clinic-b" });
    const siteBHealthBefore = await healthCheckLocalFixture({ root, site: "clinic-b" });

    await updateLocalFixture({ root, site: "clinic-a", processName: "dashboard-clinic-a", artifactRoot: a2, profileHash: "profile-a-v2", releaseId: "a2", port: portA });
    assert.equal((await healthCheckLocalFixture({ root, site: "clinic-b" })).releaseId, siteBHealthBefore.releaseId);
    await rollbackLocalFixture({ root, site: "clinic-a", releaseId: "a1" });
    assert.deepEqual(readLocalFixture({ root, site: "clinic-b" }), siteBBefore);
    assert.equal((await healthCheckLocalFixture({ root, site: "clinic-b" })).releaseId, "b1");
    assert.equal(fileSha256(canonicalHistory), canonicalBefore);
  } finally {
    if (siteA) await stopLocalFixture({ root, site: "clinic-a" }).catch(() => {});
    if (siteB) await stopLocalFixture({ root, site: "clinic-b" }).catch(() => {});
    rmSync(root, { recursive: true, force: true });
    rmSync(canonicalHistory, { force: true });
  }
});

function writeArtifact(root, releaseId) {
  const directory = path.join(root, `artifact-${releaseId}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "server.mjs"), [
    'import http from "node:http";',
    'const port = Number(process.env.PORT);',
    'const site = process.env.SITE_SEO_FIXTURE_SITE;',
    'const release = process.env.SITE_SEO_FIXTURE_RELEASE;',
    'const server = http.createServer((request, response) => {',
    '  if (request.url !== "/health") { response.writeHead(404); response.end(); return; }',
    '  response.setHeader("content-type", "application/json");',
    '  response.end(JSON.stringify({ site, release }));',
    '});',
    'server.listen(port, "127.0.0.1");',
    'process.on("SIGTERM", () => server.close(() => process.exit(0)));',
  ].join("\n"));
  return directory;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

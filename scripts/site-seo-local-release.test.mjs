import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { deployLocalFixture, readLocalFixture, rollbackLocalFixture, updateLocalFixture } from "./site-seo-local-release.mjs";

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

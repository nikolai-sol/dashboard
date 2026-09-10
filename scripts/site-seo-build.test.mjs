import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSite } from "./site-seo-build.mjs";
import { profileHash, readSiteProfile } from "./site-seo-profile.mjs";

const profileFilename = path.resolve("config/sites/medroche.json");

test("build refuses a profile that is not present at the same hash in the registry", () => {
  assert.throws(
    () => buildSite(profileFilename, { dryRun: true, registryFilename: null }),
    /registry.*required|not registered/i,
  );
});

test("build accepts the exact registered profile in preview mode", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "site-seo-build-"));
  try {
    const profile = readSiteProfile(profileFilename);
    const registry = path.join(directory, "registry.json");
    writeFileSync(registry, `${JSON.stringify([{ profile, profileHash: profileHash(profile) }])}\n`);
    const result = buildSite(profileFilename, { dryRun: true, registryFilename: registry });
    assert.equal(result.profile.siteId, "site-medroche");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assertRegistered, assertTemplateSource, buildSite, copyRuntimeAssets, writeRuntimeRegistration } from "./site-seo-build.mjs";
import { profileHash, readSiteProfile } from "./site-seo-profile.mjs";

const profileFilename = path.resolve("config/sites/medroche.json");
const exampleProfileFilename = path.resolve("config/sites/fixtures/example-clinic.json");

test("build accepts only source tree matching the exact profile template commit", () => {
  const profile = readSiteProfile(profileFilename);
  const source = assertTemplateSource(profile);
  assert.equal(source.revision, profile.templateVersion);
  assert.ok(source.sourcePaths.includes("src/db/site-seo"));
  assert.ok(source.sourcePaths.includes("package-lock.json"));
  assert.throws(
    () => assertTemplateSource({ ...profile, templateVersion: "1cdbe390fd988cf30dfbeb58bab01ef11bb87377" }),
    /template|source|revision/i,
  );
});

test("an existing isolated build output is not treated as mutable template source", () => {
  const output = path.resolve("apps/site-seo/.next-fixture-check");
  try {
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, "BUILD_ID"), "fixture");
    const profile = readSiteProfile(profileFilename);
    assert.equal(assertTemplateSource(profile).revision, profile.templateVersion);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

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
    writeFileSync(registry, `${JSON.stringify([{ profile, bindings: [], profileHash: profileHash(profile) }])}\n`);
    const result = buildSite(profileFilename, { dryRun: true, registryFilename: registry });
    assert.equal(result.profile.siteId, "site-medroche");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("build rejects a registry whose Metrika account is shared across site scopes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "site-seo-build-registry-scope-"));
  try {
    const medroche = readSiteProfile(profileFilename);
    const exampleClinic = readSiteProfile(exampleProfileFilename);
    const registry = path.join(directory, "registry.json");
    writeFileSync(registry, `${JSON.stringify([
      registrationWithMetrika(medroche, "123"),
      registrationWithMetrika(exampleClinic, "123"),
    ])}\n`);
    assert.throws(
      () => assertRegistered(medroche, registry),
      /account.*different scopes|counter.*scope|registry/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("build embeds the exact registration inside the standalone app", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "site-seo-build-registration-"));
  try {
    const profile = readSiteProfile(profileFilename);
    const registration = { profile, bindings: [] };
    const registry = path.join(directory, "registry.json");
    const standalone = path.join(directory, "standalone");
    mkdirSync(path.join(standalone, "apps", "site-seo"), { recursive: true });
    writeFileSync(registry, JSON.stringify([registration]));

    const destination = writeRuntimeRegistration(
      standalone,
      assertRegistered(profile, registry),
    );

    assert.equal(
      destination,
      path.join(standalone, "apps", "site-seo", "site-registration.json"),
    );
    assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), registration);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("standalone artifact contains the immutable Next static assets", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "site-seo-build-static-"));
  try {
    const output = path.join(directory, ".next-site");
    const standalone = path.join(output, "standalone");
    mkdirSync(path.join(output, "static/chunks"), { recursive: true });
    mkdirSync(path.join(standalone, "apps/site-seo"), { recursive: true });
    writeFileSync(path.join(output, "static/chunks/app.js"), "fixture");

    copyRuntimeAssets(output, standalone, ".next-site");

    assert.equal(readFileSync(path.join(standalone, "apps/site-seo/.next-site/static/chunks/app.js"), "utf8"), "fixture");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function registrationWithMetrika(profile, counter) {
  const source = profile.sources.find(({ sourceKey }) => sourceKey === "yandex_metrika");
  return {
    profile,
    bindings: [{
      bindingId: source.bindingId,
      clientId: profile.clientId,
      siteId: profile.siteId,
      dashboardId: profile.dashboardId,
      sourceKey: "yandex_metrika",
      analyticsAccountId: counter,
      resourceId: counter,
    }],
  };
}

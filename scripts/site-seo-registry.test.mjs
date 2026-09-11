import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { assertSiteRegistry } from "../packages/site-seo-contract/src/index.ts";
import { readSiteProfile } from "./site-seo-profile.mjs";

const profileFilename = path.resolve("config/sites/medroche.json");
const registryFilename = path.resolve("config/sites/registry.json");
const releaseFilename = path.resolve("deploy/medroche/release.json");
const repositoryFilename = path.resolve("deploy/medroche/repository.json");

test("MedRoche registry pins the confirmed Metrika, Webmaster, and Russia Wordstat scopes", () => {
  assert.ok(existsSync(registryFilename), "config/sites/registry.json is required");
  const registry = assertSiteRegistry(JSON.parse(readFileSync(registryFilename, "utf8")));
  const profile = readSiteProfile(profileFilename);

  assert.equal(registry.length, 1);
  assert.deepEqual(registry[0].profile, profile);
  assert.deepEqual(registry[0].bindings, [
    {
      bindingId: "binding-metrika-medroche",
      clientId: "client-roche",
      siteId: "site-medroche",
      dashboardId: 41,
      sourceKey: "yandex_metrika",
      analyticsAccountId: "94927113",
      resourceId: "94927113",
    },
    {
      bindingId: "binding-webmaster-medroche",
      clientId: "client-roche",
      siteId: "site-medroche",
      dashboardId: 41,
      sourceKey: "yandex_webmaster",
      analyticsAccountId: "94927113",
      resourceId: "https:med.roche.ru:443",
    },
    {
      bindingId: "binding-wordstat-medroche",
      clientId: "client-roche",
      siteId: "site-medroche",
      dashboardId: 41,
      sourceKey: "yandex_wordstat",
      analyticsAccountId: "94927113",
      resourceId: "region:225",
    },
  ]);

  const boundIds = new Set(registry[0].bindings.map((binding) => binding.bindingId));
  const unboundSourceKeys = profile.sources
    .filter((source) => source.bindingId && !boundIds.has(source.bindingId))
    .map((source) => source.sourceKey)
    .sort();
  assert.deepEqual(unboundSourceKeys, [
    "google_search_console",
    "seo_os",
    "yandex_webmaster_alice_manual",
  ]);

  for (const filename of [releaseFilename, repositoryFilename]) {
    const metadata = JSON.parse(readFileSync(filename, "utf8"));
    assert.deepEqual(metadata.sourceBindings["binding-webmaster-medroche"], {
      sourceKey: "yandex_webmaster",
      analyticsAccountId: "94927113",
      resourceId: "https:med.roche.ru:443",
      status: "configured",
    });
    assert.deepEqual(metadata.sourceBindings["binding-wordstat-medroche"], {
      sourceKey: "yandex_wordstat",
      analyticsAccountId: "94927113",
      resourceId: "region:225",
      status: "configured",
    });
  }
});

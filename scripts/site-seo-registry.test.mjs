import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { assertSiteRegistry } from "../packages/site-seo-contract/src/index.ts";
import { readSiteProfile } from "./site-seo-profile.mjs";

const profileFilename = path.resolve("config/sites/medroche.json");
const registryFilename = path.resolve("config/sites/registry.json");

test("MedRoche registry pins only the confirmed Metrika source scope", () => {
  assert.ok(existsSync(registryFilename), "config/sites/registry.json is required");
  const registry = assertSiteRegistry(JSON.parse(readFileSync(registryFilename, "utf8")));
  const profile = readSiteProfile(profileFilename);

  assert.equal(registry.length, 1);
  assert.deepEqual(registry[0].profile, profile);
  assert.deepEqual(registry[0].bindings, [{
    bindingId: "binding-metrika-medroche",
    clientId: "client-roche",
    siteId: "site-medroche",
    dashboardId: 41,
    sourceKey: "yandex_metrika",
    analyticsAccountId: "94927113",
    resourceId: "94927113",
  }]);

  const unboundSourceKeys = profile.sources
    .filter((source) => source.sourceKey !== "yandex_metrika")
    .map((source) => source.sourceKey)
    .sort();
  assert.deepEqual(unboundSourceKeys, [
    "google_search_console",
    "seo_os",
    "yandex_webmaster",
    "yandex_webmaster_alice_manual",
    "yandex_wordstat",
  ]);
  assert.equal(registry[0].bindings.some((binding) => binding.sourceKey !== "yandex_metrika"), false);
});

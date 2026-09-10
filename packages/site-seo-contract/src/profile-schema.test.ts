import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSiteProfile,
  assertSiteRegistry,
  type SiteProfile,
  type SiteRegistration,
} from "./index.ts";

function profile(overrides: Partial<SiteProfile> = {}): SiteProfile {
  return {
    schemaVersion: 1,
    profileVersion: "2026.09.10-1",
    siteId: "site-medroche",
    clientId: "client-roche",
    dashboardId: 41,
    slug: "medroche",
    domain: "med.roche.ru",
    allowedDomains: ["med.roche.ru"],
    title: "MedRoche SEO",
    logoAsset: null,
    locale: "ru-RU",
    businessTimezone: "Europe/Moscow",
    templateVersion: "1cdbe390fd988cf30dfbeb58bab01ef11bb87377",
    sources: [
      {
        sourceKey: "google_search_console",
        mode: "manual",
        bindingId: "binding-gsc-medroche",
        importCadence: ["previous_month", "previous_iso_week"],
      },
      {
        sourceKey: "yandex_metrika",
        mode: "disabled",
        bindingId: null,
        importCadence: [],
      },
    ],
    taxonomyVersion: "medroche-taxonomy-v1",
    seoRulesVersion: "site-seo-rules-v1",
    authPolicyRef: "dashboard-access:medroche",
    runtime: {
      route: "/dashboard/medroche",
      assetPrefix: "/_next-medroche",
      buildOutputDir: ".next-medroche",
      processName: "dashboard-medroche",
      port: 3003,
      deployPath: "/var/www/dashboard-medroche",
      releaseBranch: "release/medroche",
      deployLockPath: "/var/www/.dashboard-medroche-deploy.lock",
    },
    ...overrides,
  };
}

function registration(siteProfile: SiteProfile = profile()): SiteRegistration {
  return {
    profile: siteProfile,
    bindings: [
      {
        bindingId: "binding-gsc-medroche",
        clientId: siteProfile.clientId,
        siteId: siteProfile.siteId,
        dashboardId: siteProfile.dashboardId,
        sourceKey: "google_search_console",
        analyticsAccountId: "gsc-medroche",
        resourceId: "sc-domain:med.roche.ru",
      },
    ],
  };
}

test("profile schema accepts supported manual GSC and disabled sources", () => {
  assert.deepEqual(assertSiteProfile(profile()), profile());
});

test("profile schema rejects unknown fields and secret-bearing keys", () => {
  assert.throws(
    () => assertSiteProfile({ ...profile(), surprise: true }),
    /unknown field/i,
  );
  assert.throws(
    () => assertSiteProfile({ ...profile(), oauthToken: "secret" }),
    /secret|unknown field/i,
  );
});

test("profile schema rejects unsupported modes and incomplete disabled bindings", () => {
  const invalidMode = profile({
    sources: [
      {
        sourceKey: "yandex_metrika",
        mode: "manual",
        bindingId: "manual-counter",
        importCadence: [],
      },
    ],
  });
  assert.throws(() => assertSiteProfile(invalidMode), /mode/i);

  const invalidDisabled = profile({
    sources: [
      {
        sourceKey: "yandex_metrika",
        mode: "disabled",
        bindingId: "counter",
        importCadence: [],
      },
    ],
  });
  assert.throws(
    () => assertSiteProfile(invalidDisabled),
    /disabled|bindingId/i,
  );
});

test("registry rejects a binding whose client or resource scope does not match", () => {
  const value = registration();
  assert.throws(
    () =>
      assertSiteRegistry([
        {
          ...value,
          bindings: [{ ...value.bindings[0], clientId: "foreign-client" }],
        },
      ]),
    /clientId|binding/i,
  );
  assert.throws(
    () =>
      assertSiteRegistry([
        { ...value, bindings: [{ ...value.bindings[0], resourceId: "" }] },
      ]),
    /resourceId/i,
  );
});

test("registry rejects duplicate dashboard, slug, domain, route, port and runtime paths", () => {
  const first = registration();
  const secondProfile = profile({
    siteId: "site-two",
    clientId: "client-two",
    sources: [],
  });
  assert.throws(
    () => assertSiteRegistry([first, registration(secondProfile)]),
    /dashboardId|slug|domain|route|port|runtime/i,
  );
});

test("configuration is data-only and rejects executable route or path values", () => {
  assert.throws(
    () =>
      assertSiteProfile(
        profile({
          runtime: { ...profile().runtime, deployPath: "/var/www/$(whoami)" },
        }),
      ),
    /deployPath|executable|path/i,
  );
});

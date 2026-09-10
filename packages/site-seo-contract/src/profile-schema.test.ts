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

test("registry permits an enabled source to remain explicitly unconfigured", () => {
  const value = registration();
  const registered = assertSiteRegistry([{ ...value, bindings: [] }]);

  assert.equal(registered[0].profile.siteId, "site-medroche");
  assert.deepEqual(registered[0].bindings, []);
});

test("registry rejects a binding not declared by the profile", () => {
  const value = registration();
  assert.throws(
    () => assertSiteRegistry([{ ...value, bindings: [{ ...value.bindings[0], bindingId: "extra" }] }]),
    /not declared by profile/i,
  );
});

test("registry rejects one Metrika counter bound to different resource scopes", () => {
  const metrikaSource = (bindingId: string) => [{
    sourceKey: "yandex_metrika" as const,
    mode: "automated" as const,
    bindingId,
    importCadence: [],
  }];
  const firstProfile = profile({ sources: metrikaSource("metrika-one") });
  const secondProfile = profile({
    siteId: "site-second",
    clientId: "client-second",
    dashboardId: 42,
    slug: "second",
    domain: "second.example.test",
    allowedDomains: ["second.example.test"],
    title: "Second dashboard",
    sources: metrikaSource("metrika-two"),
    runtime: {
      route: "/dashboard/second",
      assetPrefix: "/_next-second",
      buildOutputDir: ".next-second",
      processName: "dashboard-second",
      port: 3004,
      deployPath: "/var/www/dashboard-second",
      releaseBranch: "release/second",
      deployLockPath: "/var/www/.dashboard-second-deploy.lock",
    },
  });
  const first: SiteRegistration = {
    profile: firstProfile,
    bindings: [{ bindingId: "metrika-one", clientId: firstProfile.clientId, siteId: firstProfile.siteId, dashboardId: firstProfile.dashboardId, sourceKey: "yandex_metrika", analyticsAccountId: "counter-123", resourceId: "counter-123" }],
  };
  const second: SiteRegistration = {
    profile: secondProfile,
    bindings: [{ bindingId: "metrika-two", clientId: secondProfile.clientId, siteId: secondProfile.siteId, dashboardId: secondProfile.dashboardId, sourceKey: "yandex_metrika", analyticsAccountId: "counter-123", resourceId: "counter-456" }],
  };

  assert.throws(() => assertSiteRegistry([first, second]), /metrika.*counter|counter.*scope/i);
});

test("registry requires a Metrika counter account and resource identity to match", () => {
  const siteProfile = profile({
    sources: [{ sourceKey: "yandex_metrika", mode: "automated", bindingId: "metrika", importCadence: [] }],
  });
  const value: SiteRegistration = {
    profile: siteProfile,
    bindings: [{ bindingId: "metrika", clientId: siteProfile.clientId, siteId: siteProfile.siteId, dashboardId: siteProfile.dashboardId, sourceKey: "yandex_metrika", analyticsAccountId: "counter-123", resourceId: "different-resource" }],
  };

  assert.throws(() => assertSiteRegistry([value]), /metrika.*account.*resource|counter.*identity/i);
});

test("registry rejects one Wordstat account across distinct site scopes", () => {
  const wordstatSource = (bindingId: string) => [{ sourceKey: "yandex_wordstat" as const, mode: "automated" as const, bindingId, importCadence: [] }];
  const firstProfile = profile({ sources: wordstatSource("wordstat-one") });
  const secondProfile = profile({
    siteId: "site-wordstat-second", clientId: "client-wordstat-second", dashboardId: 43, slug: "wordstat-second", domain: "wordstat-second.example.test", allowedDomains: ["wordstat-second.example.test"], title: "Second Wordstat", sources: wordstatSource("wordstat-two"),
    runtime: { route: "/dashboard/wordstat-second", assetPrefix: "/_next-wordstat-second", buildOutputDir: ".next-wordstat-second", processName: "dashboard-wordstat-second", port: 3005, deployPath: "/var/www/dashboard-wordstat-second", releaseBranch: "release/wordstat-second", deployLockPath: "/var/www/.dashboard-wordstat-second-deploy.lock" },
  });
  const first: SiteRegistration = { profile: firstProfile, bindings: [{ bindingId: "wordstat-one", clientId: firstProfile.clientId, siteId: firstProfile.siteId, dashboardId: firstProfile.dashboardId, sourceKey: "yandex_wordstat", analyticsAccountId: "wordstat-account", resourceId: "ru" }] };
  const second: SiteRegistration = { profile: secondProfile, bindings: [{ bindingId: "wordstat-two", clientId: secondProfile.clientId, siteId: secondProfile.siteId, dashboardId: secondProfile.dashboardId, sourceKey: "yandex_wordstat", analyticsAccountId: "wordstat-account", resourceId: "ru" }] };

  assert.throws(() => assertSiteRegistry([first, second]), /wordstat.*account|account.*scope/i);
});

test("registry rejects duplicate dashboard, slug, domain, route, port and runtime paths", () => {
  const first = registration();
  const secondProfile = profile({
    siteId: "site-two",
    clientId: "client-two",
    sources: [],
  });
  assert.throws(
    () => assertSiteRegistry([first, { profile: secondProfile, bindings: [] }]),
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

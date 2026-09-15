import assert from "node:assert/strict";
import test from "node:test";
import type { Period, SiteProfile, SiteRegistration } from "@reportingdash/site-seo-contract";
import { loadDashboardReadModel } from "./read-model.ts";
import type { CanonicalDatasetReadQuery, CanonicalReadQuery } from "./db.ts";
import { calendarMonthPeriod, createPeriodSelection } from "./period-selection.ts";

const profile: SiteProfile = {
  schemaVersion: 1, profileVersion: "fixture-1", siteId: "site-med", clientId: "client-med", dashboardId: 42, slug: "medroche", domain: "clinic.example.test", allowedDomains: ["clinic.example.test"], title: "Синтетическая клиника", logoAsset: null, locale: "ru-RU", businessTimezone: "Europe/Moscow", templateVersion: "fixture", taxonomyVersion: "fixture", seoRulesVersion: "fixture", authPolicyRef: "site-seo",
  runtime: { route: "/dashboard/medroche", assetPrefix: "/_next-medroche", buildOutputDir: ".next-medroche", processName: "fixture", port: 3010, deployPath: "/tmp/fixture", releaseBranch: "fixture", deployLockPath: "/tmp/fixture.lock" },
  sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc-fixture", importCadence: ["previous_month"] }],
};
const registration: SiteRegistration = { profile, bindings: [{ bindingId: "gsc-fixture", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account-fixture", resourceId: "resource-fixture" }] };
const period: Period = { kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" };
const selection = createPeriodSelection({ primaryWeek: "2026-W01", aliceMonth: "2026-01", gsc: calendarMonthPeriod("2026-01", "Europe/Moscow") }, "Europe/Moscow");
const isSourceQuery = (query: CanonicalReadQuery): query is CanonicalDatasetReadQuery => query.name !== "target_intent";
const ruleSet = {
  siteId: "site-med", dashboardId: 42, versionId: "intent-v7", label: "Лечебный спрос", state: "ready" as const,
  rules: [{ key: "бевацизумаб", normalizedKey: "бевацизумаб", group: "Препараты", matchType: "phrase" as const }],
  provenance: { importId: "17", publicationId: "18", sourceTransport: "upload" as const, sourceIdentity: "rules.xlsx", contentSha256: "a".repeat(64), publishedAt: "2026-09-15T12:00:00Z", publishedBy: "admin@example.test", comment: null },
};
const notConfiguredRuleSet = { siteId: "site-med", dashboardId: 42, versionId: null, label: "", state: "not_configured" as const, rules: [], provenance: null };

test("any configured site classifies exact-week GSC while preserving the independent monthly SEO view", async () => {
  const queries: CanonicalReadQuery[] = [];
  const model = await loadDashboardReadModel({
    registration: { ...registration, profile: { ...profile, slug: "another-clinic", seoRulesVersion: "unrelated-profile-value" } },
    claim: { dashboardId: 42, siteId: "site-med" }, selection, publicationId: "publication-7", filters: { country: "all" },
    execute: async (query) => {
      queries.push(query);
      if (query.name === "target_intent") return ruleSet;
      const meta = { sourceKey: "google_search_console" as const, period: query.period, state: "partial" as const,
        collectionMode: "manual" as const, completeness: "limited" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current" as const, latestAttempt: "success" as const };
      return { meta, summary: null, daily: [], indexing: meta, dimensions: [
        { dimension: "query" as const, value: "бевацизумаб", meta, metrics: { impressions: query.period.kind === "iso_week" ? 25 : 1000, clicks: 2, ctrPct: null, averagePosition: null } },
      ] };
    },
  });
  assert.deepEqual(queries.map(query => query.name), ["target_intent", "gsc", "gsc"]);
  assert.deepEqual(queries.filter(isSourceQuery).filter(query => query.name === "gsc").map(query => query.period.key), ["2026-01", "2026-W01"]);
  assert.equal(model.gsc.dimensions[0].metrics.impressions, 1000);
  assert.equal(model.targetIntent!.target.impressions, 25);
  assert.equal(model.targetIntent!.period.key, "2026-W01");
  assert.equal(model.targetIntent!.versionId, "intent-v7");
  assert.deepEqual(queries[0]?.scope, { clientId: "client-med", siteId: "site-med", dashboardId: 42 });
  assert.ok(queries.filter(isSourceQuery).filter(query => query.name === "gsc").every(query => query.publicationId === "publication-7" && query.scope.siteId === "site-med" && query.filters.country === "all"));
});

test("configured sites combine exact selected-week GSC and Webmaster queries without changing the broader GSC period", async () => {
  const scopedRegistration = {
    profile: { ...profile, slug: "generic-site", sources: [
      ...profile.sources,
      { sourceKey: "yandex_webmaster" as const, mode: "automated" as const, bindingId: "webmaster-fixture", importCadence: [] },
    ] },
    bindings: [
      ...registration.bindings,
      { bindingId: "webmaster-fixture", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "yandex_webmaster" as const, analyticsAccountId: "webmaster-account", resourceId: "host-fixture" },
    ],
  } satisfies SiteRegistration;
  const queries: CanonicalReadQuery[] = [];
  const model = await loadDashboardReadModel({
    registration: scopedRegistration,
    claim: { dashboardId: 42, siteId: "site-med" },
    selection,
    publicationId: null,
    filters: {},
    execute: async (query) => {
      queries.push(query);
      if (query.name === "target_intent") return ruleSet;
      const meta = { sourceKey: query.scope.sourceKey, period: query.period, state: "ready" as const, collectionMode: query.scope.sourceKey === "google_search_console" ? "manual" as const : "automated" as const, completeness: "complete" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current" as const, latestAttempt: "success" as const };
      if (query.scope.sourceKey === "google_search_console") return {
        meta, summary: null, daily: [], indexing: meta,
        dimensions: [{ dimension: "query" as const, value: "бевацизумаб", meta, metrics: { impressions: query.period.kind === "iso_week" ? 25 : 1000, clicks: 2, ctrPct: null, averagePosition: null } }],
      };
      return {
        ...meta, kind: "webmaster" as const, summary: null, daily: [], topPages: [],
        queryFacts: [{ query: "бевацизумаб", metrics: { impressions: 30, clicks: 3, ctrPct: 10, averagePosition: 2 } }],
      };
    },
  });

  assert.equal(model.gsc.dimensions[0]?.metrics.impressions, 1000);
  assert.equal(model.targetIntent!.target.impressions, 55);
  assert.deepEqual(model.targetIntent!.queries.map(({ source, impressions }) => [source, impressions]), [["yandex", 30], ["google", 25]]);
  assert.equal("queryFacts" in (model.targetIntent!.sources.find(({ source }) => source === "yandex")!.meta ?? {}), false);
  assert.deepEqual(queries.filter(isSourceQuery).map(({ scope, period }) => `${scope.sourceKey}:${period.key}`), [
    "google_search_console:2026-01",
    "google_search_console:2026-W01",
    "yandex_webmaster:2026-W01",
  ]);
});

test("a missing catalogue is not configured and does not enable an extra weekly source read", async () => {
  let reads = 0;
  const model = await loadDashboardReadModel({ registration, claim: { dashboardId: 42, siteId: "site-med" },
    selection, publicationId: null, filters: {}, execute: async query => {
      reads++;
      if (query.name === "target_intent") return notConfiguredRuleSet;
      const meta = { sourceKey: "google_search_console" as const, period: query.period, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
      return { meta, summary: null, dimensions: [], daily: [], indexing: meta };
    } });
  assert.equal(reads, 2);
  assert.equal(model.targetIntent!.state, "not_configured");
  assert.equal(model.targetIntent!.target.impressions, null);
});

test("rejects a mismatched viewer scope before reading the target catalogue", async () => {
  let reads = 0;
  await assert.rejects(loadDashboardReadModel({
    registration,
    claim: { dashboardId: 42, siteId: "site-foreign" },
    selection,
    publicationId: null,
    filters: {},
    execute: async () => { reads += 1; return notConfiguredRuleSet; },
  }), /site scope does not match/);
  assert.equal(reads, 0);
});

test("sends the complete server-resolved scope to the canonical reader", async () => {
  const queries: CanonicalReadQuery[] = [];
  const model = await loadDashboardReadModel({ registration, claim: { dashboardId: 42, siteId: "site-med" }, selection, publicationId: "publication-7", filters: { country: "RU" }, execute: async (query) => {
    queries.push(query);
    if (query.name === "target_intent") return notConfiguredRuleSet;
    return { meta: { sourceKey: "google_search_console", period, state: "complete_empty", collectionMode: "manual", completeness: "complete", importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current", latestAttempt: "success" }, summary: null, daily: [], dimensions: [], indexing: { sourceKey: "google_search_console", period: null, state: "missing", collectionMode: "manual", completeness: "unknown", importId: null, exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none" } };
  }});

  assert.equal(queries.length, 2);
  const sourceQuery = queries.find((query): query is CanonicalDatasetReadQuery => query.name === "gsc");
  assert.deepEqual(sourceQuery?.scope, registration.bindings[0]);
  assert.equal(sourceQuery?.period.key, "2026-01");
  assert.equal(sourceQuery?.publicationId, "publication-7");
  assert.deepEqual(sourceQuery?.filters, { country: "RU" });
  assert.equal(model.gsc.meta.state, "complete_empty");
});

test("configured target intent fails closed when the selected-week query sources are unavailable", async () => {
  const scoped: SiteRegistration = {
    profile: { ...profile, sources: [{ sourceKey: "yandex_webmaster", mode: "automated", bindingId: "webmaster", importCadence: [] }] },
    bindings: [{ ...registration.bindings[0], sourceKey: "yandex_webmaster", bindingId: "webmaster" }],
  };
  const model = await loadDashboardReadModel({ registration: scoped, claim: { dashboardId: 42, siteId: "site-med" }, selection, publicationId: null, filters: {},
    execute: async query => query.name === "target_intent" ? ruleSet : ({ sourceKey: query.scope.sourceKey, period: query.period, state: "failed", collectionMode: "automated", completeness: "unknown", importId: null, exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "failed" }),
  });
  assert.equal(model.targetIntent!.state, "unavailable");
  assert.equal(model.targetIntent!.target.impressions, null);
});

test("reports a missing source instead of querying an invented account", async () => {
  let calls = 0;
  const model = await loadDashboardReadModel({ registration: { ...registration, bindings: [] }, claim: { dashboardId: 42, siteId: "site-med" }, selection, publicationId: null, filters: {}, execute: async (query) => { calls += 1; if (query.name === "target_intent") return notConfiguredRuleSet; throw new Error("must not read a source"); } });
  assert.equal(calls, 1);
  assert.equal(model.gsc.meta.state, "missing");
});

test("reads generic canonical coverage for enabled Metrika and Webmaster but skips disabled adapters", async () => {
  const sources: SiteProfile["sources"] = [
    ...profile.sources,
    { sourceKey: "yandex_metrika" as const, mode: "automated" as const, bindingId: "metrika-fixture", importCadence: [] },
    { sourceKey: "yandex_webmaster" as const, mode: "automated" as const, bindingId: "webmaster-fixture", importCadence: [] },
    { sourceKey: "yandex_webmaster_alice_manual" as const, mode: "manual" as const, bindingId: "alice-fixture", importCadence: ["previous_month"] as const },
    { sourceKey: "yandex_wordstat" as const, mode: "disabled" as const, bindingId: null, importCadence: [] },
  ];
  const scopedRegistration = {
    profile: { ...profile, sources },
    bindings: [...registration.bindings,
      { bindingId: "metrika-fixture", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "yandex_metrika" as const, analyticsAccountId: "account-metrika", resourceId: "resource-metrika" },
      { bindingId: "webmaster-fixture", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "yandex_webmaster" as const, analyticsAccountId: "account-webmaster", resourceId: "resource-webmaster" },
      { bindingId: "alice-fixture", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "yandex_webmaster_alice_manual" as const, analyticsAccountId: "account-alice", resourceId: "resource-alice" },
    ],
  } satisfies SiteRegistration;
  const queries: CanonicalReadQuery[] = [];
  const genericMeta = { sourceKey: "yandex_metrika" as const, period, state: "ready" as const, collectionMode: "automated" as const, completeness: "complete" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current" as const, latestAttempt: "success" as const };
  const comparisonSelection = createPeriodSelection({ primaryWeek: "2026-W01", comparisonWeek: "2025-W52", aliceMonth: "2026-01", gsc: calendarMonthPeriod("2026-01", "Europe/Moscow") }, "Europe/Moscow");
  const model = await loadDashboardReadModel({ registration: scopedRegistration, claim: { dashboardId: 42, siteId: "site-med" }, selection: comparisonSelection, publicationId: null, filters: {}, execute: async (query) => {
    queries.push(query);
    if (query.name === "target_intent") return notConfiguredRuleSet;
    if (query.name === "dataset") return { ...genericMeta, sourceKey: query.scope.sourceKey };
    return { meta: { ...genericMeta, sourceKey: "google_search_console" as const }, summary: null, daily: [], dimensions: [], indexing: genericMeta };
  }});
  assert.deepEqual(queries.filter(isSourceQuery).filter((query) => query.name === "dataset").map((query) => `${query.scope.sourceKey}:${query.period.key}`).sort(), ["yandex_metrika:2025-W52", "yandex_metrika:2026-W01", "yandex_webmaster:2025-W52", "yandex_webmaster:2026-W01", "yandex_webmaster_alice_manual:2026-01"]);
  assert.equal(model.datasets.yandex_wordstat?.state, "missing");
  assert.equal(model.datasets.yandex_metrika?.state, "ready");
});

test("loads configured Metrika when GSC is disabled for a second profile", async () => {
  const secondRegistration = {
    profile: { ...profile, siteId: "site-two", clientId: "client-two", dashboardId: 43, slug: "two", sources: [
      { sourceKey: "google_search_console" as const, mode: "disabled" as const, bindingId: null, importCadence: [] },
      { sourceKey: "yandex_metrika" as const, mode: "automated" as const, bindingId: "metrika-two", importCadence: [] },
    ] },
    bindings: [{ bindingId: "metrika-two", clientId: "client-two", siteId: "site-two", dashboardId: 43, sourceKey: "yandex_metrika" as const, analyticsAccountId: "account-two", resourceId: "counter-two" }],
  } satisfies SiteRegistration;
  const queries: CanonicalReadQuery[] = [];
  const model = await loadDashboardReadModel({ registration: secondRegistration, claim: { dashboardId: 43, siteId: "site-two" }, selection, publicationId: null, filters: {}, execute: async (query) => {
    queries.push(query);
    if (query.name === "target_intent") return { ...notConfiguredRuleSet, siteId: "site-two", dashboardId: 43 };
    return { sourceKey: query.scope.sourceKey, period: query.period, state: "ready", collectionMode: "automated", completeness: "complete", importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current", latestAttempt: "success" };
  } });

  assert.deepEqual(queries.filter(isSourceQuery).filter((query) => query.name === "dataset").map((query) => query.scope.sourceKey), ["yandex_metrika"]);
  assert.equal(model.gsc.meta.state, "missing");
  assert.equal(model.datasets.yandex_metrika?.state, "ready");
});

test("keeps canonical Metrika and Webmaster facts on the shared selected model", async () => {
  const sources: SiteProfile["sources"] = [
    { sourceKey: "google_search_console", mode: "disabled", bindingId: null, importCadence: [] },
    { sourceKey: "yandex_metrika", mode: "automated", bindingId: "metrika", importCadence: [] },
    { sourceKey: "yandex_webmaster", mode: "automated", bindingId: "webmaster", importCadence: [] },
  ];
  const scopedRegistration = {
    profile: { ...profile, sources },
    bindings: [
      { bindingId: "metrika", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "yandex_metrika", analyticsAccountId: "counter", resourceId: "counter-resource" },
      { bindingId: "webmaster", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "yandex_webmaster", analyticsAccountId: "webmaster", resourceId: "host" },
    ],
  } satisfies SiteRegistration;
  const model = await loadDashboardReadModel({ registration: scopedRegistration, claim: { dashboardId: 42, siteId: "site-med" }, selection, publicationId: "publication-7", filters: {}, execute: async (query) => {
    if (query.name === "target_intent") return notConfiguredRuleSet;
    const meta = { sourceKey: query.scope.sourceKey, period: query.period, state: "ready" as const, collectionMode: "automated" as const, completeness: "complete" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current" as const, latestAttempt: "success" as const };
    if (query.scope.sourceKey === "yandex_metrika") return { ...meta, kind: "metrika" as const, summary: { visits: 20, pageviews: 30 }, daily: [{ date: "2026-01-02", visits: 4, pageviews: 6, users: 3 }], topPages: [{ page: "/a", visits: 4, pageviews: 6 }] };
    return { ...meta, kind: "webmaster" as const, summary: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 }, daily: [{ date: "2026-01-02", metrics: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 } }], topPages: [{ page: "/a", metrics: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 } }] };
  } });

  assert.deepEqual(model.metrika?.summary, { visits: 20, pageviews: 30 });
  assert.equal(model.metrika?.daily[0]?.users, 3);
  assert.deepEqual(model.webmaster?.summary, { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 });
  assert.equal(model.datasets.yandex_webmaster?.state, "ready");
});

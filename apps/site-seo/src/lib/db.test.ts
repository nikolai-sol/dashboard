import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalReadExecutor } from "./db.ts";

const scope = {
  clientId: "client-roche",
  siteId: "site-medroche",
  dashboardId: 41,
  sourceKey: "google_search_console" as const,
  analyticsAccountId: "gsc-account",
  resourceId: "sc-domain:med.roche.ru",
};

function importFields() {
  return {
    import_id: 7,
    import_uid: "publication-7",
    client_id: scope.clientId,
    site_id: scope.siteId,
    dashboard_id: scope.dashboardId,
    source_key: scope.sourceKey,
    analytics_account_id: scope.analyticsAccountId,
    resource_id: scope.resourceId,
    period_kind: "calendar_month",
    period_from: "2026-08-01",
    period_to: "2026-08-31",
    period_key: "2026-08",
    source_timezone: "Europe/Moscow",
    filters_hash: "unused-in-fixture",
    adapter_version: "gsc-v1",
    exported_at: "2026-09-01T10:00:00.000Z",
    revision: 1,
  };
}

test("canonical GSC executor reads only full scoped MySQL facts and preserves provenance", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({
    async execute(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("canonical_fact_gsc_manual_daily")) return [[{
        ...importFields(), report_date: "2026-08-03", clicks: "2", impressions: "20",
        ctr_pct: "10", average_position: "3.5", coverage_state: "complete",
      }], []];
      if (sql.includes("canonical_fact_gsc_manual_period_dimensions")) return [[{
        ...importFields(), dimension_name: "query", dimension_value: "roche", source_row_ordinal: 1,
        clicks: "2", impressions: "20", ctr_pct: "10", average_position: "3.5",
      }], []];
      if (sql.includes("canonical_fact_gsc_manual_indexing")) return [[], []];
      if (sql.includes("canonical_seo_manual_coverage")) return [[
        { ...importFields(), layer_name: "daily", coverage_state: "complete", row_count: 1, evidence_json: "{}", publication_priority: 0, publication_revision: 1 },
        { ...importFields(), layer_name: "query", coverage_state: "limited", row_count: 1, evidence_json: "{}", publication_priority: 0, publication_revision: 1 },
        { ...importFields(), layer_name: "page", coverage_state: "unknown", row_count: 1, evidence_json: "{}", publication_priority: 0, publication_revision: 1 },
      ], []];
      throw new Error("unexpected query");
    },
  });

  const result = await execute({
    name: "gsc",
    scope,
    period: { kind: "calendar_month", from: "2026-08-01", to: "2026-08-31", key: "2026-08", sourceTimezone: "Europe/Moscow" },
    publicationId: "publication-7",
    filters: { country: "RU" },
  });

  assert.ok("dimensions" in result);
  assert.equal(result.summary?.clicks, 2);
  assert.equal("meta" in result && result.meta.importId, "publication-7");
  assert.equal("dimensions" in result && result.dimensions[0]?.meta.completeness, "limited");
  assert.equal("dimensionCoverage" in result && result.dimensionCoverage?.page?.state, "partial");
  assert.equal("dimensionCoverage" in result && result.dimensionCoverage?.page?.completeness, "unknown");
  assert.ok(calls.every(({ params }) => params.includes(scope.clientId) && params.includes(scope.siteId) && params.includes(41)));
  assert.ok(calls.every(({ params }) => params.includes("publication-7")));
  assert.ok(calls.every(({ sql }) => !/api\.|oauth|token/i.test(sql)));
});

test("Metrika reads exact account coverage from canonical MySQL", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("canonical_metrika_breakdown_coverage_daily")) return [[{
      covered_days: 7, coverage_rows: 7, success_rows: 7, incomplete_rows: 0,
      import_id: 81, loaded_at: "2026-08-10 12:00:00",
    }], []];
    return [[], []];
  } });
  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_metrika", analyticsAccountId: "counter-account", resourceId: "counter-resource" },
    period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });
  assert.equal("state" in result && result.state, "ready");
  assert.equal("completeness" in result && result.completeness, "complete");
  assert.equal("importId" in result && result.importId, "81");
  assert.equal("trafficMeta" in result && result.trafficMeta?.state, "missing");
  assert.equal(calls.length, 7);
  assert.match(calls[0]!.sql, /canonical_metrika_breakdown_coverage_daily/i);
  assert.deepEqual(calls[0]!.params, ["yandex_metrika", "counter-account", "2026-08-03", "2026-08-09"]);
  assert.doesNotMatch(calls[0]!.sql, /api\.|oauth|token/i);
});

test("canonical source readers preserve empty, partial, and exact resource semantics", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("canonical_wordstat_coverage")) return [[{
      coverage_rows: 2, current_coverage_rows: 1, current_success_rows: 0, current_import_id: 91,
      historical_coverage_rows: 1, historical_success_rows: 0, historical_import_id: 91,
      import_id: 91, loaded_at: "2026-09-01 01:00:00",
    }], []];
    if (sql.includes("canonical_collector_runs")) return [[
      { job_key: "yandex_wordstat:wordstat-account:current", status: "success", import_id: 91, loaded_at: "2026-09-01 01:01:00" },
      { job_key: "yandex_wordstat:wordstat-account:historical", status: "success", import_id: 90, loaded_at: "2026-09-01 00:59:00" },
    ], []];
    if (/site-seo:wordstat-(demand|queries)/.test(sql)) return [[], []];
    if (sql.includes("site-seo:webmaster-meta")) return [[{ row_count: 2, covered_days: 2, import_id: 92, loaded_at: "2026-08-09 01:00:00" }], []];
    if (/site-seo:webmaster-(summary|daily|pages)/.test(sql)) return [[], []];
    if (/site-seo:alice-(summary|competitors|queries)/.test(sql)) return [[], []];
    if (sql.includes("canonical_alice_visibility_snapshots")) return [[{ row_count: 1, import_id: "alice-93", loaded_at: "2026-09-02 01:00:00" }], []];
    throw new Error("unexpected query");
  } });
  const week = { kind: "iso_week" as const, from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" };
  const wordstat = await execute({ name: "dataset", scope: { ...scope, sourceKey: "yandex_wordstat", analyticsAccountId: "wordstat-account", resourceId: "ru" }, period: week, publicationId: null, filters: {} });
  const webmaster = await execute({ name: "dataset", scope: { ...scope, sourceKey: "yandex_webmaster", analyticsAccountId: "webmaster-account", resourceId: "https:example.test:443" }, period: week, publicationId: null, filters: {} });
  const alice = await execute({ name: "dataset", scope: { ...scope, sourceKey: "yandex_webmaster_alice_manual", analyticsAccountId: "alice-account", resourceId: "example.test" }, period: { ...week, kind: "calendar_month", from: "2026-08-01", to: "2026-08-31", key: "2026-08" }, publicationId: null, filters: {} });

  assert.equal("state" in wordstat && wordstat.state, "complete_empty");
  assert.equal("state" in webmaster && webmaster.state, "partial");
  assert.equal("state" in alice && alice.state, "ready");
  assert.match(calls[0]!.sql, /canonical_wordstat_coverage/i);
  assert.deepEqual(calls.find((call) => call.sql.includes("site-seo:webmaster-meta"))?.params, ["yandex_webmaster", "webmaster-account", "https:example.test:443", "2026-08-03", "2026-08-09"]);
  assert.deepEqual(calls.at(-1)?.params, ["yandex_webmaster_alice_manual", "alice-account", "example.test", "2026-08-01", "2026-08-31"]);
});

test("derived SEO OS without a canonical materialization stays honestly missing", async () => {
  const execute = createCanonicalReadExecutor({ async execute() { return [[], []]; } });
  const result = await execute({ name: "dataset", scope: { ...scope, sourceKey: "seo_os" }, period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" }, publicationId: null, filters: {} });
  assert.equal("state" in result && result.state, "missing");
});

test("Wordstat pins one latest rolling snapshot and exposes its actual window", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("canonical_wordstat_coverage")) return [[{
      coverage_rows: 2, current_coverage_rows: 1, current_success_rows: 1, current_import_id: 12,
      historical_coverage_rows: 1, historical_success_rows: 1, historical_import_id: 11,
      import_id: 12, loaded_at: "2026-08-26 01:00:00",
    }], []];
    if (sql.includes("canonical_collector_runs")) return [[
      { job_key: "yandex_wordstat:wordstat-account:current", status: "success", import_id: 12, loaded_at: "2026-08-26 01:01:00" },
      { job_key: "yandex_wordstat:wordstat-account:historical", status: "success", import_id: 11, loaded_at: "2026-08-26 00:59:00" },
    ], []];
    if (sql.includes("site-seo:wordstat-demand")) return [[{ demand: "35" }], []];
    if (sql.includes("site-seo:wordstat-queries")) return [[{
      query_text: "лечение", count: "100", request_kind: "popular",
      snapshot_date: "2026-08-25", window_from: "2026-07-27", window_to: "2026-08-25",
      registry_version: "registry-2", ingestion_run_id: "run-2",
    }], []];
    throw new Error("unexpected query");
  } });
  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_wordstat", analyticsAccountId: "wordstat-account", resourceId: "region:225" },
    period: { kind: "iso_week", from: "2026-08-17", to: "2026-08-23", key: "2026-W34", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });

  assert.equal("kind" in result && result.kind, "wordstat");
  assert.equal("state" in result && result.state, "partial");
  assert.deepEqual("period" in result && result.period, {
    kind: "custom", key: "rolling:2026-07-27:2026-08-25", from: "2026-07-27", to: "2026-08-25", sourceTimezone: "Europe/Moscow",
  });
  assert.deepEqual("queries" in result && result.queries, [{
    query: "лечение", count: 100, kind: "popular",
    window: { from: "2026-07-27", to: "2026-08-25", snapshotDate: "2026-08-25", registryVersion: "registry-2", importId: "run-2" },
  }]);
  const queryCall = calls.find((call) => call.sql.includes("site-seo:wordstat-queries"));
  assert.match(calls[0]!.sql, /current_success_rows/i);
  assert.doesNotMatch(calls[0]!.sql, /ORDER BY[\s\S]*LIMIT 1/i);
  assert.match(queryCall!.sql, /WITH selected_snapshot/i);
  assert.match(queryCall!.sql, /window_from <= \?/i);
  assert.match(queryCall!.sql, /window_to >= \?/i);
  assert.match(queryCall!.sql, /ORDER BY window_to DESC/i);
  assert.match(queryCall!.sql, /snapshot_date DESC, ingestion_run_id DESC, registry_version DESC/i);
  assert.doesNotMatch(queryCall!.sql, /SUM\(count\)/i);
  assert.deepEqual(queryCall!.params, ["yandex_wordstat", "wordstat-account", "2026-08-17", "2026-08-23", "yandex_wordstat", "wordstat-account"]);
  assert.deepEqual(
    calls.find((call) => call.sql.includes("site-seo:wordstat-demand"))?.params,
    ["yandex_wordstat", "wordstat-account", "225", "2026-08-17", "2026-08-23"],
  );
});

test("Wordstat reports a failed scoped collection instead of inventing zero demand", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("canonical_wordstat_coverage")) return [[], []];
    if (sql.includes("canonical_collector_runs")) return [[{
      job_key: "yandex_wordstat:medroche-wordstat:current", status: "failed", import_id: 117, loaded_at: "2026-09-10 08:00:00",
    }], []];
    throw new Error("facts must not be read after a failed collection");
  } });

  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_wordstat", analyticsAccountId: "medroche-wordstat", resourceId: "ru" },
    period: { kind: "iso_week", from: "2026-09-07", to: "2026-09-13", key: "2026-W37", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });

  assert.equal("state" in result && result.state, "failed");
  assert.equal("latestAttempt" in result && result.latestAttempt, "failed");
  assert.equal(calls.length, 2);
  assert.match(calls[1]!.sql, /canonical_collector_runs/i);
  assert.deepEqual(calls[1]!.params, [
    "yandex_wordstat",
    "yandex_wordstat:medroche-wordstat:current",
    "yandex_wordstat:medroche-wordstat:historical",
    "yandex_wordstat:medroche-wordstat:all",
    "2026-09-07",
    "2026-09-13",
  ]);
});

test("Wordstat keeps covered facts visible and an unrelated newer regions success cannot hide a partial current run", async () => {
  const calls: string[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql) {
    calls.push(sql);
    if (sql.includes("canonical_wordstat_coverage")) return [[{
      coverage_rows: 2, current_coverage_rows: 1, current_success_rows: 1, current_import_id: 118,
      historical_coverage_rows: 1, historical_success_rows: 1, historical_import_id: 117,
      import_id: 118, loaded_at: "2026-09-10 08:00:00",
    }], []];
    if (sql.includes("canonical_collector_runs")) return [[
      { job_key: "yandex_wordstat:medroche-wordstat:current", status: "partial", import_id: 118, loaded_at: "2026-09-10 08:01:00" },
      { job_key: "yandex_wordstat:medroche-wordstat:historical", status: "success", import_id: 117, loaded_at: "2026-09-10 08:00:00" },
      { job_key: "yandex_wordstat:medroche-wordstat:regions", status: "success", import_id: 119, loaded_at: "2026-09-10 08:02:00" },
    ], []];
    if (sql.includes("site-seo:wordstat-demand")) return [[{ demand: "35" }], []];
    if (sql.includes("site-seo:wordstat-queries")) return [[{
      query_text: "лечение", count: "100", request_kind: "popular",
      snapshot_date: "2026-09-10", window_from: "2026-08-12", window_to: "2026-09-10",
      registry_version: "registry-2", ingestion_run_id: "118",
    }], []];
    throw new Error("unexpected query");
  } });

  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_wordstat", analyticsAccountId: "medroche-wordstat", resourceId: "ru" },
    period: { kind: "iso_week", from: "2026-09-07", to: "2026-09-13", key: "2026-W37", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });

  assert.equal("kind" in result && result.kind, "wordstat");
  assert.equal("state" in result && result.state, "partial");
  assert.equal("latestAttempt" in result && result.latestAttempt, "failed");
  assert.equal("demand" in result && result.demand, 35);
  assert.equal("queries" in result && result.queries.length, 1);
  assert.ok(calls.some((sql) => sql.includes("canonical_collector_runs")));
  assert.ok(calls.some((sql) => sql.includes("site-seo:wordstat-queries")));
});

test("Wordstat remains missing when neither scoped coverage nor an attempt exists", async () => {
  const execute = createCanonicalReadExecutor({ async execute(sql) {
    if (sql.includes("canonical_wordstat_coverage") || sql.includes("canonical_collector_runs")) return [[], []];
    throw new Error("unexpected fact query");
  } });
  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_wordstat", analyticsAccountId: "new-wordstat-account", resourceId: "ru" },
    period: { kind: "iso_week", from: "2026-09-07", to: "2026-09-13", key: "2026-W37", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });
  assert.equal("state" in result && result.state, "missing");
});

test("Alice retains published per-query portal and ranked source facts without conflating official SOV", async () => {
  const execute = createCanonicalReadExecutor({ async execute(sql) {
    if (sql.includes("canonical_alice_visibility_snapshots") && !sql.includes("site-seo:alice-")) return [[{ row_count: 1, import_id: "alice-93", loaded_at: "2026-09-02 01:00:00" }], []];
    if (sql.includes("site-seo:alice-summary")) return [[{ official_sov_pct: "43.91", sample_presence_pct: "43.87" }], []];
    if (sql.includes("site-seo:alice-competitors")) return [[{ site_domain: "competitor.test" }], []];
    if (sql.includes("site-seo:alice-queries")) return [[
      { query_id: 7, query_text: "лечение", portal_present: 1, portal_position: 2, portal_url: "https://portal.test/a", source_rank: 1, source_domain: "one.test", source_url: "https://one.test/a" },
      { query_id: 7, query_text: "лечение", portal_present: 1, portal_position: 2, portal_url: "https://portal.test/a", source_rank: 2, source_domain: "two.test", source_url: "https://two.test/a" },
      { query_id: 8, query_text: "диагностика", portal_present: 0, portal_position: null, portal_url: null, source_rank: 1, source_domain: "three.test", source_url: "https://three.test/a" },
    ], []];
    throw new Error("unexpected query");
  } });
  const result = await execute({ name: "dataset", scope: { ...scope, sourceKey: "yandex_webmaster_alice_manual", analyticsAccountId: "alice-account", resourceId: "example.test" }, period: { kind: "calendar_month", from: "2026-08-01", to: "2026-08-31", key: "2026-08", sourceTimezone: "Europe/Moscow" }, publicationId: null, filters: {} });

  assert.equal("kind" in result && result.kind, "alice");
  assert.equal("officialSovPct" in result && result.officialSovPct, 43.91);
  assert.equal("samplePresencePct" in result && result.samplePresencePct, 43.87);
  assert.deepEqual("queries" in result && result.queries, [
    { query: "лечение", portalPresent: true, portalPosition: 2, portalUrl: "https://portal.test/a", sources: [{ rank: 1, domain: "one.test", url: "https://one.test/a" }, { rank: 2, domain: "two.test", url: "https://two.test/a" }] },
    { query: "диагностика", portalPresent: false, portalPosition: null, portalUrl: null, sources: [{ rank: 1, domain: "three.test", url: "https://three.test/a" }] },
  ]);
});

test("SEO OS reads published recommendation evidence and task statuses, not a deprecated AI visibility table", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("site-seo:seo-os-run")) return [[{
      run_id: 71, status: "published", loaded_at: "2026-08-10 09:00:00",
      stages: JSON.stringify({ recommendations: [{ kind: "topic_opportunity", topic: "Онкология", pageUrl: "https://example.test/oncology", action: "Добавить раздел", sourceIds: ["opp-1"], sourcePeriods: ["2026-W32"], evidence: { ruleVersion: "v3" } }] }),
    }], []];
    if (sql.includes("site-seo:seo-os-tasks")) return [[{ task_id: "task-1", status: "open" }], []];
    throw new Error("unexpected query");
  } });
  const result = await execute({ name: "dataset", scope: { ...scope, sourceKey: "seo_os", analyticsAccountId: "seo-account" }, period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" }, publicationId: null, filters: {} });

  assert.equal("kind" in result && result.kind, "seo_os");
  assert.deepEqual("recommendations" in result && result.recommendations, [{
    kind: "topic_opportunity", topic: "Онкология", pageUrl: "https://example.test/oncology", action: "Добавить раздел",
    sourceIds: ["opp-1"], sourcePeriods: ["2026-W32"], ruleVersion: "v3", publicationStatus: "published",
  }]);
  assert.deepEqual("tasks" in result && result.tasks, [{ id: "task-1", status: "open" }]);
  assert.ok(calls.some((call) => /seo_weekly_runs/i.test(call.sql)));
  assert.ok(calls.every((call) => !/seo_ai_visibility_weekly/i.test(call.sql)));
});

test("Metrika returns scoped visits and pageviews while keeping users daily-only", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("canonical_metrika_breakdown_coverage_daily")) return [[{
      covered_days: 7, coverage_rows: 7, success_rows: 7, incomplete_rows: 0,
      import_id: 81, loaded_at: "2026-08-10 12:00:00",
    }], []];
    if (sql.includes("site-seo:metrika-summary")) return [[{ visits: "20", pageviews: "30" }], []];
    if (sql.includes("site-seo:metrika-daily")) return [[
      { report_date: "2026-08-03", visits: "8", pageviews: "12", users: "6" },
      { report_date: "2026-08-04", visits: "12", pageviews: "18", users: "9" },
    ], []];
    if (sql.includes("site-seo:metrika-pages")) return [[{ page_url: "https://clinic.example.test/a", visits: "7", pageviews: "11" }], []];
    if (sql.includes("site-seo:metrika-traffic-health")) return [[{
      visits: "100", pageviews: "160", bounce_rate: "17.5",
      avg_visit_duration_seconds: "95", page_depth: "2.4",
      row_count: "14", covered_days: "7", import_id: "84", loaded_at: "2026-08-10 13:00:00",
    }], []];
    if (sql.includes("site-seo:metrika-channels")) return [[
      { label: "Search engine traffic", visits: "60", pageviews: "100", bounce_rate: "10", avg_visit_duration_seconds: "110", page_depth: "2.8" },
      { label: "Direct traffic", visits: "40", pageviews: "60", bounce_rate: "28.75", avg_visit_duration_seconds: "72.5", page_depth: "1.8" },
    ], []];
    if (sql.includes("site-seo:metrika-search-engines")) return [[
      { id: "google", label: "Google, search results", visits: "12", pageviews: "18", bounce_rate: "8", avg_visit_duration_seconds: "120", page_depth: "2.5" },
      { id: "yandex", label: "Yandex, search results", visits: "8", pageviews: "12", bounce_rate: "15", avg_visit_duration_seconds: "90", page_depth: "2" },
    ], []];
    throw new Error("unexpected query");
  } });
  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_metrika", analyticsAccountId: "counter-account", resourceId: "counter-resource" },
    period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });

  assert.equal("kind" in result && result.kind, "metrika");
  assert.deepEqual("summary" in result && result.summary, { visits: 20, pageviews: 30 });
  assert.deepEqual("daily" in result && result.daily, [
    { date: "2026-08-03", visits: 8, pageviews: 12, users: 6 },
    { date: "2026-08-04", visits: 12, pageviews: 18, users: 9 },
  ]);
  assert.equal("summary" in result && "users" in (result.summary ?? {}), false);
  assert.deepEqual("trafficHealth" in result && result.trafficHealth, {
    visits: 100, pageviews: 160, bounceRate: 17.5, avgVisitDurationSeconds: 95, pageDepth: 2.4,
  });
  assert.deepEqual("trafficMeta" in result && result.trafficMeta, {
    sourceKey: "yandex_metrika",
    period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" },
    state: "partial", collectionMode: "automated", completeness: "unknown",
    importId: "84", exportedAt: null, loadedAt: "2026-08-10 13:00:00", freshness: "unknown", latestAttempt: "success",
  });
  assert.deepEqual("channels" in result && result.channels, [
    { id: null, label: "Search engine traffic", visits: 60, pageviews: 100, bounceRate: 10, avgVisitDurationSeconds: 110, pageDepth: 2.8 },
    { id: null, label: "Direct traffic", visits: 40, pageviews: 60, bounceRate: 28.75, avgVisitDurationSeconds: 72.5, pageDepth: 1.8 },
  ]);
  assert.equal("searchEngines" in result && result.searchEngines?.[0]?.label, "Google, search results");
  assert.equal("topPages" in result && result.topPages[0]?.page, "https://clinic.example.test/a");
  const facts = calls.filter((call) => call.sql.includes("canonical_fact_metrika_breakdowns_daily"));
  assert.equal(facts.length, 4);
  assert.ok(facts.every((call) => call.params.includes("yandex_metrika") && call.params.includes("counter-account") && call.params.includes("2026-08-03") && call.params.includes("2026-08-09")));
  assert.ok(facts.every((call) => !/api\.|oauth|token/i.test(call.sql)));
  const trafficFacts = calls.filter((call) => call.sql.includes("canonical_fact_site_analytics_daily"));
  assert.equal(trafficFacts.length, 2);
  assert.ok(trafficFacts.every((call) => /analytics_scope\s*=\s*'other'/i.test(call.sql)));
  assert.ok(trafficFacts.every((call) => call.params.includes("yandex_metrika") && call.params.includes("counter-account") && call.params.includes("2026-08-03") && call.params.includes("2026-08-09")));
  assert.ok(trafficFacts.every((call) => /bounce_rate[^]*visits/i.test(call.sql) && /avg_visit_duration_seconds[^]*visits/i.test(call.sql) && /page_depth[^]*visits/i.test(call.sql)));
  assert.match(trafficFacts.find((call) => call.sql.includes("site-seo:metrika-traffic-health"))!.sql, /COUNT\(\*\) AS row_count[^]*COUNT\(DISTINCT report_date\) AS covered_days[^]*MAX\(ingestion_run_id\) AS import_id[^]*MAX\(updated_at\) AS loaded_at/i);
  const engineFacts = calls.filter((call) => call.sql.includes("site-seo:metrika-search-engines"));
  assert.equal(engineFacts.length, 1);
  assert.match(engineFacts[0]!.sql, /report_key\s*=\s*'search_engines'[^]*segment_key\s*=\s*'russia'[^]*row_kind\s*=\s*'detail'/i);
});

test("Metrika preserves all-traffic facts when search-engine coverage is missing", async () => {
  const calls: string[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql) {
    calls.push(sql);
    if (sql.includes("canonical_metrika_breakdown_coverage_daily")) return [[{ coverage_rows: 0 }], []];
    if (sql.includes("site-seo:metrika-traffic-health")) return [[{
      visits: "9", pageviews: "14", bounce_rate: "20", avg_visit_duration_seconds: "75", page_depth: "1.8",
      row_count: "2", covered_days: "2", import_id: "90", loaded_at: "2026-08-09 12:00:00",
    }], []];
    if (sql.includes("site-seo:metrika-channels")) return [[{
      label: "Direct traffic", visits: "9", pageviews: "14", bounce_rate: "20", avg_visit_duration_seconds: "75", page_depth: "1.8",
    }], []];
    if (/site-seo:metrika-(summary|daily|pages|search-engines)/.test(sql)) return [[], []];
    throw new Error("unexpected query");
  } });

  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_metrika", analyticsAccountId: "counter-account", resourceId: "counter-resource" },
    period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });

  assert.equal("kind" in result && result.kind, "metrika");
  assert.equal("state" in result && result.state, "missing", "main Metrika meta remains the search-engine coverage state");
  assert.equal("trafficMeta" in result && result.trafficMeta?.state, "partial");
  assert.equal("trafficMeta" in result && result.trafficMeta?.completeness, "unknown");
  assert.equal("trafficHealth" in result && result.trafficHealth?.visits, 9);
  assert.equal("channels" in result && result.channels?.[0]?.label, "Direct traffic");
  assert.equal("summary" in result && result.summary, null);
  assert.equal("daily" in result && result.daily.length, 0);
  assert.equal("searchEngines" in result && result.searchEngines?.length, 0);
  assert.equal(calls.length, 3);
  assert.equal(calls.some((sql) => /site-seo:metrika-(summary|daily|pages|search-engines)/.test(sql)), false);
});

test("Webmaster aggregates scoped canonical facts with derived CTR and weighted position", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("site-seo:webmaster-meta")) return [[{ row_count: 2, covered_days: 2, import_id: 91, loaded_at: "2026-08-10 12:00:00" }], []];
    if (sql.includes("site-seo:webmaster-summary")) return [[{ clicks: "10", impressions: "100", ctr_pct: "10", average_position: "4.2" }], []];
    if (sql.includes("site-seo:webmaster-daily")) return [[{ report_date: "2026-08-03", clicks: "3", impressions: "20", ctr_pct: "15", average_position: "2" }], []];
    if (sql.includes("site-seo:webmaster-pages")) return [[{ page_url: "https://clinic.example.test/a", clicks: "5", impressions: "50", ctr_pct: "10", average_position: "3" }], []];
    throw new Error("unexpected query");
  } });
  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_webmaster", analyticsAccountId: "webmaster-account", resourceId: "https:clinic.example.test:443" },
    period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });

  assert.equal("kind" in result && result.kind, "webmaster");
  assert.deepEqual("summary" in result && result.summary, { clicks: 10, impressions: 100, ctrPct: 10, averagePosition: 4.2 });
  assert.equal("state" in result && result.state, "partial");
  const facts = calls.filter((call) => /canonical_fact_webmaster_(summary|pages)_daily/i.test(call.sql));
  assert.equal(facts.length, 4);
  assert.ok(facts.every((call) => call.params.includes("yandex_webmaster") && call.params.includes("webmaster-account") && call.params.includes("https:clinic.example.test:443") && call.params.includes("2026-08-03") && call.params.includes("2026-08-09")));
  assert.ok(facts.every((call) => /device_type\s*=\s*'ALL'/i.test(call.sql)));
});

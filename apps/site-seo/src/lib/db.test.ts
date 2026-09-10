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

  assert.equal("summary" in result && result.summary?.clicks, 2);
  assert.equal("meta" in result && result.meta.importId, "publication-7");
  assert.equal("dimensions" in result && result.dimensions[0]?.meta.completeness, "limited");
  assert.ok(calls.every(({ params }) => params.includes(scope.clientId) && params.includes(scope.siteId) && params.includes(41)));
  assert.ok(calls.every(({ params }) => params.includes("publication-7")));
  assert.ok(calls.every(({ sql }) => !/api\.|oauth|token/i.test(sql)));
});

test("Metrika reads exact account coverage from canonical MySQL", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    return [[{
      covered_days: 7,
      coverage_rows: 14,
      success_rows: 14,
      incomplete_rows: 0,
      import_id: 81,
      loaded_at: "2026-08-10 12:00:00",
    }], []];
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
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /canonical_metrika_breakdown_coverage_daily/i);
  assert.deepEqual(calls[0]!.params, ["yandex_metrika", "counter-account", "2026-08-03", "2026-08-09"]);
  assert.doesNotMatch(calls[0]!.sql, /api\.|oauth|token/i);
});

test("canonical source readers preserve empty, partial, and exact resource semantics", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const responses = [
    { coverage_rows: 1, status: "success_empty", import_id: 91, loaded_at: "2026-09-01 01:00:00" },
    { row_count: 2, covered_days: 2, import_id: 92, loaded_at: "2026-08-09 01:00:00" },
    { row_count: 1, import_id: "alice-93", loaded_at: "2026-09-02 01:00:00" },
  ];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    return [[responses.shift()], []];
  } });
  const week = { kind: "iso_week" as const, from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" };
  const wordstat = await execute({ name: "dataset", scope: { ...scope, sourceKey: "yandex_wordstat", analyticsAccountId: "wordstat-account", resourceId: "ru" }, period: week, publicationId: null, filters: {} });
  const webmaster = await execute({ name: "dataset", scope: { ...scope, sourceKey: "yandex_webmaster", analyticsAccountId: "webmaster-account", resourceId: "https:example.test:443" }, period: week, publicationId: null, filters: {} });
  const alice = await execute({ name: "dataset", scope: { ...scope, sourceKey: "yandex_webmaster_alice_manual", analyticsAccountId: "alice-account", resourceId: "example.test" }, period: { ...week, kind: "calendar_month", from: "2026-08-01", to: "2026-08-31", key: "2026-08" }, publicationId: null, filters: {} });

  assert.equal("state" in wordstat && wordstat.state, "complete_empty");
  assert.equal("state" in webmaster && webmaster.state, "partial");
  assert.equal("state" in alice && alice.state, "ready");
  assert.match(calls[0]!.sql, /canonical_wordstat_coverage/i);
  assert.deepEqual(calls[1]!.params, ["yandex_webmaster", "webmaster-account", "https:example.test:443", "2026-08-03", "2026-08-09"]);
  assert.deepEqual(calls[2]!.params, ["yandex_webmaster_alice_manual", "alice-account", "example.test", "2026-08-01", "2026-08-31"]);
});

test("derived SEO OS without a canonical materialization stays honestly missing", async () => {
  const execute = createCanonicalReadExecutor({ async execute() { throw new Error("must not query"); } });
  const result = await execute({ name: "dataset", scope: { ...scope, sourceKey: "seo_os" }, period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" }, publicationId: null, filters: {} });
  assert.equal("state" in result && result.state, "missing");
});

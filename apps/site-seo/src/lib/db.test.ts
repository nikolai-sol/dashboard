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

test("unmapped canonical sources return honest missing metadata", async () => {
  const execute = createCanonicalReadExecutor({ async execute() { throw new Error("must not query"); } });
  const result = await execute({
    name: "dataset",
    scope: { ...scope, sourceKey: "yandex_metrika" },
    period: { kind: "iso_week", from: "2026-08-03", to: "2026-08-09", key: "2026-W32", sourceTimezone: "Europe/Moscow" },
    publicationId: null,
    filters: {},
  });
  assert.deepEqual({ state: "state" in result && result.state, latestAttempt: "latestAttempt" in result && result.latestAttempt }, { state: "missing", latestAttempt: "none" });
});

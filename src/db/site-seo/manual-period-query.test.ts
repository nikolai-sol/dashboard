import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManualCoverageReadQuery,
  buildManualDailyReadQuery,
  buildManualDimensionsReadQuery,
  buildManualIndexingReadQuery,
  type ManualReadScope,
} from "./manual-period-query.ts";

const scope: ManualReadScope = {
  clientId: "medroche",
  siteId: "med.roche.ru",
  sourceKey: "google_search_console",
  analyticsAccountId: "medroche-gsc",
  resourceId: "sc-domain:med.roche.ru",
  filtersHash: "a".repeat(64),
};

test("daily read resolves one published import per date using the full scope", () => {
  const query = buildManualDailyReadQuery(scope, "2026-08-01", "2026-08-31");

  assert.match(query.sql, /canonical_fact_gsc_manual_daily/);
  assert.match(query.sql, /canonical_seo_manual_imports/);
  assert.match(query.sql, /canonical_seo_manual_coverage/);
  for (const column of [
    "client_id",
    "site_id",
    "source_key",
    "analytics_account_id",
    "resource_id",
    "filters_hash",
  ]) {
    assert.match(query.sql, new RegExp(`i\\.${column} = \\?`));
  }
  assert.match(query.sql, /PARTITION BY \w+\.report_date/);
  assert.match(query.sql, /\w+\.publication_priority DESC/);
  assert.match(query.sql, /row_choice = 1/);
  assert.deepEqual(query.params.slice(0, 6), [
    scope.clientId,
    scope.siteId,
    scope.sourceKey,
    scope.analyticsAccountId,
    scope.resourceId,
    scope.filtersHash,
  ]);
});

test("dimension read requires the exact independent reporting period", () => {
  const query = buildManualDimensionsReadQuery(scope, {
    kind: "iso_week",
    from: "2026-08-24",
    to: "2026-08-30",
    key: "2026-W35",
  });

  assert.match(query.sql, /canonical_fact_gsc_manual_period_dimensions/);
  assert.match(query.sql, /i\.period_kind = \?/);
  assert.match(query.sql, /i\.period_from = \?/);
  assert.match(query.sql, /i\.period_to = \?/);
  assert.match(query.sql, /i\.period_key = \?/);
  assert.match(query.sql, /c\.layer_name = d\.dimension_name/);
  assert.match(
    query.sql,
    /PARTITION BY d\.dimension_name, d\.dimension_value/,
  );
  assert.doesNotMatch(query.sql, /report_date/);
  assert.deepEqual(query.params.slice(-4), [
    "iso_week",
    "2026-08-24",
    "2026-08-30",
    "2026-W35",
  ]);
});

test("indexing snapshot keeps totals and URL samples separate", () => {
  const query = buildManualIndexingReadQuery(scope, "2026-08-31");

  assert.match(query.totals.sql, /canonical_fact_gsc_manual_indexing\b/);
  assert.doesNotMatch(query.totals.sql, /indexing_urls/);
  assert.match(query.urlSamples.sql, /canonical_fact_gsc_manual_indexing_urls/);
  assert.match(query.urlSamples.sql, /u\.snapshot_date = \?/);
  assert.equal(query.totals.params.at(-1), "2026-08-31");
  assert.equal(query.urlSamples.params.at(-1), "2026-08-31");
});

test("coverage read is scoped and exposes evidence without inferring completeness", () => {
  const query = buildManualCoverageReadQuery(scope, {
    kind: "calendar_month",
    from: "2026-08-01",
    to: "2026-08-31",
    key: "2026-08",
  });

  assert.match(query.sql, /canonical_seo_manual_coverage/);
  assert.match(query.sql, /c\.coverage_state/);
  assert.match(query.sql, /c\.evidence_json/);
  assert.match(query.sql, /i\.status = 'published'/);
});

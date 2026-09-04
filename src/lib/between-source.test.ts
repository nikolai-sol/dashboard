import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { getSchemaMetaByPlatform } from "@/lib/schema-registry";

test("between is registered as a canonical ads source", () => {
  assert.deepEqual(getSchemaMetaByPlatform("between"), {
    id: "between",
    display_name: "Between",
    source: "mysql",
    schema_file: "schemas/between.yaml",
    source_key: "between",
    source_type: "ads",
    canonical_table: "canonical_advertising_facts_current",
  });
});

test("between dashboard reads active publications without switching other ad sources", () => {
  const adapter = readFileSync(path.resolve("src/lib/canonical-adapter.ts"), "utf8");
  const loader = readFileSync(path.resolve("src/lib/dashboard-data-loader.ts"), "utf8");
  const loaderReadModel = loader.match(
    /function advertisingFactsReadModelSql[\s\S]*?\n}\n/,
  )?.[0] ?? "";

  assert.match(adapter, /advertisingFactTable\(filter\.source_key\)/);
  assert.match(adapter, /advertisingFactTable\(sourceKey\)/);
  assert.match(adapter, /sourceKey [!=]== ["']between["']/);
  assert.match(adapter, /canonical_advertising_facts_current/);
  assert.match(adapter, /canonical_fact_ads_daily legacy/);
  assert.match(adapter, /canonical_ad_coverage_daily/);
  assert.match(adapter, /MIN\(report_date\) AS first_covered_date/);
  assert.match(adapter, /legacy\.report_date < coverage_start\.first_covered_date/);
  assert.doesNotMatch(adapter, /coverage\.report_date <= legacy\.report_date/);
  assert.match(loader, /advertisingFactsReadModelSql\(["']f["']\)/);
  assert.match(loader, /source_key = ["']between["']/);
  assert.match(loader, /source_key <> ["']between["']/);
  assert.match(loader, /canonical_fact_ads_daily legacy/);
  assert.match(loader, /canonical_ad_coverage_daily/);
  assert.match(loader, /MIN\(report_date\) AS first_covered_date/);
  assert.match(loader, /legacy\.report_date < coverage_start\.first_covered_date/);
  assert.doesNotMatch(loader, /coverage\.report_date <= legacy\.report_date/);
  assert.doesNotMatch(loader, /legacy\.source_key <> 'between'\s+OR\s+\(/);
  assert.equal((loaderReadModel.match(/report_date >= \?/g) ?? []).length, 3);
  assert.equal((loaderReadModel.match(/report_date <= \?/g) ?? []).length, 3);
  assert.match(
    loader,
    /\[\.\.\.advertisingFactsReadModelParams\(dateFrom, dateTo\), dashboardId, dateFrom, dateTo\]/,
  );
  assert.match(
    loader,
    /\.\.\.metrikaAccountIds,\s+\.\.\.advertisingFactsReadModelParams\(dateFrom, dateTo\)/,
  );
});

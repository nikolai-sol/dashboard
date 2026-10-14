import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const loader = readFileSync(new URL("./dashboard-data-loader.ts", import.meta.url), "utf8");
const parentQuery = loader.slice(loader.indexOf("const [adsRows]"), loader.indexOf("const [campaignTrafficRows]"));
const childQuery = loader.slice(loader.indexOf("const [campaignAdsRows]"), loader.indexOf("const goalsByLineDate"));

test("postclick cannot multiply a campaign shared by two advertiser accounts", () => {
  assert.match(parentQuery, /f\.platform_account_id COLLATE utf8mb4_unicode_ci = b\.platform_account_id/);
});

test("postclick parent and drilldown respect binding validity dates", () => {
  for (const [query, alias] of [[parentQuery, "b"], [childQuery, "mp"]]) {
    assert.match(query, new RegExp(`${alias}\\.effective_from IS NULL OR f\\.report_date >= ${alias}\\.effective_from`));
    assert.match(query, new RegExp(`${alias}\\.effective_to IS NULL OR f\\.report_date <= ${alias}\\.effective_to`));
  }
});

test("postclick parent and drilldown use configured frequency for reach", () => {
  assert.match(parentQuery, /SUM\(\$\{reachSql\.expression\}\)/);
  assert.match(childQuery, /SUM\(\$\{reachSql\.expression\}\)/);
  assert.match(parentQuery, /\.\.\.reachSql\.params, \.\.\.advertisingFactsParams/);
  assert.match(childQuery, /\.\.\.reachSql\.params,\s+dashboardId/);
});

test("reach expression keeps source, campaign and month scoped, parameterized, last override wins", async () => {
  assert.ok(existsSync(new URL("./postclick-reach-sql.ts", import.meta.url)), "missing postclick reach SQL builder");
  const { buildPostClickReachSql } = await import("./postclick-reach-sql.ts");
  const result = buildPostClickReachSql([
    { source_key: "between", platform_campaign_id: "25072", month_key: "2026-10", frequency: 3 },
    { source_key: "between", platform_campaign_id: "25072", month_key: "2026-10", frequency: 4 },
    { source_key: "hybrid", platform_campaign_id: "a:'quoted", month_key: "2026-11", frequency: 2 },
  ]);
  assert.deepEqual(result.params, ["between", "25072", "2026-10", 4, "hybrid", "a:'quoted", "2026-11", 2]);
  assert.equal((result.expression.match(/WHEN/g) ?? []).length, 2);
  assert.match(result.expression, /f\.source_key = \?/);
  assert.match(result.expression, /f\.platform_campaign_id = \?/);
  assert.match(result.expression, /DATE_FORMAT\(f\.report_date, '%Y-%m'\) = \?/);
  assert.match(result.expression, /THEN COALESCE\(f\.impressions, 0\) \/ \?/);
  assert.match(result.expression, /ELSE COALESCE\(f\.reach, 0\) END/);
  assert.ok(!result.expression.includes("quoted"));
  assert.deepEqual(buildPostClickReachSql([]), { expression: "COALESCE(f.reach, 0)", params: [] });
});

test("postclick rounds channel reach once, consistently with plan/fact totals", () => {
  assert.match(loader, /reach: Math\.round\(totals\.reach\)/);
});

test("postclick retains daily metric precision until period aggregation", () => {
  const daily = loader.slice(loader.indexOf("const campaignByLineDate"), loader.indexOf("const rows: PostClickAnalyticsRow[]"));
  for (const metric of ["page_depth", "bounce_rate", "avg_visit_duration"]) {
    assert.doesNotMatch(daily, new RegExp(`Number\\(Number\\(row\\.${metric} \\?\\? 0\\)\\.toFixed`));
  }
});

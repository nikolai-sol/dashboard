import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadBoundAdvertisingFacts } from "./advertising-binding-read-model";

function fakeExecutor(options: { emptyBoundFacts?: boolean; sourceKey?: string } = {}) {
  const sourceKey = options.sourceKey ?? "between";
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const executor = {
    async execute(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (sql.includes("FROM dashboards")) {
        return [[{
          dashboard_type: "awareness",
          config: JSON.stringify({
            campaign_frequency_overrides: [{
              source_key: "between",
              platform_campaign_id: "24932",
              month_key: "2026-08",
              frequency: 2,
            }],
          }),
        }], []];
      }
      if (sql.includes("FROM dashboard_media_plan_rows")) {
        return [[{
          line_key: "olv-serials",
          row_order: 0,
          platform: "Between",
          channel: "OLV Serials",
          format: "OLV",
          buy_type: "CPM",
          units_plan: 999,
          unit_price: 1,
          budget_plan: 999,
          impressions_plan: 999,
          reach_plan: 500,
          frequency_plan: 2,
          views_plan: 0,
          clicks_plan: 0,
          conversions_plan: 0,
          ctr_plan: 0,
          cpm_plan: 0,
          cpc_plan: 0,
          cpv_plan: 0,
          cpa_plan: 0,
          monthly_json: JSON.stringify({ "2026-08": 40430 }),
          raw_json: JSON.stringify({ source_keys: ["between"] }),
        }], []];
      }
      if (sql.includes("FROM dashboard_sources")) {
        return [[{
          platform: sourceKey === "vk_ads_v2" ? "vk" : "between",
          source_config: JSON.stringify({ source_key: sourceKey, account_ids: ["1113"] }),
        }], []];
      }
      if (sql.includes("binding_catalog")) {
        return [[{
          line_key: "olv-serials",
          channel: "OLV Serials",
          canonical_campaign_id: 501,
          source_key: sourceKey,
          platform_account_id: "1113",
          platform_campaign_id: "24932",
          campaign_name: "OLV Serials",
        }], []];
      }
      if (sql.includes("unresolved_legacy_binding")) return [[], []];
      if (sql.includes("bound_advertising_fact")) {
        if (options.emptyBoundFacts) return [[], []];
        return [[{
          line_key: "olv-serials",
          channel: "OLV Serials",
          canonical_campaign_id: 501,
          source_key: sourceKey,
          platform_account_id: "1113",
          platform_campaign_id: "24932",
          campaign_name: "OLV Serials",
          report_date: "2026-08-17",
          impressions: 40430,
          clicks: 38,
          spend: 100,
          views: 20000,
          conversions: 1,
          reach: 100,
        }], []];
      }
      if (sql.includes("unbound_advertising_fact")) {
        return [[{
          canonical_campaign_id: 777,
          source_key: "between",
          platform_account_id: "1113",
          platform_campaign_id: "24999",
          campaign_name: "Unbound",
          report_date: "2026-08-17",
          impressions: 10,
          clicks: 0,
          spend: 0,
          views: 0,
          conversions: 0,
          reach: 0,
        }], []];
      }
      return [[], []];
    },
  };
  return { executor, statements };
}

test("facts join by canonical account and effective date", async () => {
  const { executor, statements } = fakeExecutor();
  const result = await loadBoundAdvertisingFacts(29, "2026-08-01", "2026-08-31", executor as never);

  assert.equal(result.lines.get("olv-serials")?.impressions, 40430);
  assert.equal(result.lines.get("olv-serials")?.views, 20000);
  assert.equal(result.lines.get("olv-serials")?.reach, 20215);
  assert.equal(result.unboundFacts.length, 1);
  const sql = statements.find((item) => item.sql.includes("bound_advertising_fact"))?.sql ?? "";
  assert.match(sql, /f\.platform_account_id\s*=\s*c\.platform_account_id/);
  assert.match(sql, /COALESCE\(b\.effective_from/);
  assert.match(sql, /canonical_advertising_facts_current/);
  assert.match(sql, /canonical_source_platforms/);
  assert.match(sql, /f\.fact_scope\s*=\s*p\.default_fact_scope/);
});

test("same external id in another account is not summed", async () => {
  const { executor, statements } = fakeExecutor();
  const result = await loadBoundAdvertisingFacts(29, "2026-08-17", "2026-08-17", executor as never);

  assert.deepEqual(result.lines.get("olv-serials")?.campaignIds, [501]);
  const sql = statements.find((item) => item.sql.includes("bound_advertising_fact"))?.sql ?? "";
  assert.match(sql, /f\.platform_campaign_id\s*=\s*c\.platform_campaign_id/);
  assert.match(sql, /f\.source_key\s*=\s*c\.source_key/);
});

test("stored monthly units remain exact instead of being averaged across months", async () => {
  const { executor } = fakeExecutor();
  const result = await loadBoundAdvertisingFacts(29, "2026-08-01", "2026-08-31", executor as never);

  assert.deepEqual(result.lines.get("olv-serials")?.monthlyPlan, { "2026-08": 40430 });
});

test("VK dashboard views use 89 percent of impressions", async () => {
  const { executor } = fakeExecutor({ sourceKey: "vk_ads_v2" });
  const result = await loadBoundAdvertisingFacts(29, "2026-08-01", "2026-08-31", executor as never);

  assert.equal(Math.round(result.lines.get("olv-serials")?.views ?? 0), Math.round(40430 * 0.89));
});

test("validated zero-activity binding retains campaign lineage", async () => {
  const { executor } = fakeExecutor({ emptyBoundFacts: true });
  const result = await loadBoundAdvertisingFacts(29, "2026-08-01", "2026-08-31", executor as never);

  assert.deepEqual(result.lines.get("olv-serials")?.campaignIds, [501]);
  assert.equal(result.lines.get("olv-serials")?.impressions, 0);
});

test("dashboard binding branches use the canonical read model behind the rollout flag", () => {
  const source = readFileSync(path.resolve("src/lib/dashboard-data-loader.ts"), "utf8");
  assert.match(source, /AD_CANONICAL_READ_V2/);
  assert.match(source, /loadBoundAdvertisingFacts/);
  assert.match(source, /buildCanonicalPlanVsFactRows/);
  assert.match(source, /buildCanonicalChannelTimeseries/);
});

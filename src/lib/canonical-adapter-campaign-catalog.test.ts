import assert from "node:assert/strict";
import test from "node:test";
import pool from "./db";
import { getActiveAccounts, getCampaignCatalog } from "./canonical-adapter";

test("catalog keeps equal external campaign ids in different accounts", async (t) => {
  const original = pool.query.bind(pool);
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  (pool as unknown as { query: typeof pool.query }).query = (async (sql: string, params: unknown[]) => {
    capturedSql = sql;
    capturedParams = params;
    return [[
      {
        canonical_campaign_id: 501,
        source_key: "between",
        platform_account_id: "1113",
        account_name: "Cabinet 1113",
        platform_campaign_id: "24932",
        campaign_name: "OLV Serials",
      },
      {
        canonical_campaign_id: 777,
        source_key: "between",
        platform_account_id: "2224",
        account_name: "Cabinet 2224",
        platform_campaign_id: "24932",
        campaign_name: "OLV Serials",
      },
    ], []] as never;
  }) as unknown as typeof pool.query;
  t.after(() => {
    (pool as unknown as { query: typeof pool.query }).query = original;
  });

  const rows = await getCampaignCatalog("between", { accountIds: ["1113", "2224"] });

  assert.deepEqual(rows.map((row) => [row.platformAccountId, row.platformCampaignId]), [
    ["1113", "24932"],
    ["2224", "24932"],
  ]);
  assert.notEqual(rows[0].canonicalCampaignId, rows[1].canonicalCampaignId);
  assert.match(capturedSql, /JOIN canonical_source_accounts/);
  assert.doesNotMatch(capturedSql, /canonical_fact_ads_daily|canonical_advertising_facts_current/);
  assert.deepEqual(capturedParams, ["between", "1113", "2224"]);
});

test("catalog includes zero-activity campaigns and searches all identity labels", async (t) => {
  const original = pool.query.bind(pool);
  let capturedSql = "";
  (pool as unknown as { query: typeof pool.query }).query = (async (sql: string) => {
    capturedSql = sql;
    return [[{
      canonical_campaign_id: 900,
      source_key: "between",
      platform_account_id: "1113",
      account_name: "Cabinet 1113",
      platform_campaign_id: "zero-campaign",
      campaign_name: "Validated empty campaign",
    }], []] as never;
  }) as unknown as typeof pool.query;
  t.after(() => {
    (pool as unknown as { query: typeof pool.query }).query = original;
  });

  const rows = await getCampaignCatalog("between", { accountIds: ["1113"], search: "empty" });

  assert.equal(rows[0].platformCampaignId, "zero-campaign");
  assert.match(capturedSql, /c\.campaign_name LIKE \?/);
  assert.match(capturedSql, /c\.platform_campaign_id LIKE \?/);
  assert.match(capturedSql, /a\.account_name LIKE \?/);
  assert.doesNotMatch(capturedSql, /COALESCE\(f\.(spend|impressions)/);
});

test("account selector includes active successful-empty account with zero fact rows", async (t) => {
  const original = pool.execute.bind(pool);
  let capturedSql = "";
  (pool as unknown as { execute: typeof pool.execute }).execute = (async (sql: string) => {
    capturedSql = sql;
    return [[{
      id: "empty-account",
      name: "Empty account",
      latest_report_date: "2026-08-18",
      fact_rows: 0,
      total_spend: 0,
    }], []] as never;
  }) as unknown as typeof pool.execute;
  t.after(() => {
    (pool as unknown as { execute: typeof pool.execute }).execute = original;
  });

  const rows = await getActiveAccounts("between", "ads");

  assert.ok(rows.some((row) => row.id === "empty-account" && row.fact_rows === 0));
  assert.match(capturedSql, /FROM canonical_source_accounts a/);
  assert.match(capturedSql, /LEFT JOIN canonical_source_account_collection_settings/);
  assert.match(capturedSql, /LEFT JOIN[\s\S]*canonical_advertising_facts_current/);
  assert.match(capturedSql, /LEFT JOIN[\s\S]*canonical_ad_coverage_daily/);
  assert.doesNotMatch(capturedSql, /JOIN canonical_fact_ads_daily f/);
});

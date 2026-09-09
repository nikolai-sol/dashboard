import assert from "node:assert/strict";
import test from "node:test";
import pool from "./db";
import { getAdsAggregate } from "./canonical-adapter";

test("versioned Yandex Sheet account reads current publications with legacy fallback", async (t) => {
  const original = pool.execute.bind(pool);
  const statements: string[] = [];
  (pool as unknown as { execute: typeof pool.execute }).execute = (async (sql: string) => {
    statements.push(sql);
    return [[{}], []] as never;
  }) as unknown as typeof pool.execute;
  t.after(() => {
    (pool as unknown as { execute: typeof pool.execute }).execute = original;
  });

  await getAdsAggregate({
    source_key: "yandex_direct",
    account_ids: ["gidrofuril-search"],
    date_from: "2026-07-01",
    date_to: "2026-09-10",
  });
  await getAdsAggregate({
    source_key: "hybrid",
    date_from: "2026-07-01",
    date_to: "2026-09-10",
  });

  assert.match(statements[0], /canonical_advertising_facts_current/);
  assert.match(statements[0], /canonical_fact_ads_daily legacy/);
  assert.match(statements[0], /canonical_ad_coverage_daily/);
  assert.match(statements[0], /source_key = 'yandex_direct'/);
  assert.doesNotMatch(statements[1], /canonical_advertising_facts_current/);
  assert.match(statements[1], /FROM canonical_fact_ads_daily f/);
});

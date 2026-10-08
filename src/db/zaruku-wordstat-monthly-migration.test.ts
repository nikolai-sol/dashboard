import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("monthly migration preserves daily history with separate native calendar grain", () => {
  const sql = readFileSync(new URL("./migrations/064_zaruku_wordstat_monthly.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canonical_fact_wordstat_dynamics_monthly/);
  assert.match(sql, /month_from DATE NOT NULL/);
  assert.match(sql, /month_to DATE NOT NULL/);
  assert.match(sql, /ingestion_run_id BIGINT DEFAULT NULL/);
  assert.match(sql, /REFERENCES canonical_collector_runs\(id\)/);
  assert.match(sql, /analytics_account_id, registry_version, seed_hash, month_from, month_to, region_scope, device_type/);
  assert.match(sql, /CHECK \(count >= 0\)/);
  assert.doesNotMatch(sql, /dynamics_daily|DELETE\s+FROM|DROP\s+TABLE|UPDATE\s+canonical_|oauth/i);
});

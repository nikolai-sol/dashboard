import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("./migrations/045_zaruku_wordstat_demand.sql", import.meta.url), "utf8");

function tableBody(tableName: string) {
  const match = sql.match(
    new RegExp(
      `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\s*\\(([\\s\\S]*?)\\)\\s+ENGINE=`,
      "i",
    ),
  );
  assert.ok(match, `${tableName} must use CREATE TABLE IF NOT EXISTS`);
  return match[1];
}

test("Wordstat migration creates account-scoped facts and coverage", () => {
  for (const table of [
    "canonical_wordstat_seed_registry",
    "canonical_wordstat_query_classifications",
    "canonical_dim_wordstat_regions",
    "canonical_fact_wordstat_dynamics_daily",
    "canonical_fact_wordstat_requests_snapshot",
    "canonical_fact_wordstat_regions_snapshot",
    "canonical_wordstat_coverage",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /analytics_account_id VARCHAR\(128\) NOT NULL/);
  assert.match(sql, /ENUM\('success', 'success_empty'\)/);
  assert.doesNotMatch(sql, /ENUM\('success', 'success_empty', 'failed'\)/);
  assert.match(sql, /REFERENCES canonical_collector_runs\(id\)/);
  assert.doesNotMatch(sql, /oauth|access_token|refresh_token/i);
});

test("Wordstat fact tables require provider counts", () => {
  for (const table of [
    "canonical_fact_wordstat_dynamics_daily",
    "canonical_fact_wordstat_requests_snapshot",
    "canonical_fact_wordstat_regions_snapshot",
  ]) {
    assert.match(tableBody(table), /^\s*count BIGINT NOT NULL/m);
  }
});

test("Wordstat classifications use the fixed review taxonomy", () => {
  for (const table of [
    "canonical_wordstat_seed_registry",
    "canonical_wordstat_query_classifications",
    "canonical_fact_wordstat_requests_snapshot",
  ]) {
    assert.match(
      tableBody(table),
      /classification ENUM\('medical', 'adjacent', 'irrelevant', 'unreviewed'\) NOT NULL DEFAULT 'unreviewed'/,
    );
  }
});

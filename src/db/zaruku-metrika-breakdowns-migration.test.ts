import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("migration 043 adds replay-safe Zaruku Metrika breakdown storage and read compatibility", () => {
  const sql = readFileSync(
    path.resolve("src/db/migrations/043_zaruku_metrika_breakdowns_daily.sql"),
    "utf8",
  );

  assert.match(sql, /canonical_fact_metrika_breakdowns_daily/);
  assert.match(sql, /canonical_metrika_breakdown_coverage_daily/);
  assert.match(sql, /report_key VARCHAR\(64\) NOT NULL/);
  assert.match(sql, /segment_key VARCHAR\(64\) NOT NULL DEFAULT 'russia'/);
  assert.match(sql, /dimension_1_key VARCHAR\(64\)/);
  assert.match(sql, /dimension_1_value TEXT/);
  assert.match(sql, /dimension_2_key VARCHAR\(64\)/);
  assert.match(sql, /dimension_2_value TEXT/);
  assert.match(sql, /dimension_hash CHAR\(64\) NOT NULL/);
  assert.match(sql, /UNIQUE KEY uniq_metrika_breakdown_daily/);
  assert.match(sql, /KEY idx_metrika_breakdown_read/);
  assert.match(sql, /KEY idx_site_analytics_scope_read/);
  assert.match(sql, /KEY idx_gsc_country_date/);
  assert.match(sql, /entry_page/);

  assert.doesNotMatch(sql, /canonical_fact_metrika_[a-z0-9_]*_release/i);
  assert.doesNotMatch(sql, /report_bd_private/i);
});

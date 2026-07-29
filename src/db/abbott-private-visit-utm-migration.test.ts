import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("migration 044 adds Abbott visit UTM source and index repeat-safely", () => {
  const sql = readFileSync(
    path.resolve("src/db/migrations/044_abbott_private_visit_utm_source.sql"),
    "utf8",
  );

  assert.match(sql, /TABLE_SCHEMA\s*=\s*'report_bd_private'/i);
  assert.match(sql, /TABLE_NAME\s*=\s*'canonical_fact_metrika_visits'/i);
  assert.match(sql, /ADD COLUMN utm_source VARCHAR\(500\) DEFAULT NULL/i);
  assert.match(sql, /ADD INDEX idx_private_visit_release_utm/i);
  assert.match(sql, /information_schema\.COLUMNS/i);
  assert.match(sql, /information_schema\.STATISTICS/i);
  assert.doesNotMatch(
    sql,
    /UPDATE\s+report_bd_private\.canonical_fact_metrika_visits/i,
  );
});

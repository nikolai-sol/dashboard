import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("migration 041 adds only the private multi-User-ID visit column repeat-safely", () => {
  const sql = readFileSync(
    path.resolve("src/db/migrations/041_abbott_private_visit_user_ids.sql"),
    "utf8",
  );

  assert.match(sql, /information_schema\.COLUMNS/i);
  assert.match(sql, /information_schema\.TABLES/i);
  assert.match(sql, /TABLE_SCHEMA\s*=\s*'report_bd_private'/i);
  assert.match(sql, /TABLE_NAME\s*=\s*'canonical_fact_metrika_visits'/i);
  assert.match(sql, /ADD COLUMN raw_user_ids_json JSON DEFAULT NULL/i);
  assert.match(sql, /PREPARE stmt/i);
  assert.doesNotMatch(sql, /UPDATE\s+report_bd_private\.canonical_fact_metrika_visits/i);
});

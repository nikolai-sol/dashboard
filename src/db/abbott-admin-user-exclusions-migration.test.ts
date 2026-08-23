import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("migration 062 creates only the private Abbott admin exclusion settings table", () => {
  const sql = readFileSync(
    path.resolve("src/db/migrations/062_abbott_admin_user_exclusions.sql"),
    "utf8",
  );

  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS report_bd_private\.portal_abbott_admin_user_exclusions/i,
  );
  assert.match(sql, /dashboard_id BIGINT UNSIGNED NOT NULL/i);
  assert.match(
    sql,
    /raw_user_id VARCHAR\(32\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i,
  );
  assert.match(sql, /UNIQUE KEY uniq_abbott_admin_dashboard_user\s*\(dashboard_id, raw_user_id\)/i);
  assert.doesNotMatch(sql, /CREATE TABLE[^;]*report_bd\.(?!portal_abbott_admin_user_exclusions)/i);
  assert.doesNotMatch(sql, /INSERT\s+(?:IGNORE\s+)?INTO/i);
});

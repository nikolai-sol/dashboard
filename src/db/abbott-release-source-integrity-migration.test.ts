import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve("src/db/migrations/046_abbott_release_source_integrity.sql");

test("migration 046 repeat-safely blocks release-source drift outside staging", () => {
  assert.equal(existsSync(migrationPath), true, "migration 046 must exist");
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS abbott_release_source_integrity_guard/i);
  assert.match(sql, /INSERT IGNORE INTO abbott_release_source_integrity_guard/i);
  assert.equal((sql.match(/DROP TRIGGER IF EXISTS/gi) ?? []).length, 4);
  assert.equal((sql.match(/CREATE TRIGGER/gi) ?? []).length, 4);
  assert.doesNotMatch(sql, /DELIMITER/i);

  assert.match(sql, /CREATE TRIGGER trg_abbott_release_source_ids_staging_only\s+BEFORE UPDATE ON portal_data_releases/i);
  assert.match(sql, /OLD\.release_status\s*<>\s*'staging'/i);
  assert.match(sql, /NEW\.release_status\s*<>\s*'staging'/i);
  assert.match(sql, /NOT\s*\(NEW\.source_snapshot_ids\s*<=>\s*OLD\.source_snapshot_ids\)/i);

  for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
    assert.match(
      sql,
      new RegExp(
        `CREATE TRIGGER trg_abbott_release_receipt_${event.toLowerCase()}_staging_only\\s+BEFORE ${event} ON portal_release_source_imports`,
        "i",
      ),
    );
  }
  assert.match(sql, /release_status\s*<>\s*'staging'/i);
  assert.doesNotMatch(sql, /\b12\b/);
});

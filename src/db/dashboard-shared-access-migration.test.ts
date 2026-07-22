import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("migration 042 stores only versioned shared password hashes", () => {
  const sql = readFileSync(path.resolve("src/db/migrations/042_dashboard_shared_access_settings.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS dashboard_shared_access_settings/i);
  assert.match(sql, /dashboard_id INT NOT NULL/);
  assert.match(sql, /password_hash VARCHAR\(255\) NOT NULL/);
  assert.match(sql, /credential_version BIGINT UNSIGNED NOT NULL DEFAULT 1/);
  assert.match(sql, /FOREIGN KEY \(dashboard_id\) REFERENCES dashboards\(id\)/);
  assert.doesNotMatch(sql, new RegExp(["zaruku", "2026"].join(""), "i"));
  assert.doesNotMatch(sql, /password_plain|plaintext/i);
});

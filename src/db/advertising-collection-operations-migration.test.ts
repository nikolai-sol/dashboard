import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve("src/db/migrations/059_advertising_collection_operations.sql");

test("migration 059 exists", () => {
  assert.equal(existsSync(migrationPath), true);
});

const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

test("advertising operations schema stores account SLA and notification outcomes", () => {
  assert.match(sql, /canonical_ad_source_schedule_policies/);
  assert.match(sql, /timezone_name/);
  assert.match(sql, /expected_hour_local/);
  assert.match(sql, /source_delay_days/);
  assert.match(sql, /allowed_lag_days/);
  assert.match(sql, /lookback_days/);
  assert.match(sql, /retry_limit/);
  assert.match(sql, /publication_mode ENUM\('incremental','authoritative_snapshot'\)/);
  assert.match(sql, /canonical_ad_notification_deliveries/);
  assert.match(sql, /status ENUM\('pending','sent','failed'\)/);
});

test("operations schema is account-scoped and replay safe", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canonical_ad_source_schedule_policies/);
  assert.match(sql, /UNIQUE KEY uniq_ad_schedule_account \(source_key, platform_account_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canonical_ad_notification_deliveries/);
  assert.match(sql, /UNIQUE KEY uniq_ad_notification \(notification_key, channel, report_date\)/);
  assert.match(sql, /CHECK \(expected_hour_local <= 23\)/);
});

test("notification audit records attempts without storing Telegram credentials", () => {
  assert.match(sql, /attempt_count INT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(sql, /last_error VARCHAR\(500\) NULL/);
  assert.match(sql, /sent_at DATETIME NULL/);
  assert.doesNotMatch(sql, /bot_token|chat_id|oauth|credential/i);
});

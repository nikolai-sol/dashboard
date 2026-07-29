import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./migrations/045_yandex_webmaster_query_pages_daily.sql", import.meta.url),
  "utf8",
);

test("migration defines exact pair grain and successful empty coverage", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canonical_fact_webmaster_query_pages_daily/i);
  assert.match(
    sql,
    /UNIQUE KEY uniq_webmaster_query_pages_daily \(source_key, analytics_account_id, host_id, report_date, device_type, query_hash, page_hash\)/i,
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canonical_webmaster_query_page_coverage_daily/i);
  assert.match(
    sql,
    /UNIQUE KEY uniq_webmaster_query_page_coverage_daily \(source_key, analytics_account_id, host_id, report_date, device_type, page_hash\)/i,
  );
  assert.match(sql, /row_count INT UNSIGNED NOT NULL DEFAULT 0/i);
});

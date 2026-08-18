import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sql = fs.readFileSync(
  path.join(process.cwd(), "src/db/migrations/056_advertising_ingestion_foundation.sql"),
  "utf8",
);

test("advertising ingestion migration defines versioned publication authority", () => {
  for (const name of [
    "canonical_ad_source_artifacts",
    "canonical_advertiser_source_accounts",
    "canonical_ad_publications",
    "canonical_ad_staging_facts",
    "canonical_ad_validation_issues",
    "canonical_ad_fact_versions_daily",
    "canonical_ad_coverage_daily",
    "canonical_advertising_facts_current",
  ]) assert.match(sql, new RegExp(name));
  assert.match(sql, /UNIQUE KEY uniq_ad_active_scope/);
  assert.match(sql, /content_sha256 CHAR\(64\)/);
  assert.match(sql, /ENUM\('complete_with_data','complete_empty','not_due','failed','missing'\)/);
});

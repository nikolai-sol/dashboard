import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  "src/db/migrations/058_canonical_media_plan_bindings.sql",
);

test("migration 058 exists", () => {
  assert.equal(existsSync(migrationPath), true);
});

const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

test("bindings use canonical campaign identity and effective periods", () => {
  for (const column of [
    "canonical_campaign_id",
    "platform_account_id",
    "effective_from",
    "effective_to",
    "created_by",
  ]) {
    assert.match(sql, new RegExp(column));
  }
  assert.match(sql, /CREATE TABLE IF NOT EXISTS media_plan_binding_audit/);
  assert.match(
    sql,
    /FOREIGN KEY \(canonical_campaign_id\)\s+REFERENCES canonical_source_campaigns \(id\)/,
  );
  assert.match(
    sql,
    /SELECT COLUMN_TYPE FROM information_schema\.COLUMNS[\s\S]*?TABLE_NAME = 'canonical_source_campaigns'[\s\S]*?COLUMN_NAME = 'id'/,
  );
  assert.match(
    sql,
    /ALTER TABLE media_plan_bindings MODIFY COLUMN canonical_campaign_id[\s\S]*?@canonical_campaign_id_type/,
  );
});

test("every additive column, index, and foreign key is replay guarded", () => {
  for (const column of [
    "canonical_campaign_id",
    "platform_account_id",
    "effective_from",
    "effective_to",
    "created_by",
  ]) {
    assert.match(
      sql,
      new RegExp(`information_schema\\.COLUMNS[\\s\\S]*?COLUMN_NAME = '${column}'`, "i"),
    );
  }
  assert.match(sql, /information_schema\.STATISTICS[\s\S]*?idx_media_plan_binding_canonical_period/i);
  assert.match(
    sql,
    /information_schema\.STATISTICS[\s\S]*?INDEX_NAME = 'unique_binding'[\s\S]*?COLUMN_NAME IN \('canonical_campaign_id', 'effective_from', 'effective_to'\)/i,
  );
  assert.match(
    sql,
    /ADD UNIQUE KEY unique_binding \(dashboard_id, line_key\(191\), canonical_campaign_id, effective_from, effective_to\)/i,
  );
  assert.match(sql, /information_schema\.REFERENTIAL_CONSTRAINTS[\s\S]*?fk_media_plan_binding_canonical_campaign/i);
  assert.doesNotMatch(sql, /ALTER TABLE media_plan_bindings ADD COLUMN(?![\s\S]*?PREPARE)/i);
});

test("backfill resolves only one account-aware canonical campaign", () => {
  assert.match(
    sql,
    /FROM canonical_source_campaigns[\s\S]*?GROUP BY source_key, platform_campaign_id[\s\S]*?HAVING COUNT\(\*\) = 1/i,
  );
  assert.match(
    sql,
    /SET bindings\.canonical_campaign_id = resolved\.canonical_campaign_id[\s\S]*?bindings\.platform_account_id = resolved\.platform_account_id/i,
  );
  assert.match(
    sql,
    /resolved\.source_key COLLATE utf8mb4_bin\s*= bindings\.source_key COLLATE utf8mb4_bin/i,
  );
  assert.match(
    sql,
    /resolved\.platform_campaign_id COLLATE utf8mb4_bin\s*= bindings\.platform_campaign_id COLLATE utf8mb4_bin/i,
  );
  assert.match(sql, /WHERE bindings\.canonical_campaign_id IS NULL/i);
  assert.doesNotMatch(sql, /LIMIT 1/i);
});

test("migration audit is idempotent and records before and after identity", () => {
  assert.match(sql, /action ENUM\('create','update','delete','migration'\) NOT NULL/);
  assert.match(sql, /before_json JSON NULL/);
  assert.match(sql, /after_json JSON NULL/);
  assert.match(sql, /INSERT INTO media_plan_binding_audit/i);
  assert.match(sql, /NOT EXISTS \([\s\S]*?audit\.binding_id = bindings\.id[\s\S]*?audit\.action = 'migration'/i);
  assert.match(sql, /JSON_OBJECT\([\s\S]*?'canonical_campaign_id'/i);
});

test("migration does not make unresolved legacy bindings look canonical", () => {
  assert.doesNotMatch(sql, /ADD COLUMN canonical_campaign_id[^\n]*NOT NULL/i);
  assert.doesNotMatch(sql, /ADD COLUMN platform_account_id[^\n]*NOT NULL/i);
  assert.match(sql, /created_by = 'migration:058'/i);
});

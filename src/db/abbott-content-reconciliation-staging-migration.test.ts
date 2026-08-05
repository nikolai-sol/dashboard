import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sql = readFileSync(
  path.resolve("src/db/migrations/047_abbott_content_reconciliation_staging.sql"),
  "utf8",
);

test("migration 047 adds immutable Abbott reconciliation staging", () => {
  for (const table of [
    "portal_content_reconciliation_runs",
    "portal_content_reconciliation_items",
    "portal_content_llm_attempts",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(sql, /UNIQUE KEY uniq_content_reconciliation_run \(dataset_key, run_key\)/);
  assert.match(sql, /UNIQUE KEY uniq_content_reconciliation_item_key \(reconciliation_run_id, item_key\)/);
  assert.match(sql, /UNIQUE KEY uniq_content_reconciliation_input_hash \(reconciliation_run_id, input_hash\)/);
  assert.match(sql, /UNIQUE KEY uniq_content_llm_attempt_route \(reconciliation_item_id, route_kind, attempt_ordinal\)/);
  assert.match(sql, /UNIQUE KEY uniq_content_llm_attempt_fingerprint \(event_fingerprint\)/);
  assert.match(sql, /identity_status ENUM\('matched', 'new', 'collision', 'rejected'\)/);
  assert.match(sql, /run_status ENUM\('reconciled', 'classified', 'finalized', 'failed'\)/);
});

test("migration 047 separates registry inputs from predecessor release snapshots", () => {
  assert.match(sql, /registry1_snapshot_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /registry2_snapshot_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /registry1_sha256 CHAR\(64\) NOT NULL/);
  assert.match(sql, /registry2_sha256 CHAR\(64\) NOT NULL/);
  assert.match(sql, /predecessor_release_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /predecessor_snapshot_ids JSON NOT NULL/);
  assert.match(sql, /predecessor_snapshot_digests JSON NOT NULL/);
  assert.doesNotMatch(sql, /UPDATE\s+portal_content_approval_batches\s+SET\s+source_snapshot_ids/i);
});

test("migration 047 links one finalized batch to one run repeat-safely", () => {
  assert.match(sql, /ADD COLUMN reconciliation_run_id BIGINT UNSIGNED DEFAULT NULL/);
  assert.match(sql, /ADD UNIQUE INDEX uniq_approval_batch_reconciliation_run \(reconciliation_run_id\)/);
  assert.match(sql, /ADD CONSTRAINT fk_approval_batch_reconciliation_run/);
  assert.match(sql, /information_schema\.COLUMNS/);
  assert.match(sql, /information_schema\.STATISTICS/);
  assert.match(sql, /information_schema\.TABLE_CONSTRAINTS/);
});

test("migration 047 fail-closes taxonomy v1 conflicts and stores no private data", () => {
  assert.match(sql, /abbott\.v1/);
  assert.match(sql, /d6a2bfc39d970a873e309223604f9ae7c37cd83d6c046c107eed08e73ec435d4/);
  assert.match(sql, /ON DUPLICATE KEY UPDATE/);
  assert.match(sql, /IF\(taxonomy_digest = VALUES\(taxonomy_digest\)/);
  assert.match(sql, /IF\(term_label = VALUES\(term_label\)/);
  assert.doesNotMatch(sql, /raw_response|chain_of_thought|raw_user_id|visit_id|client_id|oauth_value|secret_value|email_address|phone_number/i);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE\s+FROM)\s+portal_content_llm_attempts/i);
});

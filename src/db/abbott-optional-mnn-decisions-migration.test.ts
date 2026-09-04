import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sql = readFileSync(
  path.resolve("src/db/migrations/061_abbott_optional_mnn_decisions.sql"),
  "utf8",
);

test("migration 061 adds optional primary and additional MNN decisions", () => {
  for (const column of [
    "mnn_decision_version",
    "final_primary_mnn_key",
    "final_primary_mnn_label",
    "final_additional_mnn_json",
    "mnn_decision_reason",
  ]) {
    assert.match(sql, new RegExp(`COLUMN ${column}\\b`));
    assert.match(sql, new RegExp(`COLUMN_NAME = '${column}'`));
  }
  assert.match(sql, /CREATE TABLE IF NOT EXISTS portal_content_mnn_decision_events/);
  assert.match(sql, /mnn_role ENUM\(''primary'',''additional'',''unranked''\)/);
  assert.match(sql, /display_order INT UNSIGNED NOT NULL DEFAULT 0/);
});

test("migration 061 preserves exactly one immutable MNN authority", () => {
  assert.match(sql, /chk_content_mnn_exactly_one_authority/);
  assert.match(sql, /mnn_source_snapshot_id IS NOT NULL AND source_claim_id IS NOT NULL AND mnn_decision_event_id IS NULL/);
  assert.match(sql, /mnn_source_snapshot_id IS NULL AND source_claim_id IS NULL AND mnn_decision_event_id IS NOT NULL/);
  assert.match(sql, /trg_abbott_mnn_decisions_immutable_update/);
  assert.match(sql, /trg_abbott_mnn_decisions_immutable_delete/);
  assert.match(sql, /SIGNAL SQLSTATE '45000'/);
});

test("migration 061 keeps the existing release/entity/MNN uniqueness contract", () => {
  assert.doesNotMatch(sql, /DROP\s+(?:INDEX|KEY)\s+uniq_content_mnn_release_entity/i);
  assert.doesNotMatch(sql, /UPDATE\s+portal_content_catalog_mnn/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+portal_content_catalog_mnn/i);
});

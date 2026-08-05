import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("migration 045 creates append-only Abbott registry workflow tables", () => {
  const sql = readFileSync(
    path.resolve("src/db/migrations/045_abbott_content_registry_workflow.sql"),
    "utf8",
  );

  for (const table of [
    "portal_content_registry_entities",
    "portal_content_registry_aliases",
    "portal_content_taxonomy_versions",
    "portal_content_taxonomy_terms",
    "portal_content_approval_batches",
    "portal_content_approval_items",
    "portal_content_classification_events",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(sql, /UNIQUE KEY uniq_registry_strong_alias/);
  assert.match(sql, /accepted_decision_hash CHAR\(64\)/);
  assert.doesNotMatch(sql, /raw_user_id|visit_id|client_id/i);
});

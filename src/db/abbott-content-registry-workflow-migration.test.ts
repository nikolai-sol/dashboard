import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("migration 047 creates append-only Abbott registry workflow tables", () => {
  const sql = readFileSync(
    path.resolve("src/db/migrations/047_abbott_content_registry_workflow.sql"),
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
  assert.match(
    sql,
    /alias_type ENUM\('material_id', 'canonical_url', 'url', 'slug', 'title'\) NOT NULL/,
  );
  assert.match(
    sql,
    /CONSTRAINT chk_registry_alias_scope CHECK \([\s\S]*?alias_type IN \('material_id', 'canonical_url', 'url'\)[\s\S]*?uniqueness_scope = 'strong'[\s\S]*?alias_type IN \('slug', 'title'\)[\s\S]*?uniqueness_scope = 'weak'[\s\S]*?\)/,
  );
  assert.match(sql, /accepted_decision_hash CHAR\(64\)/);
  assert.doesNotMatch(sql, /raw_user_id|visit_id|client_id/i);
});

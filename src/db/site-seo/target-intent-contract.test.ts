import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ddl = readFileSync(
  new URL("../migrations/066_site_seo_target_intent.sql", import.meta.url),
  "utf8",
);

const immutableTables = [
  "site_seo_intent_imports",
  "site_seo_intent_versions",
  "site_seo_intent_rules",
  "site_seo_intent_publications",
] as const;

const requiredTables = [
  ...immutableTables,
  "site_seo_intent_active",
] as const;

function tableDefinition(table: string): string {
  const match = ddl.match(
    new RegExp(
      `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB`,
      "i",
    ),
  );
  assert.ok(match, `${table} must use repeat-safe CREATE TABLE IF NOT EXISTS`);
  return match[1];
}

test("target-intent migration is additive and repeat-safe", () => {
  for (const table of requiredTables) tableDefinition(table);
  assert.doesNotMatch(ddl, /\b(?:DROP|TRUNCATE|ALTER)\s+TABLE\b/i);

  for (const table of immutableTables) {
    assert.match(
      ddl,
      new RegExp(
        `DROP TRIGGER IF EXISTS trg_${table}_immutable_update;[\\s\\S]*?` +
          `CREATE TRIGGER trg_${table}_immutable_update[\\s\\S]*?` +
          `BEFORE UPDATE ON ${table}[\\s\\S]*?SIGNAL SQLSTATE '45000'`,
        "i",
      ),
    );
    assert.match(
      ddl,
      new RegExp(
        `DROP TRIGGER IF EXISTS trg_${table}_immutable_delete;[\\s\\S]*?` +
          `CREATE TRIGGER trg_${table}_immutable_delete[\\s\\S]*?` +
          `BEFORE DELETE ON ${table}[\\s\\S]*?SIGNAL SQLSTATE '45000'`,
        "i",
      ),
    );
  }
});

test("preview imports retain protected source and administrator evidence", () => {
  const imports = tableDefinition("site_seo_intent_imports");
  for (const column of [
    "site_id",
    "dashboard_id",
    "import_uid",
    "source_transport",
    "source_identity",
    "protected_artifact_ref",
    "content_sha256",
    "validation_state",
    "validation_result_json",
    "imported_by",
    "created_at",
  ]) {
    assert.match(imports, new RegExp(`\\b${column}\\b`));
  }
  assert.match(
    imports,
    /UNIQUE KEY uq_intent_import_uid\s*\(site_id, dashboard_id, import_uid\)/,
  );
  assert.match(
    imports,
    /UNIQUE KEY uq_intent_import_snapshot\s*\(site_id, dashboard_id, source_transport, source_identity_hash, content_sha256\)/,
  );
});

test("versions and rules cannot cross site or dashboard scope", () => {
  const versions = tableDefinition("site_seo_intent_versions");
  const rules = tableDefinition("site_seo_intent_rules");

  assert.match(
    versions,
    /UNIQUE KEY uq_intent_version_scope\s*\(site_id, dashboard_id, id\)/,
  );
  assert.match(
    versions,
    /FOREIGN KEY \(site_id, dashboard_id, import_id\)[\s\S]*?REFERENCES site_seo_intent_imports \(site_id, dashboard_id, id\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(versions, /created_by/);
  assert.match(versions, /created_at/);

  assert.match(
    rules,
    /UNIQUE KEY uq_intent_rule_normalized\s*\(site_id, dashboard_id, version_id, normalized_key\)/,
  );
  assert.match(
    rules,
    /FOREIGN KEY \(site_id, dashboard_id, version_id\)[\s\S]*?REFERENCES site_seo_intent_versions \(site_id, dashboard_id, id\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(rules, /match_type ENUM\('exact', 'phrase'\)/);
  assert.match(rules, /source_row_ordinal/);
});

test("one active pointer exists per site and dashboard", () => {
  const active = tableDefinition("site_seo_intent_active");
  assert.match(active, /PRIMARY KEY \(site_id, dashboard_id\)/);
  assert.match(
    active,
    /FOREIGN KEY \(site_id, dashboard_id, version_id\)[\s\S]*?REFERENCES site_seo_intent_versions \(site_id, dashboard_id, id\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(active, /publication_id/);
  assert.match(active, /activated_at/);
  assert.match(active, /activated_by/);
  assert.match(
    active,
    /FOREIGN KEY \(site_id, dashboard_id, publication_id, version_id\)[\s\S]*?REFERENCES site_seo_intent_publications \(site_id, dashboard_id, id, version_id\)[\s\S]*?ON DELETE RESTRICT/,
  );
});

test("publication receipts preserve the full site-scoped audit chain", () => {
  const publications = tableDefinition("site_seo_intent_publications");
  assert.match(
    publications,
    /UNIQUE KEY uq_intent_publication_request\s*\(site_id, dashboard_id, request_uid\)/,
  );
  for (const column of [
    "version_id",
    "previous_version_id",
    "import_id",
    "publication_kind",
    "published_by",
    "published_at",
    "publication_comment",
  ]) {
    assert.match(publications, new RegExp(`\\b${column}\\b`));
  }
  assert.match(
    publications,
    /FOREIGN KEY \(site_id, dashboard_id, version_id\)[\s\S]*?REFERENCES site_seo_intent_versions \(site_id, dashboard_id, id\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(
    publications,
    /FOREIGN KEY \(site_id, dashboard_id, previous_version_id\)[\s\S]*?REFERENCES site_seo_intent_versions \(site_id, dashboard_id, id\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(
    publications,
    /FOREIGN KEY \(site_id, dashboard_id, import_id\)[\s\S]*?REFERENCES site_seo_intent_imports \(site_id, dashboard_id, id\)[\s\S]*?ON DELETE RESTRICT/,
  );
});

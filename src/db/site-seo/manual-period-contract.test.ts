import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ddl = readFileSync(
  new URL("./manual-period-contract.sql", import.meta.url),
  "utf8",
);

const requiredTables = [
  "canonical_seo_manual_imports",
  "canonical_fact_gsc_manual_daily",
  "canonical_fact_gsc_manual_period_dimensions",
  "canonical_fact_gsc_manual_indexing",
  "canonical_fact_gsc_manual_indexing_urls",
  "canonical_seo_manual_coverage",
];

test("manual period DDL is additive and idempotent", () => {
  for (const table of requiredTables) {
    assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.doesNotMatch(ddl, /\b(?:DROP|TRUNCATE|ALTER)\s+TABLE\b/i);
});

test("immutable import scope and file identity include resource and filters", () => {
  for (const column of [
    "client_id",
    "site_id",
    "dashboard_id",
    "source_key",
    "analytics_account_id",
    "resource_id",
    "period_kind",
    "period_from",
    "period_to",
    "source_timezone",
    "filters_hash",
    "adapter_version",
    "source_files_hash",
  ]) {
    assert.match(ddl, new RegExp(`\\b${column}\\b`));
  }
  assert.match(
    ddl,
    /UNIQUE KEY uq_manual_import_file\s*\(\s*client_id,\s*site_id,\s*dashboard_id,\s*source_key,\s*analytics_account_id,\s*resource_id,\s*period_kind,\s*period_from,\s*period_to,\s*filters_hash,\s*adapter_version,\s*source_files_hash\s*\)/s,
  );
});

test("facts and coverage belong to one import and preserve manual layers", () => {
  const foreignKeys = ddl.match(
    /FOREIGN KEY\s*\(import_id\)\s*REFERENCES canonical_seo_manual_imports\s*\(id\)/g,
  );
  assert.equal(foreignKeys?.length, requiredTables.length - 1);
  assert.match(ddl, /UNIQUE KEY uq_manual_daily\s*\(import_id, report_date\)/);
  assert.match(
    ddl,
    /UNIQUE KEY uq_manual_dimension\s*\(import_id, dimension_name, dimension_value\)/,
  );
  assert.match(
    ddl,
    /UNIQUE KEY uq_manual_coverage\s*\(import_id, layer_name\)/,
  );
  assert.match(ddl, /publication_priority/);
  assert.match(ddl, /predecessor_import_id/);
  assert.match(ddl, /owner_decision_id/);
});

test("publication lock key is scoped to period and layer", () => {
  assert.match(ddl, /publication_lock_key/);
  assert.match(
    ddl,
    /UNIQUE KEY uq_manual_publication_lock\s*\(publication_lock_key, publication_revision\)/,
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sql = fs.readFileSync(
  path.join(process.cwd(), "src/db/migrations/056_advertising_ingestion_foundation.sql"),
  "utf8",
);
const mysqlVerifier = fs.readFileSync(
  path.join(process.cwd(), "scripts/verify-advertising-ingestion-foundation-mysql.ts"),
  "utf8",
);

function tableDefinition(name: string) {
  const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB`, "i"));
  assert.ok(match, `${name} must be an InnoDB table`);
  return match[1];
}

test("advertising ingestion migration defines versioned publication authority", () => {
  for (const name of [
    "canonical_ad_source_artifacts",
    "canonical_advertiser_source_accounts",
    "canonical_ad_publications",
    "canonical_ad_publication_activations",
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

test("advertising publications persist their ordering policy", () => {
  const publication = tableDefinition("canonical_ad_publications");
  assert.match(
    publication,
    /ordering_policy ENUM\('revision','source_generated_at','received_at_monotonic','manual_review'\) NOT NULL/,
  );
});

test("advertising publication activations are scope-bound immutable audit events", () => {
  const activation = tableDefinition("canonical_ad_publication_activations");
  assert.match(activation, /publication_id BIGINT UNSIGNED NOT NULL/);
  assert.match(activation, /previous_publication_id BIGINT UNSIGNED NULL/);
  assert.match(activation, /source_key VARCHAR\(64\) NOT NULL/);
  assert.match(activation, /platform_account_id VARCHAR\(128\) NOT NULL/);
  assert.match(activation, /report_date DATE NOT NULL/);
  assert.match(activation, /collector_run_id BIGINT NULL/);
  assert.match(activation, /actor VARCHAR\(255\) NOT NULL/);
  assert.match(activation, /reason TEXT NOT NULL/);
  assert.match(activation, /activated_at DATETIME(?:\(6\))? NOT NULL/);
  assert.match(activation, /KEY idx_ad_publication_activation_scope \(source_key, platform_account_id, report_date, activated_at\)/);
  assert.match(
    activation,
    /FOREIGN KEY \(publication_id, source_key, platform_account_id, report_date\)[\s\S]*?REFERENCES canonical_ad_publications \(id, source_key, platform_account_id, report_date\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(
    activation,
    /FOREIGN KEY \(previous_publication_id, source_key, platform_account_id, report_date\)[\s\S]*?REFERENCES canonical_ad_publications \(id, source_key, platform_account_id, report_date\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(
    activation,
    /FOREIGN KEY \(collector_run_id\)[\s\S]*?REFERENCES canonical_collector_runs \(id\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(sql, /CREATE TRIGGER trg_ad_publication_activations_immutable_update/);
  assert.match(sql, /CREATE TRIGGER trg_ad_publication_activations_immutable_delete/);
});

test("advertising facts retain native grain in their version identity", () => {
  for (const table of ["canonical_ad_staging_facts", "canonical_ad_fact_versions_daily"]) {
    const definition = tableDefinition(table);
    assert.match(
      definition,
      /UNIQUE KEY uniq_ad_fact_version \([\s\S]*?fact_scope, native_grain, breakdown_scope,/,
      `${table} identity must include native_grain`,
    );
  }
});

test("advertising publication scope is enforced for facts and coverage", () => {
  const publication = tableDefinition("canonical_ad_publications");
  assert.match(
    publication,
    /UNIQUE KEY uniq_ad_publication_scope \(id, source_key, platform_account_id, report_date\)/,
  );

  for (const table of ["canonical_ad_staging_facts", "canonical_ad_fact_versions_daily", "canonical_ad_coverage_daily"]) {
    const definition = tableDefinition(table);
    assert.match(
      definition,
      /FOREIGN KEY \(publication_id, source_key, platform_account_id, report_date\)[\s\S]*?REFERENCES canonical_ad_publications \(id, source_key, platform_account_id, report_date\)[\s\S]*?ON DELETE RESTRICT/,
      `${table} must reference the matching publication scope`,
    );
  }
});

test("advertising active publication and coverage authority are lifecycle guarded", () => {
  const publication = tableDefinition("canonical_ad_publications");
  assert.match(publication, /CHECK \(is_active IS NULL OR is_active = 1\)/);
  assert.match(publication, /CHECK \(is_active IS NULL OR status = 'published'\)/);
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ad_coverage_publication_active_insert/);
  assert.match(sql, /CREATE TRIGGER trg_ad_coverage_publication_active_insert[\s\S]*?p\.status = 'published'[\s\S]*?p\.is_active = 1[\s\S]*?SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /CREATE TRIGGER trg_ad_coverage_publication_active_update/);
  assert.match(sql, /CREATE TRIGGER trg_ad_publication_coverage_active_update[\s\S]*?canonical_ad_coverage_daily[\s\S]*?SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /CREATE TRIGGER trg_ad_publication_published_at_first_value_update[\s\S]*?SET NEW\.published_at = OLD\.published_at/);
});

test("advertising provenance references canonical runs and dictionaries with retained history", () => {
  const publication = tableDefinition("canonical_ad_publications");
  assert.match(publication, /FOREIGN KEY \(ingestion_run_id\)[\s\S]*?REFERENCES canonical_collector_runs\s*\(id\)[\s\S]*?ON DELETE RESTRICT/);
  assert.match(publication, /FOREIGN KEY \(source_key, platform_account_id\)[\s\S]*?REFERENCES canonical_source_accounts \(source_key, platform_account_id\)[\s\S]*?ON DELETE RESTRICT/);

  for (const table of ["canonical_ad_staging_facts", "canonical_ad_fact_versions_daily"]) {
    const definition = tableDefinition(table);
    assert.match(definition, /FOREIGN KEY \(ingestion_run_id\)[\s\S]*?REFERENCES canonical_collector_runs\s*\(id\)[\s\S]*?ON DELETE RESTRICT/);
    assert.match(definition, /FOREIGN KEY \(source_key, platform_account_id, platform_campaign_id\)[\s\S]*?REFERENCES canonical_source_campaigns \(source_key, platform_account_id, platform_campaign_id\)[\s\S]*?ON DELETE RESTRICT/);
  }

  const coverage = tableDefinition("canonical_ad_coverage_daily");
  assert.match(coverage, /FOREIGN KEY \(ingestion_run_id\)[\s\S]*?REFERENCES canonical_collector_runs\s*\(id\)[\s\S]*?ON DELETE RESTRICT/);
});

test("advertising collector-run foreign keys match migration 003 signed BIGINT keys", () => {
  for (const table of [
    "canonical_ad_publications",
    "canonical_ad_staging_facts",
    "canonical_ad_fact_versions_daily",
    "canonical_ad_coverage_daily",
  ]) {
    const definition = tableDefinition(table);
    assert.match(definition, /ingestion_run_id BIGINT(?:\s+(?:NOT NULL|DEFAULT NULL))?/);
    assert.doesNotMatch(definition, /ingestion_run_id BIGINT UNSIGNED/);
  }

  assert.match(
    mysqlVerifier,
    /CREATE TABLE canonical_collector_runs \([\s\S]*?id BIGINT NOT NULL PRIMARY KEY/,
  );
  assert.doesNotMatch(mysqlVerifier, /id BIGINT UNSIGNED NOT NULL PRIMARY KEY/);
});

test("advertising MySQL verifier source fixtures match canonical utf8mb4 collation", () => {
  for (const table of ["canonical_source_accounts", "canonical_source_campaigns"]) {
    assert.match(
      mysqlVerifier,
      new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`),
      `${table} fixture must match canonical string foreign-key collation`,
    );
  }
});

test("advertising migration can replay its lifecycle triggers and current view contract", () => {
  assert.equal((sql.match(/DROP TRIGGER IF EXISTS trg_ad_/g) ?? []).length, 6);
  assert.equal((sql.match(/CREATE TRIGGER trg_ad_/g) ?? []).length, 6);
  assert.doesNotMatch(sql, /DELIMITER/i);
  assert.match(sql, /CREATE OR REPLACE VIEW canonical_advertising_facts_current/);
  assert.match(sql, /WHERE p\.status = 'published' AND p\.is_active = 1/);
});

test("advertising MySQL verifier replays migration sections with the app runner mode", () => {
  assert.match(mysqlVerifier, /multipleStatements:\s*true/);
  assert.match(mysqlVerifier, /for \(let replay = 0; replay < 2; replay \+= 1\)/);
  assert.match(mysqlVerifier, /UPDATE canonical_ad_coverage_daily SET publication_id = NULL/);
  assert.match(mysqlVerifier, /canonical_ad_publication_activations/);
  assert.match(mysqlVerifier, /SELECT ordering_policy FROM canonical_ad_publications/);
  assert.match(mysqlVerifier, /UPDATE canonical_ad_publications SET status = 'superseded', is_active = NULL WHERE id = 1/);
  assert.match(mysqlVerifier, /UPDATE canonical_ad_publications SET status = 'superseded', is_active = NULL WHERE id = 2/);
});

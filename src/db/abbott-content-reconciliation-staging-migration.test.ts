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

test("migration 047 attests an existing taxonomy before any canonical term insert", () => {
  assert.match(sql, /abbott\.v1/);
  assert.match(sql, /d6a2bfc39d970a873e309223604f9ae7c37cd83d6c046c107eed08e73ec435d4/);
  assert.match(sql, /CREATE TEMPORARY TABLE abbott_expected_taxonomy_v1_terms/);
  assert.match(sql, /SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /ABBOTT_TAXONOMY_V1_ATTESTATION_FAILED/);
  assert.match(sql, /COUNT\(\*\)[\s\S]*portal_content_taxonomy_terms/);
  assert.match(sql, /JSON_LENGTH\(actual\.source_evidence\) = 1/);
  assert.doesNotMatch(sql, /ON DUPLICATE KEY UPDATE/);
  const attestation = sql.indexOf("ABBOTT_TAXONOMY_V1_ATTESTATION_FAILED");
  const canonicalTermInsert = sql.indexOf("INSERT INTO portal_content_taxonomy_terms");
  assert.ok(attestation >= 0 && attestation < canonicalTermInsert);
  assert.doesNotMatch(sql, /raw_response|chain_of_thought|raw_user_id|visit_id|client_id|oauth_value|secret_value|email_address|phone_number/i);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE\s+FROM)\s+portal_content_llm_attempts/i);
});

type Term = {
  kind: string;
  code: string;
  label: string;
  status: string;
  authority: string;
};

const expected: Term[] = [
  { kind: "direction", code: "cardiology", label: "Кардиология [262338]", status: "active", authority: "migration-047-reviewed-taxonomy-v1" },
  { kind: "material_type", code: "articles", label: "Статьи", status: "active", authority: "migration-047-reviewed-taxonomy-v1" },
];

function exactTerms(actual: Term[]): boolean {
  if (actual.length !== expected.length) return false;
  const key = (term: Term) => `${term.kind}\0${term.code}`;
  const actualKeys = new Set(actual.map(key));
  return actualKeys.size === expected.length && expected.every((term) =>
    actual.some((candidate) => key(candidate) === key(term)
      && candidate.label === term.label
      && candidate.status === term.status
      && candidate.authority === term.authority),
  );
}

test("taxonomy attestation model rejects every non-exact existing term shape", () => {
  assert.equal(exactTerms(expected), true);
  assert.equal(exactTerms(expected.slice(0, 1)), false, "missing");
  assert.equal(exactTerms([...expected, { ...expected[0], code: "extra" }]), false, "extra");
  assert.equal(exactTerms(expected.map((term, index) => index ? term : { ...term, label: "wrong" })), false, "label");
  assert.equal(exactTerms(expected.map((term, index) => index ? term : { ...term, authority: "wrong" })), false, "source evidence");
  assert.equal(exactTerms([expected[0], expected[0]]), false, "duplicate");
  assert.equal(exactTerms(expected.map((term, index) => index ? term : { ...term, status: "retired" })), false, "deprecated");
});

test("taxonomy seed model permits only an empty fresh version or an exact replay", () => {
  const seed = (versionExists: boolean, actual: Term[]) =>
    versionExists ? (exactTerms(actual) ? actual : null) : [...expected];
  assert.deepEqual(seed(false, []), expected);
  assert.deepEqual(seed(true, expected), expected);
  assert.equal(seed(true, expected.slice(1)), null);
});

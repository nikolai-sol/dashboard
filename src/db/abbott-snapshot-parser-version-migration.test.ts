import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve("src/db/migrations/040_abbott_snapshot_parser_version_identity.sql");
const canonicalMigrationPath = path.resolve("src/db/migrations/033_abbott_canonical_release_control.sql");

test("Abbott snapshots use parser version as part of immutable source identity", () => {
  assert.equal(existsSync(migrationPath), true, "migration 040 must exist");
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(
    sql,
    /UNIQUE\s+(?:INDEX|KEY)\s+uniq_dataset_snapshot_content\s*\(\s*dataset_key\s*,\s*source_kind\s*,\s*content_sha256\s*,\s*parser_version\s*\)/i,
  );
  assert.match(sql, /information_schema\.STATISTICS/i);
  assert.match(sql, /DROP\s+INDEX\s+uniq_dataset_snapshot_content/i);
  assert.match(sql, /PREPARE\s+stmt/i);
});

test("replaying canonical migration 033 preserves parser-version snapshot identity", () => {
  const sql = readFileSync(canonicalMigrationPath, "utf8");
  const desiredIdentity = /uniq_dataset_snapshot_content\s*\(\s*dataset_key\s*,\s*source_kind\s*,\s*content_sha256\s*,\s*parser_version\s*\)/gi;

  assert.ok((sql.match(desiredIdentity) ?? []).length >= 2);
  assert.doesNotMatch(
    sql,
    /uniq_dataset_snapshot_content\s*\(\s*dataset_key\s*,\s*source_kind\s*,\s*content_sha256\s*\)/i,
  );
  assert.match(sql, /dataset_key,source_kind,content_sha256,parser_version/);
});

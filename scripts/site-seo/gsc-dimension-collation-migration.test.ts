import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { listMigrationFiles, splitMigrationStatements } from "../../src/db/run-migration.ts";

const migrationsDir = join(new URL("../../src/db/migrations", import.meta.url).pathname);
const migrationName = "067_site_seo_gsc_dimension_binary_collation.sql";
const migrationPath = join(migrationsDir, migrationName);
const migrationSql = () => existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

test("migration 067 keeps canonically similar GSC dimension values distinct", () => {
  const sql = migrationSql();

  assert.match(sql, /^ALTER TABLE canonical_fact_gsc_manual_period_dimensions\s+/i);
  assert.match(
    sql,
    /MODIFY COLUMN dimension_value VARCHAR\(512\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/i,
  );
  assert.equal(splitMigrationStatements(sql).length, 1);
  assert.doesNotMatch(sql, /\b(?:CREATE|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i);
  assert.equal(
    (sql.match(/\bALTER TABLE\b/gi) ?? []).length,
    1,
    "067 must alter only the existing GSC dimension table",
  );
});

test("migration 067 follows both registered 066 site-SEO migrations and replays idempotently", () => {
  const files = listMigrationFiles(migrationsDir);
  const aliceIndex = files.indexOf("066_site_seo_alice_periods.sql");
  const targetIntentIndex = files.indexOf("066_site_seo_target_intent.sql");
  const migrationIndex = files.indexOf(migrationName);

  assert.notEqual(aliceIndex, -1);
  assert.notEqual(targetIntentIndex, -1);
  assert.ok(aliceIndex < targetIntentIndex);
  assert.ok(targetIntentIndex < migrationIndex);
  assert.equal(files.filter((file) => file === migrationName).length, 1);

  let collation = "utf8mb4_unicode_ci";
  const apply = () => {
    const definition = migrationSql().match(
      /MODIFY COLUMN dimension_value VARCHAR\(512\) CHARACTER SET utf8mb4 COLLATE (utf8mb4_[a-z0-9_]+) NOT NULL/i,
    );
    assert.ok(definition);
    collation = definition[1];
  };

  apply();
  assert.equal(collation, "utf8mb4_bin");
  apply();
  assert.equal(collation, "utf8mb4_bin");
});

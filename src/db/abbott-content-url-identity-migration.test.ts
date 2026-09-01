import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  "src/db/migrations/050_abbott_content_url_identity.sql",
);
const canonicalMigrationPath = path.resolve(
  "reportingdash-canonical-bootstrap/src/db/migrations/050_abbott_content_url_identity.sql",
);

test("migration adds url without dropping existing lookup kinds", () => {
  assert.equal(existsSync(migrationPath), true, "migration 050 must exist");
  assert.equal(
    existsSync(canonicalMigrationPath),
    true,
    "canonical replay migration 050 must exist",
  );

  const sql = readFileSync(migrationPath, "utf8");
  const canonicalSql = readFileSync(canonicalMigrationPath, "utf8");

  assert.equal(canonicalSql, sql, "migration copies must be byte-identical");
  assert.match(sql, /ENUM\('title','slug','path','url'\)/);
  for (const kind of ["title", "slug", "path", "url"]) {
    assert.match(sql, new RegExp(kind));
  }
});

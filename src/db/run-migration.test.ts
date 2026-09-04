import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listMigrationFiles } from "./run-migration";

test("migration enumeration retains duplicate numeric prefixes in full-filename order", () => {
  const root = mkdtempSync(path.join(tmpdir(), "migration-order-"));
  try {
    mkdirSync(path.join(root, "nested"));
    for (const name of ["046_gamma.sql", "045_beta.sql", "045_alpha.sql", "README.md"]) {
      writeFileSync(path.join(root, name), "SELECT 1;\n", "utf8");
    }
    assert.deepEqual(listMigrationFiles(root), ["045_alpha.sql", "045_beta.sql", "046_gamma.sql"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

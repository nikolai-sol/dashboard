import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { splitMigrationStatements } from "./run-migration";

const migrationPath = path.resolve("src/db/migrations/046_abbott_release_source_integrity.sql");

type ReleaseStatus = "staging" | "validated" | "active" | "retired" | "failed";

function assertSourcePointerMutationAllowed(
  oldDataset: string,
  oldStatus: ReleaseStatus,
  newDataset: string,
  newStatus: ReleaseStatus,
  sourceIdsChanged: boolean,
) {
  if (oldDataset !== "abbott" && newDataset !== "abbott") return;
  if (
    ((oldDataset === "abbott" && newDataset !== "abbott")
      || (oldDataset !== "abbott" && newDataset === "abbott"))
    && (oldStatus !== "staging" || newStatus !== "staging")
  ) {
    throw new Error("Abbott dataset changes require staging on both sides");
  }
  if (oldDataset === "abbott" && oldStatus !== "staging" && newStatus === "staging") {
    throw new Error("non-staging Abbott releases cannot return to staging");
  }
  if (sourceIdsChanged && (oldStatus !== "staging" || newStatus !== "staging")) {
    throw new Error("non-staging Abbott source IDs are immutable");
  }
}

function assertReceiptMutationAllowed(parentStatuses: ReleaseStatus[]) {
  if (parentStatuses.some((status) => status !== "staging")) {
    throw new Error("Abbott release receipts require staging parents");
  }
}

test("source-pointer transition matrix allows only staging-local mutations", () => {
  assert.doesNotThrow(() => assertSourcePointerMutationAllowed("abbott", "staging", "abbott", "staging", true));
  assert.doesNotThrow(() => assertSourcePointerMutationAllowed("abbott", "staging", "abbott", "validated", false));
  assert.doesNotThrow(() => assertSourcePointerMutationAllowed("other", "active", "other", "active", true));
  assert.doesNotThrow(() => assertSourcePointerMutationAllowed("other", "staging", "abbott", "staging", false));
  assert.doesNotThrow(() => assertSourcePointerMutationAllowed("abbott", "staging", "other", "staging", false));
  assert.throws(() => assertSourcePointerMutationAllowed("abbott", "staging", "abbott", "validated", true));
  assert.throws(() => assertSourcePointerMutationAllowed("abbott", "active", "abbott", "active", true));
  assert.throws(() => assertSourcePointerMutationAllowed("abbott", "active", "abbott", "staging", false));
  assert.throws(() => assertSourcePointerMutationAllowed("abbott", "validated", "abbott", "staging", false));
  assert.throws(() => assertSourcePointerMutationAllowed("abbott", "active", "other", "active", false));
  assert.throws(() => assertSourcePointerMutationAllowed("other", "active", "abbott", "active", false));
  assert.throws(() => assertSourcePointerMutationAllowed("other", "active", "abbott", "staging", false));
  assert.throws(() => assertSourcePointerMutationAllowed("abbott", "staging", "other", "active", false));
});

test("receipt mutation matrix allows staging and blocks every non-staging parent", () => {
  assert.doesNotThrow(() => assertReceiptMutationAllowed(["staging"]));
  for (const status of ["validated", "active", "retired", "failed"] as const) {
    assert.throws(() => assertReceiptMutationAllowed([status]));
  }
  assert.throws(() => assertReceiptMutationAllowed(["staging", "active"]));
});

test("migration 046 repeat-safely blocks release-source drift outside staging", () => {
  assert.equal(existsSync(migrationPath), true, "migration 046 must exist");
  const sql = readFileSync(migrationPath, "utf8");
  const statements = splitMigrationStatements(sql);

  assert.equal(statements.filter((statement) => /^DROP TRIGGER IF EXISTS/m.test(statement)).length, 4);
  const triggers = statements.filter((statement) => /^CREATE TRIGGER/m.test(statement));
  assert.equal(triggers.length, 4);
  for (const trigger of triggers) {
    assert.match(trigger, /SIGNAL SQLSTATE '45000'/i);
  }
  assert.doesNotMatch(sql, /abbott_release_source_integrity_guard/i);
  assert.doesNotMatch(sql, /DELIMITER/i);

  assert.match(sql, /CREATE TRIGGER trg_abbott_release_source_ids_staging_only\s+BEFORE UPDATE ON portal_data_releases/i);
  assert.match(sql, /OLD\.release_status\s*<>\s*'staging'/i);
  assert.match(sql, /NEW\.release_status\s*<>\s*'staging'/i);
  assert.match(sql, /OLD\.dataset_key\s*=\s*'abbott'\s+OR\s+NEW\.dataset_key\s*=\s*'abbott'/i);
  assert.match(sql, /OLD\.release_status\s*<>\s*'staging'\s+AND\s+NEW\.release_status\s*=\s*'staging'/i);
  assert.match(sql, /NOT\s*\(NEW\.source_snapshot_ids\s*<=>\s*OLD\.source_snapshot_ids\)/i);

  for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
    assert.match(
      sql,
      new RegExp(
        `CREATE TRIGGER trg_abbott_release_receipt_${event.toLowerCase()}_staging_only\\s+BEFORE ${event} ON portal_release_source_imports`,
        "i",
      ),
    );
  }
  assert.match(sql, /release_status\s*<>\s*'staging'/i);
  assert.doesNotMatch(sql, /\b12\b/);
});

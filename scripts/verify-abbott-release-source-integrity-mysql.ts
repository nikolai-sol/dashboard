import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { splitMigrationStatements } from "../src/db/run-migration";

const migrationPath = "src/db/migrations/046_abbott_release_source_integrity.sql";

function isSignalError(error: unknown) {
  return typeof error === "object" && error !== null
    && "sqlState" in error
    && error.sqlState === "45000";
}

async function expectSignal(operation: () => Promise<unknown>) {
  await assert.rejects(operation, isSignalError);
}

async function main() {
  const databaseUrl = process.env.ABBOTT_MIGRATION_TEST_URL;
  if (!databaseUrl) {
    throw new Error("ABBOTT_MIGRATION_TEST_URL is required for the local MySQL verifier");
  }
  const connection = await mysql.createConnection(databaseUrl);
  try {
    await connection.query(`
      CREATE TABLE portal_data_releases (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        dataset_key VARCHAR(128) NOT NULL,
        source_snapshot_ids JSON NOT NULL,
        release_status ENUM('staging', 'validated', 'active', 'retired', 'failed') NOT NULL
      ) ENGINE=InnoDB
    `);
    await connection.query(`
      CREATE TABLE portal_release_source_imports (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        canonical_release_id BIGINT UNSIGNED NOT NULL,
        source_snapshot_id BIGINT UNSIGNED NOT NULL,
        source_kind VARCHAR(64) NOT NULL,
        code_revision VARCHAR(64) NOT NULL,
        import_status ENUM('imported', 'rejected') NOT NULL,
        imported_row_count BIGINT UNSIGNED NOT NULL,
        rejected_row_count BIGINT UNSIGNED NOT NULL,
        imported_at DATETIME NOT NULL,
        UNIQUE KEY uniq_receipt (canonical_release_id, source_snapshot_id)
      ) ENGINE=InnoDB
    `);
    await connection.query(
      `INSERT INTO portal_data_releases (id, dataset_key, source_snapshot_ids, release_status)
       VALUES (1, 'abbott', JSON_ARRAY(25, 26), 'staging'),
              (2, 'abbott', JSON_ARRAY(31, 32), 'active'),
              (3, 'other', JSON_ARRAY(41, 42), 'active')`,
    );

    const migration = readFileSync(migrationPath, "utf8");
    for (let replay = 0; replay < 2; replay += 1) {
      for (const statement of splitMigrationStatements(migration)) {
        await connection.query(statement);
      }
    }

    await connection.query(
      "UPDATE portal_data_releases SET source_snapshot_ids = JSON_ARRAY(25, 27) WHERE id = 1",
    );
    await connection.query(
      `INSERT INTO portal_release_source_imports
       (canonical_release_id, source_snapshot_id, source_kind, code_revision,
        import_status, imported_row_count, rejected_row_count, imported_at)
       VALUES (1, 25, 'workbook', 'revision', 'imported', 1, 0, UTC_TIMESTAMP())`,
    );
    await connection.query(
      "UPDATE portal_release_source_imports SET source_kind = 'workbook_updated' WHERE canonical_release_id = 1",
    );
    await connection.query("DELETE FROM portal_release_source_imports WHERE canonical_release_id = 1");
    await connection.query(
      `INSERT INTO portal_release_source_imports
       (canonical_release_id, source_snapshot_id, source_kind, code_revision,
        import_status, imported_row_count, rejected_row_count, imported_at)
       VALUES (1, 25, 'workbook', 'revision', 'imported', 1, 0, UTC_TIMESTAMP())`,
    );
    await expectSignal(() => connection.query(
      "UPDATE portal_data_releases SET dataset_key = 'other', release_status = 'active' WHERE id = 1",
    ));
    await connection.query("UPDATE portal_data_releases SET release_status = 'active' WHERE id = 1");

    await expectSignal(() => connection.query(
      "UPDATE portal_data_releases SET release_status = 'staging' WHERE id = 2",
    ));
    await expectSignal(() => connection.query(
      "UPDATE portal_data_releases SET source_snapshot_ids = JSON_ARRAY(31, 33) WHERE id = 2",
    ));
    await expectSignal(() => connection.query(
      "UPDATE portal_data_releases SET dataset_key = 'other' WHERE id = 2",
    ));
    await expectSignal(() => connection.query(
      "UPDATE portal_data_releases SET dataset_key = 'abbott' WHERE id = 3",
    ));
    await expectSignal(() => connection.query(
      "UPDATE portal_data_releases SET dataset_key = 'abbott', release_status = 'staging' WHERE id = 3",
    ));
    await expectSignal(() => connection.query(
      "UPDATE portal_data_releases SET source_snapshot_ids = JSON_ARRAY(25, 28) WHERE id = 1",
    ));
    await connection.query(
      "UPDATE portal_data_releases SET source_snapshot_ids = JSON_ARRAY(41, 43) WHERE id = 3",
    );
    await expectSignal(() => connection.query(
      `INSERT INTO portal_release_source_imports
       (canonical_release_id, source_snapshot_id, source_kind, code_revision,
        import_status, imported_row_count, rejected_row_count, imported_at)
       VALUES (1, 26, 'catalog', 'revision', 'imported', 1, 0, UTC_TIMESTAMP())`,
    ));
    await expectSignal(() => connection.query(
      "UPDATE portal_release_source_imports SET source_kind = 'forbidden' WHERE canonical_release_id = 1",
    ));
    await expectSignal(() => connection.query(
      "DELETE FROM portal_release_source_imports WHERE canonical_release_id = 1",
    ));
  } finally {
    await connection.end();
  }
}

main().then(
  () => console.log("Abbott release-source MySQL integration verification passed."),
  (error) => {
    console.error("Abbott release-source MySQL integration verification failed.");
    if (error instanceof Error) console.error(error.message);
    process.exitCode = 1;
  },
);

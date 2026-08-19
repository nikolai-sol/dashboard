import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { splitMigrationStatements } from "../src/db/run-migration";

const migrationPath = "src/db/migrations/057_advertising_import_requests.sql";
const contentSha256 = "a".repeat(64);

async function expectReject(operation: () => Promise<unknown>) {
  await assert.rejects(operation);
}

async function configIdentity(
  connection: mysql.Connection,
  version: string,
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT
      CAST(JSON_OBJECT('adapter_config_version', ?, 'identity_rule', 'sheet_name_v1') AS CHAR) AS config,
      SHA2(CAST(JSON_OBJECT('adapter_config_version', ?, 'identity_rule', 'sheet_name_v1') AS CHAR), 256) AS digest
  `, [version, version]);
  return {
    config: String(rows[0].config),
    digest: String(rows[0].digest),
  };
}

async function insertRequest(
  connection: mysql.Connection,
  version: string,
  maxAttempts = 2,
) {
  const config = await configIdentity(connection, version);
  const [result] = await connection.execute<mysql.ResultSetHeader>(`
    INSERT INTO canonical_ad_import_requests (
      advertiser_key, source_key, platform_account_id, transport, protected_ref,
      content_sha256, adapter_config, adapter_config_sha256, adapter_config_version,
      max_attempts, requested_at, next_attempt_at
    ) VALUES (
      'advertiser_a', 'test_source', 'account_a', 'upload', '/protected/import.csv',
      ?, ?, ?, ?, ?, UTC_TIMESTAMP() - INTERVAL 5 MINUTE, UTC_TIMESTAMP() - INTERVAL 5 MINUTE
    )
  `, [contentSha256, config.config, config.digest, version, maxAttempts]);
  return Number(result.insertId);
}

async function main() {
  const databaseUrl = process.env.ADVERTISING_IMPORT_REQUESTS_MIGRATION_TEST_URL;
  if (!databaseUrl) {
    throw new Error("ADVERTISING_IMPORT_REQUESTS_MIGRATION_TEST_URL is required for the local MySQL verifier");
  }

  const parsedDatabaseUrl = new URL(databaseUrl);
  const connection = await mysql.createConnection({
    host: parsedDatabaseUrl.hostname,
    port: Number(parsedDatabaseUrl.port || 3306),
    user: decodeURIComponent(parsedDatabaseUrl.username),
    password: decodeURIComponent(parsedDatabaseUrl.password),
    database: decodeURIComponent(parsedDatabaseUrl.pathname.slice(1)),
    multipleStatements: true,
  });

  try {
    await connection.query(`
      CREATE TABLE canonical_collector_runs (
        id BIGINT NOT NULL PRIMARY KEY
      ) ENGINE=InnoDB
    `);
    await connection.query(`
      CREATE TABLE canonical_source_accounts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        source_key VARCHAR(64) NOT NULL,
        platform_account_id VARCHAR(128) NOT NULL,
        UNIQUE KEY uniq_canonical_source_accounts (source_key, platform_account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.query(`
      CREATE TABLE canonical_advertiser_source_accounts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        advertiser_key VARCHAR(128) NOT NULL,
        source_key VARCHAR(64) NOT NULL,
        platform_account_id VARCHAR(128) NOT NULL,
        UNIQUE KEY uniq_advertiser_source_account (advertiser_key, source_key, platform_account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.query("INSERT INTO canonical_collector_runs (id) VALUES (1)");
    await connection.query(`
      INSERT INTO canonical_source_accounts (source_key, platform_account_id)
      VALUES ('test_source', 'account_a')
    `);
    await connection.query(`
      INSERT INTO canonical_advertiser_source_accounts (advertiser_key, source_key, platform_account_id)
      VALUES ('advertiser_a', 'test_source', 'account_a')
    `);

    const migration = readFileSync(migrationPath, "utf8");
    for (let replay = 0; replay < 2; replay += 1) {
      for (const statement of splitMigrationStatements(migration)) {
        await connection.query(statement);
      }
    }

    const requestId = await insertRequest(connection, "v1");
    await expectReject(() => insertRequest(connection, "v1"));
    const correctedConfigRequestId = await insertRequest(connection, "v2");
    assert.notEqual(correctedConfigRequestId, requestId);

    const identity = await configIdentity(connection, "v1");
    await expectReject(() => connection.execute(`
      INSERT INTO canonical_ad_import_requests (
        advertiser_key, source_key, platform_account_id, transport, protected_ref,
        content_sha256, adapter_config, adapter_config_sha256, adapter_config_version
      ) VALUES (
        'advertiser_a', 'test_source', 'account_a', 'upload', '/protected/bad-config.csv',
        ?, ?, ?, 'v1'
      )
    `, [contentSha256.replace(/^a/, "b"), identity.config, "b".repeat(64)]));

    await connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'processing',
          attempt_count = 1,
          started_at = UTC_TIMESTAMP() - INTERVAL 3 MINUTE,
          lease_expires_at = UTC_TIMESTAMP() - INTERVAL 2 MINUTE,
          next_attempt_at = NULL
      WHERE id = ?
    `, [requestId]);
    const [recovery] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'retryable',
          lease_expires_at = NULL,
          next_attempt_at = UTC_TIMESTAMP(),
          error_summary = 'lease expired'
      WHERE id = ?
        AND status = 'processing'
        AND lease_expires_at <= UTC_TIMESTAMP()
    `, [requestId]);
    assert.equal(recovery.affectedRows, 1, "an expired lease must become retryable");

    await connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'processing',
          attempt_count = 2,
          started_at = UTC_TIMESTAMP(),
          lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE,
          next_attempt_at = NULL,
          error_summary = NULL
      WHERE id = ?
    `, [requestId]);
    await connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'failed',
          lease_expires_at = NULL,
          next_attempt_at = NULL,
          finished_at = UTC_TIMESTAMP(),
          error_summary = 'transient retry budget exhausted'
      WHERE id = ?
    `, [requestId]);
    await expectReject(() => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'retryable', next_attempt_at = UTC_TIMESTAMP()
      WHERE id = ${requestId}
    `));
    await expectReject(() => connection.query(`
      DELETE FROM canonical_ad_import_requests WHERE id = ${requestId}
    `));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

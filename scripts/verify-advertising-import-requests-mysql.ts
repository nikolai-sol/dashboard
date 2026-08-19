import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { splitMigrationStatements } from "../src/db/run-migration";

const migrationPath = "src/db/migrations/057_advertising_import_requests.sql";
const contentSha256 = "a".repeat(64);

async function expectReject(operation: () => Promise<unknown>) {
  await assert.rejects(operation);
}

async function config(
  connection: mysql.Connection,
  version: string,
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT CAST(JSON_OBJECT('adapter_config_version', ?, 'identity_rule', 'sheet_name_v1') AS CHAR) AS config
  `, [version]);
  return String(rows[0].config);
}

async function insertRequest(
  connection: mysql.Connection,
  version: string,
  maxAttempts = 2,
  contentDigest = contentSha256,
) {
  const adapterConfig = await config(connection, version);
  const [result] = await connection.execute<mysql.ResultSetHeader>(`
    INSERT INTO canonical_ad_import_requests (
      advertiser_key, source_key, platform_account_id, transport, protected_ref,
      content_sha256, adapter_config, adapter_config_version,
      max_attempts, requested_at, next_attempt_at
    ) VALUES (
      'advertiser_a', 'test_source', 'account_a', 'upload', '/protected/import.csv',
      ?, ?, ?, ?, UTC_TIMESTAMP() - INTERVAL 5 MINUTE, UTC_TIMESTAMP() - INTERVAL 5 MINUTE
    )
  `, [contentDigest, adapterConfig, version, maxAttempts]);
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

    const [digestRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT
        adapter_config_sha256 AS generated_digest,
        SHA2(CAST(adapter_config AS CHAR), 256) AS mysql_digest
      FROM canonical_ad_import_requests
      WHERE id = ?
    `, [requestId]);
    assert.equal(digestRows[0].generated_digest, digestRows[0].mysql_digest);
    await expectReject(() => insertRequest(connection, "v3", 2, "malformed-content"));
    await expectReject(() => insertRequest(connection, "v3", 2, contentSha256.toUpperCase()));
    await expectReject(() => connection.execute(`
      UPDATE canonical_ad_import_requests
      SET adapter_config = JSON_OBJECT('adapter_config_version', 'v3', 'identity_rule', 'sheet_name_v2')
      WHERE id = ?
    `, [requestId]));

    const attempt1LeaseToken = "11111111-1111-4111-8111-111111111111";
    const attempt2LeaseToken = "22222222-2222-4222-8222-222222222222";
    const [attempt1Claim] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'processing',
          attempt_count = 1,
          started_at = UTC_TIMESTAMP() - INTERVAL 3 MINUTE,
          lease_expires_at = UTC_TIMESTAMP() - INTERVAL 2 MINUTE,
          lease_token = ?,
          next_attempt_at = NULL
      WHERE id = ?
        AND status = 'pending'
        AND next_attempt_at <= UTC_TIMESTAMP()
    `, [attempt1LeaseToken, requestId]);
    assert.equal(attempt1Claim.affectedRows, 1);

    const expiredRetry = () => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'retryable',
          lease_expires_at = NULL,
          next_attempt_at = UTC_TIMESTAMP(),
          error_summary = 'lease expired'
      WHERE id = ?
    `, [requestId]);
    await expectReject(expiredRetry);

    const expiredFailed = () => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'failed',
          lease_expires_at = NULL,
          next_attempt_at = NULL,
          finished_at = UTC_TIMESTAMP(),
          error_summary = 'expired lease failure'
      WHERE id = ?
    `, [requestId]);
    await expectReject(expiredFailed);

    const expiredPublished = () => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'published',
          ingestion_run_id = 1,
          lease_expires_at = NULL,
          next_attempt_at = NULL,
          finished_at = UTC_TIMESTAMP(),
          error_summary = NULL
      WHERE id = ?
    `, [requestId]);
    await expectReject(expiredPublished);

    const [attempt2Claim] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'processing',
          attempt_count = attempt_count + 1,
          started_at = UTC_TIMESTAMP(),
          lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE,
          lease_token = ?,
          next_attempt_at = NULL,
          error_summary = NULL
      WHERE id = ?
        AND status = 'processing'
        AND lease_expires_at <= UTC_TIMESTAMP()
    `, [attempt2LeaseToken, requestId]);
    assert.equal(attempt2Claim.affectedRows, 1, "an expired lease can be reclaimed with a fresh token");

    const [attempt1Renew] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET lease_expires_at = UTC_TIMESTAMP() + INTERVAL 10 MINUTE
      WHERE id = ?
        AND status = 'processing'
        AND lease_token = ?
        AND lease_expires_at > UTC_TIMESTAMP()
    `, [requestId, attempt1LeaseToken]);
    assert.equal(attempt1Renew.affectedRows, 0, "expired claim cannot renew a newer lease");

    const [attempt1Retry] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'retryable',
          lease_expires_at = NULL,
          next_attempt_at = UTC_TIMESTAMP(),
          error_summary = 'stale transient failure'
      WHERE id = ?
        AND status = 'processing'
        AND lease_token = ?
        AND lease_expires_at > UTC_TIMESTAMP()
    `, [requestId, attempt1LeaseToken]);
    assert.equal(attempt1Retry.affectedRows, 0, "expired claim cannot schedule a retry");

    const [attempt1Failed] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'failed',
          lease_expires_at = NULL,
          next_attempt_at = NULL,
          finished_at = UTC_TIMESTAMP(),
          error_summary = 'stale terminal failure'
      WHERE id = ?
        AND status = 'processing'
        AND lease_token = ?
        AND lease_expires_at > UTC_TIMESTAMP()
    `, [requestId, attempt1LeaseToken]);
    assert.equal(attempt1Failed.affectedRows, 0, "expired claim cannot fail a newer lease");

    const [attempt1Published] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'published',
          ingestion_run_id = 1,
          lease_expires_at = NULL,
          next_attempt_at = NULL,
          finished_at = UTC_TIMESTAMP(),
          error_summary = NULL
      WHERE id = ?
        AND status = 'processing'
        AND lease_token = ?
        AND lease_expires_at > UTC_TIMESTAMP()
    `, [requestId, attempt1LeaseToken]);
    assert.equal(attempt1Published.affectedRows, 0, "expired claim cannot publish a newer lease");

    const [activeRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT status, attempt_count, lease_token
      FROM canonical_ad_import_requests
      WHERE id = ?
    `, [requestId]);
    assert.equal(activeRows[0].status, "processing");
    assert.equal(activeRows[0].attempt_count, 2);
    assert.equal(activeRows[0].lease_token, attempt2LeaseToken);

    const [attempt2Failed] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'failed',
          lease_expires_at = NULL,
          lease_token = NULL,
          next_attempt_at = NULL,
          finished_at = UTC_TIMESTAMP(),
          error_summary = 'transient retry budget exhausted'
      WHERE id = ?
        AND status = 'processing'
        AND lease_token = ?
        AND lease_expires_at > UTC_TIMESTAMP()
    `, [requestId, attempt2LeaseToken]);
    assert.equal(attempt2Failed.affectedRows, 1, "current claim may record a terminal result");
    await expectReject(() => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'retryable', next_attempt_at = UTC_TIMESTAMP()
      WHERE id = ${requestId}
    `));

    const maxBudgetRequestId = await insertRequest(connection, "v4", 1);
    const maxBudgetLeaseToken = "33333333-3333-4333-8333-333333333333";
    const [maxBudgetClaim] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'processing',
          attempt_count = 1,
          started_at = UTC_TIMESTAMP() - INTERVAL 3 MINUTE,
          lease_expires_at = UTC_TIMESTAMP() - INTERVAL 2 MINUTE,
          lease_token = ?,
          next_attempt_at = NULL
      WHERE id = ?
        AND status = 'pending'
        AND next_attempt_at <= UTC_TIMESTAMP()
    `, [maxBudgetLeaseToken, maxBudgetRequestId]);
    assert.equal(maxBudgetClaim.affectedRows, 1);

    const maxBudgetReclaim = () => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'processing',
          started_at = UTC_TIMESTAMP(),
          lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE,
          lease_token = '44444444-4444-4444-8444-444444444444'
      WHERE id = ?
        AND status = 'processing'
        AND lease_expires_at <= UTC_TIMESTAMP()
    `, [maxBudgetRequestId]);
    await expectReject(maxBudgetReclaim);

    const [maxBudgetFailed] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'failed',
          lease_expires_at = NULL,
          lease_token = NULL,
          next_attempt_at = NULL,
          finished_at = UTC_TIMESTAMP(),
          ingestion_run_id = NULL,
          error_summary = 'lease expired after retry budget'
      WHERE id = ?
        AND status = 'processing'
        AND attempt_count = max_attempts
        AND lease_expires_at <= UTC_TIMESTAMP()
    `, [maxBudgetRequestId]);
    assert.equal(maxBudgetFailed.affectedRows, 1, "max-budget lease recovery must terminalize once");

    const maxBudgetFailedAgain = () => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'failed',
          finished_at = UTC_TIMESTAMP(),
          error_summary = 'second terminal recovery'
      WHERE id = ?
    `, [maxBudgetRequestId]);
    await expectReject(maxBudgetFailedAgain);

    const maxBudgetRetry = () => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'retryable', next_attempt_at = UTC_TIMESTAMP()
      WHERE id = ?
    `, [maxBudgetRequestId]);
    await expectReject(maxBudgetRetry);
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

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

async function insertSheetIntent(
  connection: mysql.Connection,
  version: string,
  snapshotKey = "12121212-1212-4121-8121-121212121212",
) {
  const adapterConfig = await config(connection, version);
  const [result] = await connection.execute<mysql.ResultSetHeader>(`
    INSERT INTO canonical_ad_import_requests (
      advertiser_key, source_key, platform_account_id, transport, source_url,
      sheet_snapshot_key, adapter_config, adapter_config_version,
      requested_at, next_attempt_at
    ) VALUES (
      'advertiser_a', 'test_source', 'account_a', 'google_sheet',
      'https://docs.google.com/spreadsheets/d/sheet-123/edit#gid=0',
      ?, ?, ?, UTC_TIMESTAMP() - INTERVAL 5 MINUTE, UTC_TIMESTAMP() - INTERVAL 5 MINUTE
    )
  `, [snapshotKey, adapterConfig, version]);
  return Number(result.insertId);
}

async function main() {
  const databaseUrl = process.env.ADVERTISING_IMPORT_REQUESTS_MIGRATION_TEST_URL;
  if (!databaseUrl) {
    throw new Error("ADVERTISING_IMPORT_REQUESTS_MIGRATION_TEST_URL is required for the local MySQL verifier");
  }

  const parsedDatabaseUrl = new URL(databaseUrl);
  const connectionOptions = {
    host: parsedDatabaseUrl.hostname,
    port: Number(parsedDatabaseUrl.port || 3306),
    user: decodeURIComponent(parsedDatabaseUrl.username),
    password: decodeURIComponent(parsedDatabaseUrl.password),
    database: decodeURIComponent(parsedDatabaseUrl.pathname.slice(1)),
    multipleStatements: true,
  };
  const connection = await mysql.createConnection(connectionOptions);
  const openConnection = () => mysql.createConnection(connectionOptions);

  try {
    await connection.query(`
      CREATE TABLE canonical_collector_runs (
        id BIGINT NOT NULL PRIMARY KEY,
        status ENUM('running', 'success', 'partial', 'failed') NOT NULL DEFAULT 'running'
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
    await connection.query(`
      INSERT INTO canonical_collector_runs (id, status)
      VALUES (1, 'success'), (2, 'running'), (3, 'failed')
    `);
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

    const sheetIntentId = await insertSheetIntent(connection, "sheet-v1");
    await expectReject(() => insertSheetIntent(connection, "sheet-v1"));
    await expectReject(() => connection.execute(`
      UPDATE canonical_ad_import_requests
      SET content_sha256 = '${"b".repeat(64)}', protected_ref = '/protected/sheet.csv'
      WHERE id = ?
    `, [sheetIntentId]));
    const sheetLeaseToken = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
    const [sheetClaim] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'processing', attempt_count = 1, started_at = UTC_TIMESTAMP(),
          lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE, lease_token = ?, next_attempt_at = NULL
      WHERE id = ? AND status = 'pending'
    `, [sheetLeaseToken, sheetIntentId]);
    assert.equal(sheetClaim.affectedRows, 1);
    const [sheetMaterialized] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET content_sha256 = '${"b".repeat(64)}', protected_ref = '/protected/sheet.csv'
      WHERE id = ? AND status = 'processing' AND lease_token = ? AND lease_expires_at > UTC_TIMESTAMP()
    `, [sheetIntentId, sheetLeaseToken]);
    assert.equal(sheetMaterialized.affectedRows, 1, "the active fenced worker may materialize a Sheet snapshot once");
    await expectReject(() => connection.execute(`
      UPDATE canonical_ad_import_requests
      SET content_sha256 = '${"c".repeat(64)}'
      WHERE id = ?
    `, [sheetIntentId]));

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

    async function claimExpiredFinalAttempt(version: string, ingestionRunId: number) {
      const requestId = await insertRequest(connection, version, 1);
      if (ingestionRunId === 4) {
        await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      }
      try {
        const [claim] = await connection.query<mysql.ResultSetHeader>(`
          UPDATE canonical_ad_import_requests
          SET status = 'processing',
              attempt_count = 1,
              ingestion_run_id = ?,
              started_at = UTC_TIMESTAMP() - INTERVAL 3 MINUTE,
              lease_expires_at = UTC_TIMESTAMP() - INTERVAL 2 MINUTE,
              lease_token = '55555555-5555-4555-8555-555555555555',
              next_attempt_at = NULL
          WHERE id = ?
            AND status = 'pending'
            AND next_attempt_at <= UTC_TIMESTAMP()
        `, [ingestionRunId, requestId]);
        assert.equal(claim.affectedRows, 1);
      } finally {
        if (ingestionRunId === 4) {
          await connection.query("SET FOREIGN_KEY_CHECKS = 1");
        }
      }
      return requestId;
    }

    async function reconcileExpiredFinalAttempt(requestId: number) {
      return connection.query<mysql.ResultSetHeader>(`
        UPDATE canonical_ad_import_requests
        SET status = 'published',
            lease_expires_at = NULL,
            lease_token = NULL,
            next_attempt_at = NULL,
            finished_at = UTC_TIMESTAMP(),
            error_summary = NULL
        WHERE id = ?
          AND status = 'processing'
          AND attempt_count = max_attempts
          AND lease_expires_at <= UTC_TIMESTAMP()
      `, [requestId]);
    }

    const finalAttemptSuccessRequestId = await claimExpiredFinalAttempt("v5", 1);
    const [finalAttemptSuccessPublished] = await reconcileExpiredFinalAttempt(finalAttemptSuccessRequestId);
    assert.equal(finalAttemptSuccessPublished.affectedRows, 1, "a successful final-attempt run may reconcile after its lease expires");
    const [finalAttemptSuccessRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT status, ingestion_run_id, lease_expires_at, lease_token, finished_at, error_summary
      FROM canonical_ad_import_requests
      WHERE id = ?
    `, [finalAttemptSuccessRequestId]);
    assert.deepEqual(finalAttemptSuccessRows[0], {
      status: "published",
      ingestion_run_id: 1,
      lease_expires_at: null,
      lease_token: null,
      finished_at: finalAttemptSuccessRows[0].finished_at,
      error_summary: null,
    });
    assert.notEqual(finalAttemptSuccessRows[0].finished_at, null);

    const finalAttemptRunningRequestId = await claimExpiredFinalAttempt("v6", 2);
    const finalAttemptRunningRejected = () => reconcileExpiredFinalAttempt(finalAttemptRunningRequestId);
    await expectReject(finalAttemptRunningRejected);

    const finalAttemptFailedRequestId = await claimExpiredFinalAttempt("v7", 3);
    const finalAttemptFailedRejected = () => reconcileExpiredFinalAttempt(finalAttemptFailedRequestId);
    await expectReject(finalAttemptFailedRejected);

    const finalAttemptMissingRequestId = await claimExpiredFinalAttempt("v8", 4);
    const finalAttemptMissingRejected = () => reconcileExpiredFinalAttempt(finalAttemptMissingRequestId);
    await expectReject(finalAttemptMissingRejected);

    async function claimLinkedRequest(
      version: string,
      ingestionRunId: number,
      leaseToken: string,
      { expired = false, maxAttempts = 1 } = {},
    ) {
      const linkedRequestId = await insertRequest(connection, version, maxAttempts);
      const [claim] = await connection.query<mysql.ResultSetHeader>(`
        UPDATE canonical_ad_import_requests
        SET status = 'processing',
            attempt_count = 1,
            ingestion_run_id = ?,
            started_at = UTC_TIMESTAMP() - INTERVAL 3 MINUTE,
            lease_expires_at = ${expired ? "UTC_TIMESTAMP() - INTERVAL 2 MINUTE" : "UTC_TIMESTAMP() + INTERVAL 5 MINUTE"},
            lease_token = ?,
            next_attempt_at = NULL
        WHERE id = ?
          AND status = 'pending'
      `, [ingestionRunId, leaseToken, linkedRequestId]);
      assert.equal(claim.affectedRows, 1);
      return linkedRequestId;
    }

    const retryRunId = 10;
    await connection.query(`
      INSERT INTO canonical_collector_runs (id, status) VALUES (?, 'failed')
    `, [retryRunId]);
    const retryRequestId = await claimLinkedRequest(
      "v9",
      retryRunId,
      "66666666-6666-4666-8666-666666666666",
      { maxAttempts: 2 },
    );
    await expectReject(() => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'retryable',
          lease_expires_at = NULL,
          next_attempt_at = UTC_TIMESTAMP(),
          error_summary = 'must clear failed run before retry'
      WHERE id = ?
    `, [retryRequestId]));
    const [retryable] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'retryable',
          ingestion_run_id = NULL,
          lease_expires_at = NULL,
          next_attempt_at = UTC_TIMESTAMP(),
          error_summary = 'cleared failed run before retry'
      WHERE id = ?
        AND status = 'processing'
        AND lease_token = '66666666-6666-4666-8666-666666666666'
        AND lease_expires_at > UTC_TIMESTAMP()
    `, [retryRequestId]);
    assert.equal(retryable.affectedRows, 1, "retryable work clears its prior run ownership");
    const [retryRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT status, ingestion_run_id FROM canonical_ad_import_requests WHERE id = ?
    `, [retryRequestId]);
    assert.deepEqual(retryRows[0], { status: "retryable", ingestion_run_id: null });
    const [retryClaim] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'processing',
          attempt_count = attempt_count + 1,
          started_at = UTC_TIMESTAMP(),
          lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE,
          lease_token = '77777777-7777-4777-8777-777777777777',
          next_attempt_at = NULL,
          error_summary = NULL
      WHERE id = ?
        AND status = 'retryable'
        AND lease_token = '66666666-6666-4666-8666-666666666666'
    `, [retryRequestId]);
    assert.equal(retryClaim.affectedRows, 1);
    const replacementRunId = 11;
    await connection.query(`
      INSERT INTO canonical_collector_runs (id, status) VALUES (?, 'running')
    `, [replacementRunId]);
    const [newRunAfterRetry] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET ingestion_run_id = ?,
          lease_expires_at = UTC_TIMESTAMP() + INTERVAL 10 MINUTE
      WHERE id = ?
        AND status = 'processing'
        AND lease_token = '77777777-7777-4777-8777-777777777777'
        AND ingestion_run_id IS NULL
    `, [replacementRunId, retryRequestId]);
    assert.equal(newRunAfterRetry.affectedRows, 1, "the next claim accepts a new run after retry");

    const normalSuccessRunId = 12;
    await connection.query(`
      INSERT INTO canonical_collector_runs (id, status) VALUES (?, 'running')
    `, [normalSuccessRunId]);
    const normalSuccessRequestId = await claimLinkedRequest(
      "v10",
      normalSuccessRunId,
      "88888888-8888-4888-8888-888888888888",
    );
    await expectReject(() => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'published', lease_expires_at = NULL, lease_token = NULL,
          next_attempt_at = NULL, finished_at = UTC_TIMESTAMP(), error_summary = NULL
      WHERE id = ?
    `, [normalSuccessRequestId]));
    await connection.query(`
      UPDATE canonical_collector_runs SET status = 'success' WHERE id = ?
    `, [normalSuccessRunId]);
    const [normalSuccess] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'published', lease_expires_at = NULL, lease_token = NULL,
          next_attempt_at = NULL, finished_at = UTC_TIMESTAMP(), error_summary = NULL
      WHERE id = ?
        AND status = 'processing'
    `, [normalSuccessRequestId]);
    assert.equal(normalSuccess.affectedRows, 1, "a normal publication follows a successful run");

    const normalFailureRunId = 13;
    await connection.query(`
      INSERT INTO canonical_collector_runs (id, status) VALUES (?, 'running')
    `, [normalFailureRunId]);
    const normalFailureRequestId = await claimLinkedRequest(
      "v11",
      normalFailureRunId,
      "99999999-9999-4999-8999-999999999999",
    );
    await expectReject(() => connection.query(`
      UPDATE canonical_ad_import_requests
      SET status = 'failed', lease_expires_at = NULL, lease_token = NULL,
          next_attempt_at = NULL, finished_at = UTC_TIMESTAMP(),
          error_summary = 'run must fail before request failure'
      WHERE id = ?
    `, [normalFailureRequestId]));
    await connection.query(`
      UPDATE canonical_collector_runs SET status = 'failed' WHERE id = ?
    `, [normalFailureRunId]);
    const [normalFailure] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE canonical_ad_import_requests
      SET status = 'failed', lease_expires_at = NULL, lease_token = NULL,
          next_attempt_at = NULL, finished_at = UTC_TIMESTAMP(),
          error_summary = 'run failed before request failure'
      WHERE id = ?
        AND status = 'processing'
    `, [normalFailureRequestId]);
    assert.equal(normalFailure.affectedRows, 1, "a linked normal failure follows a failed run");

    async function selectRunStatus(
      runConnection: mysql.Connection,
      ingestionRunId: number,
    ) {
      const [rows] = await runConnection.query<mysql.RowDataPacket[]>(`
        SELECT status FROM canonical_collector_runs WHERE id = ? FOR UPDATE
      `, [ingestionRunId]);
      return String(rows[0].status);
    }

    async function assertRunRequestOutcome(
      requestIdForOutcome: number,
      runIdForOutcome: number,
      expectedStatus: "published" | "failed",
    ) {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT request.status AS request_status, run.status AS run_status
        FROM canonical_ad_import_requests AS request
        JOIN canonical_collector_runs AS run ON run.id = request.ingestion_run_id
        WHERE request.id = ? AND run.id = ?
      `, [requestIdForOutcome, runIdForOutcome]);
      assert.deepEqual(rows[0], {
        request_status: expectedStatus,
        run_status: expectedStatus === "published" ? "success" : "failed",
      });
    }

    const workerSuccessWinsRunId = 14;
    await connection.query(`
      INSERT INTO canonical_collector_runs (id, status) VALUES (?, 'running')
    `, [workerSuccessWinsRunId]);
    const workerSuccessWinsRequestId = await claimLinkedRequest(
      "v12",
      workerSuccessWinsRunId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { expired: true },
    );
    const workerSuccess = await openConnection();
    const reaperAfterWorker = await openConnection();
    try {
      await workerSuccess.beginTransaction();
      const [workerRunSuccess] = await workerSuccess.query<mysql.ResultSetHeader>(`
        UPDATE canonical_collector_runs SET status = 'success'
        WHERE id = ? AND status = 'running'
      `, [workerSuccessWinsRunId]);
      assert.equal(workerRunSuccess.affectedRows, 1);
      await reaperAfterWorker.beginTransaction();
      const reaperRunFailure = reaperAfterWorker.query<mysql.ResultSetHeader>(`
        UPDATE canonical_collector_runs SET status = 'failed'
        WHERE id = ? AND status = 'running'
      `, [workerSuccessWinsRunId]);
      const [workerRequestPublished] = await workerSuccess.query<mysql.ResultSetHeader>(`
        UPDATE canonical_ad_import_requests
        SET status = 'published', lease_expires_at = NULL, lease_token = NULL,
            next_attempt_at = NULL, finished_at = UTC_TIMESTAMP(), error_summary = NULL
        WHERE id = ? AND status = 'processing'
      `, [workerSuccessWinsRequestId]);
      assert.equal(workerRequestPublished.affectedRows, 1);
      await workerSuccess.commit();
      const [reaperRunFailureResult] = await reaperRunFailure;
      assert.equal(reaperRunFailureResult.affectedRows, 0);
      assert.equal(await selectRunStatus(reaperAfterWorker, workerSuccessWinsRunId), "success");
      await reaperAfterWorker.commit();
    } finally {
      await workerSuccess.end();
      await reaperAfterWorker.end();
    }
    await assertRunRequestOutcome(workerSuccessWinsRequestId, workerSuccessWinsRunId, "published");

    const reaperWinsRunId = 15;
    await connection.query(`
      INSERT INTO canonical_collector_runs (id, status) VALUES (?, 'running')
    `, [reaperWinsRunId]);
    const reaperWinsRequestId = await claimLinkedRequest(
      "v13",
      reaperWinsRunId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      { expired: true },
    );
    const reaperWins = await openConnection();
    const workerAfterReaper = await openConnection();
    try {
      await reaperWins.beginTransaction();
      const [reaperRunFailed] = await reaperWins.query<mysql.ResultSetHeader>(`
        UPDATE canonical_collector_runs SET status = 'failed'
        WHERE id = ? AND status = 'running'
      `, [reaperWinsRunId]);
      assert.equal(reaperRunFailed.affectedRows, 1);
      await workerAfterReaper.beginTransaction();
      const workerRunSuccess = workerAfterReaper.query<mysql.ResultSetHeader>(`
        UPDATE canonical_collector_runs SET status = 'success'
        WHERE id = ? AND status = 'running'
      `, [reaperWinsRunId]);
      const [reaperRequestFailed] = await reaperWins.query<mysql.ResultSetHeader>(`
        UPDATE canonical_ad_import_requests
        SET status = 'failed', lease_expires_at = NULL, lease_token = NULL,
            next_attempt_at = NULL, finished_at = UTC_TIMESTAMP(),
            error_summary = 'worker lease expired at retry budget'
        WHERE id = ? AND status = 'processing'
      `, [reaperWinsRequestId]);
      assert.equal(reaperRequestFailed.affectedRows, 1);
      await reaperWins.commit();
      const [workerRunSuccessResult] = await workerRunSuccess;
      assert.equal(workerRunSuccessResult.affectedRows, 0);
      assert.equal(await selectRunStatus(workerAfterReaper, reaperWinsRunId), "failed");
      await workerAfterReaper.commit();
    } finally {
      await reaperWins.end();
      await workerAfterReaper.end();
    }
    await assertRunRequestOutcome(reaperWinsRequestId, reaperWinsRunId, "failed");

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

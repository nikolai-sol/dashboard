import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  "src/db/migrations/057_advertising_import_requests.sql",
);

assert.equal(
  existsSync(migrationPath),
  true,
  "migration 057 must define the durable advertising import queue",
);

const sql = readFileSync(migrationPath, "utf8");
const mysqlVerifierPath = path.resolve(
  "scripts/verify-advertising-import-requests-mysql.ts",
);

function tableDefinition(name: string) {
  const match = sql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB`, "i"),
  );
  assert.ok(match, `${name} must be an InnoDB table`);
  return match[1];
}

test("import requests identify advertiser, source account, protected artifact, and Sheet snapshot intent", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  for (const column of [
    "advertiser_key",
    "source_key",
    "platform_account_id",
    "transport",
    "protected_ref",
    "source_url",
    "sheet_snapshot_key",
    "content_sha256",
    "adapter_config",
    "status",
  ]) {
    assert.match(request, new RegExp(column));
  }
  assert.match(request, /UNIQUE KEY uniq_ad_import_upload/);
  assert.match(request, /UNIQUE KEY uniq_ad_import_sheet_snapshot/);
});

test("import request identity binds advertiser scope to a canonical adapter configuration", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  assert.match(
    request,
    /adapter_config_sha256 CHAR\(64\)\s+GENERATED ALWAYS AS \(SHA2\(CAST\(adapter_config AS CHAR\), 256\)\) STORED/,
  );
  assert.match(request, /adapter_config_version VARCHAR\(64\) NOT NULL/);
  assert.match(
    request,
    /UNIQUE KEY uniq_ad_import_upload \(advertiser_key, source_key, platform_account_id, transport, content_sha256, adapter_config_sha256\)/,
  );
  assert.doesNotMatch(request, /adapter_config_sha256 CHAR\(64\) NOT NULL/);
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_config_version CHECK \(CHAR_LENGTH\(TRIM\(adapter_config_version\)\) > 0\)/,
  );
});

test("import request artifact hash is canonical lowercase SHA-256", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_content_digest CHECK \(content_sha256 IS NULL OR content_sha256 COLLATE utf8mb4_bin REGEXP '\^\[0-9a-f\]\{64\}\$'\)/,
  );
  assert.doesNotMatch(request, /BINARY content_sha256 REGEXP/);
});

test("import request provenance matches canonical advertising dictionaries and run keys", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  assert.match(request, /id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY/);
  assert.match(request, /ingestion_run_id BIGINT NULL/);
  assert.doesNotMatch(request, /ingestion_run_id BIGINT UNSIGNED/);
  assert.match(
    request,
    /FOREIGN KEY \(source_key, platform_account_id\)[\s\S]*?REFERENCES canonical_source_accounts \(source_key, platform_account_id\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(
    request,
    /FOREIGN KEY \(advertiser_key, source_key, platform_account_id\)[\s\S]*?REFERENCES canonical_advertiser_source_accounts \(advertiser_key, source_key, platform_account_id\)[\s\S]*?ON DELETE RESTRICT/,
  );
  assert.match(
    request,
    /FOREIGN KEY \(ingestion_run_id\)[\s\S]*?REFERENCES canonical_collector_runs \(id\)[\s\S]*?ON DELETE RESTRICT/,
  );
});

test("import request transports require exactly their safe locator", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_transport_locator CHECK \([\s\S]*?transport = 'upload'[\s\S]*?protected_ref IS NOT NULL[\s\S]*?source_url IS NULL[\s\S]*?transport = 'google_sheet'[\s\S]*?protected_ref IS NULL[\s\S]*?source_url LIKE 'https:\/\/docs\.google\.com\/spreadsheets\/%'[\s\S]*?\)/,
  );
});

test("collector Sheet intents may terminalize before materialization", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  assert.match(request, /sheet_snapshot_key CHAR\(36\) NULL/);
  assert.match(request, /UNIQUE KEY uniq_ad_import_sheet_snapshot/);
  assert.match(request, /CONSTRAINT chk_ad_import_request_sheet_materialization CHECK \([\s\S]*?content_sha256 IS NULL[\s\S]*?protected_ref IS NULL[\s\S]*?status IN \('pending', 'processing', 'retryable', 'rejected', 'failed'\)[\s\S]*?\)/);
});

test("import request lifecycle supports FIFO lease recovery and bounded retries", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  assert.match(
    request,
    /status ENUM\('pending','processing','retryable','published','rejected','failed'\) NOT NULL DEFAULT 'pending'/,
  );
  assert.match(request, /attempt_count INT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(request, /max_attempts INT UNSIGNED NOT NULL DEFAULT 3/);
  assert.match(request, /lease_expires_at DATETIME NULL/);
  assert.match(request, /lease_token CHAR\(36\) NULL/);
  assert.match(request, /next_attempt_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(request, /requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(request, /started_at DATETIME NULL/);
  assert.match(request, /finished_at DATETIME NULL/);
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_timestamps CHECK \([\s\S]*?started_at IS NULL OR requested_at <= started_at[\s\S]*?lease_expires_at IS NULL OR \(started_at IS NOT NULL AND started_at < lease_expires_at\)[\s\S]*?finished_at IS NULL OR \(started_at IS NOT NULL AND started_at <= finished_at\)[\s\S]*?\)/,
  );
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_attempts CHECK \(max_attempts >= 1 AND attempt_count <= max_attempts\)/,
  );
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_lease_token CHECK \(\s*lease_token IS NULL\s+OR lease_token REGEXP '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'\s*\)/,
  );
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_status_timestamps CHECK \([\s\S]*?status = 'pending'[\s\S]*?lease_token IS NULL[\s\S]*?status = 'processing'[\s\S]*?lease_token IS NOT NULL[\s\S]*?status = 'retryable'[\s\S]*?lease_token IS NOT NULL[\s\S]*?status = 'published'[\s\S]*?lease_token IS NULL[\s\S]*?status = 'rejected'[\s\S]*?lease_token IS NOT NULL[\s\S]*?status = 'failed'[\s\S]*?lease_token IS NULL[\s\S]*?\)/,
  );
  assert.match(
    request,
    /KEY idx_ad_import_queue \(status, next_attempt_at, requested_at, id\)/,
  );
  assert.match(request, /KEY idx_ad_import_processing \(status, lease_expires_at, id\)/);
});

test("import request identity is immutable and status only moves through its lifecycle", () => {
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ad_import_request_intake_insert/);
  assert.match(sql, /CREATE TRIGGER trg_ad_import_request_intake_insert[\s\S]*?BEFORE INSERT ON canonical_ad_import_requests[\s\S]*?NEW\.status <> 'pending'[\s\S]*?JSON_UNQUOTE\(JSON_EXTRACT\(NEW\.adapter_config, '\$\.adapter_config_version'\)\) <=> NEW\.adapter_config_version[\s\S]*?SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ad_import_request_identity_immutable_update/);
  assert.match(sql, /CREATE TRIGGER trg_ad_import_request_identity_immutable_update[\s\S]*?BEFORE UPDATE ON canonical_ad_import_requests[\s\S]*?NEW\.advertiser_key <=> OLD\.advertiser_key[\s\S]*?NEW\.content_sha256 <=> OLD\.content_sha256[\s\S]*?NEW\.adapter_config <=> OLD\.adapter_config[\s\S]*?NEW\.adapter_config_version <=> OLD\.adapter_config_version[\s\S]*?SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ad_import_request_lifecycle_update/);
  assert.match(sql, /CREATE TRIGGER trg_ad_import_request_lifecycle_update[\s\S]*?OLD\.status = 'pending'[\s\S]*?NEW\.status = 'processing'[\s\S]*?NEW\.lease_token IS NOT NULL[\s\S]*?OLD\.status = 'retryable'[\s\S]*?NEW\.status = 'processing'[\s\S]*?NOT \(NEW\.lease_token <=> OLD\.lease_token\)[\s\S]*?OLD\.status = 'processing'[\s\S]*?NEW\.status = 'processing'[\s\S]*?NEW\.lease_token <=> OLD\.lease_token[\s\S]*?SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ad_import_request_immutable_delete/);
  assert.match(sql, /CREATE TRIGGER trg_ad_import_request_immutable_delete[\s\S]*?BEFORE DELETE ON canonical_ad_import_requests[\s\S]*?SIGNAL SQLSTATE '45000'/);
});

test("processing exits require an active lease", () => {
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'retryable'[\s\S]*?NEW\.lease_token <=> OLD\.lease_token[\s\S]*?OLD\.lease_expires_at > UTC_TIMESTAMP\(\)/,
  );
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'rejected'[\s\S]*?NEW\.lease_token <=> OLD\.lease_token[\s\S]*?OLD\.lease_expires_at > UTC_TIMESTAMP\(\)/,
  );
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'published'[\s\S]*?NEW\.lease_expires_at IS NULL[\s\S]*?NEW\.lease_token IS NULL[\s\S]*?NEW\.finished_at IS NOT NULL[\s\S]*?OLD\.lease_expires_at > UTC_TIMESTAMP\(\)/,
  );
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'failed'[\s\S]*?NEW\.lease_token IS NULL[\s\S]*?OLD\.lease_expires_at > UTC_TIMESTAMP\(\)/,
  );
});

test("expired processing claims exhaust the retry budget into one terminal failure", () => {
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'processing'[\s\S]*?OLD\.lease_expires_at <= UTC_TIMESTAMP\(\)[\s\S]*?OLD\.attempt_count < OLD\.max_attempts[\s\S]*?NEW\.attempt_count = OLD\.attempt_count \+ 1[\s\S]*?NOT \(NEW\.lease_token <=> OLD\.lease_token\)/,
  );
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'failed'[\s\S]*?NEW\.lease_expires_at IS NULL[\s\S]*?NEW\.lease_token IS NULL[\s\S]*?NEW\.finished_at IS NOT NULL[\s\S]*?NEW\.error_summary IS NOT NULL[\s\S]*?OLD\.lease_expires_at <= UTC_TIMESTAMP\(\)[\s\S]*?OLD\.attempt_count = OLD\.max_attempts/,
  );
});

test("an expired final attempt may reconcile only an already-successful collector run", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  assert.match(
    request,
    /status = 'published'[\s\S]*?lease_expires_at IS NULL[\s\S]*?lease_token IS NULL[\s\S]*?finished_at IS NOT NULL[\s\S]*?ingestion_run_id IS NOT NULL[\s\S]*?error_summary IS NULL/,
  );
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'published'[\s\S]*?OLD\.lease_expires_at <= UTC_TIMESTAMP\(\)[\s\S]*?OLD\.attempt_count = OLD\.max_attempts[\s\S]*?NEW\.lease_expires_at IS NULL[\s\S]*?NEW\.lease_token IS NULL[\s\S]*?NEW\.finished_at IS NOT NULL[\s\S]*?NEW\.ingestion_run_id IS NOT NULL[\s\S]*?NEW\.error_summary IS NULL[\s\S]*?EXISTS \([\s\S]*?FROM canonical_collector_runs[\s\S]*?id = NEW\.ingestion_run_id[\s\S]*?status = 'success'/,
  );
});

test("atomic worker finalization binds every linked terminal request to its collector run", () => {
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'retryable'[\s\S]*?NEW\.ingestion_run_id IS NULL[\s\S]*?NEW\.lease_token <=> OLD\.lease_token[\s\S]*?OLD\.lease_expires_at > UTC_TIMESTAMP\(\)/,
  );
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'published'[\s\S]*?OLD\.lease_expires_at > UTC_TIMESTAMP\(\)[\s\S]*?EXISTS \([\s\S]*?FROM canonical_collector_runs[\s\S]*?id = NEW\.ingestion_run_id[\s\S]*?status = 'success'/,
  );
  assert.match(
    sql,
    /OLD\.status = 'processing'[\s\S]*?NEW\.status = 'failed'[\s\S]*?NEW\.ingestion_run_id IS NULL[\s\S]*?OR EXISTS \([\s\S]*?FROM canonical_collector_runs[\s\S]*?id = NEW\.ingestion_run_id[\s\S]*?status = 'failed'/,
  );
});

test("import request migration can replay its trigger definitions", () => {
  assert.equal((sql.match(/DROP TRIGGER IF EXISTS trg_ad_import_request_/g) ?? []).length, 4);
  assert.equal((sql.match(/CREATE TRIGGER trg_ad_import_request_/g) ?? []).length, 4);
  assert.doesNotMatch(sql, /DELIMITER/i);
});

test("MySQL verifier exercises generated identity, fenced lease races, and digest rejection", () => {
  assert.equal(existsSync(mysqlVerifierPath), true, "import-request MySQL verifier must exist");
  const verifier = readFileSync(mysqlVerifierPath, "utf8");
  assert.match(verifier, /for \(let replay = 0; replay < 2; replay \+= 1\)/);
  assert.match(verifier, /canonical_ad_import_requests/);
  assert.match(verifier, /insertSheetIntent/);
  assert.match(verifier, /the active fenced worker may materialize a Sheet snapshot once/);
  assert.match(verifier, /expectReject\(\(\) => insertRequest\(connection, "v1"\)\)/);
  assert.doesNotMatch(verifier, /adapter_config_sha256, adapter_config_version/);
  assert.match(verifier, /content_sha256, adapter_config, adapter_config_version/);
  assert.match(verifier, /status = 'retryable'/);
  assert.match(verifier, /lease_expires_at <= UTC_TIMESTAMP\(\)/);
  assert.match(verifier, /WHERE id = \?\s+AND status = 'processing'\s+AND lease_token = \?\s+AND lease_expires_at > UTC_TIMESTAMP\(\)/);
  assert.match(verifier, /assert\.equal\([^\n]*affectedRows, 0/);
  for (const mutation of ["attempt1Renew", "attempt1Retry", "attempt1Failed", "attempt1Published"]) {
    assert.match(
      verifier,
      new RegExp(`const \\[(?:${mutation})\\][\\s\\S]*?WHERE id = \\?\\s+AND status = 'processing'\\s+AND lease_token = \\?\\s+AND lease_expires_at > UTC_TIMESTAMP\\(\\)`),
    );
  }
  assert.match(verifier, /malformed-content/);
  assert.match(verifier, /contentSha256\.toUpperCase\(\)/);
  assert.match(verifier, /expiredRetry/);
  assert.match(verifier, /expiredFailed/);
  assert.match(verifier, /expiredPublished/);
  assert.match(verifier, /maxBudgetReclaim/);
  assert.match(verifier, /maxBudgetFailed/);
  assert.match(verifier, /maxBudgetFailedAgain/);
  assert.match(verifier, /maxBudgetRetry/);
  assert.match(verifier, /finalAttemptSuccessPublished/);
  assert.match(verifier, /finalAttemptRunningRejected/);
  assert.match(verifier, /finalAttemptFailedRejected/);
  assert.match(verifier, /finalAttemptMissingRejected/);
  assert.match(verifier, /preSnapshotRejected/);
  assert.match(verifier, /preSnapshotFailed/);
  assert.match(verifier, /workerSuccessWins/);
  assert.match(verifier, /reaperWins/);
  assert.match(verifier, /beginTransaction\(\)/);
  assert.match(verifier, /retryable[\s\S]*?ingestion_run_id = NULL/);
  assert.match(verifier, /new run after retry/);
  assert.match(verifier, /DELETE FROM canonical_ad_import_requests/);
});

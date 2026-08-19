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

function tableDefinition(name: string) {
  const match = sql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB`, "i"),
  );
  assert.ok(match, `${name} must be an InnoDB table`);
  return match[1];
}

test("import requests identify advertiser, source account, and protected artifact", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  for (const column of [
    "advertiser_key",
    "source_key",
    "platform_account_id",
    "transport",
    "protected_ref",
    "source_url",
    "content_sha256",
    "adapter_config",
    "status",
  ]) {
    assert.match(request, new RegExp(column));
  }
  assert.match(
    request,
    /UNIQUE KEY uniq_ad_import_request \(source_key, platform_account_id, transport, content_sha256\)/,
  );
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

test("import request lifecycle records valid timestamps and a worker-friendly queue order", () => {
  const request = tableDefinition("canonical_ad_import_requests");
  assert.match(
    request,
    /status ENUM\('pending','processing','published','rejected','failed'\) NOT NULL DEFAULT 'pending'/,
  );
  assert.match(request, /requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(request, /started_at DATETIME NULL/);
  assert.match(request, /finished_at DATETIME NULL/);
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_timestamps CHECK \([\s\S]*?started_at IS NULL OR requested_at <= started_at[\s\S]*?finished_at IS NULL OR \(started_at IS NOT NULL AND started_at <= finished_at\)[\s\S]*?\)/,
  );
  assert.match(
    request,
    /CONSTRAINT chk_ad_import_request_status_timestamps CHECK \([\s\S]*?status = 'pending'[\s\S]*?status = 'processing'[\s\S]*?status IN \('published','rejected','failed'\)[\s\S]*?\)/,
  );
  assert.match(
    request,
    /KEY idx_ad_import_queue \(status, requested_at, id\)/,
  );
  assert.match(request, /KEY idx_ad_import_processing \(status, started_at, id\)/);
});

test("import request identity is immutable and status only moves through its lifecycle", () => {
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ad_import_request_lifecycle_insert/);
  assert.match(sql, /CREATE TRIGGER trg_ad_import_request_lifecycle_insert[\s\S]*?BEFORE INSERT ON canonical_ad_import_requests[\s\S]*?NEW\.status <> 'pending'[\s\S]*?SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ad_import_request_identity_immutable_update/);
  assert.match(sql, /CREATE TRIGGER trg_ad_import_request_identity_immutable_update[\s\S]*?BEFORE UPDATE ON canonical_ad_import_requests[\s\S]*?NEW\.advertiser_key <=> OLD\.advertiser_key[\s\S]*?NEW\.content_sha256 <=> OLD\.content_sha256[\s\S]*?NEW\.adapter_config <=> OLD\.adapter_config[\s\S]*?SIGNAL SQLSTATE '45000'/);
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_ad_import_request_lifecycle_update/);
  assert.match(sql, /CREATE TRIGGER trg_ad_import_request_lifecycle_update[\s\S]*?OLD\.status = 'pending' AND NEW\.status = 'processing'[\s\S]*?OLD\.status = 'processing' AND NEW\.status IN \('published','rejected','failed'\)[\s\S]*?SIGNAL SQLSTATE '45000'/);
});

test("import request migration can replay its trigger definitions", () => {
  assert.equal((sql.match(/DROP TRIGGER IF EXISTS trg_ad_import_request_/g) ?? []).length, 3);
  assert.equal((sql.match(/CREATE TRIGGER trg_ad_import_request_/g) ?? []).length, 3);
  assert.doesNotMatch(sql, /DELIMITER/i);
});

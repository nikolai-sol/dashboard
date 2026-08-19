-- Durable, idempotent queue for protected advertising file and sheet imports.
--
-- Intake identity is immutable after creation. Workers claim eligible rows
-- with a lease and may recover stale or transient work without changing it.
--
-- A worker-owned processing mutation (renew, retry, or terminal result) must
-- compare-and-swap on id, status, lease_token, and an unexpired lease. A stale
-- lease reclaimer is the exception: it reclaims an expired processing row as
-- a new processing claim with a rotated token and a fresh lease.

CREATE TABLE IF NOT EXISTS canonical_ad_import_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    advertiser_key VARCHAR(128) NOT NULL,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    transport ENUM('upload','google_sheet') NOT NULL,
    protected_ref VARCHAR(500) NULL,
    source_url TEXT NULL,
    original_name VARCHAR(255) NULL,
    content_sha256 CHAR(64) NOT NULL,
    adapter_config JSON NOT NULL,
    adapter_config_sha256 CHAR(64)
        GENERATED ALWAYS AS (SHA2(CAST(adapter_config AS CHAR), 256)) STORED,
    adapter_config_version VARCHAR(64) NOT NULL,
    requested_by VARCHAR(255) NULL,
    status ENUM('pending','processing','retryable','published','rejected','failed') NOT NULL DEFAULT 'pending',
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
    ingestion_run_id BIGINT NULL,
    error_summary VARCHAR(500) NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    lease_expires_at DATETIME NULL,
    lease_token CHAR(36) NULL,
    next_attempt_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME NULL,
    UNIQUE KEY uniq_ad_import_request (advertiser_key, source_key, platform_account_id, transport, content_sha256, adapter_config_sha256),
    KEY idx_ad_import_queue (status, next_attempt_at, requested_at, id),
    KEY idx_ad_import_processing (status, lease_expires_at, id),
    KEY idx_ad_import_source_account_status (source_key, platform_account_id, status, next_attempt_at, id),
    KEY idx_ad_import_advertiser_source_account (advertiser_key, source_key, platform_account_id),
    KEY idx_ad_import_run (ingestion_run_id),
    CONSTRAINT chk_ad_import_request_transport_locator CHECK (
        (transport = 'upload'
            AND protected_ref IS NOT NULL
            AND CHAR_LENGTH(TRIM(protected_ref)) > 0
            AND source_url IS NULL)
        OR
        (transport = 'google_sheet'
            AND protected_ref IS NULL
            AND source_url IS NOT NULL
            AND CHAR_LENGTH(TRIM(source_url)) > 0
            AND source_url LIKE 'https://docs.google.com/spreadsheets/%')
    ),
    CONSTRAINT chk_ad_import_request_timestamps CHECK (
        (started_at IS NULL OR requested_at <= started_at)
        AND (lease_expires_at IS NULL OR (started_at IS NOT NULL AND started_at < lease_expires_at))
        AND (finished_at IS NULL OR (started_at IS NOT NULL AND started_at <= finished_at))
        AND (next_attempt_at IS NULL OR requested_at <= next_attempt_at)
    ),
    CONSTRAINT chk_ad_import_request_content_digest CHECK (BINARY content_sha256 REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT chk_ad_import_request_config_version CHECK (CHAR_LENGTH(TRIM(adapter_config_version)) > 0),
    CONSTRAINT chk_ad_import_request_attempts CHECK (max_attempts >= 1 AND attempt_count <= max_attempts),
    CONSTRAINT chk_ad_import_request_lease_token CHECK (
        lease_token IS NULL
        OR lease_token REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    CONSTRAINT chk_ad_import_request_status_timestamps CHECK (
        (status = 'pending'
            AND attempt_count = 0
            AND started_at IS NULL
            AND lease_expires_at IS NULL
            AND lease_token IS NULL
            AND next_attempt_at IS NOT NULL
            AND finished_at IS NULL
            AND ingestion_run_id IS NULL
            AND error_summary IS NULL)
        OR
        (status = 'processing'
            AND attempt_count >= 1
            AND started_at IS NOT NULL
            AND lease_expires_at IS NOT NULL
            AND lease_token IS NOT NULL
            AND next_attempt_at IS NULL
            AND finished_at IS NULL
            AND error_summary IS NULL)
        OR
        (status = 'retryable'
            AND attempt_count >= 1
            AND attempt_count < max_attempts
            AND started_at IS NOT NULL
            AND lease_expires_at IS NULL
            AND lease_token IS NOT NULL
            AND next_attempt_at IS NOT NULL
            AND finished_at IS NULL
            AND error_summary IS NOT NULL
            AND CHAR_LENGTH(TRIM(error_summary)) > 0)
        OR
        (status = 'published'
            AND attempt_count >= 1
            AND started_at IS NOT NULL
            AND lease_expires_at IS NULL
            AND lease_token IS NULL
            AND next_attempt_at IS NULL
            AND finished_at IS NOT NULL
            AND ingestion_run_id IS NOT NULL
            AND error_summary IS NULL)
        OR
        (status = 'rejected'
            AND attempt_count >= 1
            AND started_at IS NOT NULL
            AND lease_expires_at IS NULL
            AND lease_token IS NOT NULL
            AND next_attempt_at IS NULL
            AND finished_at IS NOT NULL
            AND error_summary IS NOT NULL
            AND CHAR_LENGTH(TRIM(error_summary)) > 0)
        OR
        (status = 'failed'
            AND attempt_count >= 1
            AND started_at IS NOT NULL
            AND lease_expires_at IS NULL
            AND lease_token IS NULL
            AND next_attempt_at IS NULL
            AND finished_at IS NOT NULL
            AND ingestion_run_id IS NULL
            AND error_summary IS NOT NULL
            AND CHAR_LENGTH(TRIM(error_summary)) > 0)
    ),
    CONSTRAINT fk_ad_import_request_source_account
        FOREIGN KEY (source_key, platform_account_id)
        REFERENCES canonical_source_accounts (source_key, platform_account_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_ad_import_request_advertiser_source_account
        FOREIGN KEY (advertiser_key, source_key, platform_account_id)
        REFERENCES canonical_advertiser_source_accounts (advertiser_key, source_key, platform_account_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_ad_import_request_run
        FOREIGN KEY (ingestion_run_id)
        REFERENCES canonical_collector_runs (id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_ad_import_request_intake_insert;

-- @migration-statement-break

CREATE TRIGGER trg_ad_import_request_intake_insert
BEFORE INSERT ON canonical_ad_import_requests
FOR EACH ROW
BEGIN
    IF NEW.status <> 'pending' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Advertising import requests must begin pending';
    END IF;

    IF NOT (
        JSON_UNQUOTE(JSON_EXTRACT(NEW.adapter_config, '$.adapter_config_version')) <=> NEW.adapter_config_version
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Advertising import request adapter config version is invalid';
    END IF;
END;

-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_ad_import_request_identity_immutable_update;

-- @migration-statement-break

CREATE TRIGGER trg_ad_import_request_identity_immutable_update
BEFORE UPDATE ON canonical_ad_import_requests
FOR EACH ROW
BEGIN
    IF NOT (
        NEW.advertiser_key <=> OLD.advertiser_key
        AND NEW.source_key <=> OLD.source_key
        AND NEW.platform_account_id <=> OLD.platform_account_id
        AND NEW.transport <=> OLD.transport
        AND NEW.protected_ref <=> OLD.protected_ref
        AND NEW.source_url <=> OLD.source_url
        AND NEW.original_name <=> OLD.original_name
        AND NEW.content_sha256 <=> OLD.content_sha256
        AND NEW.adapter_config <=> OLD.adapter_config
        AND NEW.adapter_config_version <=> OLD.adapter_config_version
        AND NEW.requested_by <=> OLD.requested_by
        AND NEW.requested_at <=> OLD.requested_at
        AND NEW.max_attempts <=> OLD.max_attempts
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Advertising import request identity is immutable';
    END IF;
END;

-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_ad_import_request_lifecycle_update;

-- @migration-statement-break

CREATE TRIGGER trg_ad_import_request_lifecycle_update
BEFORE UPDATE ON canonical_ad_import_requests
FOR EACH ROW
BEGIN
    IF NOT (
        (OLD.status = 'pending'
            AND NEW.status = 'processing'
            AND NEW.attempt_count = 1
            AND NEW.started_at >= OLD.next_attempt_at
            AND NEW.lease_token IS NOT NULL)
        OR
        (OLD.status = 'retryable'
            AND NEW.status = 'processing'
            AND NEW.attempt_count = OLD.attempt_count + 1
            AND NEW.started_at >= OLD.next_attempt_at
            AND NOT (NEW.lease_token <=> OLD.lease_token))
        OR
        (OLD.status = 'processing'
            AND NEW.status = 'processing'
            AND NEW.attempt_count = OLD.attempt_count
            AND NEW.started_at <=> OLD.started_at
            AND NEW.lease_token <=> OLD.lease_token
            AND OLD.lease_expires_at > UTC_TIMESTAMP()
            AND NEW.lease_expires_at > OLD.lease_expires_at)
        OR
        (OLD.status = 'processing'
            AND NEW.status = 'processing'
            AND OLD.lease_expires_at <= UTC_TIMESTAMP()
            AND OLD.attempt_count < OLD.max_attempts
            AND NEW.attempt_count = OLD.attempt_count + 1
            AND NEW.started_at >= OLD.started_at
            AND NOT (NEW.lease_token <=> OLD.lease_token)
            AND NEW.lease_expires_at > UTC_TIMESTAMP())
        OR
        (OLD.status = 'processing'
            AND NEW.status = 'retryable'
            AND NEW.attempt_count = OLD.attempt_count
            AND NEW.lease_token <=> OLD.lease_token
            AND OLD.lease_expires_at > UTC_TIMESTAMP()
            AND NEW.next_attempt_at >= OLD.started_at)
        OR
        (OLD.status = 'processing'
            AND NEW.status = 'rejected'
            AND NEW.attempt_count = OLD.attempt_count
            AND NEW.lease_token <=> OLD.lease_token
            AND OLD.lease_expires_at > UTC_TIMESTAMP())
        OR
        (OLD.status = 'processing'
            AND NEW.status = 'published'
            AND NEW.attempt_count = OLD.attempt_count
            AND NEW.lease_expires_at IS NULL
            AND NEW.lease_token IS NULL
            AND NEW.next_attempt_at IS NULL
            AND NEW.finished_at IS NOT NULL
            AND NEW.ingestion_run_id IS NOT NULL
            AND NEW.error_summary IS NULL
            AND OLD.lease_expires_at > UTC_TIMESTAMP())
        OR
        (OLD.status = 'processing'
            AND NEW.status = 'published'
            AND NEW.attempt_count = OLD.attempt_count
            AND OLD.lease_expires_at <= UTC_TIMESTAMP()
            AND OLD.attempt_count = OLD.max_attempts
            AND NEW.lease_expires_at IS NULL
            AND NEW.lease_token IS NULL
            AND NEW.next_attempt_at IS NULL
            AND NEW.finished_at IS NOT NULL
            AND NEW.ingestion_run_id IS NOT NULL
            AND NEW.error_summary IS NULL
            AND EXISTS (
                SELECT 1
                FROM canonical_collector_runs
                WHERE id = NEW.ingestion_run_id
                  AND status = 'success'
            ))
        OR
        (OLD.status = 'processing'
            AND NEW.status = 'failed'
            AND NEW.attempt_count = OLD.attempt_count
            AND NEW.lease_expires_at IS NULL
            AND NEW.lease_token IS NULL
            AND NEW.finished_at IS NOT NULL
            AND NEW.error_summary IS NOT NULL
            AND CHAR_LENGTH(TRIM(NEW.error_summary)) > 0
            AND (
                OLD.lease_expires_at > UTC_TIMESTAMP()
                OR (
                    OLD.lease_expires_at <= UTC_TIMESTAMP()
                    AND OLD.attempt_count = OLD.max_attempts
                )
            ))
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Advertising import request lifecycle transition is invalid';
    END IF;
END;

-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_ad_import_request_immutable_delete;

-- @migration-statement-break

CREATE TRIGGER trg_ad_import_request_immutable_delete
BEFORE DELETE ON canonical_ad_import_requests
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Advertising import requests are immutable';
END;

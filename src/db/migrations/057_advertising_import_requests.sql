-- Durable, idempotent queue for protected advertising file and sheet imports.
--
-- Intake identity is immutable after creation. Workers may only move rows from
-- pending to processing and then to one terminal state.

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
    requested_by VARCHAR(255) NULL,
    status ENUM('pending','processing','published','rejected','failed') NOT NULL DEFAULT 'pending',
    ingestion_run_id BIGINT NULL,
    error_summary VARCHAR(500) NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    UNIQUE KEY uniq_ad_import_request (source_key, platform_account_id, transport, content_sha256),
    KEY idx_ad_import_queue (status, requested_at, id),
    KEY idx_ad_import_processing (status, started_at, id),
    KEY idx_ad_import_source_account_status (source_key, platform_account_id, status, requested_at, id),
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
        AND (finished_at IS NULL OR (started_at IS NOT NULL AND started_at <= finished_at))
    ),
    CONSTRAINT chk_ad_import_request_status_timestamps CHECK (
        (status = 'pending'
            AND started_at IS NULL
            AND finished_at IS NULL
            AND ingestion_run_id IS NULL
            AND error_summary IS NULL)
        OR
        (status = 'processing'
            AND started_at IS NOT NULL
            AND finished_at IS NULL)
        OR
        (status IN ('published','rejected','failed')
            AND started_at IS NOT NULL
            AND finished_at IS NOT NULL)
    ),
    CONSTRAINT chk_ad_import_request_published_run CHECK (
        status <> 'published' OR (ingestion_run_id IS NOT NULL AND error_summary IS NULL)
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

DROP TRIGGER IF EXISTS trg_ad_import_request_lifecycle_insert;

-- @migration-statement-break

CREATE TRIGGER trg_ad_import_request_lifecycle_insert
BEFORE INSERT ON canonical_ad_import_requests
FOR EACH ROW
BEGIN
    IF NEW.status <> 'pending' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Advertising import requests must begin pending';
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
        AND NEW.requested_by <=> OLD.requested_by
        AND NEW.requested_at <=> OLD.requested_at
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
        (OLD.status = 'pending' AND NEW.status = 'processing')
        OR (OLD.status = 'processing' AND NEW.status IN ('published','rejected','failed'))
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Advertising import request lifecycle transition is invalid';
    END IF;
END;

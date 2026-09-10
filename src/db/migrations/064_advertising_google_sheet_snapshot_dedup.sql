-- Keep content-level idempotency for uploads without rejecting an unchanged
-- Google Sheet fetched as a new daily snapshot.

ALTER TABLE canonical_ad_import_requests
    DROP INDEX uniq_ad_import_upload,
    ADD COLUMN upload_content_sha256 CHAR(64)
        GENERATED ALWAYS AS (
            CASE WHEN transport = 'upload' THEN content_sha256 ELSE NULL END
        ) STORED AFTER content_sha256,
    ADD UNIQUE KEY uniq_ad_import_upload (
        advertiser_key,
        source_key,
        platform_account_id,
        upload_content_sha256,
        adapter_config_sha256
    );

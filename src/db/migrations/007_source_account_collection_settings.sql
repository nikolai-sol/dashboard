-- Safe first-pass control layer for per-account collection settings.
-- Purely additive migration.
-- Does not modify existing canonical source registries, facts, or collector schemas.

CREATE TABLE IF NOT EXISTS canonical_source_account_collection_settings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    cron_enabled TINYINT(1) NOT NULL DEFAULT 1,
    collection_mode VARCHAR(64) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_source_account_collection_settings (source_key, platform_account_id),
    KEY idx_source_account_collection_status (source_key, is_active, cron_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

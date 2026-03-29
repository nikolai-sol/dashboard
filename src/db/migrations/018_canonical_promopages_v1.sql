CREATE TABLE IF NOT EXISTS canonical_fact_promopages_daily (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    platform_campaign_id VARCHAR(128) NOT NULL,
    report_date DATE NOT NULL,
    traffic_source VARCHAR(64) NOT NULL DEFAULT 'all',
    impressions BIGINT DEFAULT NULL,
    reach BIGINT DEFAULT NULL,
    budget DECIMAL(18,6) DEFAULT NULL,
    cpm DECIMAL(18,6) DEFAULT NULL,
    clicks BIGINT DEFAULT NULL,
    ctr DECIMAL(18,6) DEFAULT NULL,
    views BIGINT DEFAULT NULL,
    clickouts BIGINT DEFAULT NULL,
    clickout_cost DECIMAL(18,6) DEFAULT NULL,
    clickout_percent DECIMAL(18,6) DEFAULT NULL,
    full_reads BIGINT DEFAULT NULL,
    full_read_percent DECIMAL(18,6) DEFAULT NULL,
    full_read_time_sec DECIMAL(18,6) DEFAULT NULL,
    metrica_visits BIGINT DEFAULT NULL,
    metrica_visit_percent DECIMAL(18,6) DEFAULT NULL,
    metrica_visit_cost DECIMAL(18,6) DEFAULT NULL,
    ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
    raw_payload JSON DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_canonical_fact_promopages_daily (
        source_key,
        platform_account_id,
        platform_campaign_id,
        report_date,
        traffic_source
    ),
    KEY idx_canonical_fact_promopages_daily_source_date (source_key, report_date),
    KEY idx_canonical_fact_promopages_daily_account_date (platform_account_id, report_date),
    KEY idx_canonical_fact_promopages_daily_campaign_date (platform_campaign_id, report_date),
    KEY idx_canonical_fact_promopages_daily_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Grain: 1 day x 1 publisher x 1 promopages campaign x 1 traffic source';

INSERT INTO canonical_source_platforms (
    source_key,
    display_name,
    source_type,
    default_fact_scope,
    default_timezone,
    default_currency,
    is_active
) VALUES
    ('yandex_promopages', 'Yandex Promopages', 'ads', 'campaign', 'Europe/Moscow', 'RUB', 1)
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    source_type = VALUES(source_type),
    default_fact_scope = VALUES(default_fact_scope),
    default_timezone = VALUES(default_timezone),
    default_currency = VALUES(default_currency),
    is_active = VALUES(is_active);

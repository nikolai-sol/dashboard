-- Versioned advertising publication foundation.
--
-- A publication owns one account/day authority scope. Its active row is a
-- published is_active = 1 row; superseded history uses NULL so MySQL's
-- nullable unique key permits retention of every prior publication.

CREATE TABLE IF NOT EXISTS canonical_ad_source_artifacts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    transport ENUM('api','gmail','upload','google_sheet','backfill') NOT NULL,
    artifact_key VARCHAR(255) NOT NULL,
    content_sha256 CHAR(64) NOT NULL,
    source_generated_at DATETIME NULL,
    received_at DATETIME NOT NULL,
    original_name VARCHAR(255) NULL,
    protected_ref VARCHAR(500) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_ad_artifact_identity (source_key, platform_account_id, transport, artifact_key),
    KEY idx_ad_artifact_hash (content_sha256),
    KEY idx_ad_artifact_source_account (source_key, platform_account_id),
    CONSTRAINT fk_ad_artifact_source_account
        FOREIGN KEY (source_key, platform_account_id)
        REFERENCES canonical_source_accounts (source_key, platform_account_id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_advertiser_source_accounts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    advertiser_key VARCHAR(128) NOT NULL,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_advertiser_source_account (advertiser_key, source_key, platform_account_id),
    KEY idx_source_account_advertiser (source_key, platform_account_id, advertiser_key),
    CONSTRAINT fk_advertiser_source_account
        FOREIGN KEY (source_key, platform_account_id)
        REFERENCES canonical_source_accounts (source_key, platform_account_id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_ad_publications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ingestion_run_id BIGINT UNSIGNED NOT NULL,
    artifact_id BIGINT UNSIGNED NULL,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    report_date DATE NOT NULL,
    publication_mode ENUM('incremental','authoritative_snapshot','baseline') NOT NULL,
    source_revision VARCHAR(128) NULL,
    source_generated_at DATETIME NULL,
    received_at DATETIME NOT NULL,
    status ENUM('staged','validated','published','rejected','failed','superseded') NOT NULL,
    is_active TINYINT(1) NULL,
    supersedes_publication_id BIGINT UNSIGNED NULL,
    rows_received INT NOT NULL DEFAULT 0,
    rows_rejected INT NOT NULL DEFAULT 0,
    rows_published INT NOT NULL DEFAULT 0,
    published_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_ad_active_scope (source_key, platform_account_id, report_date, is_active),
    UNIQUE KEY uniq_ad_publication_scope (id, source_key, platform_account_id, report_date),
    KEY idx_ad_publication_run (ingestion_run_id),
    CONSTRAINT chk_ad_publication_active_value CHECK (is_active IS NULL OR is_active = 1),
    CONSTRAINT chk_ad_publication_active_published CHECK (is_active IS NULL OR status = 'published'),
    CONSTRAINT fk_ad_publication_run
        FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ad_publication_artifact
        FOREIGN KEY (artifact_id) REFERENCES canonical_ad_source_artifacts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ad_publication_source_account
        FOREIGN KEY (source_key, platform_account_id)
        REFERENCES canonical_source_accounts (source_key, platform_account_id) ON DELETE RESTRICT,
    CONSTRAINT fk_ad_publication_supersedes
        FOREIGN KEY (supersedes_publication_id) REFERENCES canonical_ad_publications(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_ad_staging_facts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    publication_id BIGINT UNSIGNED NOT NULL,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    platform_campaign_id VARCHAR(128) NOT NULL,
    fact_scope ENUM('campaign', 'delivery_entity') NOT NULL DEFAULT 'delivery_entity',
    native_grain ENUM('campaign', 'ad_group', 'ad', 'banner', 'placement', 'creative', 'post', 'other') NOT NULL DEFAULT 'other',
    breakdown_scope VARCHAR(32) NOT NULL DEFAULT 'default',
    platform_delivery_entity_id VARCHAR(128) NOT NULL DEFAULT '__campaign__',
    platform_creative_id VARCHAR(128) NOT NULL DEFAULT '',
    report_date DATE NOT NULL,
    spend DECIMAL(18,6) DEFAULT NULL,
    impressions BIGINT DEFAULT NULL,
    clicks BIGINT DEFAULT NULL,
    views BIGINT DEFAULT NULL,
    conversions BIGINT DEFAULT NULL,
    conversion_value DECIMAL(18,6) DEFAULT NULL,
    reach BIGINT DEFAULT NULL,
    frequency DECIMAL(18,6) DEFAULT NULL,
    ctr DECIMAL(18,6) DEFAULT NULL,
    cpm DECIMAL(18,6) DEFAULT NULL,
    cpc DECIMAL(18,6) DEFAULT NULL,
    cpv DECIMAL(18,6) DEFAULT NULL,
    cpa DECIMAL(18,6) DEFAULT NULL,
    video_views_25 BIGINT DEFAULT NULL,
    video_views_50 BIGINT DEFAULT NULL,
    video_views_75 BIGINT DEFAULT NULL,
    video_views_100 BIGINT DEFAULT NULL,
    link_clicks BIGINT DEFAULT NULL,
    likes BIGINT DEFAULT NULL,
    comments BIGINT DEFAULT NULL,
    shares BIGINT DEFAULT NULL,
    reactions BIGINT DEFAULT NULL,
    follows BIGINT DEFAULT NULL,
    currency_code VARCHAR(8) DEFAULT NULL,
    ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_ad_fact_version (
        publication_id, source_key, platform_account_id, platform_campaign_id,
        fact_scope, native_grain, breakdown_scope, platform_delivery_entity_id, platform_creative_id
    ),
    KEY idx_ad_staging_publication (publication_id),
    KEY idx_ad_staging_account_date (source_key, platform_account_id, report_date),
    CONSTRAINT fk_ad_staging_publication_scope
        FOREIGN KEY (publication_id, source_key, platform_account_id, report_date)
        REFERENCES canonical_ad_publications (id, source_key, platform_account_id, report_date)
        ON DELETE RESTRICT,
    CONSTRAINT fk_ad_staging_run
        FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_ad_staging_campaign
        FOREIGN KEY (source_key, platform_account_id, platform_campaign_id)
        REFERENCES canonical_source_campaigns (source_key, platform_account_id, platform_campaign_id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_ad_validation_issues (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    publication_id BIGINT UNSIGNED NOT NULL,
    staging_fact_id BIGINT UNSIGNED NULL,
    severity ENUM('warning','error') NOT NULL,
    issue_code VARCHAR(128) NOT NULL,
    field_name VARCHAR(128) NULL,
    message VARCHAR(500) NOT NULL,
    details_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ad_validation_issue_publication (publication_id, severity),
    KEY idx_ad_validation_issue_staging_fact (staging_fact_id),
    CONSTRAINT fk_ad_validation_publication
        FOREIGN KEY (publication_id) REFERENCES canonical_ad_publications(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ad_validation_staging_fact
        FOREIGN KEY (staging_fact_id) REFERENCES canonical_ad_staging_facts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_ad_fact_versions_daily (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    publication_id BIGINT UNSIGNED NOT NULL,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    platform_campaign_id VARCHAR(128) NOT NULL,
    fact_scope ENUM('campaign', 'delivery_entity') NOT NULL DEFAULT 'delivery_entity',
    native_grain ENUM('campaign', 'ad_group', 'ad', 'banner', 'placement', 'creative', 'post', 'other') NOT NULL DEFAULT 'other',
    breakdown_scope VARCHAR(32) NOT NULL DEFAULT 'default',
    platform_delivery_entity_id VARCHAR(128) NOT NULL DEFAULT '__campaign__',
    platform_creative_id VARCHAR(128) NOT NULL DEFAULT '',
    report_date DATE NOT NULL,
    spend DECIMAL(18,6) DEFAULT NULL,
    impressions BIGINT DEFAULT NULL,
    clicks BIGINT DEFAULT NULL,
    views BIGINT DEFAULT NULL,
    conversions BIGINT DEFAULT NULL,
    conversion_value DECIMAL(18,6) DEFAULT NULL,
    reach BIGINT DEFAULT NULL,
    frequency DECIMAL(18,6) DEFAULT NULL,
    ctr DECIMAL(18,6) DEFAULT NULL,
    cpm DECIMAL(18,6) DEFAULT NULL,
    cpc DECIMAL(18,6) DEFAULT NULL,
    cpv DECIMAL(18,6) DEFAULT NULL,
    cpa DECIMAL(18,6) DEFAULT NULL,
    video_views_25 BIGINT DEFAULT NULL,
    video_views_50 BIGINT DEFAULT NULL,
    video_views_75 BIGINT DEFAULT NULL,
    video_views_100 BIGINT DEFAULT NULL,
    link_clicks BIGINT DEFAULT NULL,
    likes BIGINT DEFAULT NULL,
    comments BIGINT DEFAULT NULL,
    shares BIGINT DEFAULT NULL,
    reactions BIGINT DEFAULT NULL,
    follows BIGINT DEFAULT NULL,
    currency_code VARCHAR(8) DEFAULT NULL,
    ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_ad_fact_version (
        publication_id, source_key, platform_account_id, platform_campaign_id,
        fact_scope, native_grain, breakdown_scope, platform_delivery_entity_id, platform_creative_id
    ),
    KEY idx_ad_fact_version_publication (publication_id),
    KEY idx_ad_fact_version_account_date (source_key, platform_account_id, report_date),
    KEY idx_ad_fact_version_campaign_date (source_key, platform_campaign_id, report_date),
    CONSTRAINT fk_ad_fact_version_publication_scope
        FOREIGN KEY (publication_id, source_key, platform_account_id, report_date)
        REFERENCES canonical_ad_publications (id, source_key, platform_account_id, report_date)
        ON DELETE RESTRICT,
    CONSTRAINT fk_ad_fact_version_run
        FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_ad_fact_version_campaign
        FOREIGN KEY (source_key, platform_account_id, platform_campaign_id)
        REFERENCES canonical_source_campaigns (source_key, platform_account_id, platform_campaign_id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_ad_coverage_daily (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_key VARCHAR(64) NOT NULL,
    platform_account_id VARCHAR(128) NOT NULL,
    report_date DATE NOT NULL,
    coverage_state ENUM('complete_with_data','complete_empty','not_due','failed','missing') NOT NULL,
    ingestion_run_id BIGINT UNSIGNED NULL,
    publication_id BIGINT UNSIGNED NULL,
    expected_at DATETIME NULL,
    observed_at DATETIME NULL,
    rows_received INT NOT NULL DEFAULT 0,
    rows_rejected INT NOT NULL DEFAULT 0,
    rows_published INT NOT NULL DEFAULT 0,
    error_class VARCHAR(128) NULL,
    error_message VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_ad_coverage_scope (source_key, platform_account_id, report_date),
    KEY idx_ad_coverage_state_date (coverage_state, report_date),
    CONSTRAINT fk_ad_coverage_run
        FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_ad_coverage_source_account
        FOREIGN KEY (source_key, platform_account_id)
        REFERENCES canonical_source_accounts (source_key, platform_account_id) ON DELETE RESTRICT,
    CONSTRAINT fk_ad_coverage_publication_scope
        FOREIGN KEY (publication_id, source_key, platform_account_id, report_date)
        REFERENCES canonical_ad_publications (id, source_key, platform_account_id, report_date)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TRIGGER IF EXISTS trg_ad_coverage_publication_active_insert;
-- @migration-statement-break
CREATE TRIGGER trg_ad_coverage_publication_active_insert
BEFORE INSERT ON canonical_ad_coverage_daily
FOR EACH ROW
BEGIN
    IF NEW.publication_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM canonical_ad_publications AS p
        WHERE p.id = NEW.publication_id
          AND p.source_key = NEW.source_key
          AND p.platform_account_id = NEW.platform_account_id
          AND p.report_date = NEW.report_date
          AND p.status = 'published'
          AND p.is_active = 1
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Advertising coverage requires the active published publication';
    END IF;
END;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_ad_coverage_publication_active_update;
-- @migration-statement-break
CREATE TRIGGER trg_ad_coverage_publication_active_update
BEFORE UPDATE ON canonical_ad_coverage_daily
FOR EACH ROW
BEGIN
    IF NEW.publication_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM canonical_ad_publications AS p
        WHERE p.id = NEW.publication_id
          AND p.source_key = NEW.source_key
          AND p.platform_account_id = NEW.platform_account_id
          AND p.report_date = NEW.report_date
          AND p.status = 'published'
          AND p.is_active = 1
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Advertising coverage requires the active published publication';
    END IF;
END;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_ad_publication_coverage_active_update;
-- @migration-statement-break
CREATE TRIGGER trg_ad_publication_coverage_active_update
BEFORE UPDATE ON canonical_ad_publications
FOR EACH ROW
BEGIN
    IF EXISTS (
        SELECT 1
        FROM canonical_ad_coverage_daily AS c
        WHERE c.publication_id = OLD.id
    ) AND (
        NOT (NEW.status <=> 'published')
        OR NOT (NEW.is_active <=> 1)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Coverage publication must remain active and published';
    END IF;
END;
-- @migration-statement-break

CREATE OR REPLACE VIEW canonical_advertising_facts_current AS
SELECT
    f.id,
    f.source_key,
    f.platform_account_id,
    f.platform_campaign_id,
    f.fact_scope,
    f.native_grain,
    f.breakdown_scope,
    f.platform_delivery_entity_id,
    f.platform_creative_id,
    f.report_date,
    f.spend,
    f.impressions,
    f.clicks,
    f.views,
    f.conversions,
    f.conversion_value,
    f.reach,
    f.frequency,
    f.ctr,
    f.cpm,
    f.cpc,
    f.cpv,
    f.cpa,
    f.video_views_25,
    f.video_views_50,
    f.video_views_75,
    f.video_views_100,
    f.link_clicks,
    f.likes,
    f.comments,
    f.shares,
    f.reactions,
    f.follows,
    f.currency_code,
    f.ingestion_run_id,
    f.created_at,
    f.updated_at
FROM canonical_ad_fact_versions_daily AS f
INNER JOIN canonical_ad_publications AS p ON p.id = f.publication_id
WHERE p.status = 'published' AND p.is_active = 1;

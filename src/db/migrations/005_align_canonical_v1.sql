-- Align canonical_* tables created by 003 to finalized 004_canonical_v1.sql
-- Safe for existing prod canonical layer.
-- Rules:
-- 1) Never touches legacy tables.
-- 2) Never recreates canonical tables.
-- 3) Uses additive changes by default.
-- 4) Rebuilds unique keys / renames columns only when the target table is empty.
-- 5) If a risky change is needed on a non-empty table, emits a manual notice instead of applying it silently.

-- -------------------------------------------------------------------------
-- canonical_source_accounts
-- Gap vs 004: missing external_account_ref
-- -------------------------------------------------------------------------
SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_source_accounts'
      AND COLUMN_NAME = 'external_account_ref'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE canonical_source_accounts ADD COLUMN external_account_ref VARCHAR(255) DEFAULT NULL AFTER platform_account_id',
    'SELECT ''canonical_source_accounts.external_account_ref already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -------------------------------------------------------------------------
-- canonical_fact_ads_daily
-- Gaps vs 004:
--   - missing native_grain
--   - platform_creative_id should be NOT NULL DEFAULT '' for deterministic dedupe
--   - missing idx_canonical_fact_ads_daily_account_date
--   - missing idx_canonical_fact_ads_daily_creative_date
--   - unique key must include native_grain and platform_creative_id
-- -------------------------------------------------------------------------
SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_fact_ads_daily'
      AND COLUMN_NAME = 'native_grain'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE canonical_fact_ads_daily ADD COLUMN native_grain ENUM(''campaign'', ''ad_group'', ''ad'', ''banner'', ''placement'', ''creative'', ''post'', ''other'') NOT NULL DEFAULT ''other'' AFTER fact_scope',
    'SELECT ''canonical_fact_ads_daily.native_grain already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_fact_ads_daily'
      AND INDEX_NAME = 'idx_canonical_fact_ads_daily_account_date'
);
SET @sql := IF(
    @idx_exists = 0,
    'ALTER TABLE canonical_fact_ads_daily ADD INDEX idx_canonical_fact_ads_daily_account_date (source_key, platform_account_id, report_date)',
    'SELECT ''idx_canonical_fact_ads_daily_account_date already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_fact_ads_daily'
      AND INDEX_NAME = 'idx_canonical_fact_ads_daily_creative_date'
);
SET @sql := IF(
    @idx_exists = 0,
    'ALTER TABLE canonical_fact_ads_daily ADD INDEX idx_canonical_fact_ads_daily_creative_date (source_key, platform_creative_id, report_date)',
    'SELECT ''idx_canonical_fact_ads_daily_creative_date already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fact_ads_rows := (SELECT COUNT(*) FROM canonical_fact_ads_daily);
SET @platform_creative_is_nullable := (
    SELECT CASE WHEN IS_NULLABLE = 'YES' THEN 1 ELSE 0 END
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_fact_ads_daily'
      AND COLUMN_NAME = 'platform_creative_id'
    LIMIT 1
);
SET @platform_creative_default_is_empty := (
    SELECT CASE WHEN COALESCE(COLUMN_DEFAULT, '') = '' THEN 1 ELSE 0 END
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_fact_ads_daily'
      AND COLUMN_NAME = 'platform_creative_id'
    LIMIT 1
);
SET @sql := IF(
    COALESCE(@platform_creative_is_nullable, 0) = 1 OR COALESCE(@platform_creative_default_is_empty, 0) = 0,
    IF(
        @fact_ads_rows = 0,
        CONCAT('ALTER TABLE canonical_fact_ads_daily MODIFY COLUMN platform_creative_id VARCHAR(128) NOT NULL DEFAULT ', QUOTE('')),
        'SELECT ''MANUAL: canonical_fact_ads_daily.platform_creative_id needs NOT NULL DEFAULT '''''''' but table is non-empty'' AS manual_notice'
    ),
    'SELECT ''canonical_fact_ads_daily.platform_creative_id already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fact_ads_uniq_cols := (
    SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_fact_ads_daily'
      AND INDEX_NAME = 'uniq_canonical_fact_ads_daily'
    GROUP BY INDEX_NAME
);
SET @fact_ads_uniq_target := 'source_key,report_date,platform_account_id,platform_campaign_id,fact_scope,native_grain,breakdown_scope,platform_delivery_entity_id,platform_creative_id';
SET @sql := IF(
    COALESCE(@fact_ads_uniq_cols, '') = @fact_ads_uniq_target,
    'SELECT ''uniq_canonical_fact_ads_daily already aligned'' AS info',
    IF(
        @fact_ads_rows = 0,
        IF(
            @fact_ads_uniq_cols IS NULL,
            'ALTER TABLE canonical_fact_ads_daily ADD UNIQUE KEY uniq_canonical_fact_ads_daily (source_key, report_date, platform_account_id, platform_campaign_id, fact_scope, native_grain, breakdown_scope, platform_delivery_entity_id, platform_creative_id)',
            'ALTER TABLE canonical_fact_ads_daily DROP INDEX uniq_canonical_fact_ads_daily, ADD UNIQUE KEY uniq_canonical_fact_ads_daily (source_key, report_date, platform_account_id, platform_campaign_id, fact_scope, native_grain, breakdown_scope, platform_delivery_entity_id, platform_creative_id)'
        ),
        'SELECT ''MANUAL: rebuild uniq_canonical_fact_ads_daily after dedupe / maintenance window because table is non-empty'' AS manual_notice'
    )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -------------------------------------------------------------------------
-- canonical_collector_runs
-- Gap vs 004: no schema gap detected; no ALTER needed.
-- -------------------------------------------------------------------------
SELECT 'canonical_collector_runs already aligned to 004-required fields' AS info;

-- -------------------------------------------------------------------------
-- canonical_parity_daily
-- Gaps vs 004:
--   - platform_delivery_entity_id should be delivery_entity_id
--   - missing creative_id
--   - missing tolerance_abs / tolerance_pct
--   - missing idx_canonical_parity_daily_account_date
--   - unique key must include delivery_entity_id + creative_id
-- -------------------------------------------------------------------------
SET @parity_rows := (SELECT COUNT(*) FROM canonical_parity_daily);
SET @parity_has_delivery_entity_id := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_parity_daily'
      AND COLUMN_NAME = 'delivery_entity_id'
);
SET @parity_has_old_delivery_entity_id := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_parity_daily'
      AND COLUMN_NAME = 'platform_delivery_entity_id'
);
SET @sql := IF(
    @parity_has_delivery_entity_id = 1,
    'SELECT ''canonical_parity_daily.delivery_entity_id already present'' AS info',
    IF(
        @parity_has_old_delivery_entity_id = 1,
        IF(
            @parity_rows = 0,
            CONCAT('ALTER TABLE canonical_parity_daily CHANGE COLUMN platform_delivery_entity_id delivery_entity_id VARCHAR(128) NOT NULL DEFAULT ', QUOTE('')),
            'SELECT ''MANUAL: rename canonical_parity_daily.platform_delivery_entity_id to delivery_entity_id because table is non-empty'' AS manual_notice'
        ),
        CONCAT('ALTER TABLE canonical_parity_daily ADD COLUMN delivery_entity_id VARCHAR(128) NOT NULL DEFAULT ', QUOTE(''), ' AFTER fact_scope')
    )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_parity_daily'
      AND COLUMN_NAME = 'creative_id'
);
SET @sql := IF(
    @col_exists = 0,
    CONCAT('ALTER TABLE canonical_parity_daily ADD COLUMN creative_id VARCHAR(128) NOT NULL DEFAULT ', QUOTE(''), ' AFTER delivery_entity_id'),
    'SELECT ''canonical_parity_daily.creative_id already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_parity_daily'
      AND COLUMN_NAME = 'tolerance_abs'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE canonical_parity_daily ADD COLUMN tolerance_abs DECIMAL(24,6) DEFAULT NULL AFTER delta_pct',
    'SELECT ''canonical_parity_daily.tolerance_abs already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_parity_daily'
      AND COLUMN_NAME = 'tolerance_pct'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE canonical_parity_daily ADD COLUMN tolerance_pct DECIMAL(24,6) DEFAULT NULL AFTER tolerance_abs',
    'SELECT ''canonical_parity_daily.tolerance_pct already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_parity_daily'
      AND INDEX_NAME = 'idx_canonical_parity_daily_account_date'
);
SET @sql := IF(
    @idx_exists = 0,
    'ALTER TABLE canonical_parity_daily ADD INDEX idx_canonical_parity_daily_account_date (source_key, platform_account_id, report_date)',
    'SELECT ''idx_canonical_parity_daily_account_date already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @parity_uniq_cols := (
    SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_parity_daily'
      AND INDEX_NAME = 'uniq_canonical_parity_daily'
    GROUP BY INDEX_NAME
);
SET @parity_uniq_target := 'source_key,report_date,platform_account_id,platform_campaign_id,fact_scope,delivery_entity_id,creative_id,metric_name';
SET @sql := IF(
    COALESCE(@parity_uniq_cols, '') = @parity_uniq_target,
    'SELECT ''uniq_canonical_parity_daily already aligned'' AS info',
    IF(
        @parity_rows = 0,
        IF(
            @parity_uniq_cols IS NULL,
            'ALTER TABLE canonical_parity_daily ADD UNIQUE KEY uniq_canonical_parity_daily (source_key, report_date, platform_account_id, platform_campaign_id, fact_scope, delivery_entity_id, creative_id, metric_name)',
            'ALTER TABLE canonical_parity_daily DROP INDEX uniq_canonical_parity_daily, ADD UNIQUE KEY uniq_canonical_parity_daily (source_key, report_date, platform_account_id, platform_campaign_id, fact_scope, delivery_entity_id, creative_id, metric_name)'
        ),
        'SELECT ''MANUAL: rebuild uniq_canonical_parity_daily after dedupe / maintenance window because table is non-empty'' AS manual_notice'
    )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

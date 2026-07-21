-- Align the legacy property-scoped table with the active account-scoped GSC
-- writer/read model. New columns stay nullable so rows written under the legacy
-- contract remain valid while the canonical collector always supplies them.

SET @gsc_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'analytics_account_id'
);
SET @sql := IF(
  @gsc_column_exists = 0,
  'ALTER TABLE canonical_fact_gsc_queries_daily ADD COLUMN analytics_account_id BIGINT NULL AFTER source_key',
  'SELECT ''canonical_fact_gsc_queries_daily.analytics_account_id already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'query'
);
SET @sql := IF(
  @gsc_column_exists = 0,
  'ALTER TABLE canonical_fact_gsc_queries_daily ADD COLUMN query TEXT NULL AFTER report_date',
  'SELECT ''canonical_fact_gsc_queries_daily.query already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'page'
);
SET @sql := IF(
  @gsc_column_exists = 0,
  'ALTER TABLE canonical_fact_gsc_queries_daily ADD COLUMN page TEXT NULL AFTER query',
  'SELECT ''canonical_fact_gsc_queries_daily.page already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'country'
);
SET @sql := IF(
  @gsc_column_exists = 0,
  'ALTER TABLE canonical_fact_gsc_queries_daily ADD COLUMN country VARCHAR(16) NULL AFTER page',
  'SELECT ''canonical_fact_gsc_queries_daily.country already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'device'
);
SET @sql := IF(
  @gsc_column_exists = 0,
  'ALTER TABLE canonical_fact_gsc_queries_daily ADD COLUMN device VARCHAR(32) NULL AFTER country',
  'SELECT ''canonical_fact_gsc_queries_daily.device already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'position'
);
SET @sql := IF(
  @gsc_column_exists = 0,
  'ALTER TABLE canonical_fact_gsc_queries_daily ADD COLUMN position DECIMAL(10,4) NULL AFTER ctr',
  'SELECT ''canonical_fact_gsc_queries_daily.position already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_legacy_nullable := (
  SELECT IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'property_url'
);
SET @sql := IF(
  @gsc_legacy_nullable = 'NO',
  'ALTER TABLE canonical_fact_gsc_queries_daily MODIFY COLUMN property_url VARCHAR(255) NULL DEFAULT NULL',
  'SELECT ''canonical_fact_gsc_queries_daily.property_url already nullable'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_legacy_nullable := (
  SELECT IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'device_type'
);
SET @sql := IF(
  @gsc_legacy_nullable = 'NO',
  'ALTER TABLE canonical_fact_gsc_queries_daily MODIFY COLUMN device_type VARCHAR(32) NULL DEFAULT NULL',
  'SELECT ''canonical_fact_gsc_queries_daily.device_type already nullable'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_legacy_nullable := (
  SELECT IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND COLUMN_NAME = 'query_text'
);
SET @sql := IF(
  @gsc_legacy_nullable = 'NO',
  'ALTER TABLE canonical_fact_gsc_queries_daily MODIFY COLUMN query_text TEXT NULL',
  'SELECT ''canonical_fact_gsc_queries_daily.query_text already nullable'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_unique_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND INDEX_NAME = 'uniq_gsc_queries_daily'
  GROUP BY INDEX_NAME
);
SET @gsc_named_is_unique := (
  SELECT IF(MIN(NON_UNIQUE) = 0, 1, 0)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND INDEX_NAME = 'uniq_gsc_queries_daily'
  GROUP BY INDEX_NAME
);
SET @gsc_unique_target := 'analytics_account_id,report_date,query_hash,device,country';
SET @gsc_equivalent_unique_count := (
  SELECT COUNT(*)
  FROM (
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
      AND NON_UNIQUE = 0
      AND INDEX_NAME <> 'PRIMARY'
    GROUP BY INDEX_NAME
    HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') = @gsc_unique_target
  ) AS equivalent_unique_indexes
);
SET @sql := IF(
  COALESCE(@gsc_unique_columns, '') = @gsc_unique_target
    AND COALESCE(@gsc_named_is_unique, 0) = 1,
  'SELECT ''uniq_gsc_queries_daily already canonical'' AS info',
  IF(
    @gsc_equivalent_unique_count > 0,
    IF(
      @gsc_unique_columns IS NULL,
      'SELECT ''equivalent canonical GSC query unique index already present'' AS info',
      'ALTER TABLE canonical_fact_gsc_queries_daily DROP INDEX uniq_gsc_queries_daily'
    ),
    IF(
      @gsc_unique_columns IS NULL,
      'ALTER TABLE canonical_fact_gsc_queries_daily ADD UNIQUE KEY uniq_gsc_queries_daily (analytics_account_id, report_date, query_hash, device, country)',
      'ALTER TABLE canonical_fact_gsc_queries_daily DROP INDEX uniq_gsc_queries_daily, ADD UNIQUE KEY uniq_gsc_queries_daily (analytics_account_id, report_date, query_hash, device, country)'
    )
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND INDEX_NAME = 'idx_gsc_queries_daily_account_date'
  GROUP BY INDEX_NAME
);
SET @gsc_index_target := 'analytics_account_id,report_date';
SET @sql := IF(
  COALESCE(@gsc_index_columns, '') = @gsc_index_target,
  'SELECT ''idx_gsc_queries_daily_account_date already canonical'' AS info',
  IF(
    @gsc_index_columns IS NULL,
    'ALTER TABLE canonical_fact_gsc_queries_daily ADD INDEX idx_gsc_queries_daily_account_date (analytics_account_id, report_date)',
    'ALTER TABLE canonical_fact_gsc_queries_daily DROP INDEX idx_gsc_queries_daily_account_date, ADD INDEX idx_gsc_queries_daily_account_date (analytics_account_id, report_date)'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

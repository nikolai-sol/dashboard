-- Account-aware, effective-dated advertising bindings. All alterations are
-- replay guarded because the migration runner executes every SQL file again.

SET @has_binding_canonical_campaign := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND COLUMN_NAME = 'canonical_campaign_id'
);
SET @canonical_campaign_id_type := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canonical_source_campaigns'
    AND COLUMN_NAME = 'id'
);
SET @binding_canonical_campaign_id_type := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND COLUMN_NAME = 'canonical_campaign_id'
);
SET @sql := IF(
  @has_binding_canonical_campaign = 0,
  CONCAT(
    'ALTER TABLE media_plan_bindings ADD COLUMN canonical_campaign_id ',
    @canonical_campaign_id_type,
    ' NULL AFTER source_key'
  ),
  IF(
    @binding_canonical_campaign_id_type <> @canonical_campaign_id_type,
    CONCAT(
      'ALTER TABLE media_plan_bindings MODIFY COLUMN canonical_campaign_id ',
      @canonical_campaign_id_type,
      ' NULL'
    ),
    'SELECT ''media_plan_bindings.canonical_campaign_id already matches canonical_source_campaigns.id'' AS info'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_binding_platform_account := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND COLUMN_NAME = 'platform_account_id'
);
SET @sql := IF(
  @has_binding_platform_account = 0,
  'ALTER TABLE media_plan_bindings ADD COLUMN platform_account_id VARCHAR(128) NULL AFTER canonical_campaign_id',
  'SELECT ''media_plan_bindings.platform_account_id already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_binding_effective_from := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND COLUMN_NAME = 'effective_from'
);
SET @sql := IF(
  @has_binding_effective_from = 0,
  'ALTER TABLE media_plan_bindings ADD COLUMN effective_from DATE NULL AFTER platform_campaign_id',
  'SELECT ''media_plan_bindings.effective_from already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_binding_effective_to := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND COLUMN_NAME = 'effective_to'
);
SET @sql := IF(
  @has_binding_effective_to = 0,
  'ALTER TABLE media_plan_bindings ADD COLUMN effective_to DATE NULL AFTER effective_from',
  'SELECT ''media_plan_bindings.effective_to already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_binding_created_by := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND COLUMN_NAME = 'created_by'
);
SET @sql := IF(
  @has_binding_created_by = 0,
  'ALTER TABLE media_plan_bindings ADD COLUMN created_by VARCHAR(255) NULL AFTER effective_to',
  'SELECT ''media_plan_bindings.created_by already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS media_plan_binding_audit (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dashboard_id INT NOT NULL,
  binding_id INT NULL,
  action ENUM('create','update','delete','migration') NOT NULL,
  actor VARCHAR(255) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_binding_audit_dashboard_time (dashboard_id, created_at),
  KEY idx_binding_audit_binding (binding_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_binding_canonical_period_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND INDEX_NAME = 'idx_media_plan_binding_canonical_period'
);
SET @sql := IF(
  @has_binding_canonical_period_index = 0,
  'ALTER TABLE media_plan_bindings ADD INDEX idx_media_plan_binding_canonical_period (dashboard_id, canonical_campaign_id, effective_from, effective_to)',
  'SELECT ''idx_media_plan_binding_canonical_period already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_binding_unique := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND INDEX_NAME = 'unique_binding'
);
SET @binding_unique_period_columns := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_plan_bindings'
    AND INDEX_NAME = 'unique_binding'
    AND COLUMN_NAME IN ('canonical_campaign_id', 'effective_from', 'effective_to')
);
SET @sql := IF(
  @has_binding_unique = 0,
  'ALTER TABLE media_plan_bindings ADD UNIQUE KEY unique_binding (dashboard_id, line_key(191), canonical_campaign_id, effective_from, effective_to)',
  IF(
    @binding_unique_period_columns <> 3,
    'ALTER TABLE media_plan_bindings DROP INDEX unique_binding, ADD UNIQUE KEY unique_binding (dashboard_id, line_key(191), canonical_campaign_id, effective_from, effective_to)',
    'SELECT ''media_plan_bindings.unique_binding already effective-dated'' AS info'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_binding_canonical_campaign_fk := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'media_plan_bindings'
    AND CONSTRAINT_NAME = 'fk_media_plan_binding_canonical_campaign'
);
SET @sql := IF(
  @has_binding_canonical_campaign_fk = 0,
  'ALTER TABLE media_plan_bindings ADD CONSTRAINT fk_media_plan_binding_canonical_campaign FOREIGN KEY (canonical_campaign_id) REFERENCES canonical_source_campaigns (id) ON DELETE RESTRICT',
  'SELECT ''fk_media_plan_binding_canonical_campaign already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE media_plan_bindings AS bindings
JOIN (
  SELECT source_key, platform_campaign_id,
         MIN(id) AS canonical_campaign_id,
         MIN(platform_account_id) AS platform_account_id
  FROM canonical_source_campaigns
  GROUP BY source_key, platform_campaign_id
  HAVING COUNT(*) = 1
) AS resolved
  ON resolved.source_key = bindings.source_key
 AND resolved.platform_campaign_id = bindings.platform_campaign_id
SET bindings.canonical_campaign_id = resolved.canonical_campaign_id,
    bindings.platform_account_id = resolved.platform_account_id,
    bindings.created_by = 'migration:058'
WHERE bindings.canonical_campaign_id IS NULL
  AND bindings.platform_account_id IS NULL;

INSERT INTO media_plan_binding_audit (
  dashboard_id, binding_id, action, actor, before_json, after_json
)
SELECT bindings.dashboard_id, bindings.id, 'migration', 'migration:058',
       JSON_OBJECT(
         'line_key', bindings.line_key,
         'source_key', bindings.source_key,
         'platform_campaign_id', bindings.platform_campaign_id,
         'canonical_campaign_id', NULL,
         'platform_account_id', NULL
       ),
       JSON_OBJECT(
         'line_key', bindings.line_key,
         'source_key', bindings.source_key,
         'platform_campaign_id', bindings.platform_campaign_id,
         'canonical_campaign_id', bindings.canonical_campaign_id,
         'platform_account_id', bindings.platform_account_id,
         'effective_from', bindings.effective_from,
         'effective_to', bindings.effective_to
       )
FROM media_plan_bindings AS bindings
WHERE bindings.created_by = 'migration:058'
  AND bindings.canonical_campaign_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM media_plan_binding_audit AS audit
    WHERE audit.binding_id = bindings.id AND audit.action = 'migration'
  );

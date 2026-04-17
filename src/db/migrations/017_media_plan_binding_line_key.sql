SET @has_line_key := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'media_plan_bindings'
    AND COLUMN_NAME = 'line_key'
);

SET @sql := IF(
  @has_line_key = 0,
  'ALTER TABLE media_plan_bindings ADD COLUMN line_key VARCHAR(500) NULL AFTER dashboard_id',
  'SELECT ''media_plan_bindings.line_key already present'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE media_plan_bindings
SET line_key = channel
WHERE line_key IS NULL OR line_key = '';

SET @has_idx_line_key := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'media_plan_bindings'
    AND INDEX_NAME = 'idx_dashboard_line_key'
);

SET @sql := IF(
  @has_idx_line_key = 0,
  'ALTER TABLE media_plan_bindings ADD INDEX idx_dashboard_line_key (dashboard_id, line_key(191))',
  'SELECT ''idx_dashboard_line_key already present'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @uniq_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'media_plan_bindings'
    AND INDEX_NAME = 'unique_binding'
);

SET @has_unique_line_key := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'media_plan_bindings'
    AND INDEX_NAME = 'unique_binding'
    AND COLUMN_NAME = 'line_key'
);

SET @sql := IF(
  @uniq_exists > 0 AND @has_unique_line_key = 0,
  'ALTER TABLE media_plan_bindings DROP INDEX unique_binding, ADD UNIQUE KEY unique_binding (dashboard_id, line_key(191), source_key, platform_campaign_id)',
  'SELECT ''media_plan_bindings.unique_binding already aligned'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

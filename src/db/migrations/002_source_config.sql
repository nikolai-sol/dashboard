-- Add source-specific config (e.g. Google Sheet URL per dashboard)
SET @source_config_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dashboard_sources'
    AND COLUMN_NAME = 'source_config'
);

SET @alter_sql = IF(
  @source_config_exists = 0,
  'ALTER TABLE dashboard_sources ADD COLUMN source_config JSON DEFAULT NULL',
  'SELECT 1'
);

PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Initialize existing media plan sources with an empty sheet URL config
UPDATE dashboard_sources
SET source_config = JSON_OBJECT('sheet_url', '')
WHERE role = 'plan'
  AND platform = 'media_plan'
  AND (source_config IS NULL OR JSON_EXTRACT(source_config, '$.sheet_url') IS NULL);

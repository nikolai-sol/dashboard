SET @source_key_nullable := (
  SELECT IS_NULLABLE = 'YES'
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dashboard_utm_source_bindings'
    AND COLUMN_NAME = 'source_key'
);

SET @has_line_key := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dashboard_utm_source_bindings'
    AND COLUMN_NAME = 'line_key'
);

SET @has_channel := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dashboard_utm_source_bindings'
    AND COLUMN_NAME = 'channel'
);

SET @sql := CONCAT(
  'ALTER TABLE dashboard_utm_source_bindings ',
  IF(COALESCE(@source_key_nullable, 0) = 0, 'MODIFY COLUMN source_key VARCHAR(64) NULL', 'ENGINE=InnoDB'),
  IF(@has_line_key = 0, ', ADD COLUMN line_key VARCHAR(500) NULL AFTER utm_source', ''),
  IF(@has_channel = 0, ', ADD COLUMN channel VARCHAR(255) NULL AFTER line_key', '')
);

SET @sql := IF(
  @has_line_key = 0 OR @has_channel = 0 OR COALESCE(@source_key_nullable, 0) = 0,
  @sql,
  'SELECT ''dashboard_utm_source_bindings columns already aligned'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_line_key := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dashboard_utm_source_bindings'
    AND INDEX_NAME = 'idx_dashboard_utm_source_binding_line_key'
);

SET @sql := IF(
  @has_idx_line_key = 0,
  'ALTER TABLE dashboard_utm_source_bindings ADD INDEX idx_dashboard_utm_source_binding_line_key (dashboard_id, line_key(191))',
  'SELECT ''idx_dashboard_utm_source_binding_line_key already present'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

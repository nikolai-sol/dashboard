-- Add visit-level UTM Source only to the manager-private Abbott visit table.
-- Existing active-release rows remain untouched; successor backfills populate it.

SET @abbott_private_visits_table_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'canonical_fact_metrika_visits'
);

SET @abbott_private_visit_utm_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'canonical_fact_metrika_visits'
    AND COLUMN_NAME = 'utm_source'
);

SET @sql := IF(
  @abbott_private_visits_table_exists = 1
    AND @abbott_private_visit_utm_exists = 0,
  'ALTER TABLE report_bd_private.canonical_fact_metrika_visits ADD COLUMN utm_source VARCHAR(500) DEFAULT NULL AFTER traffic_source',
  'SELECT ''private Metrika visit UTM source already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_visit_utm_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'canonical_fact_metrika_visits'
    AND INDEX_NAME = 'idx_private_visit_release_utm'
);

SET @sql := IF(
  @abbott_private_visits_table_exists = 1
    AND @abbott_private_visit_utm_index_exists = 0,
  'ALTER TABLE report_bd_private.canonical_fact_metrika_visits ADD INDEX idx_private_visit_release_utm (canonical_release_id, report_date, utm_source(191))',
  'SELECT ''private Metrika visit UTM index already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

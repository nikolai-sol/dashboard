-- Store every distinct UserID parsed from one Metrika visit without assigning
-- an ambiguous visit to an arbitrary singular identity. Existing release rows
-- remain untouched; successor backfills populate the new private JSON field.

SET @abbott_private_visit_user_ids_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'canonical_fact_metrika_visits'
    AND COLUMN_NAME = 'raw_user_ids_json'
);

SET @abbott_private_visits_table_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'canonical_fact_metrika_visits'
);

SET @sql := IF(
  @abbott_private_visits_table_exists = 1
    AND @abbott_private_visit_user_ids_exists = 0,
  'ALTER TABLE report_bd_private.canonical_fact_metrika_visits ADD COLUMN raw_user_ids_json JSON DEFAULT NULL AFTER raw_user_id_hash',
  'SELECT ''private Metrika visit User ID JSON already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

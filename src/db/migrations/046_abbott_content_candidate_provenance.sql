-- Immutable provenance for successor content projections. Existing release rows
-- remain legacy-null: the first post-046 successor derives their baseline identity
-- only from active strong aliases plus the active catalog labels/taxonomy, fails on
-- unmapped or ambiguous identity, and writes all five fields into the new successor.
-- This migration is deliberately additive and repeat-safe; it never rewrites an
-- active legacy catalog row and never consults unactivated classification events.

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'content_entity_id'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN content_entity_id BIGINT UNSIGNED DEFAULT NULL AFTER valid_to',
  'SELECT ''content entity projection provenance already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'classification_event_id'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN classification_event_id BIGINT UNSIGNED DEFAULT NULL AFTER content_entity_id',
  'SELECT ''classification event projection provenance already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'classification_event_fingerprint'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN classification_event_fingerprint CHAR(64) DEFAULT NULL AFTER classification_event_id',
  'SELECT ''classification event fingerprint already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'projection_provenance_json'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN projection_provenance_json JSON DEFAULT NULL AFTER classification_event_fingerprint',
  'SELECT ''projection provenance JSON already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'projection_row_hash'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN projection_row_hash CHAR(64) DEFAULT NULL AFTER projection_provenance_json',
  'SELECT ''projection row hash already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND INDEX_NAME = 'idx_content_projection_entity'
);
SET @sql := IF(
  @abbott_index_exists = 0,
  'ALTER TABLE portal_content_catalog ADD INDEX idx_content_projection_entity (canonical_release_id, content_entity_id)',
  'SELECT ''content projection entity index already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND INDEX_NAME = 'idx_content_projection_event'
);
SET @sql := IF(
  @abbott_index_exists = 0,
  'ALTER TABLE portal_content_catalog ADD INDEX idx_content_projection_event (classification_event_id)',
  'SELECT ''content projection event index already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

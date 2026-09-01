-- Migration 055: make local and Google approval projections disjoint receipts.
SET @abbott_projection_kind_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_batches' AND COLUMN_NAME = 'projection_kind');
SET @sql := IF(@abbott_projection_kind_exists = 1, 'SELECT 1', 'ALTER TABLE portal_content_approval_batches ADD COLUMN projection_kind ENUM(''google'', ''local'') DEFAULT NULL AFTER spreadsheet_projection_hash');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_local_locator_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_batches' AND COLUMN_NAME = 'local_projection_locator');
SET @sql := IF(@abbott_local_locator_exists = 1, 'SELECT 1', 'ALTER TABLE portal_content_approval_batches ADD COLUMN local_projection_locator VARCHAR(255) DEFAULT NULL AFTER projection_kind');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_local_hash_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_batches' AND COLUMN_NAME = 'local_projection_content_hash');
SET @sql := IF(@abbott_local_hash_exists = 1, 'SELECT 1', 'ALTER TABLE portal_content_approval_batches ADD COLUMN local_projection_content_hash CHAR(64) DEFAULT NULL AFTER local_projection_locator');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE portal_content_approval_batches
SET projection_kind = 'google'
WHERE projection_kind IS NULL AND spreadsheet_file_id IS NOT NULL;

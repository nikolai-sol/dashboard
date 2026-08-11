-- Migration 054: local review may create one canonical observed Abbott page.
-- Existing foreign keys and immutable event triggers are deliberately retained.
SET @abbott_item_url_decision_enum := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_items' AND COLUMN_NAME = 'url_alias_decision');
SET @sql := IF(@abbott_item_url_decision_enum = "enum('attach','retire','reject','create')", 'SELECT 1', "ALTER TABLE portal_content_approval_items MODIFY COLUMN url_alias_decision ENUM('attach', 'retire', 'reject', 'create') DEFAULT NULL");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_event_url_decision_enum := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_url_alias_decision_events' AND COLUMN_NAME = 'url_alias_decision');
SET @sql := IF(@abbott_event_url_decision_enum = "enum('attach','retire','reject','create')", 'SELECT 1', "ALTER TABLE portal_content_url_alias_decision_events MODIFY COLUMN url_alias_decision ENUM('attach', 'retire', 'reject', 'create') NOT NULL");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

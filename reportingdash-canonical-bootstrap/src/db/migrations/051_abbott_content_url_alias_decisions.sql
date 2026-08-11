-- Migration 051: immutable reviewed URL-alias choices for approval replay.
SET @abbott_selected_entity_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_approval_items'
    AND COLUMN_NAME = 'selected_content_entity_id'
);
SET @sql := IF(
  @abbott_selected_entity_column_exists = 0,
  'ALTER TABLE portal_content_approval_items ADD COLUMN selected_content_entity_id BIGINT UNSIGNED DEFAULT NULL',
  'SELECT ''selected content entity column already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_url_decision_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_approval_items'
    AND COLUMN_NAME = 'url_alias_decision'
);
SET @sql := IF(
  @abbott_url_decision_column_exists = 0,
  'ALTER TABLE portal_content_approval_items ADD COLUMN url_alias_decision ENUM(''attach'', ''retire'', ''reject'') DEFAULT NULL',
  'SELECT ''url alias decision column already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_selected_entity_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_approval_items'
    AND INDEX_NAME = 'idx_approval_item_selected_entity'
);
SET @sql := IF(
  @abbott_selected_entity_index_exists = 0,
  'ALTER TABLE portal_content_approval_items ADD INDEX idx_approval_item_selected_entity (selected_content_entity_id)',
  'SELECT ''selected content entity index already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS portal_content_url_alias_decision_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  approval_batch_id BIGINT UNSIGNED NOT NULL,
  approval_item_id BIGINT UNSIGNED NOT NULL,
  accepted_decision_hash CHAR(64) NOT NULL,
  actor VARCHAR(191) NOT NULL,
  decision_reason TEXT NOT NULL,
  normalized_url VARCHAR(2048) NOT NULL,
  url_alias_decision ENUM('attach', 'retire', 'reject') NOT NULL,
  selected_content_entity_id BIGINT UNSIGNED DEFAULT NULL,
  selected_predecessor_event_id BIGINT UNSIGNED DEFAULT NULL,
  selected_predecessor_event_fingerprint CHAR(64) DEFAULT NULL,
  event_fingerprint CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_url_alias_decision_fingerprint (event_fingerprint),
  UNIQUE KEY uniq_url_alias_decision_item (approval_batch_id, approval_item_id),
  CONSTRAINT fk_url_alias_decision_batch
    FOREIGN KEY (approval_batch_id)
    REFERENCES portal_content_approval_batches (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_url_alias_decision_item
    FOREIGN KEY (approval_item_id)
    REFERENCES portal_content_approval_items (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_url_alias_decision_entity
    FOREIGN KEY (selected_content_entity_id)
    REFERENCES portal_content_registry_entities (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_url_alias_decision_predecessor_event
    FOREIGN KEY (selected_predecessor_event_id)
    REFERENCES portal_content_classification_events (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_url_alias_decision_events_immutable_update;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_url_alias_decision_events_immutable_update
BEFORE UPDATE ON portal_content_url_alias_decision_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Abbott URL alias decision events are immutable';
END;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_url_alias_decision_events_immutable_delete;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_url_alias_decision_events_immutable_delete
BEFORE DELETE ON portal_content_url_alias_decision_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Abbott URL alias decision events are immutable';
END;
-- @migration-statement-break

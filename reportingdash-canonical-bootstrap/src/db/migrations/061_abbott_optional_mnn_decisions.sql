-- Migration 061: optional reviewed primary/additional MNN decisions.
-- Existing workbook claim authority remains valid and is never rewritten.

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_items'
    AND COLUMN_NAME = 'mnn_decision_version'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE portal_content_approval_items ADD COLUMN mnn_decision_version TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER url_alias_decision',
  'SELECT ''mnn decision version already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_items'
    AND COLUMN_NAME = 'final_primary_mnn_key'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE portal_content_approval_items ADD COLUMN final_primary_mnn_key VARCHAR(255) DEFAULT NULL AFTER mnn_decision_version',
  'SELECT ''primary MNN key already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_items'
    AND COLUMN_NAME = 'final_primary_mnn_label'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE portal_content_approval_items ADD COLUMN final_primary_mnn_label VARCHAR(500) DEFAULT NULL AFTER final_primary_mnn_key',
  'SELECT ''primary MNN label already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_items'
    AND COLUMN_NAME = 'final_additional_mnn_json'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE portal_content_approval_items ADD COLUMN final_additional_mnn_json JSON DEFAULT NULL AFTER final_primary_mnn_label',
  'SELECT ''additional MNN already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_approval_items'
    AND COLUMN_NAME = 'mnn_decision_reason'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE portal_content_approval_items ADD COLUMN mnn_decision_reason VARCHAR(2000) DEFAULT NULL AFTER final_additional_mnn_json',
  'SELECT ''MNN reason already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

CREATE TABLE IF NOT EXISTS portal_content_mnn_decision_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dataset_key VARCHAR(64) NOT NULL DEFAULT 'abbott',
  approval_batch_id BIGINT UNSIGNED NOT NULL,
  approval_item_id BIGINT UNSIGNED NOT NULL,
  content_entity_id BIGINT UNSIGNED NOT NULL,
  accepted_decision_hash CHAR(64) NOT NULL,
  actor VARCHAR(191) NOT NULL,
  decision_reason VARCHAR(2000) DEFAULT NULL,
  mnn_source_snapshot_id BIGINT UNSIGNED DEFAULT NULL,
  primary_mnn_key VARCHAR(255) NOT NULL,
  primary_mnn_label VARCHAR(500) NOT NULL,
  additional_mnn_json JSON NOT NULL,
  proposal_evidence_json JSON DEFAULT NULL,
  event_fingerprint CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_content_mnn_decision_item (approval_batch_id, approval_item_id),
  UNIQUE KEY uniq_content_mnn_decision_fingerprint (event_fingerprint),
  KEY idx_content_mnn_decision_entity (content_entity_id, created_at),
  CONSTRAINT fk_content_mnn_decision_batch
    FOREIGN KEY (approval_batch_id) REFERENCES portal_content_approval_batches (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_mnn_decision_item
    FOREIGN KEY (approval_item_id) REFERENCES portal_content_approval_items (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_mnn_decision_entity
    FOREIGN KEY (content_entity_id) REFERENCES portal_content_registry_entities (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_mnn_decision_snapshot
    FOREIGN KEY (mnn_source_snapshot_id) REFERENCES portal_dataset_snapshots (id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_content_mnn_decision_dataset CHECK (dataset_key = 'abbott')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable optional primary/additional MNN review decisions';
-- @migration-statement-break

ALTER TABLE portal_content_catalog_mnn
  MODIFY mnn_source_snapshot_id BIGINT UNSIGNED NULL,
  MODIFY source_claim_id BIGINT UNSIGNED NULL;
-- @migration-statement-break

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_catalog_mnn'
    AND COLUMN_NAME = 'mnn_decision_event_id'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE portal_content_catalog_mnn ADD COLUMN mnn_decision_event_id BIGINT UNSIGNED DEFAULT NULL AFTER source_claim_id',
  'SELECT ''MNN decision authority already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_catalog_mnn'
    AND COLUMN_NAME = 'mnn_role'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE portal_content_catalog_mnn ADD COLUMN mnn_role ENUM(''primary'',''additional'',''unranked'') NOT NULL DEFAULT ''unranked'' AFTER mnn_label',
  'SELECT ''MNN role already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_catalog_mnn'
    AND COLUMN_NAME = 'display_order'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE portal_content_catalog_mnn ADD COLUMN display_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER mnn_role',
  'SELECT ''MNN display order already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_catalog_mnn'
    AND INDEX_NAME = 'idx_content_mnn_decision_event'
);
SET @sql := IF(@index_exists = 0,
  'ALTER TABLE portal_content_catalog_mnn ADD KEY idx_content_mnn_decision_event (mnn_decision_event_id)',
  'SELECT ''MNN decision index already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @constraint_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_catalog_mnn'
    AND CONSTRAINT_NAME = 'fk_content_mnn_decision_event'
);
SET @sql := IF(@constraint_exists = 0,
  'ALTER TABLE portal_content_catalog_mnn ADD CONSTRAINT fk_content_mnn_decision_event FOREIGN KEY (mnn_decision_event_id) REFERENCES portal_content_mnn_decision_events (id) ON DELETE RESTRICT',
  'SELECT ''MNN decision foreign key already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

SET @constraint_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_content_catalog_mnn'
    AND CONSTRAINT_NAME = 'chk_content_mnn_exactly_one_authority'
);
SET @sql := IF(@constraint_exists = 0,
  'ALTER TABLE portal_content_catalog_mnn ADD CONSTRAINT chk_content_mnn_exactly_one_authority CHECK (((mnn_source_snapshot_id IS NOT NULL AND source_claim_id IS NOT NULL AND mnn_decision_event_id IS NULL) OR (mnn_source_snapshot_id IS NULL AND source_claim_id IS NULL AND mnn_decision_event_id IS NOT NULL)))',
  'SELECT ''mnn catalog authority check already available'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_mnn_decisions_immutable_update;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_mnn_decisions_immutable_update
BEFORE UPDATE ON portal_content_mnn_decision_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Abbott MNN decision events are immutable';
END;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_mnn_decisions_immutable_delete;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_mnn_decisions_immutable_delete
BEFORE DELETE ON portal_content_mnn_decision_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Abbott MNN decision events are immutable';
END;
-- @migration-statement-break

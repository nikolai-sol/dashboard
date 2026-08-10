-- Migration 051: immutable reviewed URL-alias choices for approval replay.
ALTER TABLE portal_content_approval_items
  ADD COLUMN IF NOT EXISTS selected_content_entity_id BIGINT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS url_alias_decision ENUM('attach', 'retire', 'reject') DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_approval_item_selected_entity (selected_content_entity_id);

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
  UNIQUE KEY uniq_url_alias_decision_item (approval_batch_id, approval_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

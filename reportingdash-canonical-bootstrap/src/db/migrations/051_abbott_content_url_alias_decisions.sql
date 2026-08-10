-- Migration 051: immutable reviewed URL-alias choices for approval replay.
ALTER TABLE portal_content_approval_items
  ADD COLUMN IF NOT EXISTS selected_content_entity_id BIGINT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS url_alias_decision ENUM('attach', 'retire', 'reject') DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_approval_item_selected_entity (selected_content_entity_id);

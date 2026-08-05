-- Canonical Abbott content registry, taxonomy, review, and append-only events.
-- Source APIs remain collector-only; workflow consumers read these MySQL tables.

CREATE TABLE IF NOT EXISTS portal_content_registry_entities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dataset_key VARCHAR(64) NOT NULL DEFAULT 'abbott',
  material_id VARCHAR(255) DEFAULT NULL,
  title VARCHAR(1000) NOT NULL,
  canonical_url VARCHAR(2048) NOT NULL,
  registry_status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  source_evidence JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_registry_entity_dataset_id (dataset_key, id),
  UNIQUE KEY uniq_registry_material_id (dataset_key, material_id),
  CONSTRAINT chk_registry_entity_dataset CHECK (dataset_key = 'abbott')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_content_registry_aliases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dataset_key VARCHAR(64) NOT NULL DEFAULT 'abbott',
  content_entity_id BIGINT UNSIGNED NOT NULL,
  alias_type ENUM('material_id', 'canonical_url', 'url', 'slug', 'title') NOT NULL,
  alias_value VARCHAR(2048) NOT NULL,
  alias_hash CHAR(64) NOT NULL,
  uniqueness_scope VARCHAR(191) NOT NULL,
  strong_alias_hash CHAR(64) GENERATED ALWAYS AS (
    CASE WHEN uniqueness_scope = 'strong' THEN alias_hash ELSE NULL END
  ) STORED,
  alias_status ENUM('active', 'retired') NOT NULL DEFAULT 'active',
  source_evidence JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_registry_strong_alias (dataset_key, alias_type, strong_alias_hash),
  UNIQUE KEY uniq_registry_alias_owner (dataset_key, content_entity_id, alias_type, alias_hash),
  INDEX idx_registry_alias_entity (dataset_key, content_entity_id),
  CONSTRAINT fk_registry_alias_entity
    FOREIGN KEY (dataset_key, content_entity_id)
    REFERENCES portal_content_registry_entities (dataset_key, id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_registry_alias_dataset CHECK (dataset_key = 'abbott'),
  CONSTRAINT chk_registry_alias_scope CHECK (
    (alias_type IN ('material_id', 'canonical_url', 'url') AND uniqueness_scope = 'strong')
    OR
    (alias_type IN ('slug', 'title') AND uniqueness_scope = 'weak')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_content_taxonomy_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dataset_key VARCHAR(64) NOT NULL DEFAULT 'abbott',
  version VARCHAR(191) NOT NULL,
  taxonomy_digest CHAR(64) NOT NULL,
  taxonomy_status ENUM('draft', 'active', 'retired') NOT NULL DEFAULT 'draft',
  source_evidence JSON NOT NULL,
  activated_at DATETIME(6) DEFAULT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_taxonomy_version (dataset_key, version),
  CONSTRAINT chk_taxonomy_version_dataset CHECK (dataset_key = 'abbott')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_content_taxonomy_terms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  taxonomy_version_id BIGINT UNSIGNED NOT NULL,
  taxonomy_kind ENUM('direction', 'material_type', 'access', 'lifecycle') NOT NULL,
  term_code VARCHAR(191) NOT NULL,
  term_label VARCHAR(500) NOT NULL,
  term_status ENUM('active', 'deprecated') NOT NULL DEFAULT 'active',
  source_evidence JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_taxonomy_code (taxonomy_version_id, taxonomy_kind, term_code),
  CONSTRAINT fk_taxonomy_term_version
    FOREIGN KEY (taxonomy_version_id)
    REFERENCES portal_content_taxonomy_versions (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_content_approval_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dataset_key VARCHAR(64) NOT NULL DEFAULT 'abbott',
  batch_key VARCHAR(191) NOT NULL,
  taxonomy_version_id BIGINT UNSIGNED NOT NULL,
  taxonomy_digest CHAR(64) NOT NULL,
  source_snapshot_ids JSON NOT NULL,
  source_snapshot_digests JSON NOT NULL,
  published_input_hash CHAR(64) NOT NULL,
  accepted_decision_hash CHAR(64) DEFAULT NULL,
  batch_status ENUM('draft', 'published', 'accepted', 'ingested', 'candidate_materialized', 'rejected', 'failed') NOT NULL DEFAULT 'draft',
  prompt_version VARCHAR(191) NOT NULL DEFAULT '',
  model_routing_version VARCHAR(191) NOT NULL,
  ready_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  conflict_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  unresolved_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rejected_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  no_change_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  accepted_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  spreadsheet_file_id VARCHAR(255) DEFAULT NULL,
  spreadsheet_projection_hash CHAR(64) DEFAULT NULL,
  published_at DATETIME(6) DEFAULT NULL,
  failed_at DATETIME(6) DEFAULT NULL,
  failure_code VARCHAR(64) DEFAULT NULL,
  accepted_by VARCHAR(255) DEFAULT NULL,
  accepted_at DATETIME(6) DEFAULT NULL,
  ingested_at DATETIME(6) DEFAULT NULL,
  candidate_release_id BIGINT UNSIGNED DEFAULT NULL,
  activation_status ENUM('not_started', 'candidate', 'active', 'rejected') NOT NULL DEFAULT 'not_started',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_approval_batch_key (dataset_key, batch_key),
  INDEX idx_approval_batch_taxonomy (taxonomy_version_id),
  CONSTRAINT fk_approval_batch_taxonomy
    FOREIGN KEY (taxonomy_version_id)
    REFERENCES portal_content_taxonomy_versions (id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_approval_batch_dataset CHECK (dataset_key = 'abbott')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_content_approval_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  approval_batch_id BIGINT UNSIGNED NOT NULL,
  content_entity_id BIGINT UNSIGNED DEFAULT NULL,
  content_entity_identity BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(content_entity_id, 0)) STORED,
  input_hash CHAR(64) NOT NULL,
  title VARCHAR(1000) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  final_direction_code VARCHAR(191) DEFAULT NULL,
  final_material_type_code VARCHAR(191) DEFAULT NULL,
  final_access_code VARCHAR(191) DEFAULT NULL,
  final_lifecycle_code VARCHAR(191) DEFAULT NULL,
  readiness_state ENUM('ready', 'conflict', 'unresolved', 'rejected', 'no_change') NOT NULL,
  conflict_code VARCHAR(64) DEFAULT NULL,
  conflict_codes JSON NOT NULL,
  row_hash CHAR(64) NOT NULL,
  decision_reason TEXT DEFAULT NULL,
  proposal_evidence JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_approval_batch_entity (approval_batch_id, content_entity_id, input_hash),
  UNIQUE KEY uniq_approval_batch_item_identity (approval_batch_id, content_entity_identity, input_hash),
  INDEX idx_approval_items_open (approval_batch_id, readiness_state, conflict_code),
  INDEX idx_approval_item_entity (content_entity_id),
  CONSTRAINT fk_approval_item_batch
    FOREIGN KEY (approval_batch_id)
    REFERENCES portal_content_approval_batches (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_approval_item_entity
    FOREIGN KEY (content_entity_id)
    REFERENCES portal_content_registry_entities (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_content_classification_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  content_entity_id BIGINT UNSIGNED NOT NULL,
  taxonomy_version_id BIGINT UNSIGNED NOT NULL,
  approval_batch_id BIGINT UNSIGNED DEFAULT NULL,
  approval_item_id BIGINT UNSIGNED DEFAULT NULL,
  predecessor_event_id BIGINT UNSIGNED DEFAULT NULL,
  direction_code VARCHAR(191) DEFAULT NULL,
  material_type_code VARCHAR(191) DEFAULT NULL,
  access_code VARCHAR(191) DEFAULT NULL,
  lifecycle_code VARCHAR(191) NOT NULL,
  event_kind ENUM('baseline', 'approve', 'correct', 'reject', 'revoke') NOT NULL,
  event_fingerprint CHAR(64) NOT NULL,
  proposal_evidence JSON NOT NULL,
  actor VARCHAR(255) DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  effective_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_classification_event_fingerprint (event_fingerprint),
  INDEX idx_classification_entity_effective (content_entity_id, effective_at, id),
  INDEX idx_classification_event_batch (approval_batch_id, approval_item_id),
  CONSTRAINT fk_classification_event_entity
    FOREIGN KEY (content_entity_id)
    REFERENCES portal_content_registry_entities (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_classification_event_taxonomy
    FOREIGN KEY (taxonomy_version_id)
    REFERENCES portal_content_taxonomy_versions (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_classification_event_batch
    FOREIGN KEY (approval_batch_id)
    REFERENCES portal_content_approval_batches (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_classification_event_item
    FOREIGN KEY (approval_item_id)
    REFERENCES portal_content_approval_items (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_classification_event_predecessor
    FOREIGN KEY (predecessor_event_id)
    REFERENCES portal_content_classification_events (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

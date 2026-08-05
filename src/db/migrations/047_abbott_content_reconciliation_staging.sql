-- Canonical, immutable staging for the weekly Abbott content proposal workflow.
-- Registry captures are inputs to a reconciliation run; approval batches are
-- created only after classification and remain bound to predecessor snapshots.

CREATE TABLE IF NOT EXISTS portal_content_reconciliation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dataset_key VARCHAR(64) NOT NULL DEFAULT 'abbott',
  run_key CHAR(64) NOT NULL,
  run_status ENUM('reconciled', 'classified', 'finalized', 'failed') NOT NULL,
  registry1_snapshot_id BIGINT UNSIGNED NOT NULL,
  registry1_sha256 CHAR(64) NOT NULL,
  registry1_source_row_count BIGINT UNSIGNED NOT NULL,
  registry1_accepted_count BIGINT UNSIGNED NOT NULL,
  registry1_rejected_count BIGINT UNSIGNED NOT NULL,
  registry1_duplicate_collapsed_count BIGINT UNSIGNED NOT NULL,
  registry1_parser_version VARCHAR(128) NOT NULL,
  registry1_source_kind VARCHAR(64) NOT NULL,
  registry2_snapshot_id BIGINT UNSIGNED NOT NULL,
  registry2_sha256 CHAR(64) NOT NULL,
  registry2_source_row_count BIGINT UNSIGNED NOT NULL,
  registry2_accepted_count BIGINT UNSIGNED NOT NULL,
  registry2_rejected_count BIGINT UNSIGNED NOT NULL,
  registry2_duplicate_collapsed_count BIGINT UNSIGNED NOT NULL,
  registry2_parser_version VARCHAR(128) NOT NULL,
  registry2_source_kind VARCHAR(64) NOT NULL,
  predecessor_release_id BIGINT UNSIGNED NOT NULL,
  predecessor_snapshot_ids JSON NOT NULL,
  predecessor_snapshot_digests JSON NOT NULL,
  taxonomy_version_id BIGINT UNSIGNED NOT NULL,
  taxonomy_digest CHAR(64) NOT NULL,
  prompt_version VARCHAR(191) NOT NULL,
  model_routing_version VARCHAR(191) NOT NULL,
  code_revision CHAR(40) NOT NULL,
  failure_code VARCHAR(64) DEFAULT NULL,
  reconciled_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  classified_at DATETIME(6) DEFAULT NULL,
  finalized_at DATETIME(6) DEFAULT NULL,
  failed_at DATETIME(6) DEFAULT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_content_reconciliation_run (dataset_key, run_key),
  INDEX idx_content_reconciliation_status (dataset_key, run_status, created_at),
  INDEX idx_content_reconciliation_registry1_snapshot (registry1_snapshot_id),
  INDEX idx_content_reconciliation_registry2_snapshot (registry2_snapshot_id),
  INDEX idx_content_reconciliation_predecessor (predecessor_release_id),
  INDEX idx_content_reconciliation_taxonomy (taxonomy_version_id),
  CONSTRAINT fk_content_reconciliation_registry1_snapshot
    FOREIGN KEY (registry1_snapshot_id)
    REFERENCES portal_dataset_snapshots (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_reconciliation_registry2_snapshot
    FOREIGN KEY (registry2_snapshot_id)
    REFERENCES portal_dataset_snapshots (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_reconciliation_predecessor
    FOREIGN KEY (predecessor_release_id)
    REFERENCES portal_data_releases (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_reconciliation_taxonomy
    FOREIGN KEY (taxonomy_version_id)
    REFERENCES portal_content_taxonomy_versions (id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_content_reconciliation_dataset CHECK (dataset_key = 'abbott')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_content_reconciliation_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reconciliation_run_id BIGINT UNSIGNED NOT NULL,
  item_key CHAR(64) NOT NULL,
  input_hash CHAR(64) NOT NULL,
  content_entity_id BIGINT UNSIGNED DEFAULT NULL,
  identity_status ENUM('matched', 'new', 'collision', 'rejected') NOT NULL,
  title VARCHAR(1000) NOT NULL,
  normalized_url VARCHAR(2048) NOT NULL,
  active_canonical_json JSON DEFAULT NULL,
  registry1_json JSON DEFAULT NULL,
  registry2_json JSON DEFAULT NULL,
  content_metadata_json JSON NOT NULL,
  deterministic_result_json JSON DEFAULT NULL,
  rejection_code VARCHAR(64) DEFAULT NULL,
  evidence_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_content_reconciliation_item_key (reconciliation_run_id, item_key),
  UNIQUE KEY uniq_content_reconciliation_input_hash (reconciliation_run_id, input_hash),
  INDEX idx_content_reconciliation_item_entity (content_entity_id),
  INDEX idx_content_reconciliation_item_status (reconciliation_run_id, identity_status),
  CONSTRAINT fk_content_reconciliation_item_run
    FOREIGN KEY (reconciliation_run_id)
    REFERENCES portal_content_reconciliation_runs (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_reconciliation_item_entity
    FOREIGN KEY (content_entity_id)
    REFERENCES portal_content_registry_entities (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_content_llm_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reconciliation_run_id BIGINT UNSIGNED NOT NULL,
  reconciliation_item_id BIGINT UNSIGNED NOT NULL,
  route_kind ENUM('terra_primary', 'sol_verifier') NOT NULL,
  attempt_ordinal INT UNSIGNED NOT NULL,
  model_version VARCHAR(191) NOT NULL,
  prompt_version VARCHAR(191) NOT NULL,
  model_routing_version VARCHAR(191) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  requested_fields JSON NOT NULL,
  strict_result_json JSON DEFAULT NULL,
  unresolved_code VARCHAR(64) DEFAULT NULL,
  input_token_count BIGINT UNSIGNED DEFAULT NULL,
  output_token_count BIGINT UNSIGNED DEFAULT NULL,
  elapsed_ms BIGINT UNSIGNED DEFAULT NULL,
  event_fingerprint CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_content_llm_attempt_route (reconciliation_item_id, route_kind, attempt_ordinal),
  UNIQUE KEY uniq_content_llm_attempt_fingerprint (event_fingerprint),
  INDEX idx_content_llm_attempt_run (reconciliation_run_id, reconciliation_item_id),
  CONSTRAINT fk_content_llm_attempt_run
    FOREIGN KEY (reconciliation_run_id)
    REFERENCES portal_content_reconciliation_runs (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_llm_attempt_item
    FOREIGN KEY (reconciliation_item_id)
    REFERENCES portal_content_reconciliation_items (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add the one-run/one-batch link without rewriting existing approval rows.
SET @abbott_reconciliation_run_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_approval_batches'
    AND COLUMN_NAME = 'reconciliation_run_id'
);
SET @sql := IF(
  @abbott_reconciliation_run_column_exists = 0,
  'ALTER TABLE portal_content_approval_batches ADD COLUMN reconciliation_run_id BIGINT UNSIGNED DEFAULT NULL AFTER id',
  'SELECT ''approval batch reconciliation run column already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_reconciliation_run_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_approval_batches'
    AND INDEX_NAME = 'uniq_approval_batch_reconciliation_run'
);
SET @sql := IF(
  @abbott_reconciliation_run_index_exists = 0,
  'ALTER TABLE portal_content_approval_batches ADD UNIQUE INDEX uniq_approval_batch_reconciliation_run (reconciliation_run_id)',
  'SELECT ''approval batch reconciliation run uniqueness already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_reconciliation_run_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_approval_batches'
    AND CONSTRAINT_NAME = 'fk_approval_batch_reconciliation_run'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(
  @abbott_reconciliation_run_fk_exists = 0,
  'ALTER TABLE portal_content_approval_batches ADD CONSTRAINT fk_approval_batch_reconciliation_run FOREIGN KEY (reconciliation_run_id) REFERENCES portal_content_reconciliation_runs (id) ON DELETE RESTRICT',
  'SELECT ''approval batch reconciliation run foreign key already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Taxonomy v1 is content-addressed. Duplicate execution is a no-op only when
-- the reviewed digest, active status, codes, labels, and term statuses agree.
INSERT INTO portal_content_taxonomy_versions (
  dataset_key, version, taxonomy_digest, taxonomy_status, source_evidence, activated_at
) VALUES (
  'abbott',
  'abbott.v1',
  'd6a2bfc39d970a873e309223604f9ae7c37cd83d6c046c107eed08e73ec435d4',
  'active',
  JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1'),
  CURRENT_TIMESTAMP(6)
)
ON DUPLICATE KEY UPDATE
  taxonomy_digest = IF(taxonomy_digest = VALUES(taxonomy_digest), taxonomy_digest, NULL),
  taxonomy_status = IF(taxonomy_status = VALUES(taxonomy_status), taxonomy_status, NULL);

SET @abbott_taxonomy_v1_id := (
  SELECT id
  FROM portal_content_taxonomy_versions
  WHERE dataset_key = 'abbott'
    AND version = 'abbott.v1'
    AND taxonomy_digest = 'd6a2bfc39d970a873e309223604f9ae7c37cd83d6c046c107eed08e73ec435d4'
    AND taxonomy_status = 'active'
);

INSERT INTO portal_content_taxonomy_terms (
  taxonomy_version_id, taxonomy_kind, term_code, term_label, term_status, source_evidence
) VALUES
  (@abbott_taxonomy_v1_id, 'direction', 'cardiology', 'Кардиология [262338]', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'dermatology', 'Дерматология [624635]', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'diabetes_management', 'Управление сахарным диабетом [620888]', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'gastroenterology', 'Гастроэнтерология [262340]', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'neurology_psychiatry', 'Неврология и психиатрия [262339]', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'not_applicable', 'Не относится / служебная', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'pharmacists', 'Фармацевты', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'respiratory_health', 'Здоровье дыхательной системы [263746]', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'undetermined', 'Не определено', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'direction', 'womens_health', 'Женское здоровье [262337]', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'articles', 'Статьи', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'calculators', 'Калькуляторы', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'child_nutrition', 'Детское питание', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'clinical_cases', 'Клинические случаи', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'clinical_decision_support', 'Цифровой консультант врача', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'clinical_guidelines', 'Клинические рекомендации', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'devices', 'Приборы и устройства', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'educational_brochures', 'Научно-образовательные брошюры', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'events', 'Мероприятия', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'general_materials', 'Общие материалы', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'knowledge_check', 'Проверить знания', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'personal_effectiveness', 'Личная эффективность', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'pharmacist_assistant', 'Помощник фармацевта', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'pharmacy_consulting_algorithms', 'Алгоритмы фармацевтического консультирования', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'podcasts', 'Подкасты', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'products', 'Препараты и продукты', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'respiratory_assistant', 'Респираторный помощник', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'section', 'Раздел', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'special_project', 'Спецпроект', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'subsection', 'Подраздел', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'tables', 'Таблицы', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'material_type', 'video', 'Видео', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'access', 'all', 'Все', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'access', 'doctors', 'Врачи', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'access', 'pharmacists', 'Фармацевты', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'access', 'unspecified', 'Не указано', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'lifecycle', 'active', 'active', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'lifecycle', 'archive_candidate', 'archive_candidate', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'lifecycle', 'archived', 'archived', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1')),
  (@abbott_taxonomy_v1_id, 'lifecycle', 'unknown', 'unknown', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1'))
ON DUPLICATE KEY UPDATE
  taxonomy_kind = IF(taxonomy_kind = VALUES(taxonomy_kind), taxonomy_kind, NULL),
  term_label = IF(term_label = VALUES(term_label), term_label, NULL),
  term_status = IF(term_status = VALUES(term_status), term_status, NULL);

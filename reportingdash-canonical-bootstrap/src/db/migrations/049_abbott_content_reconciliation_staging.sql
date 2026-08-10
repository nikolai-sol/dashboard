-- Migration 049: canonical, immutable staging for the weekly Abbott content proposal workflow.
-- Registry captures are inputs to a reconciliation run; approval batches are
-- created only after classification and remain bound to predecessor snapshots.

-- Migration 047 originally made weak title/slug hashes globally unique. Upgrade
-- that index repeat-safely: strong aliases retain one owner, while a weak alias
-- may have multiple owners and is resolved as ambiguous by the repository.
SET @abbott_alias_strong_hash_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_registry_aliases'
    AND COLUMN_NAME = 'strong_alias_hash'
);
SET @sql := IF(
  @abbott_alias_strong_hash_column_exists = 0,
  'ALTER TABLE portal_content_registry_aliases ADD COLUMN strong_alias_hash CHAR(64) GENERATED ALWAYS AS (CASE WHEN uniqueness_scope = ''strong'' THEN alias_hash ELSE NULL END) STORED AFTER uniqueness_scope',
  'SELECT ''registry strong alias generated column already available'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_alias_strong_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_registry_aliases'
    AND INDEX_NAME = 'uniq_registry_strong_alias'
);
SET @sql := IF(
  COALESCE(@abbott_alias_strong_index_columns, '') <> 'dataset_key,alias_type,strong_alias_hash'
    AND @abbott_alias_strong_index_columns IS NOT NULL,
  'ALTER TABLE portal_content_registry_aliases DROP INDEX uniq_registry_strong_alias',
  'SELECT ''registry strong alias legacy index does not need removal'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_alias_strong_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_registry_aliases'
    AND INDEX_NAME = 'uniq_registry_strong_alias'
);
SET @sql := IF(
  @abbott_alias_strong_index_exists = 0,
  'ALTER TABLE portal_content_registry_aliases ADD UNIQUE INDEX uniq_registry_strong_alias (dataset_key, alias_type, strong_alias_hash)',
  'SELECT ''registry strong alias index already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_alias_owner_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_registry_aliases'
    AND INDEX_NAME = 'uniq_registry_alias_owner'
);
SET @sql := IF(
  @abbott_alias_owner_index_exists = 0,
  'ALTER TABLE portal_content_registry_aliases ADD UNIQUE INDEX uniq_registry_alias_owner (dataset_key, content_entity_id, alias_type, alias_hash)',
  'SELECT ''registry alias owner index already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

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

-- Taxonomy v1 is content-addressed. Existing state is attested completely
-- before any canonical insert; migration replay never repairs or replaces it.
SET @abbott_taxonomy_v1_id := (
  SELECT id
  FROM portal_content_taxonomy_versions
  WHERE dataset_key = 'abbott'
    AND version = 'abbott.v1'
);
SET @abbott_taxonomy_v1_preexisting := IF(@abbott_taxonomy_v1_id IS NULL, 0, 1);

DROP TEMPORARY TABLE IF EXISTS abbott_expected_taxonomy_v1_terms;
CREATE TEMPORARY TABLE abbott_expected_taxonomy_v1_terms (
  taxonomy_version_id BIGINT UNSIGNED DEFAULT NULL,
  taxonomy_kind VARCHAR(64) NOT NULL,
  term_code VARCHAR(128) NOT NULL,
  term_label VARCHAR(255) NOT NULL,
  term_status VARCHAR(32) NOT NULL,
  source_evidence JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO abbott_expected_taxonomy_v1_terms (
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
  (@abbott_taxonomy_v1_id, 'lifecycle', 'unknown', 'unknown', 'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1'));

SET @abbott_taxonomy_v1_version_exact := IF(
  @abbott_taxonomy_v1_preexisting = 0,
  1,
  (
    SELECT COUNT(*) = 1
    FROM portal_content_taxonomy_versions
    WHERE id = @abbott_taxonomy_v1_id
      AND dataset_key = 'abbott'
      AND version = 'abbott.v1'
      AND taxonomy_digest = 'd6a2bfc39d970a873e309223604f9ae7c37cd83d6c046c107eed08e73ec435d4'
      AND taxonomy_status = 'active'
      AND JSON_LENGTH(source_evidence) = 1
      AND JSON_UNQUOTE(JSON_EXTRACT(source_evidence, '$.authority')) = 'migration-047-reviewed-taxonomy-v1'
  )
);
SET @abbott_taxonomy_v1_actual_count := (
  SELECT COUNT(*)
  FROM portal_content_taxonomy_terms
  WHERE taxonomy_version_id = @abbott_taxonomy_v1_id
);
SET @abbott_taxonomy_v1_expected_count := (
  SELECT COUNT(*) FROM abbott_expected_taxonomy_v1_terms
);
SET @abbott_taxonomy_v1_mismatched_count := (
  SELECT COUNT(*)
  FROM portal_content_taxonomy_terms AS actual
  LEFT JOIN abbott_expected_taxonomy_v1_terms AS expected
    ON expected.taxonomy_kind = actual.taxonomy_kind
   AND expected.term_code = actual.term_code
  WHERE actual.taxonomy_version_id = @abbott_taxonomy_v1_id
    AND (
      expected.term_code IS NULL
      OR actual.term_label <> expected.term_label
      OR actual.term_status <> expected.term_status
      OR NOT (
        JSON_LENGTH(actual.source_evidence) = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(actual.source_evidence, '$.authority'))
            <=> JSON_UNQUOTE(JSON_EXTRACT(expected.source_evidence, '$.authority'))
      )
    )
);
SET @abbott_taxonomy_v1_missing_count := (
  SELECT COUNT(*)
  FROM abbott_expected_taxonomy_v1_terms AS expected
  LEFT JOIN portal_content_taxonomy_terms AS actual
    ON actual.taxonomy_version_id = @abbott_taxonomy_v1_id
   AND actual.taxonomy_kind = expected.taxonomy_kind
   AND actual.term_code = expected.term_code
  WHERE actual.id IS NULL
);
SET @abbott_taxonomy_v1_existing_exact := (
  @abbott_taxonomy_v1_version_exact = 1
  AND @abbott_taxonomy_v1_actual_count = @abbott_taxonomy_v1_expected_count
  AND @abbott_taxonomy_v1_mismatched_count = 0
  AND @abbott_taxonomy_v1_missing_count = 0
);

-- Legacy diagnostic: ABBOTT_TAXONOMY_V1_ATTESTATION_FAILED.
DROP TEMPORARY TABLE IF EXISTS abbott_taxonomy_v1_guard;
CREATE TEMPORARY TABLE abbott_taxonomy_v1_guard (
  attestation_ok TINYINT NOT NULL,
  seed_ok TINYINT NOT NULL,
  CONSTRAINT ABBOTT_M047_TAXONOMY_ATTEST_FAIL CHECK (attestation_ok = 1),
  CONSTRAINT ABBOTT_M047_TAXONOMY_SEED_FAIL CHECK (seed_ok = 1)
);
INSERT INTO abbott_taxonomy_v1_guard (attestation_ok, seed_ok) VALUES (
  IF(
    @abbott_taxonomy_v1_preexisting = 0 OR @abbott_taxonomy_v1_existing_exact = 1,
    1,
    0
  ),
  1
);

INSERT INTO portal_content_taxonomy_versions (
  dataset_key, version, taxonomy_digest, taxonomy_status, source_evidence, activated_at
)
SELECT
  'abbott', 'abbott.v1',
  'd6a2bfc39d970a873e309223604f9ae7c37cd83d6c046c107eed08e73ec435d4',
  'active', JSON_OBJECT('authority', 'migration-047-reviewed-taxonomy-v1'),
  CURRENT_TIMESTAMP(6)
WHERE @abbott_taxonomy_v1_preexisting = 0;

SET @abbott_taxonomy_v1_id := (
  SELECT id
  FROM portal_content_taxonomy_versions
  WHERE dataset_key = 'abbott' AND version = 'abbott.v1'
);

INSERT INTO portal_content_taxonomy_terms (
  taxonomy_version_id, taxonomy_kind, term_code, term_label, term_status, source_evidence
)
SELECT
  @abbott_taxonomy_v1_id, taxonomy_kind, term_code, term_label, term_status,
  source_evidence
FROM abbott_expected_taxonomy_v1_terms
WHERE @abbott_taxonomy_v1_preexisting = 0
ORDER BY taxonomy_kind, term_code;

SET @abbott_taxonomy_v1_final_count := (
  SELECT COUNT(*)
  FROM portal_content_taxonomy_terms
  WHERE taxonomy_version_id = @abbott_taxonomy_v1_id
);
DELETE FROM abbott_taxonomy_v1_guard;
INSERT INTO abbott_taxonomy_v1_guard (attestation_ok, seed_ok) VALUES (
  1,
  IF(
    @abbott_taxonomy_v1_id IS NOT NULL
      AND @abbott_taxonomy_v1_final_count = @abbott_taxonomy_v1_expected_count,
    1,
    0
  )
);

DROP TEMPORARY TABLE abbott_taxonomy_v1_guard;
DROP TEMPORARY TABLE abbott_expected_taxonomy_v1_terms;

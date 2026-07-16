CREATE TABLE IF NOT EXISTS portal_data_releases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dataset_key VARCHAR(128) NOT NULL,
  release_key VARCHAR(128) NOT NULL,
  source_snapshot_ids JSON NOT NULL,
  canonical_version_id VARCHAR(128) NOT NULL,
  baseline_validation_run_id BIGINT UNSIGNED DEFAULT NULL,
  code_revision VARCHAR(64) NOT NULL,
  release_status ENUM('staging', 'validated', 'active', 'retired', 'failed') NOT NULL DEFAULT 'staging',
  activated_at DATETIME DEFAULT NULL,
  activated_by VARCHAR(255) DEFAULT NULL,
  rollback_from_release_id BIGINT UNSIGNED DEFAULT NULL,
  rollback_reason VARCHAR(1000) DEFAULT NULL,
  retired_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_portal_release_key (dataset_key, release_key),
  UNIQUE KEY uniq_portal_release_dataset_id (dataset_key, id),
  KEY idx_portal_release_status (dataset_key, release_status),
  KEY idx_portal_release_validation (baseline_validation_run_id),
  KEY idx_portal_release_rollback (dataset_key, rollback_from_release_id),
  CONSTRAINT fk_portal_release_rollback
    FOREIGN KEY (dataset_key, rollback_from_release_id)
      REFERENCES portal_data_releases(dataset_key, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable candidate releases and activation audit metadata';

CREATE TABLE IF NOT EXISTS portal_active_data_releases (
  dataset_key VARCHAR(128) NOT NULL,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  previous_release_id BIGINT UNSIGNED DEFAULT NULL,
  switched_at DATETIME NOT NULL,
  switched_by VARCHAR(255) NOT NULL,
  switch_reason VARCHAR(1000) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (dataset_key),
  UNIQUE KEY uniq_active_release_id (canonical_release_id),
  KEY idx_active_release_dataset (dataset_key, canonical_release_id),
  KEY idx_active_previous_release (dataset_key, previous_release_id),
  CONSTRAINT fk_active_canonical_release
    FOREIGN KEY (dataset_key, canonical_release_id)
      REFERENCES portal_data_releases(dataset_key, id),
  CONSTRAINT fk_active_previous_release
    FOREIGN KEY (dataset_key, previous_release_id)
      REFERENCES portal_data_releases(dataset_key, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Atomic dataset pointer shared by protected and aggregate read models';

CREATE TABLE IF NOT EXISTS portal_dataset_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_key VARCHAR(128) NOT NULL,
  dataset_key VARCHAR(128) NOT NULL,
  source_kind VARCHAR(64) NOT NULL,
  source_locator VARCHAR(1000) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  content_bytes BIGINT UNSIGNED NOT NULL,
  source_generated_at DATETIME DEFAULT NULL,
  period_min_date DATE DEFAULT NULL,
  period_max_date DATE DEFAULT NULL,
  source_row_count BIGINT UNSIGNED NOT NULL,
  parser_version VARCHAR(128) NOT NULL,
  import_status ENUM('registered', 'importing', 'imported', 'rejected') NOT NULL DEFAULT 'registered',
  imported_row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rejected_row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  private_archive_locator VARCHAR(1000) NOT NULL,
  manifest_json JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_dataset_snapshot_key (snapshot_key),
  UNIQUE KEY uniq_dataset_snapshot_content (dataset_key, source_kind, content_sha256),
  KEY idx_dataset_snapshot_period (dataset_key, period_min_date, period_max_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable source and pre-backfill snapshot registry';

CREATE TABLE IF NOT EXISTS portal_migration_validation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  baseline_snapshot_id BIGINT UNSIGNED NOT NULL,
  candidate_snapshot_id BIGINT UNSIGNED DEFAULT NULL,
  candidate_run_id BIGINT UNSIGNED DEFAULT NULL,
  code_revision VARCHAR(64) NOT NULL,
  control_name VARCHAR(255) NOT NULL,
  expected_value DECIMAL(30,10) DEFAULT NULL,
  actual_value DECIMAL(30,10) DEFAULT NULL,
  absolute_delta DECIMAL(30,10) DEFAULT NULL,
  relative_delta DECIMAL(30,10) DEFAULT NULL,
  threshold_value DECIMAL(30,10) DEFAULT NULL,
  result_status ENUM('pass', 'warn', 'fail') NOT NULL,
  diagnostic_json JSON DEFAULT NULL,
  reviewed_by VARCHAR(255) DEFAULT NULL,
  accepted_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_release_validation_control
    (canonical_release_id, baseline_snapshot_id, control_name),
  KEY idx_validation_result (canonical_release_id, result_status),
  KEY idx_validation_candidate_snapshot (candidate_snapshot_id),
  CONSTRAINT fk_validation_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_validation_baseline_snapshot
    FOREIGN KEY (baseline_snapshot_id) REFERENCES portal_dataset_snapshots(id),
  CONSTRAINT fk_validation_candidate_snapshot
    FOREIGN KEY (candidate_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Sanitized before-and-after migration control results';

CREATE TABLE IF NOT EXISTS portal_content_catalog (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  normalized_url TEXT DEFAULT NULL,
  normalized_url_hash CHAR(64) DEFAULT NULL,
  normalized_path TEXT DEFAULT NULL,
  page_title VARCHAR(1000) NOT NULL,
  material_id VARCHAR(255) DEFAULT NULL,
  material_type VARCHAR(128) DEFAULT NULL,
  source_slug VARCHAR(1000) DEFAULT NULL,
  source_slug_hash CHAR(64) DEFAULT NULL,
  access_label VARCHAR(500) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  source_row_fingerprint CHAR(64) NOT NULL,
  section_key VARCHAR(255) DEFAULT NULL,
  direction_key VARCHAR(255) DEFAULT NULL,
  published_at DATETIME DEFAULT NULL,
  valid_from DATETIME NOT NULL,
  valid_to DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_content_release_source_row
    (canonical_release_id, source_snapshot_id, source_row_fingerprint),
  KEY idx_content_release_url
    (canonical_release_id, source_snapshot_id, normalized_url_hash),
  KEY idx_content_release_title_type
    (canonical_release_id, page_title(191), material_type),
  KEY idx_content_release_slug
    (canonical_release_id, source_slug_hash),
  KEY idx_content_material (canonical_release_id, material_id),
  KEY idx_content_snapshot (source_snapshot_id),
  CONSTRAINT fk_content_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_content_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Source-faithful release-scoped portal content and lookup catalog';

CREATE TABLE IF NOT EXISTS portal_general_materials (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  material_key VARCHAR(255) NOT NULL,
  material_title VARCHAR(1000) NOT NULL,
  material_type VARCHAR(128) DEFAULT NULL,
  normalized_url TEXT DEFAULT NULL,
  normalized_url_hash CHAR(64) DEFAULT NULL,
  normalized_path TEXT DEFAULT NULL,
  normalized_path_hash CHAR(64) DEFAULT NULL,
  direction_key VARCHAR(255) DEFAULT NULL,
  published_at DATETIME DEFAULT NULL,
  metadata_json JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_general_material_release
    (canonical_release_id, source_snapshot_id, material_key),
  KEY idx_general_material_url
    (canonical_release_id, normalized_url_hash),
  KEY idx_general_material_direction (canonical_release_id, direction_key),
  CONSTRAINT fk_general_material_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_general_material_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Release-scoped non-identifying portal material metadata';

CREATE TABLE IF NOT EXISTS portal_event_catalog (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  event_title VARCHAR(1000) NOT NULL,
  direction_key VARCHAR(500) DEFAULT NULL,
  registration_url TEXT DEFAULT NULL,
  registration_url_hash CHAR(64) DEFAULT NULL,
  access_label VARCHAR(500) DEFAULT NULL,
  source_row_fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_event_catalog_source_row
    (canonical_release_id, source_snapshot_id, source_row_fingerprint),
  KEY idx_event_catalog_title
    (canonical_release_id, event_title(191)),
  KEY idx_event_catalog_direction
    (canonical_release_id, direction_key),
  KEY idx_event_catalog_registration
    (canonical_release_id, registration_url_hash),
  CONSTRAINT fk_event_catalog_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_event_catalog_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Source-faithful workbook registration-event catalog';

CREATE TABLE IF NOT EXISTS portal_external_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(64) NOT NULL,
  analytics_account_id VARCHAR(128) NOT NULL,
  report_date DATE NOT NULL,
  occurred_at DATETIME DEFAULT NULL,
  normalized_path TEXT NOT NULL,
  normalized_path_hash CHAR(64) NOT NULL,
  event_kind VARCHAR(128) NOT NULL,
  source_name VARCHAR(255) DEFAULT NULL,
  campaign_name VARCHAR(500) DEFAULT NULL,
  source_row_fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_external_release_event
    (canonical_release_id, source_key, analytics_account_id, report_date, source_row_fingerprint),
  KEY idx_external_event_path (canonical_release_id, report_date, normalized_path_hash),
  KEY idx_external_event_snapshot (source_snapshot_id),
  CONSTRAINT fk_external_event_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_external_event_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Release-scoped aggregate-safe external portal events';

CREATE TABLE IF NOT EXISTS portal_bitrix_page_facts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  analytics_account_id VARCHAR(128) NOT NULL DEFAULT 'abbott_bitrix',
  report_date DATE NOT NULL,
  normalized_path TEXT NOT NULL,
  normalized_path_hash CHAR(64) NOT NULL,
  material_id VARCHAR(255) DEFAULT NULL,
  material_type_hint VARCHAR(500) DEFAULT NULL,
  pageviews BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  users BIGINT UNSIGNED NOT NULL DEFAULT 0,
  guests BIGINT UNSIGNED NOT NULL DEFAULT 0,
  logged_in_hits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  anonymous_hits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  logged_in_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  anonymous_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  entry_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  exit_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  avg_session_duration_seconds DECIMAL(18,6) DEFAULT NULL,
  top_utm_source VARCHAR(500) DEFAULT NULL,
  top_utm_medium VARCHAR(500) DEFAULT NULL,
  top_utm_campaign VARCHAR(500) DEFAULT NULL,
  source_row_fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_bitrix_page_release_row
    (canonical_release_id, source_snapshot_id, analytics_account_id,
     report_date, source_row_fingerprint),
  KEY idx_bitrix_page_snapshot (source_snapshot_id),
  KEY idx_bitrix_page_path
    (canonical_release_id, report_date, normalized_path_hash),
  CONSTRAINT fk_bitrix_page_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_bitrix_page_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Aggregate-safe release-scoped Bitrix page facts';

CREATE TABLE IF NOT EXISTS portal_bitrix_journey_transitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  analytics_account_id VARCHAR(128) NOT NULL DEFAULT 'abbott_bitrix',
  report_date DATE NOT NULL,
  from_path TEXT NOT NULL,
  from_path_hash CHAR(64) NOT NULL,
  to_path TEXT NOT NULL,
  to_path_hash CHAR(64) NOT NULL,
  transition_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_bitrix_transition_release
    (canonical_release_id, source_snapshot_id, analytics_account_id,
     report_date, from_path_hash, to_path_hash),
  KEY idx_bitrix_transition_from
    (canonical_release_id, report_date, from_path_hash),
  KEY idx_bitrix_transition_to
    (canonical_release_id, report_date, to_path_hash),
  CONSTRAINT fk_bitrix_transition_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_bitrix_transition_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Aggregate-only Bitrix journey transitions safe for ordinary charts';

CREATE TABLE IF NOT EXISTS canonical_fact_metrika_site_analytics_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_metrika',
  analytics_account_id VARCHAR(128) NOT NULL,
  counter_id BIGINT UNSIGNED NOT NULL,
  report_date DATE NOT NULL,
  analytics_scope ENUM('other', 'traffic', 'page') NOT NULL,
  scope_hash CHAR(64) NOT NULL,
  scope_dimensions JSON NOT NULL,
  sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  users BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pageviews BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bounce_rate DECIMAL(18,8) DEFAULT NULL,
  average_session_seconds DECIMAL(18,6) DEFAULT NULL,
  goal_conversions BIGINT UNSIGNED DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  ingestion_run_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_site_release_scope
    (canonical_release_id, source_key, analytics_account_id, report_date, analytics_scope, scope_hash),
  KEY idx_site_release_counter_date (canonical_release_id, counter_id, report_date),
  KEY idx_site_release_run (ingestion_run_id),
  CONSTRAINT fk_site_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Release-scoped Metrika site analytics facts';

CREATE TABLE IF NOT EXISTS canonical_fact_metrika_returning_pages_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  counter_id BIGINT UNSIGNED NOT NULL,
  report_date DATE NOT NULL,
  raw_page_value TEXT NOT NULL,
  raw_page_hash CHAR(64) NOT NULL,
  normalized_page TEXT NOT NULL,
  normalized_page_hash CHAR(64) NOT NULL,
  return_bucket_code VARCHAR(128) NOT NULL,
  return_bucket_label VARCHAR(500) DEFAULT NULL,
  source_percentage DECIMAL(20,10) NOT NULL,
  source_denominator BIGINT UNSIGNED DEFAULT NULL,
  derived_count BIGINT UNSIGNED DEFAULT NULL,
  is_derived TINYINT(1) NOT NULL DEFAULT 0,
  request_fingerprint CHAR(64) NOT NULL,
  ingestion_run_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_returning_release_page_bucket
    (canonical_release_id, counter_id, report_date, raw_page_hash, return_bucket_code),
  KEY idx_returning_release_page (canonical_release_id, counter_id, report_date, normalized_page_hash),
  KEY idx_returning_release_run (ingestion_run_id),
  CONSTRAINT fk_returning_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Counter-scoped Metrika returning-page facts with source precision';

CREATE TABLE IF NOT EXISTS canonical_source_coverage_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(64) NOT NULL,
  counter_id BIGINT UNSIGNED NOT NULL,
  scope_key ENUM('other', 'traffic', 'page', 'user_behavior', 'returning') NOT NULL,
  report_date DATE NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  collection_status ENUM('success', 'success_empty', 'partial', 'skipped', 'sampled', 'failed') NOT NULL,
  api_total_rows BIGINT UNSIGNED DEFAULT NULL,
  persisted_rows BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pagination_complete TINYINT(1) NOT NULL DEFAULT 0,
  is_sampled TINYINT(1) NOT NULL DEFAULT 0,
  empty_reconciled TINYINT(1) NOT NULL DEFAULT 0,
  collector_run_id BIGINT UNSIGNED NOT NULL,
  failure_code VARCHAR(128) DEFAULT NULL,
  sanitized_failure_json JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_release_coverage
    (canonical_release_id, source_key, counter_id, scope_key, report_date),
  KEY idx_release_coverage_gate (canonical_release_id, counter_id, report_date, collection_status),
  KEY idx_release_coverage_run (collector_run_id),
  CONSTRAINT fk_coverage_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Closed-status daily source coverage used by release activation gates';

-- Task 7 compatibility upgrade. Migration 033 was introduced in Task 1 and
-- may already have created these tables, so the definitions above are
-- followed by guarded ALTERs. Every statement resolves to a harmless
-- SELECT when the target already has the Task 7 shape.

SET @abbott_snapshot_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_dataset_snapshots'
    AND INDEX_NAME = 'uniq_dataset_snapshot_content'
);
SET @sql := IF(
  @abbott_snapshot_index_columns IS NOT NULL
    AND @abbott_snapshot_index_columns <> 'dataset_key,source_kind,content_sha256',
  'ALTER TABLE portal_dataset_snapshots DROP INDEX uniq_dataset_snapshot_content',
  'SELECT ''portal_dataset_snapshots checksum index does not need removal'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_snapshot_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_dataset_snapshots'
    AND INDEX_NAME = 'uniq_dataset_snapshot_content'
);
SET @sql := IF(
  COALESCE(@abbott_snapshot_index_columns, '') <> 'dataset_key,source_kind,content_sha256',
  'ALTER TABLE portal_dataset_snapshots ADD UNIQUE INDEX uniq_dataset_snapshot_content (dataset_key, source_kind, content_sha256)',
  'SELECT ''portal_dataset_snapshots checksum index already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'source_slug'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN source_slug VARCHAR(1000) DEFAULT NULL',
  'SELECT ''portal_content_catalog.source_slug already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'source_slug_hash'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN source_slug_hash CHAR(64) DEFAULT NULL',
  'SELECT ''portal_content_catalog.source_slug_hash already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'access_label'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN access_label VARCHAR(500) DEFAULT NULL',
  'SELECT ''portal_content_catalog.access_label already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'is_active'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT ''portal_content_catalog.is_active already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'source_row_fingerprint'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_content_catalog ADD COLUMN source_row_fingerprint CHAR(64) DEFAULT NULL',
  'SELECT ''portal_content_catalog.source_row_fingerprint already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE portal_content_catalog
SET source_row_fingerprint = SHA2(CONCAT('legacy-task1-row:', id), 256)
WHERE source_row_fingerprint IS NULL;

SET @abbott_column_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'source_row_fingerprint'
);
SET @sql := IF(
  @abbott_column_nullable = 'YES',
  'ALTER TABLE portal_content_catalog MODIFY COLUMN source_row_fingerprint CHAR(64) NOT NULL',
  'SELECT ''portal_content_catalog.source_row_fingerprint already required'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_content_nullable_columns := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME IN ('normalized_url', 'normalized_url_hash', 'normalized_path')
    AND IS_NULLABLE = 'NO'
);
SET @sql := IF(
  @abbott_content_nullable_columns > 0,
  'ALTER TABLE portal_content_catalog MODIFY COLUMN normalized_url TEXT DEFAULT NULL, MODIFY COLUMN normalized_url_hash CHAR(64) DEFAULT NULL, MODIFY COLUMN normalized_path TEXT DEFAULT NULL',
  'SELECT ''portal_content_catalog optional locators already nullable'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE portal_content_catalog SET page_title = '' WHERE page_title IS NULL;
SET @abbott_column_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND COLUMN_NAME = 'page_title'
);
SET @sql := IF(
  @abbott_column_nullable = 'YES',
  'ALTER TABLE portal_content_catalog MODIFY COLUMN page_title VARCHAR(1000) NOT NULL',
  'SELECT ''portal_content_catalog.page_title already required'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND INDEX_NAME = 'uniq_content_release_url'
);
SET @sql := IF(
  @abbott_index_exists > 0,
  'ALTER TABLE portal_content_catalog DROP INDEX uniq_content_release_url',
  'SELECT ''portal_content_catalog legacy URL uniqueness already removed'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND INDEX_NAME = 'uniq_content_release_source_row'
);
SET @sql := IF(
  @abbott_index_exists = 0,
  'ALTER TABLE portal_content_catalog ADD UNIQUE INDEX uniq_content_release_source_row (canonical_release_id, source_snapshot_id, source_row_fingerprint)',
  'SELECT ''portal_content_catalog source-row uniqueness already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND INDEX_NAME = 'idx_content_release_url'
);
SET @sql := IF(
  @abbott_index_exists = 0,
  'ALTER TABLE portal_content_catalog ADD INDEX idx_content_release_url (canonical_release_id, source_snapshot_id, normalized_url_hash)',
  'SELECT ''portal_content_catalog URL index already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND INDEX_NAME = 'idx_content_release_title_type'
);
SET @sql := IF(
  @abbott_index_exists = 0,
  'ALTER TABLE portal_content_catalog ADD INDEX idx_content_release_title_type (canonical_release_id, page_title(191), material_type)',
  'SELECT ''portal_content_catalog title/type index already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_content_catalog'
    AND INDEX_NAME = 'idx_content_release_slug'
);
SET @sql := IF(
  @abbott_index_exists = 0,
  'ALTER TABLE portal_content_catalog ADD INDEX idx_content_release_slug (canonical_release_id, source_slug_hash)',
  'SELECT ''portal_content_catalog slug index already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_general_materials'
    AND COLUMN_NAME = 'normalized_url'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_general_materials ADD COLUMN normalized_url TEXT DEFAULT NULL',
  'SELECT ''portal_general_materials.normalized_url already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_general_materials'
    AND COLUMN_NAME = 'normalized_url_hash'
);
SET @sql := IF(
  @abbott_column_exists = 0,
  'ALTER TABLE portal_general_materials ADD COLUMN normalized_url_hash CHAR(64) DEFAULT NULL',
  'SELECT ''portal_general_materials.normalized_url_hash already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_general_materials'
    AND INDEX_NAME = 'idx_general_material_url'
);
SET @sql := IF(
  @abbott_index_exists = 0,
  'ALTER TABLE portal_general_materials ADD INDEX idx_general_material_url (canonical_release_id, normalized_url_hash)',
  'SELECT ''portal_general_materials URL index already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

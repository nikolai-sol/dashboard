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
  UNIQUE KEY uniq_dataset_snapshot_content (dataset_key, content_sha256),
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
  normalized_url TEXT NOT NULL,
  normalized_url_hash CHAR(64) NOT NULL,
  normalized_path TEXT NOT NULL,
  page_title VARCHAR(1000) DEFAULT NULL,
  material_id VARCHAR(255) DEFAULT NULL,
  material_type VARCHAR(128) DEFAULT NULL,
  section_key VARCHAR(255) DEFAULT NULL,
  direction_key VARCHAR(255) DEFAULT NULL,
  published_at DATETIME DEFAULT NULL,
  valid_from DATETIME NOT NULL,
  valid_to DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_content_release_url
    (canonical_release_id, source_snapshot_id, normalized_url_hash),
  KEY idx_content_material (canonical_release_id, material_id),
  KEY idx_content_snapshot (source_snapshot_id),
  CONSTRAINT fk_content_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_content_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Release-scoped normalized portal URL and material dictionary';

CREATE TABLE IF NOT EXISTS portal_general_materials (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  material_key VARCHAR(255) NOT NULL,
  material_title VARCHAR(1000) NOT NULL,
  material_type VARCHAR(128) DEFAULT NULL,
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
  KEY idx_general_material_direction (canonical_release_id, direction_key),
  CONSTRAINT fk_general_material_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases(id),
  CONSTRAINT fk_general_material_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Release-scoped non-identifying portal material metadata';

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

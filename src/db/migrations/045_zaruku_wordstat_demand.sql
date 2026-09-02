CREATE TABLE IF NOT EXISTS canonical_wordstat_seed_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  analytics_account_id VARCHAR(128) NOT NULL,
  registry_version VARCHAR(64) NOT NULL,
  seed_hash CHAR(64) NOT NULL,
  normalized_phrase TEXT NOT NULL,
  phrase_text TEXT NOT NULL,
  topic VARCHAR(255) DEFAULT NULL,
  cluster VARCHAR(255) DEFAULT NULL,
  classification ENUM('medical', 'adjacent', 'irrelevant', 'unreviewed') NOT NULL DEFAULT 'unreviewed',
  review_status VARCHAR(64) NOT NULL DEFAULT 'pending',
  review_source VARCHAR(128) DEFAULT NULL,
  review_reason TEXT DEFAULT NULL,
  owner_name VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wordstat_seed_registry (
    analytics_account_id, registry_version, seed_hash
  ),
  KEY idx_wordstat_seed_registry_active (
    analytics_account_id, registry_version, is_active
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Versioned Wordstat seed registry at account and normalized phrase grain';

CREATE TABLE IF NOT EXISTS canonical_wordstat_query_classifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  analytics_account_id VARCHAR(128) NOT NULL,
  registry_version VARCHAR(64) NOT NULL,
  query_hash CHAR(64) NOT NULL,
  normalized_query TEXT NOT NULL,
  query_text TEXT NOT NULL,
  topic VARCHAR(255) DEFAULT NULL,
  cluster VARCHAR(255) DEFAULT NULL,
  classification ENUM('medical', 'adjacent', 'irrelevant', 'unreviewed') NOT NULL DEFAULT 'unreviewed',
  review_status VARCHAR(64) NOT NULL DEFAULT 'pending',
  review_source VARCHAR(128) DEFAULT NULL,
  review_reason TEXT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wordstat_query_classification (
    analytics_account_id, registry_version, query_hash
  ),
  KEY idx_wordstat_query_classification_review (
    analytics_account_id, registry_version, review_status, is_active
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Versioned reviewed classifications for normalized discovered Wordstat queries';

CREATE TABLE IF NOT EXISTS canonical_dim_wordstat_regions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  region_id BIGINT NOT NULL,
  region_name VARCHAR(255) NOT NULL,
  region_type VARCHAR(64) NOT NULL,
  parent_region_id BIGINT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wordstat_region (region_id),
  KEY idx_wordstat_region_parent (parent_region_id),
  KEY idx_wordstat_region_run (ingestion_run_id),
  CONSTRAINT fk_wordstat_region_run
    FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Wordstat region dictionary and hierarchy';

CREATE TABLE IF NOT EXISTS canonical_fact_wordstat_dynamics_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_wordstat',
  analytics_account_id VARCHAR(128) NOT NULL,
  registry_version VARCHAR(64) NOT NULL,
  seed_hash CHAR(64) NOT NULL,
  topic VARCHAR(255) DEFAULT NULL,
  cluster VARCHAR(255) DEFAULT NULL,
  report_date DATE NOT NULL,
  region_scope VARCHAR(255) NOT NULL,
  device_type VARCHAR(64) NOT NULL,
  count BIGINT NOT NULL,
  share DECIMAL(18,6) DEFAULT NULL,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wordstat_dynamics (
    analytics_account_id, registry_version, seed_hash, report_date, region_scope, device_type
  ),
  KEY idx_wordstat_dynamics_read (
    analytics_account_id, report_date, topic
  ),
  KEY idx_wordstat_dynamics_run (ingestion_run_id),
  CONSTRAINT fk_wordstat_dynamics_run
    FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Wordstat daily demand by account, registry seed, date, region scope, and device';

CREATE TABLE IF NOT EXISTS canonical_fact_wordstat_requests_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_wordstat',
  analytics_account_id VARCHAR(128) NOT NULL,
  registry_version VARCHAR(64) NOT NULL,
  snapshot_date DATE NOT NULL,
  window_from DATE NOT NULL,
  window_to DATE NOT NULL,
  seed_hash CHAR(64) NOT NULL,
  query_hash CHAR(64) NOT NULL,
  normalized_query TEXT NOT NULL,
  query_text TEXT NOT NULL,
  request_kind ENUM('popular', 'similar') NOT NULL,
  device_type VARCHAR(64) NOT NULL,
  topic VARCHAR(255) DEFAULT NULL,
  cluster VARCHAR(255) DEFAULT NULL,
  classification ENUM('medical', 'adjacent', 'irrelevant', 'unreviewed') NOT NULL DEFAULT 'unreviewed',
  count BIGINT NOT NULL,
  share DECIMAL(18,6) DEFAULT NULL,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wordstat_request_snapshot (
    analytics_account_id, snapshot_date, seed_hash, query_hash, request_kind, device_type
  ),
  KEY idx_wordstat_request_snapshot_read (
    analytics_account_id, snapshot_date, classification, request_kind
  ),
  KEY idx_wordstat_request_snapshot_run (ingestion_run_id),
  CONSTRAINT fk_wordstat_request_snapshot_run
    FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Wordstat rolling-window popular and similar request snapshots';

CREATE TABLE IF NOT EXISTS canonical_fact_wordstat_regions_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_wordstat',
  analytics_account_id VARCHAR(128) NOT NULL,
  registry_version VARCHAR(64) NOT NULL,
  snapshot_date DATE NOT NULL,
  window_from DATE NOT NULL,
  window_to DATE NOT NULL,
  seed_hash CHAR(64) NOT NULL,
  topic VARCHAR(255) DEFAULT NULL,
  cluster VARCHAR(255) DEFAULT NULL,
  region_id BIGINT NOT NULL,
  device_type VARCHAR(64) NOT NULL,
  count BIGINT NOT NULL,
  share DECIMAL(18,6) DEFAULT NULL,
  affinity_index DECIMAL(18,6) DEFAULT NULL,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wordstat_region_snapshot (
    analytics_account_id, snapshot_date, seed_hash, region_id, device_type
  ),
  KEY idx_wordstat_region_snapshot_read (
    analytics_account_id, snapshot_date, region_id
  ),
  KEY idx_wordstat_region_snapshot_run (ingestion_run_id),
  CONSTRAINT fk_wordstat_region_snapshot_run
    FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Wordstat rolling-window regional demand snapshots';

CREATE TABLE IF NOT EXISTS canonical_wordstat_coverage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_wordstat',
  analytics_account_id VARCHAR(128) NOT NULL,
  registry_version VARCHAR(64) NOT NULL,
  endpoint VARCHAR(128) NOT NULL,
  scope_hash CHAR(64) NOT NULL,
  requested_from DATE NOT NULL,
  requested_to DATE NOT NULL,
  status ENUM('success', 'success_empty') NOT NULL,
  returned_row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  persisted_row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wordstat_coverage (
    analytics_account_id, endpoint, scope_hash, requested_from, requested_to
  ),
  KEY idx_wordstat_coverage_read (
    analytics_account_id, endpoint, requested_from, requested_to
  ),
  KEY idx_wordstat_coverage_run (ingestion_run_id),
  CONSTRAINT fk_wordstat_coverage_run
    FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Successful Wordstat request coverage; failed requests exist only in collector lineage';

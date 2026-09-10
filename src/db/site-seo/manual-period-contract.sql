-- Additive shared storage for manually supplied period and snapshot SEO data.
-- Import scope fields are immutable application contract fields. Corrections
-- create a successor import; they never update an accepted import in place.

CREATE TABLE IF NOT EXISTS canonical_seo_manual_imports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_uid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dashboard_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  analytics_account_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_kind ENUM('iso_week', 'calendar_month', 'custom', 'snapshot') NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  period_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_timezone VARCHAR(64) NOT NULL,
  filters_json JSON NOT NULL,
  filters_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adapter_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_files_json JSON NOT NULL,
  source_files_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  exported_at DATETIME(6) NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('staged', 'published', 'failed', 'superseded') NOT NULL DEFAULT 'staged',
  predecessor_import_id BIGINT UNSIGNED NULL,
  owner_decision_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  failure_reason TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  published_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_manual_import_uid (import_uid),
  UNIQUE KEY uq_manual_import_file (
    client_id, site_id, dashboard_id, source_key, analytics_account_id, resource_id,
    period_kind, period_from, period_to, period_key, source_timezone,
    filters_hash, adapter_version, source_files_hash
  ),
  KEY ix_manual_import_scope_period (
    client_id, site_id, dashboard_id, source_key, analytics_account_id, resource_id,
    period_from, period_to, status
  ),
  CONSTRAINT fk_manual_import_predecessor
    FOREIGN KEY (predecessor_import_id)
    REFERENCES canonical_seo_manual_imports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_fact_gsc_manual_daily (
  import_id BIGINT UNSIGNED NOT NULL,
  report_date DATE NOT NULL,
  clicks DECIMAL(20,6) NOT NULL,
  impressions DECIMAL(20,6) NOT NULL,
  ctr_pct DECIMAL(12,8) NULL,
  average_position DECIMAL(12,6) NULL,
  PRIMARY KEY (import_id, report_date),
  UNIQUE KEY uq_manual_daily (import_id, report_date),
  CONSTRAINT fk_manual_daily_import FOREIGN KEY (import_id)
    REFERENCES canonical_seo_manual_imports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_fact_gsc_manual_period_dimensions (
  import_id BIGINT UNSIGNED NOT NULL,
  dimension_name ENUM('query', 'page', 'country', 'device', 'appearance') NOT NULL,
  dimension_value VARCHAR(512) NOT NULL,
  source_row_ordinal INT UNSIGNED NOT NULL,
  clicks DECIMAL(20,6) NOT NULL,
  impressions DECIMAL(20,6) NOT NULL,
  ctr_pct DECIMAL(12,8) NULL,
  average_position DECIMAL(12,6) NULL,
  PRIMARY KEY (import_id, dimension_name, dimension_value),
  UNIQUE KEY uq_manual_dimension (import_id, dimension_name, dimension_value),
  CONSTRAINT fk_manual_dimension_import FOREIGN KEY (import_id)
    REFERENCES canonical_seo_manual_imports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_fact_gsc_manual_indexing (
  import_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  reason VARCHAR(255) NOT NULL,
  affected_url_count BIGINT UNSIGNED NOT NULL,
  validation_state VARCHAR(64) NULL,
  PRIMARY KEY (import_id, snapshot_date, reason),
  CONSTRAINT fk_manual_indexing_import FOREIGN KEY (import_id)
    REFERENCES canonical_seo_manual_imports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_fact_gsc_manual_indexing_urls (
  import_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  reason VARCHAR(255) NOT NULL,
  page_url TEXT NOT NULL,
  page_url_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_row_ordinal INT UNSIGNED NOT NULL,
  PRIMARY KEY (import_id, snapshot_date, reason, page_url_hash),
  CONSTRAINT fk_manual_indexing_url_import FOREIGN KEY (import_id)
    REFERENCES canonical_seo_manual_imports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_seo_manual_coverage (
  import_id BIGINT UNSIGNED NOT NULL,
  layer_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coverage_state ENUM('missing', 'limited', 'complete_empty', 'complete') NOT NULL,
  row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  evidence_json JSON NOT NULL,
  publication_priority INT NOT NULL DEFAULT 0,
  publication_lock_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  publication_revision INT UNSIGNED NOT NULL,
  PRIMARY KEY (import_id, layer_name),
  UNIQUE KEY uq_manual_coverage (import_id, layer_name),
  UNIQUE KEY uq_manual_publication_lock (publication_lock_key, publication_revision),
  CONSTRAINT fk_manual_coverage_import FOREIGN KEY (import_id)
    REFERENCES canonical_seo_manual_imports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

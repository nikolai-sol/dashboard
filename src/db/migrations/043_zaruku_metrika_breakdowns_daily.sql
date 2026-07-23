CREATE TABLE IF NOT EXISTS canonical_fact_metrika_breakdowns_daily (
  id BIGINT NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL,
  analytics_account_id VARCHAR(128) NOT NULL,
  report_date DATE NOT NULL,
  report_key VARCHAR(64) NOT NULL,
  segment_key VARCHAR(64) NOT NULL DEFAULT 'russia',
  row_kind ENUM('detail', 'total') NOT NULL DEFAULT 'detail',
  dimension_1_key VARCHAR(64) DEFAULT NULL,
  dimension_1_id VARCHAR(255) DEFAULT NULL,
  dimension_1_value TEXT DEFAULT NULL,
  dimension_2_key VARCHAR(64) DEFAULT NULL,
  dimension_2_id VARCHAR(255) DEFAULT NULL,
  dimension_2_value TEXT DEFAULT NULL,
  page_url TEXT DEFAULT NULL,
  dimension_hash CHAR(64) NOT NULL,
  visits BIGINT DEFAULT NULL,
  users BIGINT DEFAULT NULL,
  new_users BIGINT DEFAULT NULL,
  pageviews BIGINT DEFAULT NULL,
  bounce_rate DECIMAL(18,6) DEFAULT NULL,
  avg_visit_duration_seconds DECIMAL(18,6) DEFAULT NULL,
  page_depth DECIMAL(18,6) DEFAULT NULL,
  ingestion_run_id BIGINT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_metrika_breakdown_daily (
    source_key,
    analytics_account_id,
    report_date,
    report_key,
    segment_key,
    row_kind,
    dimension_hash
  ),
  KEY idx_metrika_breakdown_read (
    analytics_account_id,
    report_key,
    segment_key,
    report_date
  ),
  KEY idx_metrika_breakdown_run (ingestion_run_id),
  CONSTRAINT fk_metrika_breakdown_run
    FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical Metrika breakdown facts; grain: account x day x report x segment x row kind x dimensions';

CREATE TABLE IF NOT EXISTS canonical_metrika_breakdown_coverage_daily (
  id BIGINT NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL,
  analytics_account_id VARCHAR(128) NOT NULL,
  report_date DATE NOT NULL,
  report_key VARCHAR(64) NOT NULL,
  segment_key VARCHAR(64) NOT NULL DEFAULT 'russia',
  status ENUM('success', 'empty') NOT NULL,
  api_total_rows BIGINT UNSIGNED NOT NULL DEFAULT 0,
  persisted_rows BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pagination_complete TINYINT(1) NOT NULL DEFAULT 0,
  ingestion_run_id BIGINT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_metrika_breakdown_coverage_daily (
    source_key,
    analytics_account_id,
    report_date,
    report_key,
    segment_key
  ),
  KEY idx_metrika_breakdown_coverage_read (
    analytics_account_id,
    report_key,
    segment_key,
    report_date
  ),
  KEY idx_metrika_breakdown_coverage_run (ingestion_run_id),
  CONSTRAINT fk_metrika_breakdown_coverage_run
    FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Successful or empty Metrika breakdown coverage at account x day x report x segment grain';

SET @site_scope_has_entry_page := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_site_analytics_daily'
    AND COLUMN_NAME = 'analytics_scope'
    AND COLUMN_TYPE LIKE '%''entry_page''%'
);
SET @sql := IF(
  @site_scope_has_entry_page = 0,
  'ALTER TABLE canonical_fact_site_analytics_daily MODIFY COLUMN analytics_scope ENUM(''traffic'', ''goal'', ''page'', ''params'', ''returned'', ''other'', ''entry_page'') NOT NULL DEFAULT ''traffic''',
  'SELECT ''canonical_fact_site_analytics_daily.analytics_scope already supports entry_page'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @site_scope_read_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_site_analytics_daily'
    AND INDEX_NAME = 'idx_site_analytics_scope_read'
);
SET @sql := IF(
  @site_scope_read_index_exists = 0,
  'ALTER TABLE canonical_fact_site_analytics_daily ADD KEY idx_site_analytics_scope_read (source_key, analytics_account_id, analytics_scope, report_date)',
  'SELECT ''idx_site_analytics_scope_read already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @gsc_country_date_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_fact_gsc_queries_daily'
    AND INDEX_NAME = 'idx_gsc_country_date'
);
SET @sql := IF(
  @gsc_country_date_index_exists = 0,
  'ALTER TABLE canonical_fact_gsc_queries_daily ADD KEY idx_gsc_country_date (analytics_account_id, country, report_date)',
  'SELECT ''idx_gsc_country_date already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

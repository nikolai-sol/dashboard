CREATE TABLE IF NOT EXISTS canonical_fact_gsc_queries_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'google_search_console',
  property_url VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  query_hash CHAR(64) NOT NULL,
  query_text TEXT NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr DECIMAL(18,6) DEFAULT NULL,
  average_position DECIMAL(18,6) DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_gsc_queries_daily (source_key, property_url, report_date, device_type, query_hash),
  KEY idx_gsc_queries_daily_property_date (property_url, report_date),
  KEY idx_gsc_queries_daily_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical Google Search Console query facts; grain: property x day x device x query';

CREATE TABLE IF NOT EXISTS canonical_fact_gsc_pages_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'google_search_console',
  property_url VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  page_hash CHAR(64) NOT NULL,
  page_url TEXT NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr DECIMAL(18,6) DEFAULT NULL,
  average_position DECIMAL(18,6) DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_gsc_pages_daily (source_key, property_url, report_date, device_type, page_hash),
  KEY idx_gsc_pages_daily_property_date (property_url, report_date),
  KEY idx_gsc_pages_daily_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical Google Search Console page facts; grain: property x day x device x page';

CREATE TABLE IF NOT EXISTS canonical_fact_gsc_summary_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'google_search_console',
  property_url VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr DECIMAL(18,6) DEFAULT NULL,
  average_position DECIMAL(18,6) DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_gsc_summary_daily (source_key, property_url, report_date, device_type),
  KEY idx_gsc_summary_daily_property_date (property_url, report_date),
  KEY idx_gsc_summary_daily_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical Google Search Console summary facts; grain: property x day x device';

CREATE TABLE IF NOT EXISTS canonical_fact_webmaster_query_pages_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_webmaster',
  analytics_account_id VARCHAR(128) NOT NULL,
  host_id VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  query_hash CHAR(64) NOT NULL,
  page_hash CHAR(64) NOT NULL,
  query_text TEXT NOT NULL,
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
  UNIQUE KEY uniq_webmaster_query_pages_daily (source_key, analytics_account_id, host_id, report_date, device_type, query_hash, page_hash),
  KEY idx_webmaster_query_pages_daily_account_date (analytics_account_id, report_date),
  KEY idx_webmaster_query_pages_daily_page_date (page_hash, report_date),
  KEY idx_webmaster_query_pages_daily_query_date (query_hash, report_date),
  KEY idx_webmaster_query_pages_daily_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical Yandex Webmaster exact query-page facts; grain: account x host x day x device x query x URL';

CREATE TABLE IF NOT EXISTS canonical_webmaster_query_page_coverage_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_webmaster',
  analytics_account_id VARCHAR(128) NOT NULL,
  host_id VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  page_hash CHAR(64) NOT NULL,
  page_url TEXT NOT NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_webmaster_query_page_coverage_daily (source_key, analytics_account_id, host_id, report_date, device_type, page_hash),
  KEY idx_webmaster_query_page_coverage_account_date (analytics_account_id, report_date),
  KEY idx_webmaster_query_page_coverage_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Successful Yandex Webmaster exact URL-filter coverage, including zero-row snapshots';

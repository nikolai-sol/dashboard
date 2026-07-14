CREATE TABLE IF NOT EXISTS canonical_fact_webmaster_queries_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_webmaster',
  analytics_account_id VARCHAR(128) NOT NULL,
  host_id VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  query_hash CHAR(64) NOT NULL,
  query_id VARCHAR(255) DEFAULT NULL,
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
  UNIQUE KEY uniq_webmaster_queries_daily (source_key, analytics_account_id, host_id, report_date, device_type, query_hash),
  KEY idx_webmaster_queries_daily_account_date (analytics_account_id, report_date),
  KEY idx_webmaster_queries_daily_host_date (host_id, report_date),
  KEY idx_webmaster_queries_daily_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical Yandex Webmaster query facts; grain: account x host x day x device x query';

CREATE TABLE IF NOT EXISTS canonical_fact_webmaster_summary_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_webmaster',
  analytics_account_id VARCHAR(128) NOT NULL,
  host_id VARCHAR(255) NOT NULL,
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
  UNIQUE KEY uniq_webmaster_summary_daily (source_key, analytics_account_id, host_id, report_date, device_type),
  KEY idx_webmaster_summary_daily_account_date (analytics_account_id, report_date),
  KEY idx_webmaster_summary_daily_host_date (host_id, report_date),
  KEY idx_webmaster_summary_daily_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical Yandex Webmaster host summary facts; grain: account x host x day x device';

ALTER TABLE seo_webmaster_queries_weekly COMMENT = 'DEPRECATED: use canonical_fact_webmaster_queries_daily aggregated by ISO week';
ALTER TABLE seo_webmaster_pages_weekly COMMENT = 'DEPRECATED: URL weekly facts are superseded for dashboard use; do not query from Zaruku panels';

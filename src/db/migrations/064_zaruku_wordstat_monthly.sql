-- Native closed calendar-month demand; daily facts and prior snapshots stay intact.
CREATE TABLE IF NOT EXISTS canonical_fact_wordstat_dynamics_monthly (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_wordstat',
  analytics_account_id VARCHAR(128) NOT NULL,
  registry_version VARCHAR(64) NOT NULL,
  seed_hash CHAR(64) NOT NULL,
  topic VARCHAR(255) DEFAULT NULL,
  cluster VARCHAR(255) DEFAULT NULL,
  month_from DATE NOT NULL,
  month_to DATE NOT NULL,
  region_scope VARCHAR(255) NOT NULL,
  device_type VARCHAR(64) NOT NULL,
  count BIGINT NOT NULL,
  share DECIMAL(18,6) DEFAULT NULL,
  ingestion_run_id BIGINT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wordstat_monthly (
    analytics_account_id, registry_version, seed_hash, month_from, month_to, region_scope, device_type
  ),
  KEY idx_wordstat_monthly_read (analytics_account_id, month_from, topic),
  KEY idx_wordstat_monthly_run (ingestion_run_id),
  CONSTRAINT chk_wordstat_monthly_count CHECK (count >= 0),
  CONSTRAINT fk_wordstat_monthly_run FOREIGN KEY (ingestion_run_id) REFERENCES canonical_collector_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Native Wordstat calendar-month demand, never daily expansion';

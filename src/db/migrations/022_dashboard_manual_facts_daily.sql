CREATE TABLE IF NOT EXISTS dashboard_manual_facts_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dashboard_id INT NOT NULL,
  manual_source_key VARCHAR(120) NOT NULL,
  report_date DATE NOT NULL,
  platform VARCHAR(64) NOT NULL,
  channel VARCHAR(255) NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  spend DECIMAL(18, 6) NOT NULL DEFAULT 0,
  views BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  reach BIGINT NOT NULL DEFAULT 0,
  sessions BIGINT NOT NULL DEFAULT 0,
  source_upload_name VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dashboard_manual_fact_grain (
    dashboard_id,
    manual_source_key,
    report_date,
    platform,
    channel
  ),
  KEY idx_dashboard_manual_facts_lookup (dashboard_id, manual_source_key, report_date),
  CONSTRAINT fk_dashboard_manual_facts_dashboard
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
);

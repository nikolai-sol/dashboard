CREATE TABLE IF NOT EXISTS media_plan_bindings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dashboard_id INT NOT NULL,
  channel VARCHAR(500) NOT NULL,
  source_key VARCHAR(50) NOT NULL,
  platform_campaign_id VARCHAR(200) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
  INDEX idx_dashboard_channel (dashboard_id, channel),
  UNIQUE KEY unique_binding (dashboard_id, channel, source_key, platform_campaign_id)
);

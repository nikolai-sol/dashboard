CREATE TABLE IF NOT EXISTS report_bd_private.portal_abbott_admin_user_exclusions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dashboard_id BIGINT UNSIGNED NOT NULL,
  raw_user_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_abbott_admin_dashboard_user (dashboard_id, raw_user_id),
  KEY idx_abbott_admin_dashboard (dashboard_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Manager-controlled Abbott User IDs excluded only by explicit dashboard filter';

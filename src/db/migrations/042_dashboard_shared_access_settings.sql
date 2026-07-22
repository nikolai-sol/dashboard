CREATE TABLE IF NOT EXISTS dashboard_shared_access_settings (
  dashboard_id INT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  credential_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (dashboard_id),
  CONSTRAINT fk_dashboard_shared_access_dashboard
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dashboard_access_users (
  id INT NOT NULL AUTO_INCREMENT,
  dashboard_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dashboard_access_users_dashboard_email (dashboard_id, email),
  KEY idx_dashboard_access_users_dashboard (dashboard_id),
  CONSTRAINT fk_dashboard_access_users_dashboard
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

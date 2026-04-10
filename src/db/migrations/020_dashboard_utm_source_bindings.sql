CREATE TABLE IF NOT EXISTS dashboard_utm_source_bindings (
    id INT NOT NULL AUTO_INCREMENT,
    dashboard_id INT NOT NULL,
    utm_source VARCHAR(255) NOT NULL,
    source_key VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_dashboard_utm_source_binding (dashboard_id, utm_source),
    KEY idx_dashboard_utm_source_binding_dashboard (dashboard_id),
    KEY idx_dashboard_utm_source_binding_source (source_key),
    CONSTRAINT fk_dashboard_utm_source_binding_dashboard
      FOREIGN KEY (dashboard_id) REFERENCES dashboards(id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

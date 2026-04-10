ALTER TABLE dashboard_utm_source_bindings
  MODIFY COLUMN source_key VARCHAR(64) NULL,
  ADD COLUMN line_key VARCHAR(500) NULL AFTER utm_source,
  ADD COLUMN channel VARCHAR(255) NULL AFTER line_key;

ALTER TABLE dashboard_utm_source_bindings
  ADD INDEX idx_dashboard_utm_source_binding_line_key (dashboard_id, line_key(191));

ALTER TABLE media_plan_bindings
  ADD COLUMN line_key VARCHAR(500) NULL AFTER dashboard_id;

UPDATE media_plan_bindings
SET line_key = channel
WHERE line_key IS NULL OR line_key = '';

ALTER TABLE media_plan_bindings
  ADD INDEX idx_dashboard_line_key (dashboard_id, line_key(191));

ALTER TABLE media_plan_bindings
  DROP INDEX unique_binding,
  ADD UNIQUE KEY unique_binding (dashboard_id, line_key(191), source_key, platform_campaign_id);

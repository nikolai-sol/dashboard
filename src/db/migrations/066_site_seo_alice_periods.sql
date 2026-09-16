-- Extend the existing Alice snapshot facts with their exact source period.
-- Historical monthly rows keep their reporting-month bucket and are backfilled
-- to the exact calendar month; no fact rows or period totals are replaced.

SET @alice_source_period_kind_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_alice_visibility_snapshots'
    AND COLUMN_NAME = 'source_period_kind'
);
SET @sql := IF(
  @alice_source_period_kind_exists = 0,
  'ALTER TABLE canonical_alice_visibility_snapshots ADD COLUMN source_period_kind ENUM(''calendar_month'', ''custom'') NULL AFTER period_month',
  'SELECT ''Alice source_period_kind already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @alice_source_period_from_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_alice_visibility_snapshots'
    AND COLUMN_NAME = 'source_period_from'
);
SET @sql := IF(
  @alice_source_period_from_exists = 0,
  'ALTER TABLE canonical_alice_visibility_snapshots ADD COLUMN source_period_from DATE NULL AFTER source_period_kind',
  'SELECT ''Alice source_period_from already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @alice_source_period_to_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_alice_visibility_snapshots'
    AND COLUMN_NAME = 'source_period_to'
);
SET @sql := IF(
  @alice_source_period_to_exists = 0,
  'ALTER TABLE canonical_alice_visibility_snapshots ADD COLUMN source_period_to DATE NULL AFTER source_period_from',
  'SELECT ''Alice source_period_to already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE canonical_alice_visibility_snapshots
SET source_period_kind = 'calendar_month',
    source_period_from = period_month,
    source_period_to = LAST_DAY(period_month)
WHERE source_period_kind IS NULL
   OR source_period_from IS NULL
   OR source_period_to IS NULL;

ALTER TABLE canonical_alice_visibility_snapshots
  MODIFY COLUMN source_period_kind ENUM('calendar_month', 'custom') NULL,
  MODIFY COLUMN source_period_from DATE NULL,
  MODIFY COLUMN source_period_to DATE NULL,
  MODIFY COLUMN official_sov_pct DECIMAL(7,4) NULL;

CREATE TABLE IF NOT EXISTS canonical_alice_visibility_sov_weekly (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  week_from DATE NOT NULL,
  week_to DATE NOT NULL,
  official_sov_pct DECIMAL(7,4) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_sov_weekly (snapshot_id, week_from, week_to),
  KEY idx_alice_sov_weekly_snapshot (snapshot_id, week_from),
  CONSTRAINT fk_alice_sov_weekly_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES canonical_alice_visibility_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

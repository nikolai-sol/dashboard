-- Current morning facts, independent of immutable epidemiology/Wordstat snapshots.
-- Apply separately after production approval; no changes to existing tables or data.
CREATE TABLE IF NOT EXISTS canonical_fact_lyzobact_weather_daily (
  centre_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  local_date DATE NOT NULL,
  status ENUM('valid','error') NOT NULL,
  temperature_c DOUBLE NULL,
  observed_at DATETIME NULL COMMENT 'OpenWeather dt in UTC',
  retrieved_at DATETIME NOT NULL COMMENT 'Actual collector retrieval time in UTC',
  error_code VARCHAR(40) CHARACTER SET ascii NULL,
  raw_sha256 CHAR(64) CHARACTER SET ascii NULL,
  PRIMARY KEY (centre_id,local_date),
  KEY idx_lyzobact_weather_date (local_date),
  CONSTRAINT chk_lyzobact_weather_value CHECK ((status='valid' AND temperature_c IS NOT NULL AND observed_at IS NOT NULL AND error_code IS NULL) OR (status='error' AND temperature_c IS NULL AND observed_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

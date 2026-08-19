-- Advertising-only scheduling and Telegram delivery state. These tables are
-- declarative and replay safe; applying this migration does not alter cron.

CREATE TABLE IF NOT EXISTS canonical_ad_source_schedule_policies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(64) NOT NULL,
  platform_account_id VARCHAR(128) NOT NULL,
  timezone_name VARCHAR(64) NOT NULL,
  expected_hour_local TINYINT UNSIGNED NOT NULL,
  source_delay_days TINYINT UNSIGNED NOT NULL DEFAULT 1,
  allowed_lag_days TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lookback_days TINYINT UNSIGNED NOT NULL DEFAULT 3,
  retry_limit TINYINT UNSIGNED NOT NULL DEFAULT 3,
  publication_mode ENUM('incremental','authoritative_snapshot') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_ad_schedule_account (source_key, platform_account_id),
  KEY idx_ad_schedule_source_hour (source_key, expected_hour_local),
  CONSTRAINT chk_ad_schedule_expected_hour CHECK (expected_hour_local <= 23),
  CONSTRAINT chk_ad_schedule_lookback CHECK (lookback_days > 0),
  CONSTRAINT fk_ad_schedule_source_account
    FOREIGN KEY (source_key, platform_account_id)
    REFERENCES canonical_source_accounts (source_key, platform_account_id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_ad_notification_deliveries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notification_key VARCHAR(255) NOT NULL,
  channel ENUM('telegram') NOT NULL,
  report_date DATE NOT NULL,
  status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  sent_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_ad_notification (notification_key, channel, report_date),
  KEY idx_ad_notification_status_date (status, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

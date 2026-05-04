-- Add cross-platform conversion value metric to canonical ads facts.
-- Google Ads stores this natively as metrics.conversions_value; other sources
-- can populate it when they expose equivalent conversion revenue/value.

SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'canonical_fact_ads_daily'
      AND COLUMN_NAME = 'conversion_value'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE canonical_fact_ads_daily ADD COLUMN conversion_value DECIMAL(18,6) DEFAULT NULL AFTER conversions',
    'SELECT ''canonical_fact_ads_daily.conversion_value already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

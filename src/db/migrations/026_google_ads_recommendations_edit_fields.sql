SET @db_name = DATABASE();

SET @exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'google_ads_negative_keyword_recommendations'
    AND column_name = 'original_suggested_negative_keyword'
);
SET @sql = IF(
  @exists = 0,
  'ALTER TABLE google_ads_negative_keyword_recommendations ADD COLUMN original_suggested_negative_keyword VARCHAR(255) NULL AFTER suggested_negative_keyword',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'google_ads_negative_keyword_recommendations'
    AND column_name = 'edited_by'
);
SET @sql = IF(
  @exists = 0,
  'ALTER TABLE google_ads_negative_keyword_recommendations ADD COLUMN edited_by VARCHAR(255) NULL AFTER review_note',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'google_ads_negative_keyword_recommendations'
    AND column_name = 'edited_at'
);
SET @sql = IF(
  @exists = 0,
  'ALTER TABLE google_ads_negative_keyword_recommendations ADD COLUMN edited_at TIMESTAMP NULL AFTER edited_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Keep content-level idempotency for uploads without rejecting an unchanged
-- Google Sheet fetched as a new daily snapshot. Every step is replay-safe.

SET @ad_import_upload_digest_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_ad_import_requests'
    AND COLUMN_NAME = 'upload_content_sha256'
);

SET @sql := IF(
  @ad_import_upload_digest_column_exists = 0,
  'ALTER TABLE canonical_ad_import_requests ADD COLUMN upload_content_sha256 CHAR(64) GENERATED ALWAYS AS (CASE WHEN transport = ''upload'' THEN content_sha256 ELSE NULL END) STORED AFTER content_sha256',
  'SELECT ''canonical_ad_import_requests upload digest column already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ad_import_upload_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_ad_import_requests'
    AND INDEX_NAME = 'uniq_ad_import_upload'
);

SET @ad_import_upload_index_non_unique := (
  SELECT MAX(NON_UNIQUE)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_ad_import_requests'
    AND INDEX_NAME = 'uniq_ad_import_upload'
);

SET @sql := IF(
  @ad_import_upload_index_columns IS NOT NULL AND (
    @ad_import_upload_index_columns <> 'advertiser_key,source_key,platform_account_id,upload_content_sha256,adapter_config_sha256'
    OR @ad_import_upload_index_non_unique <> 0
  ),
  'ALTER TABLE canonical_ad_import_requests DROP INDEX uniq_ad_import_upload',
  'SELECT ''canonical_ad_import_requests upload index needs no repair'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ad_import_upload_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_ad_import_requests'
    AND INDEX_NAME = 'uniq_ad_import_upload'
);

SET @sql := IF(
  @ad_import_upload_index_columns IS NULL,
  'ALTER TABLE canonical_ad_import_requests ADD UNIQUE KEY uniq_ad_import_upload (advertiser_key, source_key, platform_account_id, upload_content_sha256, adapter_config_sha256)',
  'SELECT ''canonical_ad_import_requests upload index already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

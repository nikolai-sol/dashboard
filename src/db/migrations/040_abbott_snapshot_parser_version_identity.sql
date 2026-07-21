-- Abbott source bytes can be reparsed by a reviewed successor parser without
-- mutating the earlier immutable snapshot or its release audit evidence.

SET @abbott_snapshot_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_dataset_snapshots'
    AND INDEX_NAME = 'uniq_dataset_snapshot_content'
);

SET @sql := IF(
  @abbott_snapshot_index_columns IS NOT NULL
    AND @abbott_snapshot_index_columns <> 'dataset_key,source_kind,content_sha256,parser_version',
  'ALTER TABLE portal_dataset_snapshots DROP INDEX uniq_dataset_snapshot_content',
  'SELECT ''portal_dataset_snapshots parser identity index does not need removal'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_snapshot_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'portal_dataset_snapshots'
    AND INDEX_NAME = 'uniq_dataset_snapshot_content'
);

SET @sql := IF(
  COALESCE(@abbott_snapshot_index_columns, '') <> 'dataset_key,source_kind,content_sha256,parser_version',
  'ALTER TABLE portal_dataset_snapshots ADD UNIQUE INDEX uniq_dataset_snapshot_content (dataset_key, source_kind, content_sha256, parser_version)',
  'SELECT ''portal_dataset_snapshots parser identity index already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

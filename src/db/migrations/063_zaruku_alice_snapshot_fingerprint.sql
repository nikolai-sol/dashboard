-- Allow an explicitly superseded metadata correction to retain the immutable
-- workbook checksum while keeping exact authoritative payloads idempotent.
-- Existing rows intentionally retain a NULL fingerprint; the importer compares
-- their stored metadata directly so the already-published August row remains
-- compatible without rewriting historical data.

SET @alice_snapshot_fingerprint_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_alice_visibility_snapshots'
    AND COLUMN_NAME = 'snapshot_fingerprint_sha256'
);

SET @sql := IF(
  @alice_snapshot_fingerprint_column_exists = 0,
  'ALTER TABLE canonical_alice_visibility_snapshots ADD COLUMN snapshot_fingerprint_sha256 CHAR(64) DEFAULT NULL AFTER source_sha256',
  'SELECT ''canonical_alice_visibility_snapshots fingerprint column already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @alice_snapshot_fingerprint_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_alice_visibility_snapshots'
    AND INDEX_NAME = 'uniq_alice_snapshot_fingerprint'
);

SET @alice_snapshot_fingerprint_index_non_unique := (
  SELECT MAX(NON_UNIQUE)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_alice_visibility_snapshots'
    AND INDEX_NAME = 'uniq_alice_snapshot_fingerprint'
);

-- Keep checksum uniqueness in place while repairing any partial/wrong-shaped
-- fingerprint index left by an interrupted or manually altered installation.
SET @sql := IF(
  @alice_snapshot_fingerprint_index_columns IS NOT NULL AND (
    @alice_snapshot_fingerprint_index_columns <> 'analytics_account_id,source_key,snapshot_fingerprint_sha256'
    OR @alice_snapshot_fingerprint_index_non_unique <> 0
  ),
  'ALTER TABLE canonical_alice_visibility_snapshots DROP INDEX uniq_alice_snapshot_fingerprint',
  'SELECT ''canonical_alice_visibility_snapshots fingerprint index needs no repair'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @alice_snapshot_fingerprint_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_alice_visibility_snapshots'
    AND INDEX_NAME = 'uniq_alice_snapshot_fingerprint'
);

SET @sql := IF(
  @alice_snapshot_fingerprint_index_columns IS NULL,
  'ALTER TABLE canonical_alice_visibility_snapshots ADD UNIQUE KEY uniq_alice_snapshot_fingerprint (analytics_account_id, source_key, snapshot_fingerprint_sha256)',
  'SELECT ''canonical_alice_visibility_snapshots fingerprint index already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Only retire the checksum guard after the replacement unique index exists.
SET @alice_snapshot_checksum_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'canonical_alice_visibility_snapshots'
    AND INDEX_NAME = 'uniq_alice_snapshot_checksum'
);

SET @sql := IF(
  @alice_snapshot_checksum_index_columns IS NOT NULL,
  'ALTER TABLE canonical_alice_visibility_snapshots DROP INDEX uniq_alice_snapshot_checksum',
  'SELECT ''canonical_alice_visibility_snapshots checksum index already absent'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

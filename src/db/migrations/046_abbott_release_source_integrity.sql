CREATE TABLE IF NOT EXISTS abbott_release_source_integrity_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB
  COMMENT='Sentinel used by Abbott release-integrity triggers to reject immutable mutations';

INSERT IGNORE INTO abbott_release_source_integrity_guard (guard_id) VALUES (1);

DROP TRIGGER IF EXISTS trg_abbott_release_source_ids_staging_only;
CREATE TRIGGER trg_abbott_release_source_ids_staging_only
BEFORE UPDATE ON portal_data_releases
FOR EACH ROW
INSERT INTO abbott_release_source_integrity_guard (guard_id)
SELECT 1
WHERE OLD.dataset_key = 'abbott'
  AND (OLD.release_status <> 'staging' OR NEW.release_status <> 'staging')
  AND NOT (NEW.source_snapshot_ids <=> OLD.source_snapshot_ids);

DROP TRIGGER IF EXISTS trg_abbott_release_receipt_insert_staging_only;
CREATE TRIGGER trg_abbott_release_receipt_insert_staging_only
BEFORE INSERT ON portal_release_source_imports
FOR EACH ROW
INSERT INTO abbott_release_source_integrity_guard (guard_id)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM portal_data_releases
  WHERE dataset_key = 'abbott'
    AND id = NEW.canonical_release_id
    AND release_status <> 'staging'
);

DROP TRIGGER IF EXISTS trg_abbott_release_receipt_update_staging_only;
CREATE TRIGGER trg_abbott_release_receipt_update_staging_only
BEFORE UPDATE ON portal_release_source_imports
FOR EACH ROW
INSERT INTO abbott_release_source_integrity_guard (guard_id)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM portal_data_releases
  WHERE dataset_key = 'abbott'
    AND id IN (OLD.canonical_release_id, NEW.canonical_release_id)
    AND release_status <> 'staging'
);

DROP TRIGGER IF EXISTS trg_abbott_release_receipt_delete_staging_only;
CREATE TRIGGER trg_abbott_release_receipt_delete_staging_only
BEFORE DELETE ON portal_release_source_imports
FOR EACH ROW
INSERT INTO abbott_release_source_integrity_guard (guard_id)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM portal_data_releases
  WHERE dataset_key = 'abbott'
    AND id = OLD.canonical_release_id
    AND release_status <> 'staging'
);

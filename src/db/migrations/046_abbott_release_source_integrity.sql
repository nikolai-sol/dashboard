DROP TRIGGER IF EXISTS trg_abbott_release_source_ids_staging_only;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_release_source_ids_staging_only
BEFORE UPDATE ON portal_data_releases
FOR EACH ROW
BEGIN
  IF (OLD.dataset_key = 'abbott' OR NEW.dataset_key = 'abbott') AND (
    (
      (
        (OLD.dataset_key = 'abbott' AND NEW.dataset_key <> 'abbott')
        OR (OLD.dataset_key <> 'abbott' AND NEW.dataset_key = 'abbott')
      )
      AND (OLD.release_status <> 'staging' OR NEW.release_status <> 'staging')
    )
    OR (
      OLD.dataset_key = 'abbott'
      AND OLD.release_status <> 'staging'
      AND NEW.release_status = 'staging'
    )
    OR (
      NOT (NEW.source_snapshot_ids <=> OLD.source_snapshot_ids)
      AND (OLD.release_status <> 'staging' OR NEW.release_status <> 'staging')
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Abbott release source IDs require staging';
  END IF;
END;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_release_receipt_insert_staging_only;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_release_receipt_insert_staging_only
BEFORE INSERT ON portal_release_source_imports
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM portal_data_releases
    WHERE dataset_key = 'abbott'
      AND id = NEW.canonical_release_id
      AND release_status <> 'staging'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Abbott release receipts require staging';
  END IF;
END;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_release_receipt_update_staging_only;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_release_receipt_update_staging_only
BEFORE UPDATE ON portal_release_source_imports
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM portal_data_releases
    WHERE dataset_key = 'abbott'
      AND id IN (OLD.canonical_release_id, NEW.canonical_release_id)
      AND release_status <> 'staging'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Abbott release receipts require staging';
  END IF;
END;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_release_receipt_delete_staging_only;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_release_receipt_delete_staging_only
BEFORE DELETE ON portal_release_source_imports
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM portal_data_releases
    WHERE dataset_key = 'abbott'
      AND id = OLD.canonical_release_id
      AND release_status <> 'staging'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Abbott release receipts require staging';
  END IF;
END;

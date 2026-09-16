-- Canonical, site-scoped target-intent catalogue.
--
-- Imports are immutable preview receipts. Versions and their rules are immutable
-- complete snapshots. Publications are immutable audit events; only the active
-- pointer changes when a reviewed version is published or restored.

CREATE TABLE IF NOT EXISTS site_seo_intent_imports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dashboard_id INT NOT NULL,
  import_uid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_transport ENUM('upload', 'google_sheet') NOT NULL,
  source_identity VARCHAR(512) NOT NULL,
  source_identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_filename VARCHAR(255) NULL,
  accepted_worksheet VARCHAR(255) NULL,
  protected_artifact_ref VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  validation_state ENUM('valid', 'invalid', 'failed') NOT NULL,
  validation_result_json JSON NOT NULL,
  rule_count INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  conflict_count INT UNSIGNED NOT NULL DEFAULT 0,
  imported_by VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_intent_import_scope (site_id, dashboard_id, id),
  UNIQUE KEY uq_intent_import_uid (site_id, dashboard_id, import_uid),
  UNIQUE KEY uq_intent_import_snapshot (site_id, dashboard_id, source_transport, source_identity_hash, content_sha256),
  KEY ix_intent_import_dashboard (dashboard_id),
  CONSTRAINT fk_intent_import_dashboard
    FOREIGN KEY (dashboard_id) REFERENCES dashboards (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_seo_intent_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dashboard_id INT NOT NULL,
  version_uid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  import_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(191) NOT NULL,
  rule_count INT UNSIGNED NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  version_comment TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  sealed_by VARCHAR(255) NULL,
  sealed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_intent_version_scope (site_id, dashboard_id, id),
  UNIQUE KEY uq_intent_version_import_identity (site_id, dashboard_id, id, import_id),
  UNIQUE KEY uq_intent_version_uid (site_id, dashboard_id, version_uid),
  KEY ix_intent_version_import (site_id, dashboard_id, import_id),
  CONSTRAINT fk_intent_version_import_scope
    FOREIGN KEY (site_id, dashboard_id, import_id)
    REFERENCES site_seo_intent_imports (site_id, dashboard_id, id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_seo_intent_rules (
  site_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dashboard_id INT NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  source_row_ordinal INT UNSIGNED NOT NULL,
  rule_key VARCHAR(512) NOT NULL,
  normalized_key VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  group_label VARCHAR(255) NULL,
  match_type ENUM('exact', 'phrase') NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (site_id, dashboard_id, version_id, source_row_ordinal),
  UNIQUE KEY uq_intent_rule_normalized (site_id, dashboard_id, version_id, normalized_key),
  CONSTRAINT fk_intent_rule_version_scope
    FOREIGN KEY (site_id, dashboard_id, version_id)
    REFERENCES site_seo_intent_versions (site_id, dashboard_id, id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_seo_intent_publications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dashboard_id INT NOT NULL,
  request_uid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  previous_version_id BIGINT UNSIGNED NULL,
  import_id BIGINT UNSIGNED NOT NULL,
  publication_kind ENUM('publish', 'restore') NOT NULL,
  published_by VARCHAR(255) NOT NULL,
  published_at DATETIME(6) NOT NULL,
  publication_comment TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_intent_publication_scope (site_id, dashboard_id, id),
  UNIQUE KEY uq_intent_publication_version (site_id, dashboard_id, id, version_id),
  UNIQUE KEY uq_intent_publication_request (site_id, dashboard_id, request_uid),
  KEY ix_intent_publication_version (site_id, dashboard_id, version_id),
  KEY ix_intent_publication_previous (site_id, dashboard_id, previous_version_id),
  KEY ix_intent_publication_import (site_id, dashboard_id, import_id),
  CONSTRAINT fk_intent_publication_version_scope
    FOREIGN KEY (site_id, dashboard_id, version_id, import_id)
    REFERENCES site_seo_intent_versions (site_id, dashboard_id, id, import_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_intent_publication_previous_scope
    FOREIGN KEY (site_id, dashboard_id, previous_version_id)
    REFERENCES site_seo_intent_versions (site_id, dashboard_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_intent_publication_import_scope
    FOREIGN KEY (site_id, dashboard_id, import_id)
    REFERENCES site_seo_intent_imports (site_id, dashboard_id, id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_seo_intent_active (
  site_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dashboard_id INT NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  publication_id BIGINT UNSIGNED NOT NULL,
  activated_by VARCHAR(255) NOT NULL,
  activated_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (site_id, dashboard_id),
  UNIQUE KEY uq_intent_active_publication (site_id, dashboard_id, publication_id),
  CONSTRAINT fk_intent_active_version_scope
    FOREIGN KEY (site_id, dashboard_id, version_id)
    REFERENCES site_seo_intent_versions (site_id, dashboard_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_intent_active_publication_scope
    FOREIGN KEY (site_id, dashboard_id, publication_id, version_id)
    REFERENCES site_seo_intent_publications (site_id, dashboard_id, id, version_id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_imports_immutable_update;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_imports_immutable_update
BEFORE UPDATE ON site_seo_intent_imports
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'site_seo_intent_imports rows are immutable';

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_imports_immutable_delete;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_imports_immutable_delete
BEFORE DELETE ON site_seo_intent_imports
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'site_seo_intent_imports rows are immutable';

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_versions_immutable_update;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_versions_immutable_update
BEFORE UPDATE ON site_seo_intent_versions
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.sealed_at IS NULL
    AND OLD.sealed_by IS NULL
    AND NEW.sealed_at IS NOT NULL
    AND NEW.sealed_by IS NOT NULL
    AND TRIM(NEW.sealed_by) <> ''
    AND NEW.id <=> OLD.id
    AND NEW.site_id <=> OLD.site_id
    AND NEW.dashboard_id <=> OLD.dashboard_id
    AND NEW.version_uid <=> OLD.version_uid
    AND NEW.import_id <=> OLD.import_id
    AND NEW.label <=> OLD.label
    AND NEW.rule_count <=> OLD.rule_count
    AND NEW.created_by <=> OLD.created_by
    AND NEW.version_comment <=> OLD.version_comment
    AND NEW.created_at <=> OLD.created_at
    AND NEW.rule_count = (
      SELECT COUNT(*)
      FROM site_seo_intent_rules AS rules
      WHERE rules.site_id = OLD.site_id
        AND rules.dashboard_id = OLD.dashboard_id
        AND rules.version_id = OLD.id
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'site_seo_intent_versions permit only one complete seal transition';
  END IF;
END;

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_versions_immutable_delete;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_versions_immutable_delete
BEFORE DELETE ON site_seo_intent_versions
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'site_seo_intent_versions rows are immutable';

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_rules_unsealed_insert;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_rules_unsealed_insert
BEFORE INSERT ON site_seo_intent_rules
FOR EACH ROW
BEGIN
  DECLARE unsealed_version_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET unsealed_version_id = NULL;

  SELECT id INTO unsealed_version_id
  FROM site_seo_intent_versions
  WHERE site_id = NEW.site_id
    AND dashboard_id = NEW.dashboard_id
    AND id = NEW.version_id
    AND sealed_at IS NULL
  FOR UPDATE;

  IF unsealed_version_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'target-intent rules require an existing unsealed version';
  END IF;
END;

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_rules_immutable_update;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_rules_immutable_update
BEFORE UPDATE ON site_seo_intent_rules
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'site_seo_intent_rules rows are immutable';

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_rules_immutable_delete;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_rules_immutable_delete
BEFORE DELETE ON site_seo_intent_rules
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'site_seo_intent_rules rows are immutable';

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_publications_sealed_insert;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_publications_sealed_insert
BEFORE INSERT ON site_seo_intent_publications
FOR EACH ROW
BEGIN
  DECLARE sealed_version_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET sealed_version_id = NULL;

  SELECT id INTO sealed_version_id
  FROM site_seo_intent_versions
  WHERE site_id = NEW.site_id
    AND dashboard_id = NEW.dashboard_id
    AND id = NEW.version_id
    AND import_id = NEW.import_id
    AND sealed_at IS NOT NULL
  FOR UPDATE;

  IF sealed_version_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'target-intent publication requires its sealed version';
  END IF;
END;

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_publications_immutable_update;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_publications_immutable_update
BEFORE UPDATE ON site_seo_intent_publications
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'site_seo_intent_publications rows are immutable';

-- @migration-statement-break
DROP TRIGGER IF EXISTS trg_site_seo_intent_publications_immutable_delete;
-- @migration-statement-break
CREATE TRIGGER trg_site_seo_intent_publications_immutable_delete
BEFORE DELETE ON site_seo_intent_publications
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'site_seo_intent_publications rows are immutable';
-- @migration-statement-break

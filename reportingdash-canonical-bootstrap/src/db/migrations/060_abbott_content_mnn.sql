-- Migration 060: release-scoped multi-value Abbott MNN metadata.
CREATE TABLE IF NOT EXISTS portal_content_mnn_source_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  source_sheet VARCHAR(255) NOT NULL,
  source_row_ordinal BIGINT UNSIGNED NOT NULL,
  source_row_fingerprint CHAR(64) NOT NULL,
  normalized_url TEXT DEFAULT NULL,
  normalized_url_hash CHAR(64) DEFAULT NULL,
  mnn_key VARCHAR(255) NOT NULL,
  mnn_label VARCHAR(500) NOT NULL,
  raw_value_sha256 CHAR(64) NOT NULL,
  source_provenance_json JSON NOT NULL,
  resolved_content_entity_id BIGINT UNSIGNED DEFAULT NULL,
  resolution_status ENUM('mapped', 'unresolved', 'collision', 'unlinked') NOT NULL,
  resolution_evidence_json JSON NOT NULL,
  claim_fingerprint CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_mnn_claim_fingerprint (claim_fingerprint),
  UNIQUE KEY uniq_mnn_claim_source_value
    (source_snapshot_id, source_sheet, source_row_ordinal, mnn_key),
  KEY idx_mnn_claim_url (source_snapshot_id, normalized_url_hash),
  KEY idx_mnn_claim_key (source_snapshot_id, mnn_key),
  CONSTRAINT fk_mnn_claim_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES portal_dataset_snapshots (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_mnn_claim_entity
    FOREIGN KEY (resolved_content_entity_id) REFERENCES portal_content_registry_entities (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable source-faithful URL-to-MNN claims from reviewed Abbott workbooks';
-- @migration-statement-break

CREATE TABLE IF NOT EXISTS portal_content_catalog_mnn (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  content_entity_id BIGINT UNSIGNED NOT NULL,
  mnn_source_snapshot_id BIGINT UNSIGNED NOT NULL,
  source_claim_id BIGINT UNSIGNED NOT NULL,
  mnn_key VARCHAR(255) NOT NULL,
  mnn_label VARCHAR(500) NOT NULL,
  mapping_fingerprint CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_content_mnn_release_entity (canonical_release_id, content_entity_id, mnn_key),
  UNIQUE KEY uniq_content_mnn_mapping_fingerprint (canonical_release_id, mapping_fingerprint),
  KEY idx_content_mnn_filter (canonical_release_id, mnn_key, content_entity_id),
  KEY idx_content_mnn_snapshot (mnn_source_snapshot_id),
  KEY idx_content_mnn_claim (source_claim_id),
  CONSTRAINT fk_content_mnn_release
    FOREIGN KEY (canonical_release_id) REFERENCES portal_data_releases (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_mnn_entity
    FOREIGN KEY (content_entity_id) REFERENCES portal_content_registry_entities (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_mnn_snapshot
    FOREIGN KEY (mnn_source_snapshot_id) REFERENCES portal_dataset_snapshots (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_content_mnn_claim
    FOREIGN KEY (source_claim_id) REFERENCES portal_content_mnn_source_claims (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Release-scoped multi-value MNN projection for canonical Abbott materials';
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_mnn_claims_immutable_update;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_mnn_claims_immutable_update
BEFORE UPDATE ON portal_content_mnn_source_claims
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Abbott MNN source claims are immutable';
END;
-- @migration-statement-break

DROP TRIGGER IF EXISTS trg_abbott_mnn_claims_immutable_delete;
-- @migration-statement-break
CREATE TRIGGER trg_abbott_mnn_claims_immutable_delete
BEFORE DELETE ON portal_content_mnn_source_claims
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Abbott MNN source claims are immutable';
END;
-- @migration-statement-break

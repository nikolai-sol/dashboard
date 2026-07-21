CREATE DATABASE IF NOT EXISTS report_bd_private
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_bd_private.canonical_fact_metrika_user_behavior_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  counter_id BIGINT UNSIGNED NOT NULL,
  report_date DATE NOT NULL,
  raw_user_id TEXT NOT NULL,
  raw_user_id_hash CHAR(64) NOT NULL,
  start_url TEXT NOT NULL,
  start_url_hash CHAR(64) NOT NULL,
  end_url TEXT NOT NULL,
  end_url_hash CHAR(64) NOT NULL,
  visit_id TEXT DEFAULT NULL,
  visit_id_hash CHAR(64) DEFAULT NULL,
  session_started_at DATETIME DEFAULT NULL,
  session_ended_at DATETIME DEFAULT NULL,
  pageviews BIGINT UNSIGNED NOT NULL DEFAULT 0,
  request_fingerprint CHAR(64) NOT NULL,
  ingestion_run_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_private_behavior_release_request
    (canonical_release_id, counter_id, report_date, request_fingerprint),
  KEY idx_private_behavior_release_user
    (canonical_release_id, counter_id, report_date, raw_user_id_hash),
  KEY idx_private_behavior_release_start
    (canonical_release_id, counter_id, report_date, start_url_hash),
  KEY idx_private_behavior_release_end
    (canonical_release_id, counter_id, report_date, end_url_hash),
  KEY idx_private_behavior_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Lossless manager-only Metrika user behavior facts';

CREATE TABLE IF NOT EXISTS report_bd_private.canonical_fact_metrika_visits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  counter_id BIGINT UNSIGNED NOT NULL,
  report_date DATE NOT NULL,
  visit_id TEXT NOT NULL,
  visit_id_hash CHAR(64) NOT NULL,
  client_id_hash CHAR(64) DEFAULT NULL,
  raw_user_id TEXT DEFAULT NULL,
  raw_user_id_hash CHAR(64) DEFAULT NULL,
  traffic_source VARCHAR(500) NOT NULL,
  start_url TEXT NOT NULL,
  start_url_hash CHAR(64) NOT NULL,
  end_url TEXT NOT NULL,
  end_url_hash CHAR(64) NOT NULL,
  session_started_at DATETIME NOT NULL,
  session_ended_at DATETIME NOT NULL,
  pageviews BIGINT UNSIGNED NOT NULL,
  duration_seconds BIGINT UNSIGNED NOT NULL,
  is_bounce TINYINT(1) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  ingestion_run_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_private_visit_release
    (canonical_release_id, counter_id, report_date, visit_id_hash),
  KEY idx_private_visit_release_source
    (canonical_release_id, report_date, traffic_source),
  KEY idx_private_visit_release_user
    (canonical_release_id, report_date, raw_user_id_hash),
  KEY idx_private_visit_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Lossless manager-only Metrika visit facts';

CREATE TABLE IF NOT EXISTS report_bd_private.portal_user_directions_private (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  raw_user_id TEXT NOT NULL,
  raw_user_id_hash CHAR(64) NOT NULL,
  normalized_direction VARCHAR(500) NOT NULL,
  normalized_specialization VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_private_direction_snapshot_user
    (canonical_release_id, source_snapshot_id, raw_user_id_hash),
  KEY idx_private_direction_release
    (canonical_release_id, normalized_direction)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Lossless snapshot-scoped user direction mapping';

CREATE TABLE IF NOT EXISTS report_bd_private.portal_bitrix_page_facts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  analytics_account_id VARCHAR(128) NOT NULL DEFAULT 'abbott_bitrix',
  report_date DATE NOT NULL,
  normalized_path TEXT NOT NULL,
  normalized_path_hash CHAR(64) NOT NULL,
  material_id VARCHAR(255) DEFAULT NULL,
  material_type_hint VARCHAR(500) DEFAULT NULL,
  pageviews BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  users BIGINT UNSIGNED NOT NULL DEFAULT 0,
  guests BIGINT UNSIGNED NOT NULL DEFAULT 0,
  logged_in_hits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  anonymous_hits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  logged_in_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  anonymous_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  entry_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  exit_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  avg_session_duration_seconds DECIMAL(18,6) DEFAULT NULL,
  top_utm_source VARCHAR(500) DEFAULT NULL,
  top_utm_medium VARCHAR(500) DEFAULT NULL,
  top_utm_campaign VARCHAR(500) DEFAULT NULL,
  source_row_fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_private_bitrix_release_page
    (canonical_release_id, analytics_account_id, report_date, source_row_fingerprint),
  KEY idx_private_bitrix_snapshot (source_snapshot_id),
  KEY idx_private_bitrix_path
    (canonical_release_id, report_date, normalized_path_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Snapshot-bound Bitrix page and material aggregates';

CREATE TABLE IF NOT EXISTS report_bd_private.portal_bitrix_journeys_private (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_release_id BIGINT UNSIGNED NOT NULL,
  source_snapshot_id BIGINT UNSIGNED NOT NULL,
  analytics_account_id VARCHAR(128) NOT NULL DEFAULT 'abbott_bitrix',
  report_date DATE NOT NULL,
  raw_user_id TEXT DEFAULT NULL,
  raw_user_id_hash CHAR(64) DEFAULT NULL,
  protected_visit_id TEXT NOT NULL,
  protected_visit_id_hash CHAR(64) NOT NULL,
  source_event_id TEXT DEFAULT NULL,
  source_event_id_hash CHAR(64) DEFAULT NULL,
  event_sequence INT UNSIGNED NOT NULL,
  event_at DATETIME NOT NULL,
  normalized_path TEXT NOT NULL,
  normalized_path_hash CHAR(64) NOT NULL,
  event_kind VARCHAR(128) NOT NULL,
  source_row_fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_private_bitrix_release_journey
    (canonical_release_id, analytics_account_id, report_date, source_row_fingerprint),
  UNIQUE KEY uniq_private_bitrix_visit_sequence
    (canonical_release_id, source_snapshot_id, analytics_account_id,
     report_date, protected_visit_id_hash, event_sequence),
  KEY idx_private_bitrix_journey_user
    (canonical_release_id, report_date, raw_user_id_hash),
  KEY idx_private_bitrix_journey_visit
    (canonical_release_id, protected_visit_id_hash, event_sequence),
  KEY idx_private_bitrix_journey_snapshot (source_snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Manager-only ordered Bitrix journeys with lossless internal identifiers';

-- Task 7 compatibility upgrade for installations where the Task 1 tables
-- already exist. Guarded INFORMATION_SCHEMA checks make repeat execution a
-- no-op while preserving any legacy rows for reviewed backfill validation.

-- The same immutable workbook snapshot can be attached to more than one
-- canonical release. Canonicalize both the original snapshot-only index and
-- any equivalent differently named index without creating duplicate indexes.
SET @abbott_private_direction_index_signature := (
  SELECT CONCAT(
    MIN(NON_UNIQUE), ':',
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_user_directions_private'
    AND INDEX_NAME = 'uniq_private_direction_snapshot_user'
);
SET @sql := IF(
  @abbott_private_direction_index_signature IS NOT NULL
    AND @abbott_private_direction_index_signature <>
      '0:canonical_release_id,source_snapshot_id,raw_user_id_hash',
  'ALTER TABLE report_bd_private.portal_user_directions_private DROP INDEX uniq_private_direction_snapshot_user',
  'SELECT ''private direction named uniqueness does not need removal'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_direction_equivalent_index := (
  SELECT candidate.INDEX_NAME
  FROM (
    SELECT
      INDEX_NAME,
      MIN(NON_UNIQUE) AS non_unique,
      GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS index_columns
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = 'report_bd_private'
      AND TABLE_NAME = 'portal_user_directions_private'
      AND INDEX_NAME <> 'PRIMARY'
    GROUP BY INDEX_NAME
  ) AS candidate
  WHERE candidate.non_unique = 0
    AND candidate.index_columns =
      'canonical_release_id,source_snapshot_id,raw_user_id_hash'
  ORDER BY
    candidate.INDEX_NAME = 'uniq_private_direction_snapshot_user' DESC,
    candidate.INDEX_NAME
  LIMIT 1
);
SET @sql := CASE
  WHEN @abbott_private_direction_equivalent_index =
       'uniq_private_direction_snapshot_user'
    THEN 'SELECT ''private direction uniqueness already aligned'' AS info'
  WHEN @abbott_private_direction_equivalent_index IS NOT NULL
    THEN CONCAT(
      'ALTER TABLE report_bd_private.portal_user_directions_private RENAME INDEX `',
      REPLACE(@abbott_private_direction_equivalent_index, '`', '``'),
      '` TO uniq_private_direction_snapshot_user'
    )
  ELSE
    'ALTER TABLE report_bd_private.portal_user_directions_private ADD UNIQUE INDEX uniq_private_direction_snapshot_user (canonical_release_id, source_snapshot_id, raw_user_id_hash)'
END;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_visit_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'canonical_fact_metrika_user_behavior_daily'
    AND COLUMN_NAME = 'visit_id'
);
SET @sql := IF(
  @abbott_private_visit_type <> 'text',
  'ALTER TABLE report_bd_private.canonical_fact_metrika_user_behavior_daily MODIFY COLUMN visit_id TEXT DEFAULT NULL',
  'SELECT ''private behavior visit_id already text-safe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'canonical_fact_metrika_user_behavior_daily'
    AND COLUMN_NAME = 'visit_id_hash'
);
SET @sql := IF(
  @abbott_private_column_exists = 0,
  'ALTER TABLE report_bd_private.canonical_fact_metrika_user_behavior_daily ADD COLUMN visit_id_hash CHAR(64) DEFAULT NULL',
  'SELECT ''private behavior visit_id_hash already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_page_clauses := CONCAT(
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'material_type_hint') = 0,
     ', ADD COLUMN material_type_hint VARCHAR(500) DEFAULT NULL', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'sessions') = 0,
     ', ADD COLUMN sessions BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'users') = 0,
     ', ADD COLUMN users BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'guests') = 0,
     ', ADD COLUMN guests BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'logged_in_hits') = 0,
     ', ADD COLUMN logged_in_hits BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'anonymous_hits') = 0,
     ', ADD COLUMN anonymous_hits BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'logged_in_sessions') = 0,
     ', ADD COLUMN logged_in_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'anonymous_sessions') = 0,
     ', ADD COLUMN anonymous_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'entry_sessions') = 0,
     ', ADD COLUMN entry_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'exit_sessions') = 0,
     ', ADD COLUMN exit_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'avg_session_duration_seconds') = 0,
     ', ADD COLUMN avg_session_duration_seconds DECIMAL(18,6) DEFAULT NULL', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'top_utm_source') = 0,
     ', ADD COLUMN top_utm_source VARCHAR(500) DEFAULT NULL', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'top_utm_medium') = 0,
     ', ADD COLUMN top_utm_medium VARCHAR(500) DEFAULT NULL', ''),
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'report_bd_private' AND TABLE_NAME = 'portal_bitrix_page_facts' AND COLUMN_NAME = 'top_utm_campaign') = 0,
     ', ADD COLUMN top_utm_campaign VARCHAR(500) DEFAULT NULL', '')
);
SET @sql := IF(
  @abbott_private_page_clauses <> '',
  CONCAT(
    'ALTER TABLE report_bd_private.portal_bitrix_page_facts ',
    SUBSTRING(@abbott_private_page_clauses, 3)
  ),
  'SELECT ''private Bitrix page columns already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_legacy_page_columns := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_page_facts'
    AND COLUMN_NAME IN ('visits', 'unique_visitors')
);
SET @sql := IF(
  @abbott_private_legacy_page_columns = 2,
  'UPDATE report_bd_private.portal_bitrix_page_facts SET sessions = visits, users = unique_visitors WHERE sessions = 0 AND users = 0',
  'SELECT ''private Bitrix page legacy metrics do not need copying'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_journey_visit_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND INDEX_NAME = 'idx_private_bitrix_journey_visit'
);
SET @sql := IF(
  @abbott_private_journey_visit_index_columns IS NOT NULL
    AND @abbott_private_journey_visit_index_columns <> 'canonical_release_id,protected_visit_id_hash,event_sequence',
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private DROP INDEX idx_private_bitrix_journey_visit',
  'SELECT ''private journey legacy visit index does not need removal'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_journey_nullable_columns := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND COLUMN_NAME IN ('raw_user_id', 'raw_user_id_hash')
    AND IS_NULLABLE = 'NO'
);
SET @sql := IF(
  @abbott_private_journey_nullable_columns > 0,
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private MODIFY COLUMN raw_user_id TEXT DEFAULT NULL, MODIFY COLUMN raw_user_id_hash CHAR(64) DEFAULT NULL',
  'SELECT ''private journey anonymous identity already nullable'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_visit_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND COLUMN_NAME = 'protected_visit_id'
);
SET @sql := IF(
  @abbott_private_visit_type <> 'text',
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private MODIFY COLUMN protected_visit_id TEXT NOT NULL',
  'SELECT ''private journey visit ID already text-safe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND COLUMN_NAME = 'protected_visit_id_hash'
);
SET @sql := IF(
  @abbott_private_column_exists = 0,
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private ADD COLUMN protected_visit_id_hash CHAR(64) DEFAULT NULL',
  'SELECT ''private journey protected_visit_id_hash already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE report_bd_private.portal_bitrix_journeys_private
SET protected_visit_id_hash = SHA2(protected_visit_id, 256)
WHERE protected_visit_id_hash IS NULL;

SET @abbott_private_column_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND COLUMN_NAME = 'protected_visit_id_hash'
);
SET @sql := IF(
  @abbott_private_column_nullable = 'YES',
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private MODIFY COLUMN protected_visit_id_hash CHAR(64) NOT NULL',
  'SELECT ''private journey protected_visit_id_hash already required'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND COLUMN_NAME = 'source_event_id'
);
SET @sql := IF(
  @abbott_private_column_exists = 0,
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private ADD COLUMN source_event_id TEXT DEFAULT NULL',
  'SELECT ''private journey source_event_id already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND COLUMN_NAME = 'source_event_id_hash'
);
SET @sql := IF(
  @abbott_private_column_exists = 0,
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private ADD COLUMN source_event_id_hash CHAR(64) DEFAULT NULL',
  'SELECT ''private journey source_event_id_hash already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE report_bd_private.portal_bitrix_journeys_private
SET event_at = TIMESTAMP(report_date)
WHERE event_at IS NULL;
SET @abbott_private_column_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND COLUMN_NAME = 'event_at'
);
SET @sql := IF(
  @abbott_private_column_nullable = 'YES',
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private MODIFY COLUMN event_at DATETIME NOT NULL',
  'SELECT ''private journey event_at already required'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND INDEX_NAME = 'idx_private_bitrix_journey_visit'
);
SET @sql := IF(
  @abbott_private_index_exists = 0,
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private ADD INDEX idx_private_bitrix_journey_visit (canonical_release_id, protected_visit_id_hash, event_sequence)',
  'SELECT ''private journey visit hash index already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_journey_unique_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND INDEX_NAME = 'uniq_private_bitrix_visit_sequence'
);
SET @sql := IF(
  @abbott_private_journey_unique_columns IS NOT NULL
    AND @abbott_private_journey_unique_columns <> 'canonical_release_id,source_snapshot_id,analytics_account_id,report_date,protected_visit_id_hash,event_sequence',
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private DROP INDEX uniq_private_bitrix_visit_sequence',
  'SELECT ''private journey visit uniqueness does not need removal'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @abbott_private_journey_unique_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'report_bd_private'
    AND TABLE_NAME = 'portal_bitrix_journeys_private'
    AND INDEX_NAME = 'uniq_private_bitrix_visit_sequence'
);
SET @sql := IF(
  COALESCE(@abbott_private_journey_unique_columns, '') <>
    'canonical_release_id,source_snapshot_id,analytics_account_id,report_date,protected_visit_id_hash,event_sequence',
  'ALTER TABLE report_bd_private.portal_bitrix_journeys_private ADD UNIQUE INDEX uniq_private_bitrix_visit_sequence (canonical_release_id, source_snapshot_id, analytics_account_id, report_date, protected_visit_id_hash, event_sequence)',
  'SELECT ''private journey visit uniqueness already aligned'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE ROLE IF NOT EXISTS
  'abbott_collector_role',
  'abbott_importer_role',
  'abbott_release_operator_role',
  'abbott_runtime_reader_role',
  'abbott_embed_reader_role';

GRANT SELECT ON report_bd.portal_data_releases
  TO 'abbott_collector_role';
GRANT SELECT ON report_bd.portal_active_data_releases
  TO 'abbott_collector_role';
GRANT SELECT (id, dataset_key, source_kind) ON report_bd.portal_dataset_snapshots
  TO 'abbott_collector_role';
GRANT SELECT ON report_bd.yandex_metrika_names
  TO 'abbott_collector_role';
GRANT SELECT ON report_bd.canonical_source_account_collection_settings
  TO 'abbott_collector_role';
GRANT SELECT, INSERT, UPDATE ON report_bd.canonical_source_accounts
  TO 'abbott_collector_role';
GRANT SELECT, INSERT, UPDATE ON report_bd.canonical_collector_runs
  TO 'abbott_collector_role';
GRANT INSERT ON report_bd.canonical_collector_run_events
  TO 'abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd.canonical_fact_metrika_site_analytics_daily
  TO 'abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd.canonical_fact_metrika_returning_pages_release_daily
  TO 'abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd.canonical_source_coverage_daily
  TO 'abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd_private.canonical_fact_metrika_user_behavior_daily
  TO 'abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd_private.canonical_fact_metrika_visits
  TO 'abbott_collector_role';

-- The CLI importer uses one connection for a single transaction spanning both
-- schemas. It may attach imported snapshot IDs to a staging release, but it
-- cannot write the active-release pointer or change release status.
GRANT SELECT ON report_bd.portal_data_releases
  TO 'abbott_importer_role';
GRANT UPDATE (source_snapshot_ids) ON report_bd.portal_data_releases
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_dataset_snapshots
  TO 'abbott_importer_role';
GRANT UPDATE (import_status, imported_row_count, rejected_row_count,
              manifest_json, imported_at) ON report_bd.portal_dataset_snapshots
  TO 'abbott_importer_role';
GRANT SELECT, INSERT, UPDATE ON report_bd.portal_release_source_imports
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_content_catalog
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_content_lookup_projection
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_general_materials
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_event_catalog
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_bitrix_page_facts
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_bitrix_journey_transitions
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd_private.portal_user_directions_private
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd_private.portal_bitrix_page_facts
  TO 'abbott_importer_role';
GRANT SELECT, INSERT ON report_bd_private.portal_bitrix_journeys_private
  TO 'abbott_importer_role';

-- Baseline capture, comparison, candidate creation, validation, activation,
-- and rollback use a separate operator account. It cannot write canonical or
-- private facts; only the collector/importer roles can do that.
GRANT SELECT, INSERT, UPDATE ON report_bd.portal_data_releases
  TO 'abbott_release_operator_role';
GRANT SELECT, UPDATE ON report_bd.portal_active_data_releases
  TO 'abbott_release_operator_role';
GRANT SELECT, INSERT ON report_bd.portal_dataset_snapshots
  TO 'abbott_release_operator_role';
GRANT SELECT ON report_bd.portal_release_source_imports
  TO 'abbott_release_operator_role';
GRANT SELECT, INSERT, UPDATE ON report_bd.portal_migration_validation_runs
  TO 'abbott_release_operator_role';
GRANT SELECT ON report_bd.canonical_fact_metrika_site_analytics_daily
  TO 'abbott_release_operator_role';
GRANT SELECT ON report_bd.canonical_source_coverage_daily
  TO 'abbott_release_operator_role';

-- The server-side manager runtime is read-only across the release metadata,
-- aggregate catalogs, and manager-private tables. Embed must use only the
-- aggregate projections even when this role is available to the manager path.
GRANT SELECT ON report_bd.portal_data_releases
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_active_data_releases
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.dashboards
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_dataset_snapshots
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_content_catalog
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_content_lookup_projection
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_general_materials
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_event_catalog
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_external_events
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_bitrix_page_facts
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_bitrix_journey_transitions
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.canonical_fact_metrika_site_analytics_daily
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.canonical_fact_metrika_returning_pages_release_daily
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd.canonical_source_coverage_daily
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.canonical_fact_metrika_user_behavior_daily
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.canonical_fact_metrika_visits
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.portal_user_directions_private
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.portal_bitrix_page_facts
  TO 'abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.portal_bitrix_journeys_private
  TO 'abbott_runtime_reader_role';

-- Embed credentials are independently aggregate-only. This role has no grants
-- in report_bd_private and cannot be elevated by application audience checks.
GRANT SELECT ON report_bd.portal_data_releases TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_active_data_releases TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.dashboards TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_dataset_snapshots TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_content_catalog TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_content_lookup_projection TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_general_materials TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_event_catalog TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_external_events TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_bitrix_page_facts TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.portal_bitrix_journey_transitions TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.canonical_fact_metrika_site_analytics_daily TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.canonical_fact_metrika_returning_pages_release_daily TO 'abbott_embed_reader_role';
GRANT SELECT ON report_bd.canonical_source_coverage_daily TO 'abbott_embed_reader_role';

-- Account creation and role assignment are intentionally left to a reviewed DBA rollout.

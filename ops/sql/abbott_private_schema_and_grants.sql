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
    (source_snapshot_id, raw_user_id_hash),
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
    (canonical_release_id, source_snapshot_id, protected_visit_id_hash, event_sequence),
  KEY idx_private_bitrix_journey_user
    (canonical_release_id, report_date, raw_user_id_hash),
  KEY idx_private_bitrix_journey_visit
    (canonical_release_id, protected_visit_id_hash, event_sequence),
  KEY idx_private_bitrix_journey_snapshot (source_snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Manager-only ordered Bitrix journeys with lossless internal identifiers';

CREATE ROLE IF NOT EXISTS
  'reportingdash_abbott_collector_role',
  'reportingdash_abbott_importer_role',
  'reportingdash_abbott_runtime_reader_role';

GRANT SELECT ON report_bd.portal_data_releases
  TO 'reportingdash_abbott_collector_role';
GRANT SELECT ON report_bd.portal_active_data_releases
  TO 'reportingdash_abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd.canonical_fact_metrika_site_analytics_daily
  TO 'reportingdash_abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd.canonical_fact_metrika_returning_pages_daily
  TO 'reportingdash_abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd.canonical_source_coverage_daily
  TO 'reportingdash_abbott_collector_role';
GRANT SELECT, INSERT, UPDATE, DELETE ON report_bd_private.canonical_fact_metrika_user_behavior_daily
  TO 'reportingdash_abbott_collector_role';

-- The CLI importer uses one connection for a single transaction spanning both
-- schemas. It may attach imported snapshot IDs to a staging release, but it
-- cannot write the active-release pointer or change release status.
GRANT SELECT ON report_bd.portal_data_releases
  TO 'reportingdash_abbott_importer_role';
GRANT UPDATE (source_snapshot_ids) ON report_bd.portal_data_releases
  TO 'reportingdash_abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_dataset_snapshots
  TO 'reportingdash_abbott_importer_role';
GRANT UPDATE (import_status, imported_row_count, rejected_row_count,
              manifest_json, imported_at) ON report_bd.portal_dataset_snapshots
  TO 'reportingdash_abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_content_catalog
  TO 'reportingdash_abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_general_materials
  TO 'reportingdash_abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_event_catalog
  TO 'reportingdash_abbott_importer_role';
GRANT SELECT, INSERT ON report_bd.portal_bitrix_journey_transitions
  TO 'reportingdash_abbott_importer_role';
GRANT SELECT, INSERT ON report_bd_private.portal_user_directions_private
  TO 'reportingdash_abbott_importer_role';
GRANT SELECT, INSERT ON report_bd_private.portal_bitrix_page_facts
  TO 'reportingdash_abbott_importer_role';
GRANT SELECT, INSERT ON report_bd_private.portal_bitrix_journeys_private
  TO 'reportingdash_abbott_importer_role';

-- The server-side manager runtime is read-only across the release metadata,
-- aggregate catalogs, and manager-private tables. Embed must use only the
-- aggregate projections even when this role is available to the manager path.
GRANT SELECT ON report_bd.portal_data_releases
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_active_data_releases
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_dataset_snapshots
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_content_catalog
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_general_materials
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_event_catalog
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_external_events
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.portal_bitrix_journey_transitions
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.canonical_fact_metrika_site_analytics_daily
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.canonical_fact_metrika_returning_pages_daily
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd.canonical_source_coverage_daily
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.canonical_fact_metrika_user_behavior_daily
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.portal_user_directions_private
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.portal_bitrix_page_facts
  TO 'reportingdash_abbott_runtime_reader_role';
GRANT SELECT ON report_bd_private.portal_bitrix_journeys_private
  TO 'reportingdash_abbott_runtime_reader_role';

-- Account creation and role assignment are intentionally left to a reviewed DBA rollout.

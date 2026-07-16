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
  visit_id VARCHAR(255) DEFAULT NULL,
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
  pageviews BIGINT UNSIGNED NOT NULL DEFAULT 0,
  visits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  unique_visitors BIGINT UNSIGNED NOT NULL DEFAULT 0,
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
  raw_user_id TEXT NOT NULL,
  raw_user_id_hash CHAR(64) NOT NULL,
  protected_visit_id VARCHAR(255) NOT NULL,
  event_sequence INT UNSIGNED NOT NULL,
  event_at DATETIME DEFAULT NULL,
  normalized_path TEXT NOT NULL,
  normalized_path_hash CHAR(64) NOT NULL,
  event_kind VARCHAR(128) NOT NULL,
  source_row_fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_private_bitrix_release_journey
    (canonical_release_id, analytics_account_id, report_date, source_row_fingerprint),
  KEY idx_private_bitrix_journey_user
    (canonical_release_id, report_date, raw_user_id_hash),
  KEY idx_private_bitrix_journey_visit
    (canonical_release_id, protected_visit_id, event_sequence),
  KEY idx_private_bitrix_journey_snapshot (source_snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Manager-only ordered Bitrix journeys with lossless internal identifiers';

CREATE ROLE IF NOT EXISTS
  'reportingdash_abbott_collector_role',
  'reportingdash_abbott_manager_reader_role';

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
GRANT SELECT, INSERT, UPDATE ON report_bd_private.portal_user_directions_private
  TO 'reportingdash_abbott_collector_role';
GRANT SELECT, INSERT, UPDATE ON report_bd_private.portal_bitrix_page_facts
  TO 'reportingdash_abbott_collector_role';
GRANT SELECT, INSERT, UPDATE ON report_bd_private.portal_bitrix_journeys_private
  TO 'reportingdash_abbott_collector_role';

GRANT SELECT ON report_bd_private.canonical_fact_metrika_user_behavior_daily
  TO 'reportingdash_abbott_manager_reader_role';
GRANT SELECT ON report_bd_private.portal_user_directions_private
  TO 'reportingdash_abbott_manager_reader_role';
GRANT SELECT ON report_bd_private.portal_bitrix_page_facts
  TO 'reportingdash_abbott_manager_reader_role';
GRANT SELECT ON report_bd_private.portal_bitrix_journeys_private
  TO 'reportingdash_abbott_manager_reader_role';

-- Account creation and role assignment are intentionally left to a reviewed DBA rollout.

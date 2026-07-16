-- Run only after the reviewed operator has set every abbott_snapshot_* session
-- variable below from the frozen, restricted baseline manifest. The guard aborts
-- before opening the snapshot transaction when any required value is missing.
--
-- Required variables:
--   @abbott_snapshot_key, @abbott_snapshot_source_locator,
--   @abbott_snapshot_sha256, @abbott_snapshot_bytes,
--   @abbott_snapshot_generated_at, @abbott_snapshot_period_min,
--   @abbott_snapshot_period_max, @abbott_snapshot_rows,
--   @abbott_snapshot_parser_version, @abbott_snapshot_archive_locator,
--   @abbott_snapshot_manifest_json.

DROP PROCEDURE IF EXISTS report_bd.assert_abbott_prebackfill_variables;

DELIMITER //
CREATE PROCEDURE report_bd.assert_abbott_prebackfill_variables()
BEGIN
  IF @abbott_snapshot_key IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_key';
  END IF;
  IF @abbott_snapshot_source_locator IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_source_locator';
  END IF;
  IF @abbott_snapshot_sha256 IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_sha256';
  END IF;
  IF @abbott_snapshot_bytes IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_bytes';
  END IF;
  IF @abbott_snapshot_generated_at IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_generated_at';
  END IF;
  IF @abbott_snapshot_period_min IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_period_min';
  END IF;
  IF @abbott_snapshot_period_max IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_period_max';
  END IF;
  IF @abbott_snapshot_rows IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_rows';
  END IF;
  IF @abbott_snapshot_parser_version IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_parser_version';
  END IF;
  IF @abbott_snapshot_archive_locator IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_archive_locator';
  END IF;
  IF @abbott_snapshot_manifest_json IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Missing required variable: abbott_snapshot_manifest_json';
  END IF;
END//
DELIMITER ;

CALL report_bd.assert_abbott_prebackfill_variables();
DROP PROCEDURE report_bd.assert_abbott_prebackfill_variables;

SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION WITH CONSISTENT SNAPSHOT;

INSERT INTO report_bd.portal_dataset_snapshots (
  snapshot_key,
  dataset_key,
  source_kind,
  source_locator,
  content_sha256,
  content_bytes,
  source_generated_at,
  period_min_date,
  period_max_date,
  source_row_count,
  parser_version,
  import_status,
  imported_row_count,
  rejected_row_count,
  private_archive_locator,
  manifest_json
) VALUES (
  @abbott_snapshot_key,
  'abbott_portal',
  'prebackfill_manifest',
  @abbott_snapshot_source_locator,
  @abbott_snapshot_sha256,
  @abbott_snapshot_bytes,
  @abbott_snapshot_generated_at,
  @abbott_snapshot_period_min,
  @abbott_snapshot_period_max,
  @abbott_snapshot_rows,
  @abbott_snapshot_parser_version,
  'registered',
  0,
  0,
  @abbott_snapshot_archive_locator,
  @abbott_snapshot_manifest_json
);

SET @abbott_prebackfill_snapshot_id = LAST_INSERT_ID();

-- Capture the rollback pointer that was active inside this consistent snapshot.
SELECT
  @abbott_prebackfill_snapshot_id AS baseline_snapshot_id,
  active.dataset_key,
  active.canonical_release_id AS prebackfill_release_id,
  active.previous_release_id,
  active.switched_at,
  releases.release_key,
  releases.code_revision
FROM report_bd.portal_active_data_releases AS active
JOIN report_bd.portal_data_releases AS releases
  ON releases.id = active.canonical_release_id
WHERE active.dataset_key = 'abbott_portal';

-- Sanitized aggregate evidence for the currently active primary facts.
SELECT
  facts.canonical_release_id,
  facts.counter_id,
  facts.report_date,
  facts.analytics_scope,
  COUNT(*) AS fact_rows,
  SUM(facts.sessions) AS sessions,
  SUM(facts.users) AS users,
  SUM(facts.pageviews) AS pageviews
FROM report_bd.canonical_fact_metrika_site_analytics_daily AS facts
JOIN report_bd.portal_active_data_releases AS active
  ON active.canonical_release_id = facts.canonical_release_id
 AND active.dataset_key = 'abbott_portal'
WHERE facts.counter_id = 90602537
GROUP BY
  facts.canonical_release_id,
  facts.counter_id,
  facts.report_date,
  facts.analytics_scope
ORDER BY facts.report_date, facts.analytics_scope;

SELECT
  coverage.canonical_release_id,
  coverage.counter_id,
  coverage.report_date,
  coverage.scope_key,
  coverage.collection_status,
  coverage.api_total_rows,
  coverage.persisted_rows,
  coverage.pagination_complete,
  coverage.is_sampled,
  coverage.empty_reconciled,
  coverage.collector_run_id
FROM report_bd.canonical_source_coverage_daily AS coverage
JOIN report_bd.portal_active_data_releases AS active
  ON active.canonical_release_id = coverage.canonical_release_id
 AND active.dataset_key = 'abbott_portal'
WHERE coverage.counter_id = 90602537
ORDER BY coverage.report_date, coverage.scope_key;

-- Private evidence is count-only; this result set never emits identifiers or paths.
SELECT
  behavior.canonical_release_id,
  behavior.counter_id,
  MIN(behavior.report_date) AS period_min_date,
  MAX(behavior.report_date) AS period_max_date,
  COUNT(*) AS fact_rows,
  COUNT(DISTINCT behavior.raw_user_id_hash) AS distinct_user_ids,
  COUNT(DISTINCT behavior.visit_id) AS distinct_visits
FROM report_bd_private.canonical_fact_metrika_user_behavior_daily AS behavior
JOIN report_bd.portal_active_data_releases AS active
  ON active.canonical_release_id = behavior.canonical_release_id
 AND active.dataset_key = 'abbott_portal'
WHERE behavior.counter_id = 90602537
GROUP BY behavior.canonical_release_id, behavior.counter_id;

COMMIT;

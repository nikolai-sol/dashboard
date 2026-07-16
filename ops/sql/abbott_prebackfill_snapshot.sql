-- Run only after the reviewed operator has set every abbott_snapshot_* session
-- variable below from the frozen, restricted baseline manifest. Missing required
-- values fail on the NOT NULL constraints instead of recording partial evidence.
--
-- Required variables:
--   @abbott_snapshot_key, @abbott_snapshot_source_locator,
--   @abbott_snapshot_sha256, @abbott_snapshot_bytes,
--   @abbott_snapshot_generated_at, @abbott_snapshot_period_min,
--   @abbott_snapshot_period_max, @abbott_snapshot_rows,
--   @abbott_snapshot_parser_version, @abbott_snapshot_archive_locator,
--   @abbott_snapshot_manifest_json.

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

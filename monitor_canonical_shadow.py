#!/usr/bin/env python3
"""Daily operational summary for canonical shadow collectors."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

import mysql.connector

from canonical_writer import get_db_connection

SOURCES = {
    'linkedin': {
        'gate_note': 'aggregate delivery_entity facts to campaign/day for parity',
    },
    'reddit': {
        'gate_note': 'campaign scope is parity authority; delivery_entity is analytics-only',
    },
    'vk_ads_v2': {
        'gate_note': 'shared parity grain is delivery_entity/banner + report_date with zero-row filtering on both sides',
    },
    'hybrid': {
        'gate_note': 'shared parity grain is delivery_entity/creative + report_date; first-pass gate uses clicks, views and quartiles only',
    },
    'getintent': {
        'gate_note': 'shared parity grain is delivery_entity/creative + report_date; first-pass gate uses impressions, clicks and quartiles only',
    },
    'yandex_direct': {
        'gate_note': 'prod health uses canonical API-first freshness/run status',
    },
    'yandex_metrika': {
        'gate_note': 'canonical-only analytics source; monitor freshness, row presence and collector health on daily traffic/account grain',
        'source_kind': 'analytics',
        'gate_scope': 'traffic',
        'is_blocking_default': False,
    },
}

YANDEX_DIRECT_SHADOW_CUTOVER_ENABLED = os.getenv('YANDEX_DIRECT_SHADOW_CUTOVER', '').lower() in {'1', 'true', 'yes'}

POLICY_SQL = """
SELECT
  source_key,
  authority_fact_scope,
  comparison_level,
  spend_tolerance_abs,
  impressions_tolerance_abs,
  clicks_tolerance_abs,
  conversions_tolerance_abs,
  coverage_mode,
  is_blocking
FROM source_parity_policy
WHERE source_key = %s
LIMIT 1
"""

LATEST_RUN_SQL = """
SELECT
  id,
  source_key,
  run_type,
  run_mode,
  status,
  rows_read,
  rows_written,
  rows_updated,
  error_count,
  error_summary,
  started_at,
  finished_at
FROM canonical_collector_runs
WHERE source_key = %s
ORDER BY id DESC
LIMIT 1
"""

LATEST_EVENT_SQL = """
SELECT
  e.run_id,
  e.level,
  e.event_type,
  e.message,
  e.event_payload,
  e.created_at
FROM canonical_collector_run_events e
JOIN canonical_collector_runs r
  ON r.id = e.run_id
WHERE r.source_key = %s
  AND e.event_type = %s
ORDER BY e.id DESC
LIMIT 1
"""

ROW_COUNTS_SQL = """
SELECT
  source_key,
  fact_scope,
  native_grain,
  COUNT(*) AS row_count,
  MIN(report_date) AS min_date,
  MAX(report_date) AS max_date
FROM canonical_fact_ads_daily
WHERE source_key = %s
  AND report_date >= %s
GROUP BY source_key, fact_scope, native_grain
ORDER BY fact_scope, native_grain
"""

ANALYTICS_ROW_COUNTS_SQL = """
SELECT
  source_key,
  analytics_scope AS fact_scope,
  'account_day' AS native_grain,
  COUNT(*) AS row_count,
  MIN(report_date) AS min_date,
  MAX(report_date) AS max_date
FROM canonical_fact_site_analytics_daily
WHERE source_key = %s
  AND report_date >= %s
GROUP BY source_key, analytics_scope
ORDER BY analytics_scope
"""

FRESH_ROWS_SQL = """
SELECT
  MAX(report_date) AS max_report_date,
  COUNT(*) AS recent_rows
FROM canonical_fact_ads_daily
WHERE source_key = %s
  AND fact_scope = %s
  AND report_date >= %s
"""

ANALYTICS_FRESH_ROWS_SQL = """
SELECT
  MAX(report_date) AS max_report_date,
  COUNT(*) AS recent_rows
FROM canonical_fact_site_analytics_daily
WHERE source_key = %s
  AND analytics_scope = %s
  AND report_date >= %s
"""

LINKEDIN_PARITY_SQL = """
WITH legacy AS (
  SELECT
    report_date,
    account_id AS platform_account_id,
    campaign_id AS platform_campaign_id,
    ROUND(SUM(cost_local), 6) AS legacy_spend,
    SUM(impressions) AS legacy_impressions,
    SUM(clicks) AS legacy_clicks,
    SUM(conversions) AS legacy_conversions
  FROM ad_analytics_daily
  WHERE platform='linkedin'
    AND report_date >= %s
  GROUP BY report_date, account_id, campaign_id
),
canonical AS (
  SELECT
    report_date,
    platform_account_id,
    platform_campaign_id,
    ROUND(SUM(spend), 6) AS canonical_spend,
    SUM(impressions) AS canonical_impressions,
    SUM(clicks) AS canonical_clicks,
    SUM(conversions) AS canonical_conversions
  FROM canonical_fact_ads_daily
  WHERE source_key='linkedin'
    AND fact_scope='delivery_entity'
    AND report_date >= %s
  GROUP BY report_date, platform_account_id, platform_campaign_id
),
intersected AS (
  SELECT
    l.report_date,
    l.platform_account_id,
    l.platform_campaign_id,
    l.legacy_spend,
    c.canonical_spend,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_conversions,
    c.canonical_conversions
  FROM legacy l
  JOIN canonical c
    ON c.report_date = l.report_date
   AND c.platform_account_id = l.platform_account_id
   AND c.platform_campaign_id = l.platform_campaign_id
)
SELECT
  COUNT(*) AS compare_rows,
  SUM(CASE WHEN ABS(COALESCE(legacy_spend,0)-COALESCE(canonical_spend,0)) > %s THEN 1 ELSE 0 END) AS spend_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_impressions,0)-COALESCE(canonical_impressions,0)) > %s THEN 1 ELSE 0 END) AS impressions_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_clicks,0)-COALESCE(canonical_clicks,0)) > %s THEN 1 ELSE 0 END) AS clicks_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_conversions,0)-COALESCE(canonical_conversions,0)) > %s THEN 1 ELSE 0 END) AS conversions_mismatches
FROM intersected
"""

LINKEDIN_COVERAGE_SQL = """
WITH legacy AS (
  SELECT
    report_date,
    account_id AS platform_account_id,
    campaign_id AS platform_campaign_id
  FROM ad_analytics_daily
  WHERE platform='linkedin'
    AND report_date >= %s
  GROUP BY report_date, account_id, campaign_id
),
canonical AS (
  SELECT
    report_date,
    platform_account_id,
    platform_campaign_id
  FROM canonical_fact_ads_daily
  WHERE source_key='linkedin'
    AND fact_scope='delivery_entity'
    AND report_date >= %s
  GROUP BY report_date, platform_account_id, platform_campaign_id
),
legacy_bounds AS (
  SELECT MAX(report_date) AS legacy_max_report_date
  FROM legacy
)
SELECT
  SUM(CASE WHEN c.report_date IS NULL THEN 1 ELSE 0 END) AS legacy_only_rows,
  0 AS canonical_only_rows,
  0 AS canonical_only_rows_after_legacy_max,
  MAX(b.legacy_max_report_date) AS legacy_max_report_date,
  NULL AS canonical_only_min_date,
  NULL AS canonical_only_max_date
FROM legacy l
LEFT JOIN canonical c
  ON c.report_date = l.report_date
 AND c.platform_account_id = l.platform_account_id
 AND c.platform_campaign_id = l.platform_campaign_id
CROSS JOIN legacy_bounds b
UNION ALL
SELECT
  0 AS legacy_only_rows,
  SUM(CASE WHEN l.report_date IS NULL THEN 1 ELSE 0 END) AS canonical_only_rows,
  SUM(CASE WHEN l.report_date IS NULL AND c.report_date > b.legacy_max_report_date THEN 1 ELSE 0 END) AS canonical_only_rows_after_legacy_max,
  MAX(b.legacy_max_report_date) AS legacy_max_report_date,
  MIN(CASE WHEN l.report_date IS NULL THEN c.report_date ELSE NULL END) AS canonical_only_min_date,
  MAX(CASE WHEN l.report_date IS NULL THEN c.report_date ELSE NULL END) AS canonical_only_max_date
FROM canonical c
LEFT JOIN legacy l
  ON l.report_date = c.report_date
 AND l.platform_account_id = c.platform_account_id
 AND l.platform_campaign_id = c.platform_campaign_id
CROSS JOIN legacy_bounds b
WHERE l.report_date IS NULL
"""

REDDIT_PARITY_SQL = """
WITH legacy AS (
  SELECT
    report_date,
    account_id AS platform_account_id,
    campaign_id AS platform_campaign_id,
    ROUND(SUM(cost_local), 6) AS legacy_spend,
    SUM(impressions) AS legacy_impressions,
    SUM(clicks) AS legacy_clicks,
    SUM(conversions) AS legacy_conversions
  FROM ad_analytics_daily
  WHERE platform='reddit'
    AND report_date >= %s
  GROUP BY report_date, account_id, campaign_id
),
canonical AS (
  SELECT
    report_date,
    platform_account_id,
    platform_campaign_id,
    ROUND(SUM(spend), 6) AS canonical_spend,
    SUM(impressions) AS canonical_impressions,
    SUM(clicks) AS canonical_clicks,
    SUM(conversions) AS canonical_conversions
  FROM canonical_fact_ads_daily
  WHERE source_key='reddit'
    AND fact_scope='campaign'
    AND report_date >= %s
  GROUP BY report_date, platform_account_id, platform_campaign_id
),
compared AS (
  SELECT
    COALESCE(l.report_date, c.report_date) AS report_date,
    COALESCE(l.platform_account_id, c.platform_account_id) AS platform_account_id,
    COALESCE(l.platform_campaign_id, c.platform_campaign_id) AS platform_campaign_id,
    l.legacy_spend,
    c.canonical_spend,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_conversions,
    c.canonical_conversions
  FROM legacy l
  LEFT JOIN canonical c
    ON c.report_date = l.report_date
   AND c.platform_account_id = l.platform_account_id
   AND c.platform_campaign_id = l.platform_campaign_id
  UNION ALL
  SELECT
    c.report_date,
    c.platform_account_id,
    c.platform_campaign_id,
    l.legacy_spend,
    c.canonical_spend,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_conversions,
    c.canonical_conversions
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND l.platform_account_id = c.platform_account_id
   AND l.platform_campaign_id = c.platform_campaign_id
  WHERE l.report_date IS NULL
)
SELECT
  COUNT(*) AS compare_rows,
  SUM(CASE WHEN ABS(COALESCE(legacy_spend,0)-COALESCE(canonical_spend,0)) > %s THEN 1 ELSE 0 END) AS spend_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_impressions,0)-COALESCE(canonical_impressions,0)) > %s THEN 1 ELSE 0 END) AS impressions_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_clicks,0)-COALESCE(canonical_clicks,0)) > %s THEN 1 ELSE 0 END) AS clicks_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_conversions,0)-COALESCE(canonical_conversions,0)) > %s THEN 1 ELSE 0 END) AS conversions_mismatches
FROM compared
"""

VK_PARITY_SQL = """
WITH legacy AS (
  SELECT
    date AS report_date,
    CAST(creative_id AS CHAR) AS platform_delivery_entity_id,
    SUM(impressions) AS legacy_impressions,
    SUM(clicks) AS legacy_clicks,
    SUM(views25) AS legacy_video_views_25,
    SUM(views50) AS legacy_video_views_50,
    SUM(views75) AS legacy_video_views_75,
    SUM(views100) AS legacy_video_views_100
  FROM vk_creative_stats
  WHERE date >= %s
  GROUP BY date, creative_id
  HAVING
    COALESCE(SUM(impressions), 0) <> 0
    OR COALESCE(SUM(clicks), 0) <> 0
    OR COALESCE(SUM(views25), 0) <> 0
    OR COALESCE(SUM(views50), 0) <> 0
    OR COALESCE(SUM(views75), 0) <> 0
    OR COALESCE(SUM(views100), 0) <> 0
),
canonical AS (
  SELECT
    report_date,
    platform_delivery_entity_id,
    SUM(impressions) AS canonical_impressions,
    SUM(clicks) AS canonical_clicks,
    SUM(video_views_25) AS canonical_video_views_25,
    SUM(video_views_50) AS canonical_video_views_50,
    SUM(video_views_75) AS canonical_video_views_75,
    SUM(video_views_100) AS canonical_video_views_100
  FROM canonical_fact_ads_daily
  WHERE source_key='vk_ads_v2'
    AND fact_scope='delivery_entity'
    AND report_date >= %s
  GROUP BY report_date, platform_delivery_entity_id
  HAVING
    COALESCE(SUM(impressions), 0) <> 0
    OR COALESCE(SUM(clicks), 0) <> 0
    OR COALESCE(SUM(video_views_25), 0) <> 0
    OR COALESCE(SUM(video_views_50), 0) <> 0
    OR COALESCE(SUM(video_views_75), 0) <> 0
    OR COALESCE(SUM(video_views_100), 0) <> 0
),
intersected AS (
  SELECT
    l.report_date,
    l.platform_delivery_entity_id,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_video_views_25,
    c.canonical_video_views_25,
    l.legacy_video_views_50,
    c.canonical_video_views_50,
    l.legacy_video_views_75,
    c.canonical_video_views_75,
    l.legacy_video_views_100,
    c.canonical_video_views_100
  FROM legacy l
  JOIN canonical c
    ON c.report_date = l.report_date
   AND c.platform_delivery_entity_id = l.platform_delivery_entity_id
),
legacy_only AS (
  SELECT COUNT(*) AS legacy_only_rows
  FROM legacy l
  LEFT JOIN canonical c
    ON c.report_date = l.report_date
   AND c.platform_delivery_entity_id = l.platform_delivery_entity_id
  WHERE c.report_date IS NULL
),
canonical_only AS (
  SELECT
    COUNT(*) AS canonical_only_rows,
    MIN(c.report_date) AS canonical_only_min_date,
    MAX(c.report_date) AS canonical_only_max_date
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND l.platform_delivery_entity_id = c.platform_delivery_entity_id
  WHERE l.report_date IS NULL
),
legacy_bounds AS (
  SELECT MAX(report_date) AS legacy_max_report_date
  FROM legacy
),
canonical_split AS (
  SELECT
    SUM(CASE WHEN l.report_date IS NULL AND c.report_date <= b.legacy_max_report_date THEN 1 ELSE 0 END) AS canonical_only_in_legacy_window,
    SUM(CASE WHEN l.report_date IS NULL AND c.report_date > b.legacy_max_report_date THEN 1 ELSE 0 END) AS canonical_only_after_legacy_max
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND l.platform_delivery_entity_id = c.platform_delivery_entity_id
  CROSS JOIN legacy_bounds b
)
SELECT
  (SELECT COUNT(*) FROM intersected) AS compare_rows,
  (SELECT legacy_only_rows FROM legacy_only) AS legacy_only_rows,
  (SELECT canonical_only_rows FROM canonical_only) AS canonical_only_rows,
  (SELECT canonical_only_min_date FROM canonical_only) AS canonical_only_min_date,
  (SELECT canonical_only_max_date FROM canonical_only) AS canonical_only_max_date,
  (SELECT legacy_max_report_date FROM legacy_bounds) AS legacy_max_report_date,
  (SELECT canonical_only_in_legacy_window FROM canonical_split) AS canonical_only_in_legacy_window,
  (SELECT canonical_only_after_legacy_max FROM canonical_split) AS canonical_only_after_legacy_max,
  SUM(CASE WHEN ABS(COALESCE(legacy_impressions,0)-COALESCE(canonical_impressions,0)) > %s THEN 1 ELSE 0 END) AS impressions_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_clicks,0)-COALESCE(canonical_clicks,0)) > %s THEN 1 ELSE 0 END) AS clicks_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_25,0)-COALESCE(canonical_video_views_25,0)) > 0 THEN 1 ELSE 0 END) AS video_views_25_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_50,0)-COALESCE(canonical_video_views_50,0)) > 0 THEN 1 ELSE 0 END) AS video_views_50_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_75,0)-COALESCE(canonical_video_views_75,0)) > 0 THEN 1 ELSE 0 END) AS video_views_75_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_100,0)-COALESCE(canonical_video_views_100,0)) > 0 THEN 1 ELSE 0 END) AS video_views_100_mismatches
FROM intersected
"""

HYBRID_PARITY_SQL = """
WITH legacy AS (
  SELECT
    date AS report_date,
    CAST(campaign_id AS CHAR) AS platform_campaign_id,
    CAST(creative_id AS CHAR) AS platform_delivery_entity_id,
    SUM(clicks) AS legacy_clicks,
    SUM(views) AS legacy_views,
    SUM(view_25) AS legacy_video_views_25,
    SUM(view_50) AS legacy_video_views_50,
    SUM(view_75) AS legacy_video_views_75,
    SUM(view_100) AS legacy_video_views_100
  FROM hyb_stats
  WHERE date >= %s
  GROUP BY date, campaign_id, creative_id
),
canonical AS (
  SELECT
    report_date,
    platform_campaign_id,
    platform_delivery_entity_id,
    SUM(clicks) AS canonical_clicks,
    SUM(views) AS canonical_views,
    SUM(video_views_25) AS canonical_video_views_25,
    SUM(video_views_50) AS canonical_video_views_50,
    SUM(video_views_75) AS canonical_video_views_75,
    SUM(video_views_100) AS canonical_video_views_100
  FROM canonical_fact_ads_daily
  WHERE source_key='hybrid'
    AND fact_scope='delivery_entity'
    AND report_date >= %s
  GROUP BY report_date, platform_campaign_id, platform_delivery_entity_id
),
intersected AS (
  SELECT
    l.report_date,
    l.platform_campaign_id,
    l.platform_delivery_entity_id,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_views,
    c.canonical_views,
    l.legacy_video_views_25,
    c.canonical_video_views_25,
    l.legacy_video_views_50,
    c.canonical_video_views_50,
    l.legacy_video_views_75,
    c.canonical_video_views_75,
    l.legacy_video_views_100,
    c.canonical_video_views_100
  FROM legacy l
  JOIN canonical c
    ON c.report_date = l.report_date
   AND CONVERT(c.platform_campaign_id USING utf8mb4) = CONVERT(l.platform_campaign_id USING utf8mb4)
   AND CONVERT(c.platform_delivery_entity_id USING utf8mb4) = CONVERT(l.platform_delivery_entity_id USING utf8mb4)
),
legacy_only AS (
  SELECT COUNT(*) AS legacy_only_rows
  FROM legacy l
  LEFT JOIN canonical c
    ON c.report_date = l.report_date
   AND CONVERT(c.platform_campaign_id USING utf8mb4) = CONVERT(l.platform_campaign_id USING utf8mb4)
   AND CONVERT(c.platform_delivery_entity_id USING utf8mb4) = CONVERT(l.platform_delivery_entity_id USING utf8mb4)
  WHERE c.report_date IS NULL
),
canonical_only AS (
  SELECT
    COUNT(*) AS canonical_only_rows,
    MIN(c.report_date) AS canonical_only_min_date,
    MAX(c.report_date) AS canonical_only_max_date
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND CONVERT(l.platform_campaign_id USING utf8mb4) = CONVERT(c.platform_campaign_id USING utf8mb4)
   AND CONVERT(l.platform_delivery_entity_id USING utf8mb4) = CONVERT(c.platform_delivery_entity_id USING utf8mb4)
  WHERE l.report_date IS NULL
),
legacy_bounds AS (
  SELECT MAX(report_date) AS legacy_max_report_date
  FROM legacy
),
canonical_split AS (
  SELECT
    SUM(CASE WHEN l.report_date IS NULL AND c.report_date <= b.legacy_max_report_date THEN 1 ELSE 0 END) AS canonical_only_in_legacy_window,
    SUM(CASE WHEN l.report_date IS NULL AND c.report_date > b.legacy_max_report_date THEN 1 ELSE 0 END) AS canonical_only_after_legacy_max
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND CONVERT(l.platform_campaign_id USING utf8mb4) = CONVERT(c.platform_campaign_id USING utf8mb4)
   AND CONVERT(l.platform_delivery_entity_id USING utf8mb4) = CONVERT(c.platform_delivery_entity_id USING utf8mb4)
  CROSS JOIN legacy_bounds b
)
SELECT
  (SELECT COUNT(*) FROM intersected) AS compare_rows,
  (SELECT legacy_only_rows FROM legacy_only) AS legacy_only_rows,
  (SELECT canonical_only_rows FROM canonical_only) AS canonical_only_rows,
  (SELECT canonical_only_min_date FROM canonical_only) AS canonical_only_min_date,
  (SELECT canonical_only_max_date FROM canonical_only) AS canonical_only_max_date,
  (SELECT legacy_max_report_date FROM legacy_bounds) AS legacy_max_report_date,
  (SELECT canonical_only_in_legacy_window FROM canonical_split) AS canonical_only_in_legacy_window,
  (SELECT canonical_only_after_legacy_max FROM canonical_split) AS canonical_only_after_legacy_max,
  SUM(CASE WHEN ABS(COALESCE(legacy_clicks,0)-COALESCE(canonical_clicks,0)) > %s THEN 1 ELSE 0 END) AS clicks_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_views,0)-COALESCE(canonical_views,0)) > 0 THEN 1 ELSE 0 END) AS views_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_25,0)-COALESCE(canonical_video_views_25,0)) > 0 THEN 1 ELSE 0 END) AS video_views_25_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_50,0)-COALESCE(canonical_video_views_50,0)) > 0 THEN 1 ELSE 0 END) AS video_views_50_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_75,0)-COALESCE(canonical_video_views_75,0)) > 0 THEN 1 ELSE 0 END) AS video_views_75_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_100,0)-COALESCE(canonical_video_views_100,0)) > 0 THEN 1 ELSE 0 END) AS video_views_100_mismatches
FROM intersected
"""

GETINTENT_PARITY_SQL = """
WITH legacy AS (
  SELECT
    day AS report_date,
    CAST(campaign_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS platform_campaign_id,
    CAST(creative_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS platform_delivery_entity_id,
    SUM(imps) AS legacy_impressions,
    SUM(clicks) AS legacy_clicks,
    SUM(video_completion_25) AS legacy_video_views_25,
    SUM(video_completion_50) AS legacy_video_views_50,
    SUM(video_completion_75) AS legacy_video_views_75,
    SUM(video_completion_100) AS legacy_video_views_100
  FROM git_statistic
  WHERE day >= %s
  GROUP BY day, campaign_id, creative_id
),
canonical AS (
  SELECT
    report_date,
    platform_campaign_id COLLATE utf8mb4_unicode_ci AS platform_campaign_id,
    platform_delivery_entity_id COLLATE utf8mb4_unicode_ci AS platform_delivery_entity_id,
    SUM(impressions) AS canonical_impressions,
    SUM(clicks) AS canonical_clicks,
    SUM(video_views_25) AS canonical_video_views_25,
    SUM(video_views_50) AS canonical_video_views_50,
    SUM(video_views_75) AS canonical_video_views_75,
    SUM(video_views_100) AS canonical_video_views_100
  FROM canonical_fact_ads_daily
  WHERE source_key='getintent'
    AND fact_scope='delivery_entity'
    AND report_date >= %s
  GROUP BY report_date, platform_campaign_id, platform_delivery_entity_id
),
intersected AS (
  SELECT
    l.report_date,
    l.platform_campaign_id,
    l.platform_delivery_entity_id,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_video_views_25,
    c.canonical_video_views_25,
    l.legacy_video_views_50,
    c.canonical_video_views_50,
    l.legacy_video_views_75,
    c.canonical_video_views_75,
    l.legacy_video_views_100,
    c.canonical_video_views_100
  FROM legacy l
  JOIN canonical c
    ON c.report_date = l.report_date
   AND c.platform_campaign_id = l.platform_campaign_id
   AND c.platform_delivery_entity_id = l.platform_delivery_entity_id
),
legacy_only AS (
  SELECT COUNT(*) AS legacy_only_rows
  FROM legacy l
  LEFT JOIN canonical c
    ON c.report_date = l.report_date
   AND c.platform_campaign_id = l.platform_campaign_id
   AND c.platform_delivery_entity_id = l.platform_delivery_entity_id
  WHERE c.report_date IS NULL
),
canonical_only AS (
  SELECT
    COUNT(*) AS canonical_only_rows,
    MIN(c.report_date) AS canonical_only_min_date,
    MAX(c.report_date) AS canonical_only_max_date
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND l.platform_campaign_id = c.platform_campaign_id
   AND l.platform_delivery_entity_id = c.platform_delivery_entity_id
  WHERE l.report_date IS NULL
),
legacy_bounds AS (
  SELECT MAX(report_date) AS legacy_max_report_date
  FROM legacy
),
canonical_split AS (
  SELECT
    SUM(CASE WHEN l.report_date IS NULL AND c.report_date <= b.legacy_max_report_date THEN 1 ELSE 0 END) AS canonical_only_in_legacy_window,
    SUM(CASE WHEN l.report_date IS NULL AND c.report_date > b.legacy_max_report_date THEN 1 ELSE 0 END) AS canonical_only_after_legacy_max
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND l.platform_campaign_id = c.platform_campaign_id
   AND l.platform_delivery_entity_id = c.platform_delivery_entity_id
  CROSS JOIN legacy_bounds b
)
SELECT
  (SELECT COUNT(*) FROM intersected) AS compare_rows,
  (SELECT legacy_only_rows FROM legacy_only) AS legacy_only_rows,
  (SELECT canonical_only_rows FROM canonical_only) AS canonical_only_rows,
  (SELECT canonical_only_min_date FROM canonical_only) AS canonical_only_min_date,
  (SELECT canonical_only_max_date FROM canonical_only) AS canonical_only_max_date,
  (SELECT legacy_max_report_date FROM legacy_bounds) AS legacy_max_report_date,
  (SELECT canonical_only_in_legacy_window FROM canonical_split) AS canonical_only_in_legacy_window,
  (SELECT canonical_only_after_legacy_max FROM canonical_split) AS canonical_only_after_legacy_max,
  SUM(CASE WHEN ABS(COALESCE(legacy_impressions,0)-COALESCE(canonical_impressions,0)) > %s THEN 1 ELSE 0 END) AS impressions_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_clicks,0)-COALESCE(canonical_clicks,0)) > %s THEN 1 ELSE 0 END) AS clicks_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_25,0)-COALESCE(canonical_video_views_25,0)) > 0 THEN 1 ELSE 0 END) AS video_views_25_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_50,0)-COALESCE(canonical_video_views_50,0)) > 0 THEN 1 ELSE 0 END) AS video_views_50_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_75,0)-COALESCE(canonical_video_views_75,0)) > 0 THEN 1 ELSE 0 END) AS video_views_75_mismatches,
  SUM(CASE WHEN ABS(COALESCE(legacy_video_views_100,0)-COALESCE(canonical_video_views_100,0)) > 0 THEN 1 ELSE 0 END) AS video_views_100_mismatches
FROM intersected
"""

YANDEX_DIRECT_PARITY_SQL = """
WITH prod AS (
  SELECT
    report_date,
    platform_account_id,
    platform_campaign_id,
    platform_delivery_entity_id,
    ROUND(SUM(COALESCE(spend, 0)), 6) AS prod_spend,
    SUM(COALESCE(impressions, 0)) AS prod_impressions,
    SUM(COALESCE(clicks, 0)) AS prod_clicks,
    SUM(COALESCE(conversions, 0)) AS prod_conversions
  FROM canonical_fact_ads_daily
  WHERE source_key='yandex_direct'
    AND fact_scope='delivery_entity'
    AND report_date >= %s
  GROUP BY report_date, platform_account_id, platform_campaign_id, platform_delivery_entity_id
),
shadow AS (
  SELECT
    report_date,
    platform_account_id,
    platform_campaign_id,
    platform_delivery_entity_id,
    ROUND(SUM(COALESCE(spend, 0)), 6) AS shadow_spend,
    SUM(COALESCE(impressions, 0)) AS shadow_impressions,
    SUM(COALESCE(clicks, 0)) AS shadow_clicks,
    SUM(COALESCE(conversions, 0)) AS shadow_conversions
  FROM canonical_fact_ads_daily
  WHERE source_key='yandex_direct_api_shadow'
    AND fact_scope='delivery_entity'
    AND report_date >= %s
  GROUP BY report_date, platform_account_id, platform_campaign_id, platform_delivery_entity_id
),
intersected AS (
  SELECT
    p.report_date,
    p.platform_account_id,
    p.platform_campaign_id,
    p.platform_delivery_entity_id,
    p.prod_spend,
    s.shadow_spend,
    p.prod_impressions,
    s.shadow_impressions,
    p.prod_clicks,
    s.shadow_clicks,
    p.prod_conversions,
    s.shadow_conversions
  FROM prod p
  JOIN shadow s
    ON s.report_date = p.report_date
   AND s.platform_account_id = p.platform_account_id
   AND s.platform_campaign_id = p.platform_campaign_id
   AND s.platform_delivery_entity_id = p.platform_delivery_entity_id
),
prod_only AS (
  SELECT COUNT(*) AS prod_only_rows
  FROM prod p
  LEFT JOIN shadow s
    ON s.report_date = p.report_date
   AND s.platform_account_id = p.platform_account_id
   AND s.platform_campaign_id = p.platform_campaign_id
   AND s.platform_delivery_entity_id = p.platform_delivery_entity_id
  WHERE s.report_date IS NULL
),
shadow_only AS (
  SELECT
    COUNT(*) AS shadow_only_rows,
    MIN(s.report_date) AS shadow_only_min_date,
    MAX(s.report_date) AS shadow_only_max_date
  FROM shadow s
  LEFT JOIN prod p
    ON p.report_date = s.report_date
   AND p.platform_account_id = s.platform_account_id
   AND p.platform_campaign_id = s.platform_campaign_id
   AND p.platform_delivery_entity_id = s.platform_delivery_entity_id
  WHERE p.report_date IS NULL
),
prod_bounds AS (
  SELECT MAX(report_date) AS prod_max_report_date
  FROM prod
),
shadow_bounds AS (
  SELECT MAX(report_date) AS shadow_max_report_date
  FROM shadow
)
SELECT
  (SELECT COUNT(*) FROM intersected) AS compare_rows,
  (SELECT prod_only_rows FROM prod_only) AS prod_only_rows,
  (SELECT shadow_only_rows FROM shadow_only) AS shadow_only_rows,
  (SELECT shadow_only_min_date FROM shadow_only) AS shadow_only_min_date,
  (SELECT shadow_only_max_date FROM shadow_only) AS shadow_only_max_date,
  (SELECT prod_max_report_date FROM prod_bounds) AS prod_max_report_date,
  (SELECT shadow_max_report_date FROM shadow_bounds) AS shadow_max_report_date,
  SUM(CASE WHEN ABS(COALESCE(prod_spend,0)-COALESCE(shadow_spend,0)) > %s THEN 1 ELSE 0 END) AS spend_mismatches,
  SUM(CASE WHEN ABS(COALESCE(prod_impressions,0)-COALESCE(shadow_impressions,0)) > %s THEN 1 ELSE 0 END) AS impressions_mismatches,
  SUM(CASE WHEN ABS(COALESCE(prod_clicks,0)-COALESCE(shadow_clicks,0)) > %s THEN 1 ELSE 0 END) AS clicks_mismatches,
  SUM(CASE WHEN ABS(COALESCE(prod_conversions,0)-COALESCE(shadow_conversions,0)) > %s THEN 1 ELSE 0 END) AS conversions_mismatches
FROM intersected
"""


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--recent-days', type=int, default=7)
    parser.add_argument('--freshness-days', type=int, default=2)
    return parser.parse_args()


def fetch_one(cur: mysql.connector.cursor.MySQLCursorDict, sql: str, params=()):
    cur.execute(sql, params)
    return cur.fetchone()


def fetch_all(cur: mysql.connector.cursor.MySQLCursorDict, sql: str, params=()):
    cur.execute(sql, params)
    return cur.fetchall()


def parity_sql_for(source_key: str) -> str:
    if source_key == 'linkedin':
        return LINKEDIN_PARITY_SQL
    if source_key == 'reddit':
        return REDDIT_PARITY_SQL
    if source_key == 'vk_ads_v2':
        return VK_PARITY_SQL
    if source_key == 'hybrid':
        return HYBRID_PARITY_SQL
    if source_key == 'getintent':
        return GETINTENT_PARITY_SQL
    if source_key == 'yandex_direct':
        return YANDEX_DIRECT_PARITY_SQL
    raise ValueError(source_key)


def parity_params_for(source_key: str, cfg: dict, recent_from):
    if source_key in {'vk_ads_v2', 'getintent'}:
        return (
            recent_from,
            recent_from,
            cfg['policy']['impressions_tolerance_abs'],
            cfg['policy']['clicks_tolerance_abs'],
        )
    if source_key == 'hybrid':
        return (
            recent_from,
            recent_from,
            cfg['policy']['clicks_tolerance_abs'],
        )
    return (
        recent_from,
        recent_from,
        cfg['policy']['spend_tolerance_abs'],
        cfg['policy']['impressions_tolerance_abs'],
        cfg['policy']['clicks_tolerance_abs'],
        cfg['policy']['conversions_tolerance_abs'],
    )


def coverage_sql_for(source_key: str) -> str | None:
    if source_key == 'linkedin':
        return LINKEDIN_COVERAGE_SQL
    return None


def normalize_policy_row(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        'source_key': row['source_key'],
        'authority_fact_scope': row['authority_fact_scope'],
        'comparison_level': row['comparison_level'],
        'spend_tolerance_abs': float(row['spend_tolerance_abs'] or 0),
        'impressions_tolerance_abs': int(row['impressions_tolerance_abs'] or 0),
        'clicks_tolerance_abs': int(row['clicks_tolerance_abs'] or 0),
        'conversions_tolerance_abs': int(row['conversions_tolerance_abs'] or 0),
        'coverage_mode': row['coverage_mode'] or 'strict',
        'is_blocking': bool(row['is_blocking']),
    }


def total_parity_mismatches(row: dict) -> int:
    total = 0
    for key, value in row.items():
        if key.endswith('_mismatches'):
            total += int(value or 0)
    return total


def as_int(value) -> int:
    return int(value or 0)


def parse_event_payload(value):
    if value is None or value == '':
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode('utf-8', errors='ignore')
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return None


def build_yandex_shadow_cutover(cur, policy: dict | None, recent_from):
    shadow_run = fetch_one(cur, LATEST_RUN_SQL, ('yandex_direct_api_shadow',))
    shadow_summary_event = fetch_one(cur, LATEST_EVENT_SQL, ('yandex_direct_api_shadow', 'collector_summary'))
    shadow_missing_event = fetch_one(cur, LATEST_EVENT_SQL, ('yandex_direct_api_shadow', 'critical_account_day_missing'))
    summary_payload = parse_event_payload(shadow_summary_event.get('event_payload')) if shadow_summary_event else None
    missing_payload = parse_event_payload(shadow_missing_event.get('event_payload')) if shadow_missing_event else None
    parity = None
    coverage = None
    if policy:
        parity = fetch_one(cur, YANDEX_DIRECT_PARITY_SQL, parity_params_for('yandex_direct', {'policy': policy}, recent_from))
        coverage = {
            'prod_only_rows': int(parity.get('prod_only_rows') or 0) if parity else 0,
            'shadow_only_rows': int(parity.get('shadow_only_rows') or 0) if parity else 0,
            'prod_max_report_date': parity.get('prod_max_report_date') if parity else None,
            'shadow_max_report_date': parity.get('shadow_max_report_date') if parity else None,
            'shadow_only_min_date': parity.get('shadow_only_min_date') if parity else None,
            'shadow_only_max_date': parity.get('shadow_only_max_date') if parity else None,
        }
    return {
        'shadow_run': shadow_run,
        'parity': parity,
        'coverage': coverage,
        'checkpoint_account_day_results': (summary_payload or {}).get('checkpoint_account_day_results', []),
        'missing_critical_account_day_sample': (
            (missing_payload or {}).get('missing_critical_account_days')
            or (summary_payload or {}).get('missing_critical_account_day_sample')
            or []
        ),
    }


def format_run(run: dict | None) -> list[str]:
    if not run:
        return ['latest_run: none']
    return [
        f"latest_run: id={run['id']} status={run['status']} mode={run['run_mode']} type={run['run_type']}",
        f"latest_run_time: started_at={run['started_at']} finished_at={run['finished_at']}",
        f"rows: read={run['rows_read']} written={run['rows_written']} updated={run['rows_updated']} errors={run['error_count']}",
        f"error_summary: {run['error_summary'] or '-'}",
    ]


def format_counts(rows: list[dict]) -> list[str]:
    if not rows:
        return ['recent_counts: none']
    lines = ['recent_counts:']
    for row in rows:
        lines.append(
            f"  - scope={row['fact_scope']} grain={row['native_grain']} rows={row['row_count']} "
            f"window={row['min_date']}..{row['max_date']}"
        )
    return lines


def format_parity(row: dict) -> list[str]:
    if not row:
        return ['parity: none']
    if 'views_mismatches' in row and 'spend_mismatches' not in row and 'impressions_mismatches' not in row:
        return [
            f"parity: compare_rows={as_int(row['compare_rows'])}",
            f"parity_mismatches: clicks={as_int(row['clicks_mismatches'])} "
            f"views={as_int(row['views_mismatches'])} "
            f"video_views_25={as_int(row['video_views_25_mismatches'])} "
            f"video_views_50={as_int(row['video_views_50_mismatches'])} "
            f"video_views_75={as_int(row['video_views_75_mismatches'])} "
            f"video_views_100={as_int(row['video_views_100_mismatches'])}",
        ]
    if 'video_views_25_mismatches' in row:
        return [
            f"parity: compare_rows={as_int(row['compare_rows'])}",
            f"parity_mismatches: impressions={as_int(row['impressions_mismatches'])} "
            f"clicks={as_int(row['clicks_mismatches'])} "
            f"video_views_25={as_int(row['video_views_25_mismatches'])} "
            f"video_views_50={as_int(row['video_views_50_mismatches'])} "
            f"video_views_75={as_int(row['video_views_75_mismatches'])} "
            f"video_views_100={as_int(row['video_views_100_mismatches'])}",
        ]
    return [
        f"parity: compare_rows={as_int(row['compare_rows'])}",
        f"parity_mismatches: spend={as_int(row['spend_mismatches'])} impressions={as_int(row['impressions_mismatches'])} "
        f"clicks={as_int(row['clicks_mismatches'])} conversions={as_int(row['conversions_mismatches'])}",
    ]


def format_coverage(row: dict | None) -> list[str]:
    if not row:
        return ['coverage: none']
    if row.get('canonical_only_min_date') and row.get('canonical_only_max_date'):
        canonical_only_range = f"{row['canonical_only_min_date']}..{row['canonical_only_max_date']}"
    else:
        canonical_only_range = '-'
    return [
        f"coverage: legacy_only_rows={row['legacy_only_rows']} canonical_only_rows={row['canonical_only_rows']} "
        f"canonical_only_in_legacy_window={row.get('canonical_only_in_legacy_window', 0)} "
        f"canonical_only_rows_after_legacy_max={row.get('canonical_only_rows_after_legacy_max', 0)} "
        f"legacy_max_report_date={row.get('legacy_max_report_date')} "
        f"canonical_only_range={canonical_only_range}",
    ]


def main() -> int:
    args = parse_args()
    today = datetime.utcnow().date()
    recent_from = today - timedelta(days=args.recent_days)
    fresh_from = today - timedelta(days=args.freshness_days)

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)

    overall_warn = False
    print(f'canonical-shadow-monitor utc_now={datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")} recent_days={args.recent_days} freshness_days={args.freshness_days}')

    for source_key, cfg in SOURCES.items():
        policy = normalize_policy_row(fetch_one(cur, POLICY_SQL, (source_key,)))
        source_cfg = dict(cfg)
        source_cfg['policy'] = policy
        latest_run = fetch_one(cur, LATEST_RUN_SQL, (source_key,))
        if cfg.get('source_kind') == 'analytics':
            recent_counts = fetch_all(cur, ANALYTICS_ROW_COUNTS_SQL, (source_key, recent_from))
        else:
            recent_counts = fetch_all(cur, ROW_COUNTS_SQL, (source_key, recent_from))
        fresh = None
        parity = None
        if cfg.get('source_kind') == 'analytics':
            fresh = fetch_one(cur, ANALYTICS_FRESH_ROWS_SQL, (source_key, cfg.get('gate_scope', 'traffic'), fresh_from))
        elif policy:
            fresh = fetch_one(cur, FRESH_ROWS_SQL, (source_key, policy['authority_fact_scope'], fresh_from))
            if source_key != 'yandex_direct':
                parity = fetch_one(cur, parity_sql_for(source_key), parity_params_for(source_key, source_cfg, recent_from))
        coverage_sql = coverage_sql_for(source_key)
        coverage = None
        yandex_shadow_cutover = (
            build_yandex_shadow_cutover(cur, policy, recent_from)
            if source_key == 'yandex_direct' and YANDEX_DIRECT_SHADOW_CUTOVER_ENABLED
            else None
        )
        if source_key in {'vk_ads_v2', 'hybrid', 'getintent'} and parity:
            coverage = {
                'legacy_only_rows': int(parity.get('legacy_only_rows') or 0),
                'canonical_only_rows': int(parity.get('canonical_only_rows') or 0),
                'canonical_only_in_legacy_window': int(parity.get('canonical_only_in_legacy_window') or 0),
                'canonical_only_rows_after_legacy_max': int(parity.get('canonical_only_after_legacy_max') or 0),
                'legacy_max_report_date': parity.get('legacy_max_report_date'),
                'canonical_only_min_date': parity.get('canonical_only_min_date'),
                'canonical_only_max_date': parity.get('canonical_only_max_date'),
            }
        elif coverage_sql and policy:
            coverage_rows = fetch_all(cur, coverage_sql, (recent_from, recent_from))
            legacy_only = sum(int(r['legacy_only_rows'] or 0) for r in coverage_rows)
            canonical_only = sum(int(r['canonical_only_rows'] or 0) for r in coverage_rows)
            canonical_only_after_legacy_max = sum(int(r.get('canonical_only_rows_after_legacy_max') or 0) for r in coverage_rows)
            legacy_max_report_date = None
            canonical_only_min_date = None
            canonical_only_max_date = None
            for r in coverage_rows:
                if r.get('legacy_max_report_date') is not None:
                    legacy_max_report_date = r['legacy_max_report_date']
                if r.get('canonical_only_min_date') is not None:
                    if canonical_only_min_date is None or r['canonical_only_min_date'] < canonical_only_min_date:
                        canonical_only_min_date = r['canonical_only_min_date']
                if r.get('canonical_only_max_date') is not None:
                    if canonical_only_max_date is None or r['canonical_only_max_date'] > canonical_only_max_date:
                        canonical_only_max_date = r['canonical_only_max_date']
            coverage = {
                'legacy_only_rows': legacy_only,
                'canonical_only_rows': canonical_only,
                'canonical_only_rows_after_legacy_max': canonical_only_after_legacy_max,
                'legacy_max_report_date': legacy_max_report_date,
                'canonical_only_min_date': canonical_only_min_date,
                'canonical_only_max_date': canonical_only_max_date,
            }

        statuses = []
        if not policy and cfg.get('source_kind') != 'analytics':
            statuses.append('WARN_CONFIG:missing_source_parity_policy')
        if not latest_run:
            statuses.append('FAIL_RUN:no_run')
        elif latest_run['status'] != 'success':
            statuses.append(f"FAIL_RUN:latest_run_status={latest_run['status']}")

        fresh_rows = int(fresh['recent_rows'] or 0) if fresh else 0
        max_report_date = fresh['max_report_date'] if fresh else None
        gate_scope = policy['authority_fact_scope'] if policy else cfg.get('gate_scope', 'unknown')
        if cfg.get('source_kind') == 'analytics':
            if fresh_rows == 0 or max_report_date is None:
                statuses.append(f'WARN_FRESHNESS:no_fresh_rows_for_gate_scope={gate_scope}')
        elif policy and (fresh_rows == 0 or max_report_date is None):
            statuses.append(f'WARN_FRESHNESS:no_fresh_rows_for_gate_scope={gate_scope}')

        if policy and parity and as_int(parity.get('compare_rows')) > 0 and total_parity_mismatches(parity) > 0:
            statuses.append('WARN_PARITY:intersection_mismatches_exceed_tolerance')

        if coverage and policy:
            legacy_only = int(coverage['legacy_only_rows'] or 0)
            canonical_only = int(coverage['canonical_only_rows'] or 0)
            canonical_only_after_legacy_max = int(coverage.get('canonical_only_rows_after_legacy_max') or 0)
            legacy_max_report_date = coverage.get('legacy_max_report_date')
            canonical_only_min_date = coverage.get('canonical_only_min_date')
            if legacy_only > 0:
                statuses.append('WARN_COVERAGE:legacy_only_rows_present')
            if (
                canonical_only > 0
                and canonical_only_min_date is not None
                and legacy_max_report_date is not None
                and canonical_only_min_date > legacy_max_report_date
                and policy.get('coverage_mode') == 'allow_canonical_ahead'
            ):
                statuses.append('INFO_COVERAGE:canonical_ahead_of_legacy')
            elif source_key in {'vk_ads_v2', 'hybrid', 'getintent'} and canonical_only > 0 and int(coverage.get('canonical_only_in_legacy_window') or 0) > 0:
                statuses.append('WARN_COVERAGE:canonical_only_rows_inside_legacy_window')
            elif canonical_only > 0 and canonical_only != canonical_only_after_legacy_max:
                statuses.append('WARN_COVERAGE:canonical_only_rows_inside_legacy_window')

        if source_key == 'yandex_direct' and yandex_shadow_cutover:
            shadow_run = yandex_shadow_cutover.get('shadow_run') or {}
            shadow_parity = yandex_shadow_cutover.get('parity') or {}
            shadow_coverage = yandex_shadow_cutover.get('coverage') or {}
            missing_critical = yandex_shadow_cutover.get('missing_critical_account_day_sample') or []
            if shadow_run.get('status') and shadow_run.get('status') != 'success':
                statuses.append(f"INFO_CUTOVER:shadow_run_status={shadow_run.get('status')}")
            if shadow_parity and as_int(shadow_parity.get('compare_rows')) > 0 and total_parity_mismatches(shadow_parity) > 0:
                statuses.append(
                    f"INFO_CUTOVER:shadow_parity_mismatches={total_parity_mismatches(shadow_parity)}"
                )
            if int(shadow_coverage.get('prod_only_rows') or 0) > 0 or int(shadow_coverage.get('shadow_only_rows') or 0) > 0:
                statuses.append(
                    'INFO_CUTOVER:shadow_coverage prod_only={} shadow_only={}'.format(
                        int(shadow_coverage.get('prod_only_rows') or 0),
                        int(shadow_coverage.get('shadow_only_rows') or 0),
                    )
                )
            if missing_critical:
                statuses.append(f'INFO_CUTOVER:shadow_missing_critical_account_days={len(missing_critical)}')

        blocking_statuses = [s for s in statuses if s.startswith('FAIL_RUN') or s.startswith('WARN_')]
        info_statuses = [s for s in statuses if s.startswith('INFO_')]

        if blocking_statuses:
            status = 'WARN'
            if any(s.startswith('WARN_CONFIG') for s in blocking_statuses):
                non_config_blockers = [s for s in blocking_statuses if not s.startswith('WARN_CONFIG')]
            else:
                non_config_blockers = blocking_statuses
            if cfg.get('source_kind') == 'analytics':
                if non_config_blockers and cfg.get('is_blocking_default', False):
                    overall_warn = True
            elif non_config_blockers and (policy is None or policy.get('is_blocking', True)):
                overall_warn = True
        elif info_statuses:
            status = 'INFO'
        else:
            status = 'OK'

        print()
        print(f'[{status}] source={source_key}')
        print(f'gate_scope: {gate_scope}')
        print(f'gate_note: {cfg["gate_note"]}')
        if policy:
            print(
                'policy: '
                f"comparison_level={policy['comparison_level']} "
                f"coverage_mode={policy['coverage_mode']} "
                f"is_blocking={int(policy['is_blocking'])}"
            )
            print(
                'tolerances: '
                f"spend_abs={policy['spend_tolerance_abs']} "
                f"impressions_abs={policy['impressions_tolerance_abs']} "
                f"clicks_abs={policy['clicks_tolerance_abs']} "
                f"conversions_abs={policy['conversions_tolerance_abs']}"
            )
        elif cfg.get('source_kind') == 'analytics':
            print('policy: canonical-only analytics source parity=none is_blocking=0')
        else:
            print('policy: missing')
        for line in format_run(latest_run):
            print(line)
        print(f"fresh_gate_rows: count={fresh_rows} max_report_date={max_report_date}")
        for line in format_counts(recent_counts):
            print(line)
        for line in format_parity(parity):
            print(line)
        for line in format_coverage(coverage):
            print(line)
        if source_key == 'yandex_direct' and yandex_shadow_cutover:
            shadow_run = yandex_shadow_cutover.get('shadow_run')
            shadow_parity = yandex_shadow_cutover.get('parity')
            shadow_coverage = yandex_shadow_cutover.get('coverage')
            if shadow_run:
                print('shadow_latest_run: status={} read={} written={} updated={} errors={}'.format(
                    shadow_run.get('status'),
                    shadow_run.get('rows_read'),
                    shadow_run.get('rows_written'),
                    shadow_run.get('rows_updated'),
                    shadow_run.get('error_count'),
                ))
            if shadow_parity:
                print(
                    'shadow_parity: compare_rows={} mismatches_total={}'.format(
                        as_int(shadow_parity.get('compare_rows')),
                        total_parity_mismatches(shadow_parity),
                    )
                )
            if shadow_coverage:
                print(
                    'shadow_coverage: prod_only_rows={} shadow_only_rows={} prod_max_report_date={} shadow_max_report_date={}'.format(
                        int(shadow_coverage.get('prod_only_rows') or 0),
                        int(shadow_coverage.get('shadow_only_rows') or 0),
                        shadow_coverage.get('prod_max_report_date'),
                        shadow_coverage.get('shadow_max_report_date'),
                    )
                )
            checkpoint_results = yandex_shadow_cutover.get('checkpoint_account_day_results') or []
            if checkpoint_results:
                sample = checkpoint_results[:6]
                print(f'shadow_checkpoint_results: {sample}')
            missing_critical = yandex_shadow_cutover.get('missing_critical_account_day_sample') or []
            if missing_critical:
                print(f'shadow_missing_critical_account_days: {missing_critical[:6]}')
        print(f"statuses: {', '.join(statuses) if statuses else '-'}")

    cur.close()
    conn.close()
    return 1 if overall_warn else 0


if __name__ == '__main__':
    sys.exit(main())

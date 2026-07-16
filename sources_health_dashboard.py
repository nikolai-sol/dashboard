#!/usr/bin/env python3
"""Unified operational health dashboard for canonical reporting sources."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional

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
        'gate_note': 'canonical analytics freshness on traffic scope',
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

LATEST_DATA_SQL = """
SELECT MAX(report_date) AS max_report_date
FROM canonical_fact_ads_daily
WHERE source_key = %s
"""

ANALYTICS_ROW_COUNTS_SQL = """
SELECT
  source_key,
  analytics_scope AS fact_scope,
  'analytics_slice' AS native_grain,
  COUNT(*) AS row_count,
  MIN(report_date) AS min_date,
  MAX(report_date) AS max_date
FROM canonical_fact_site_analytics_daily
WHERE source_key = %s
  AND report_date >= %s
GROUP BY source_key, analytics_scope
ORDER BY analytics_scope
"""

ANALYTICS_LATEST_DATA_SQL = """
SELECT MAX(report_date) AS max_report_date
FROM canonical_fact_site_analytics_daily
WHERE source_key = %s
  AND analytics_scope = %s
"""

DATA_COVERAGE_SQL = """
SELECT
  s.source_key,
  COALESCE(a.accounts, 0) AS accounts,
  COALESCE(c.campaigns, 0) AS campaigns,
  COALESCE(d.delivery_entities, 0) AS delivery_entities
FROM (
  SELECT %s AS source_key
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
) s
LEFT JOIN (
  SELECT source_key, COUNT(*) AS accounts
  FROM canonical_source_accounts
  GROUP BY source_key
) a ON a.source_key = s.source_key
LEFT JOIN (
  SELECT source_key, COUNT(*) AS campaigns
  FROM canonical_source_campaigns
  GROUP BY source_key
) c ON c.source_key = s.source_key
LEFT JOIN (
  SELECT source_key, COUNT(*) AS delivery_entities
  FROM canonical_source_delivery_entities
  GROUP BY source_key
) d ON d.source_key = s.source_key
ORDER BY s.source_key
"""

DATA_FRESHNESS_SQL = """
SELECT
  s.source_key,
  f.max_report_date AS latest_report_date
FROM (
  SELECT %s AS source_key
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
) s
LEFT JOIN (
  SELECT source_key, MAX(report_date) AS max_report_date
  FROM canonical_fact_ads_daily
  GROUP BY source_key
) f ON f.source_key = s.source_key
ORDER BY s.source_key
"""

LAST_RUNS_SQL = """
SELECT
  t.source_key,
  t.id AS last_run_id,
  t.status,
  t.run_type,
  t.started_at,
  t.finished_at,
  t.rows_read,
  t.rows_written,
  t.rows_updated,
  t.error_count,
  t.error_summary
FROM canonical_collector_runs t
JOIN (
  SELECT source_key, MAX(id) AS max_id
  FROM canonical_collector_runs
  WHERE source_key IN (%s, %s, %s, %s, %s, %s)
  GROUP BY source_key
) last_run
  ON last_run.source_key = t.source_key
 AND last_run.max_id = t.id
ORDER BY t.source_key
"""

DATA_WINDOW_SQL = """
SELECT
  s.source_key,
  f.min_report_date AS from_date,
  f.max_report_date AS to_date
FROM (
  SELECT %s AS source_key
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
  UNION ALL SELECT %s
) s
LEFT JOIN (
  SELECT source_key, MIN(report_date) AS min_report_date, MAX(report_date) AS max_report_date
  FROM canonical_fact_ads_daily
  GROUP BY source_key
) f ON f.source_key = s.source_key
ORDER BY s.source_key
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', action='store_true', dest='as_json')
    parser.add_argument('--recent-days', type=int, default=7)
    parser.add_argument('--freshness-days', type=int, default=2)
    return parser.parse_args()


def fetch_one(cur, sql: str, params=()):
    cur.execute(sql, params)
    return cur.fetchone()


def fetch_all(cur, sql: str, params=()):
    cur.execute(sql, params)
    return cur.fetchall()


def to_jsonable(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat(sep=' ')
    return value


def compact_rows(rows: List[Dict]) -> List[Dict]:
    result = []
    for row in rows:
        result.append({key: to_jsonable(value) for key, value in row.items()})
    return result


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


def normalize_policy_row(row: Optional[Dict]) -> Optional[Dict]:
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


def source_config(source_key: str) -> Dict:
    if source_key not in SOURCES:
        raise ValueError(source_key)
    config = dict(SOURCES[source_key])
    config.setdefault('source_kind', 'ads')
    config.setdefault('gate_scope', 'unknown')
    config.setdefault('is_blocking_default', True)
    return config


def default_blocking(source_key: str, policy: Optional[Dict]) -> bool:
    if source_key == 'yandex_metrika':
        return False
    if policy is not None:
        return bool(policy['is_blocking'])
    return bool(source_config(source_key)['is_blocking_default'])


def build_source_fact_snapshot(cur, source_key: str, recent_from) -> Dict:
    config = source_config(source_key)
    if config['source_kind'] == 'analytics':
        latest_data = fetch_one(
            cur,
            ANALYTICS_LATEST_DATA_SQL,
            (source_key, config['gate_scope']),
        )
        recent_counts = fetch_all(
            cur,
            ANALYTICS_ROW_COUNTS_SQL,
            (source_key, recent_from),
        )
    else:
        latest_data = fetch_one(cur, LATEST_DATA_SQL, (source_key,))
        recent_counts = fetch_all(cur, ROW_COUNTS_SQL, (source_key, recent_from))
    return {'latest_data': latest_data, 'recent_counts': recent_counts}


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


def parity_params_for(source_key: str, policy: Dict, recent_from):
    if source_key in {'vk_ads_v2', 'getintent'}:
        return (
            recent_from,
            recent_from,
            policy['impressions_tolerance_abs'],
            policy['clicks_tolerance_abs'],
        )
    if source_key == 'hybrid':
        return (
            recent_from,
            recent_from,
            policy['clicks_tolerance_abs'],
        )
    return (
        recent_from,
        recent_from,
        policy['spend_tolerance_abs'],
        policy['impressions_tolerance_abs'],
        policy['clicks_tolerance_abs'],
        policy['conversions_tolerance_abs'],
    )


def coverage_sql_for(source_key: str) -> Optional[str]:
    if source_key == 'linkedin':
        return LINKEDIN_COVERAGE_SQL
    return None


def summarize_parity(parity: Optional[Dict]) -> Dict:
    if not parity:
        return {'compare_rows': 0, 'mismatches': {}, 'total_mismatches': 0}
    mismatches = {}
    for key, value in parity.items():
        if key.endswith('_mismatches'):
            mismatches[key.replace('_mismatches', '')] = int(value or 0)
    return {
        'compare_rows': int(parity.get('compare_rows') or 0),
        'mismatches': mismatches,
        'total_mismatches': sum(mismatches.values()),
    }


def build_yandex_shadow_cutover(cur, policy: Optional[Dict], recent_from) -> Dict:
    shadow_run = fetch_one(cur, LATEST_RUN_SQL, ('yandex_direct_api_shadow',))
    shadow_summary_event = fetch_one(cur, LATEST_EVENT_SQL, ('yandex_direct_api_shadow', 'collector_summary'))
    shadow_missing_event = fetch_one(cur, LATEST_EVENT_SQL, ('yandex_direct_api_shadow', 'critical_account_day_missing'))
    summary_payload = parse_event_payload(shadow_summary_event.get('event_payload')) if shadow_summary_event else None
    missing_payload = parse_event_payload(shadow_missing_event.get('event_payload')) if shadow_missing_event else None
    parity = None
    parity_summary = {'compare_rows': 0, 'mismatches': {}, 'total_mismatches': 0}
    coverage = {
        'prod_only_rows': 0,
        'shadow_only_rows': 0,
        'prod_max_report_date': None,
        'shadow_max_report_date': None,
        'shadow_only_min_date': None,
        'shadow_only_max_date': None,
    }
    if policy:
        parity = fetch_one(cur, YANDEX_DIRECT_PARITY_SQL, parity_params_for('yandex_direct', policy, recent_from))
        parity_summary = summarize_parity(parity)
        if parity:
            coverage = {
                'prod_only_rows': int(parity.get('prod_only_rows') or 0),
                'shadow_only_rows': int(parity.get('shadow_only_rows') or 0),
                'prod_max_report_date': to_jsonable(parity.get('prod_max_report_date')),
                'shadow_max_report_date': to_jsonable(parity.get('shadow_max_report_date')),
                'shadow_only_min_date': to_jsonable(parity.get('shadow_only_min_date')),
                'shadow_only_max_date': to_jsonable(parity.get('shadow_only_max_date')),
            }
    return {
        'shadow_collector': {
            'last_run_id': shadow_run['id'] if shadow_run else None,
            'run_status': shadow_run['status'] if shadow_run else None,
            'run_type': shadow_run['run_type'] if shadow_run else None,
            'started_at': to_jsonable(shadow_run['started_at']) if shadow_run else None,
            'finished_at': to_jsonable(shadow_run['finished_at']) if shadow_run else None,
            'rows_read': int(shadow_run['rows_read'] or 0) if shadow_run else 0,
            'rows_written': int(shadow_run['rows_written'] or 0) if shadow_run else 0,
            'rows_updated': int(shadow_run['rows_updated'] or 0) if shadow_run else 0,
            'error_count': int(shadow_run['error_count'] or 0) if shadow_run else 0,
            'error_summary': shadow_run['error_summary'] if shadow_run else None,
        },
        'parity': parity_summary,
        'coverage': coverage,
        'checkpoint_account_day_results': (summary_payload or {}).get('checkpoint_account_day_results', []),
        'critical_accounts': (summary_payload or {}).get('critical_accounts', []),
        'missing_critical_account_day_sample': (
            (missing_payload or {}).get('missing_critical_account_days')
            or (summary_payload or {}).get('missing_critical_account_day_sample')
            or []
        ),
    }


def build_coverage(source_key: str, policy: Optional[Dict], parity: Optional[Dict], cur, recent_from) -> Optional[Dict]:
    if source_key in {'vk_ads_v2', 'hybrid', 'getintent'} and parity:
        return {
            'legacy_only_rows': int(parity.get('legacy_only_rows') or 0),
            'canonical_only_rows': int(parity.get('canonical_only_rows') or 0),
            'canonical_only_in_legacy_window': int(parity.get('canonical_only_in_legacy_window') or 0),
            'canonical_only_after_legacy_max': int(parity.get('canonical_only_after_legacy_max') or 0),
            'legacy_max_report_date': to_jsonable(parity.get('legacy_max_report_date')),
            'canonical_only_min_date': to_jsonable(parity.get('canonical_only_min_date')),
            'canonical_only_max_date': to_jsonable(parity.get('canonical_only_max_date')),
        }
    coverage_sql = coverage_sql_for(source_key)
    if not coverage_sql or not policy:
        return None
    coverage_rows = fetch_all(cur, coverage_sql, (recent_from, recent_from))
    legacy_only = sum(int(r['legacy_only_rows'] or 0) for r in coverage_rows)
    canonical_only = sum(int(r['canonical_only_rows'] or 0) for r in coverage_rows)
    canonical_only_after_legacy_max = sum(int(r.get('canonical_only_rows_after_legacy_max') or 0) for r in coverage_rows)
    legacy_max_report_date = None
    canonical_only_min_date = None
    canonical_only_max_date = None
    for row in coverage_rows:
        if row.get('legacy_max_report_date') is not None:
            legacy_max_report_date = row['legacy_max_report_date']
        if row.get('canonical_only_min_date') is not None:
            if canonical_only_min_date is None or row['canonical_only_min_date'] < canonical_only_min_date:
                canonical_only_min_date = row['canonical_only_min_date']
        if row.get('canonical_only_max_date') is not None:
            if canonical_only_max_date is None or row['canonical_only_max_date'] > canonical_only_max_date:
                canonical_only_max_date = row['canonical_only_max_date']
    return {
        'legacy_only_rows': legacy_only,
        'canonical_only_rows': canonical_only,
        'canonical_only_in_legacy_window': canonical_only - canonical_only_after_legacy_max,
        'canonical_only_after_legacy_max': canonical_only_after_legacy_max,
        'legacy_max_report_date': to_jsonable(legacy_max_report_date),
        'canonical_only_min_date': to_jsonable(canonical_only_min_date),
        'canonical_only_max_date': to_jsonable(canonical_only_max_date),
    }


def classify_source(latest_run: Optional[Dict], days_lag: Optional[int], parity_summary: Dict) -> str:
    if not latest_run or latest_run['status'] != 'success' or int(latest_run.get('error_count') or 0) > 0:
        return 'CRITICAL'
    if parity_summary['total_mismatches'] > 0:
        return 'WARNING'
    if days_lag is None or days_lag > 2:
        return 'WARNING'
    return 'HEALTHY'


def build_source_health(cur, source_key: str, recent_from) -> Dict:
    policy = normalize_policy_row(fetch_one(cur, POLICY_SQL, (source_key,)))
    latest_run = fetch_one(cur, LATEST_RUN_SQL, (source_key,))
    config = source_config(source_key)
    fact_snapshot = build_source_fact_snapshot(cur, source_key, recent_from)
    latest_data = fact_snapshot['latest_data']
    recent_counts = fact_snapshot['recent_counts']
    gate_scope = policy['authority_fact_scope'] if policy else config['gate_scope']
    freshness = {'latest_report_date': None, 'days_lag': None}
    if latest_data and latest_data.get('max_report_date') is not None:
        max_date = latest_data['max_report_date']
        if isinstance(max_date, datetime):
            max_date = max_date.date()
        freshness = {
            'latest_report_date': str(max_date),
            'days_lag': (datetime.utcnow().date() - max_date).days,
        }
    parity = None
    if policy and config['source_kind'] == 'ads' and source_key != 'yandex_direct':
        parity = fetch_one(cur, parity_sql_for(source_key), parity_params_for(source_key, policy, recent_from))
    parity_summary = summarize_parity(parity)
    coverage = (
        build_coverage(source_key, policy, parity, cur, recent_from)
        if config['source_kind'] == 'ads'
        else None
    )
    shadow_cutover = (
        build_yandex_shadow_cutover(cur, policy, recent_from)
        if source_key == 'yandex_direct' and YANDEX_DIRECT_SHADOW_CUTOVER_ENABLED
        else None
    )
    status = classify_source(latest_run, freshness['days_lag'], parity_summary)
    return {
        'source_key': source_key,
        'gate_note': SOURCES.get(source_key, {}).get('gate_note', ''),
        'collector': {
            'last_run_id': latest_run['id'] if latest_run else None,
            'run_status': latest_run['status'] if latest_run else None,
            'run_type': latest_run['run_type'] if latest_run else None,
            'started_at': to_jsonable(latest_run['started_at']) if latest_run else None,
            'finished_at': to_jsonable(latest_run['finished_at']) if latest_run else None,
            'rows_read': int(latest_run['rows_read'] or 0) if latest_run else 0,
            'rows_written': int(latest_run['rows_written'] or 0) if latest_run else 0,
            'rows_updated': int(latest_run['rows_updated'] or 0) if latest_run else 0,
            'error_count': int(latest_run['error_count'] or 0) if latest_run else 0,
            'error_summary': latest_run['error_summary'] if latest_run else None,
        },
        'freshness': freshness,
        'governance': {
            'authority_fact_scope': gate_scope,
            'comparison_level': policy['comparison_level'] if policy else None,
            'coverage_mode': policy['coverage_mode'] if policy else None,
            'blocking': default_blocking(source_key, policy),
        },
        'parity': parity_summary,
        'coverage': coverage or {
            'legacy_only_rows': 0,
            'canonical_only_rows': 0,
            'canonical_only_in_legacy_window': 0,
            'canonical_only_after_legacy_max': 0,
            'legacy_max_report_date': None,
            'canonical_only_min_date': None,
            'canonical_only_max_date': None,
        },
        'recent_counts': compact_rows(recent_counts),
        'shadow_cutover': shadow_cutover,
        'status': status,
    }


def source_list() -> List[str]:
    return list(SOURCES.keys())


def build_section_maps(cur, items: List[Dict]) -> Dict:
    keys = source_list()
    ad_keys = [key for key in keys if source_config(key)['source_kind'] == 'ads']
    params = tuple(ad_keys)

    coverage_rows = compact_rows(fetch_all(cur, DATA_COVERAGE_SQL, params))
    freshness_rows = compact_rows(fetch_all(cur, DATA_FRESHNESS_SQL, params))
    run_rows = compact_rows(fetch_all(cur, LAST_RUNS_SQL, params))
    window_rows = compact_rows(fetch_all(cur, DATA_WINDOW_SQL, params))

    item_map = dict((item['source_key'], item) for item in items)
    for key in keys:
        if source_config(key)['source_kind'] != 'analytics':
            continue
        item = item_map[key]
        latest = item['freshness']['latest_report_date']
        freshness_rows.append({'source_key': key, 'latest_report_date': latest})
        collector = item['collector']
        run_rows.append({
            'source_key': key,
            'last_run_id': collector['last_run_id'],
            'status': collector['run_status'],
            'run_type': collector['run_type'],
            'started_at': collector['started_at'],
            'finished_at': collector['finished_at'],
            'rows_read': collector['rows_read'],
            'rows_written': collector['rows_written'],
            'rows_updated': collector['rows_updated'],
            'error_count': collector['error_count'],
            'error_summary': collector['error_summary'],
        })
        recent = item.get('recent_counts') or []
        min_dates = [row.get('min_date') for row in recent if row.get('min_date')]
        max_dates = [row.get('max_date') for row in recent if row.get('max_date')]
        window_rows.append({
            'source_key': key,
            'from_date': min(min_dates) if min_dates else None,
            'to_date': max(max_dates) if max_dates else None,
        })
    freshness_map = {}
    for row in freshness_rows:
        latest = row['latest_report_date']
        lag = None
        if latest:
            latest_date = datetime.strptime(latest, '%Y-%m-%d').date()
            lag = (datetime.utcnow().date() - latest_date).days
        freshness_map[row['source_key']] = {
            'source_key': row['source_key'],
            'latest_report_date': latest,
            'lag_days': lag,
        }

    run_map = dict((row['source_key'], row) for row in run_rows)
    coverage_map = dict((row['source_key'], row) for row in coverage_rows)
    window_map = dict((row['source_key'], row) for row in window_rows)

    health_rows = []
    blocking_issues = []
    non_blocking_notes = []
    for key in keys:
        item = item_map[key]
        health_rows.append({'source_key': key, 'status': item['status']})
        lag = freshness_map.get(key, {}).get('lag_days')
        is_blocking = bool(item['governance']['blocking'])
        if lag is not None and lag > 2:
            note = '{} freshness lag = {}'.format(key, lag)
            if is_blocking:
                blocking_issues.append(note)
            else:
                non_blocking_notes.append(note)
        if item['parity']['total_mismatches'] > 0:
            note = '{} parity mismatches = {}'.format(key, item['parity']['total_mismatches'])
            if is_blocking:
                blocking_issues.append(note)
            else:
                non_blocking_notes.append(note)
        coverage = item['coverage'] or {}
        legacy_only = int(coverage.get('legacy_only_rows') or 0)
        canonical_in_window = int(coverage.get('canonical_only_in_legacy_window') or 0)
        if legacy_only > 0 or canonical_in_window > 0:
            note = '{} coverage warning legacy_only={} canonical_only_in_window={}'.format(
                key, legacy_only, canonical_in_window
            )
            if is_blocking:
                blocking_issues.append(note)
            else:
                non_blocking_notes.append(note)
        if (
            not is_blocking
            and int(coverage.get('canonical_only_after_legacy_max') or 0) > 0
            and int(coverage.get('canonical_only_in_legacy_window') or 0) == 0
        ):
            non_blocking_notes.append('{} canonical_ahead_of_legacy'.format(key))
        if key == 'yandex_direct':
            shadow_cutover = item.get('shadow_cutover') or {}
            shadow_run = shadow_cutover.get('shadow_collector') or {}
            shadow_parity = shadow_cutover.get('parity') or {}
            shadow_coverage = shadow_cutover.get('coverage') or {}
            missing_critical = shadow_cutover.get('missing_critical_account_day_sample') or []
            if shadow_run.get('run_status') and shadow_run.get('run_status') != 'success':
                non_blocking_notes.append(
                    'yandex_direct shadow_run_status={}'.format(shadow_run.get('run_status'))
                )
            if int(shadow_parity.get('total_mismatches') or 0) > 0:
                non_blocking_notes.append(
                    'yandex_direct shadow_parity_mismatches={}'.format(shadow_parity.get('total_mismatches'))
                )
            if int(shadow_coverage.get('prod_only_rows') or 0) > 0 or int(shadow_coverage.get('shadow_only_rows') or 0) > 0:
                non_blocking_notes.append(
                    'yandex_direct shadow_coverage prod_only={} shadow_only={}'.format(
                        int(shadow_coverage.get('prod_only_rows') or 0),
                        int(shadow_coverage.get('shadow_only_rows') or 0),
                    )
                )
            if missing_critical:
                non_blocking_notes.append(
                    'yandex_direct shadow_missing_critical_account_days={}'.format(len(missing_critical))
                )

    return {
        'health_rows': health_rows,
        'blocking_issues': blocking_issues,
        'non_blocking_notes': non_blocking_notes,
        'coverage_rows': [coverage_map.get(key, {'source_key': key, 'accounts': 0, 'campaigns': 0, 'delivery_entities': 0}) for key in keys],
        'freshness_rows': [freshness_map.get(key, {'source_key': key, 'latest_report_date': None, 'lag_days': None}) for key in keys],
        'last_run_rows': [
            run_map.get(
                key,
                {
                    'source_key': key,
                    'status': None,
                    'rows_read': None,
                    'rows_written': None,
                    'rows_updated': None,
                },
            )
            for key in keys
        ],
        'window_rows': [window_map.get(key, {'source_key': key, 'from_date': None, 'to_date': None}) for key in keys],
    }


def render_summary(items: List[Dict]) -> List[str]:
    blocking = [item['source_key'] for item in items if item['governance']['blocking']]
    non_blocking = [item['source_key'] for item in items if item['governance']['blocking'] is False]
    lines = ['', '=================================================', 'SOURCES HEALTH SUMMARY', '=================================================']
    for item in items:
        lines.append('{:<12} {}'.format(item['source_key'], item['status']))
    lines.extend(['', 'Blocking sources:', '  ' + (', '.join(blocking) if blocking else '-'), '', 'Non-blocking sources:', '  ' + (', '.join(non_blocking) if non_blocking else '-')])
    return lines


def render_health_section(section: Dict, exit_code: int) -> List[str]:
    lines = ['CANONICAL REPORTING HEALTH', '--------------------------------', '']
    for row in section['health_rows']:
        lines.append('{:<12} {}'.format(row['source_key'], row['status']))
    lines.extend(['', 'Blocking issues:'])
    if section['blocking_issues']:
        for issue in section['blocking_issues']:
            lines.append('- {}'.format(issue))
    else:
        lines.append('- none')
    lines.extend(['', 'Non-blocking notes:'])
    if section['non_blocking_notes']:
        for note in section['non_blocking_notes']:
            lines.append('- {}'.format(note))
    else:
        lines.append('- none')
    lines.extend(['', 'Exit code: {}'.format(exit_code)])
    return lines


def render_data_coverage_section(rows: List[Dict]) -> List[str]:
    lines = ['', 'DATA COVERAGE', '--------------------------------', '', '{:<12} {:>10} {:>11} {:>20}'.format('source', 'accounts', 'campaigns', 'delivery_entities'), '']
    for row in rows:
        lines.append(
            '{:<12} {:>10} {:>11} {:>20}'.format(
                row['source_key'],
                int(row.get('accounts') or 0),
                int(row.get('campaigns') or 0),
                int(row.get('delivery_entities') or 0),
            )
        )
    return lines


def render_data_freshness_section(rows: List[Dict]) -> List[str]:
    lines = ['', 'DATA FRESHNESS', '--------------------------------', '', '{:<12} {:>14} {:>10}'.format('source', 'latest_date', 'lag_days'), '']
    for row in rows:
        lines.append(
            '{:<12} {:>14} {:>10}'.format(
                row['source_key'],
                row.get('latest_report_date') or '-',
                row.get('lag_days') if row.get('lag_days') is not None else '-',
            )
        )
    return lines


def render_last_run_section(rows: List[Dict]) -> List[str]:
    lines = ['', 'LAST COLLECTOR RUN', '--------------------------------', '', '{:<12} {:>10} {:>11} {:>14} {:>13}'.format('source', 'status', 'rows_read', 'rows_written', 'rows_updated'), '']
    for row in rows:
        lines.append(
            '{:<12} {:>10} {:>11} {:>14} {:>13}'.format(
                row['source_key'],
                row.get('status') or '-',
                row.get('rows_read') if row.get('rows_read') is not None else '-',
                row.get('rows_written') if row.get('rows_written') is not None else '-',
                row.get('rows_updated') if row.get('rows_updated') is not None else '-',
            )
        )
    return lines


def render_data_window_section(rows: List[Dict]) -> List[str]:
    lines = ['', 'DATA WINDOW', '--------------------------------', '', '{:<12} {:>14} {:>14}'.format('source', 'from_date', 'to_date'), '']
    for row in rows:
        lines.append(
            '{:<12} {:>14} {:>14}'.format(
                row['source_key'],
                row.get('from_date') or '-',
                row.get('to_date') or '-',
            )
        )
    return lines


def compute_exit_code(items: List[Dict]) -> int:
    for item in items:
        if item['governance']['blocking'] and item['status'] in {'WARNING', 'CRITICAL'}:
            return 1
    return 0


def main() -> int:
    from canonical_writer import get_db_connection

    args = parse_args()
    recent_from = datetime.utcnow().date() - timedelta(days=args.recent_days)
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    try:
        items = [build_source_health(cur, source_key, recent_from) for source_key in SOURCES]
        sections = build_section_maps(cur, items)
    finally:
        cur.close()
        conn.close()
    exit_code = compute_exit_code(items)
    payload = {
        'generated_at_utc': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        'sources': items,
        'sections': sections,
        'summary': {
            'blocking_sources': [item['source_key'] for item in items if item['governance']['blocking']],
            'non_blocking_sources': [item['source_key'] for item in items if item['governance']['blocking'] is False],
            'blocking_source_statuses': dict((item['source_key'], item['status']) for item in items if item['governance']['blocking']),
            'exit_code': exit_code,
        },
    }
    if args.as_json:
        print(json.dumps(payload, ensure_ascii=True, indent=2))
    else:
        for line in render_health_section(sections, exit_code):
            print(line)
        for line in render_data_coverage_section(sections['coverage_rows']):
            print(line)
        for line in render_data_freshness_section(sections['freshness_rows']):
            print(line)
        for line in render_last_run_section(sections['last_run_rows']):
            print(line)
        for line in render_data_window_section(sections['window_rows']):
            print(line)
        for line in render_summary(items):
            print(line)
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())

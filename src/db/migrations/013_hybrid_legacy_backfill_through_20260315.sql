-- Align Hybrid canonical facts with legacy hyb_stats through 2026-03-15.
-- This is intentionally idempotent: it deletes the affected canonical window
-- and rebuilds it from legacy daily creative rows.

DELETE FROM canonical_fact_ads_daily
WHERE source_key = 'hybrid'
  AND report_date BETWEEN '2026-03-01' AND '2026-03-15'
  AND platform_campaign_id IN (
    SELECT DISTINCT campaign_id
    FROM hyb_stats
    WHERE date BETWEEN '2026-03-01' AND '2026-03-15'
  );

INSERT INTO canonical_fact_ads_daily (
  source_key,
  platform_account_id,
  platform_campaign_id,
  fact_scope,
  native_grain,
  breakdown_scope,
  platform_delivery_entity_id,
  platform_creative_id,
  report_date,
  spend,
  impressions,
  clicks,
  views,
  conversions,
  reach,
  frequency,
  ctr,
  cpm,
  cpc,
  cpv,
  cpa,
  video_views_25,
  video_views_50,
  video_views_75,
  video_views_100,
  link_clicks,
  likes,
  comments,
  shares,
  reactions,
  follows,
  currency_code,
  ingestion_run_id
)
SELECT
  'hybrid' AS source_key,
  campaign_accounts.platform_account_id,
  h.campaign_id AS platform_campaign_id,
  'delivery_entity' AS fact_scope,
  'creative' AS native_grain,
  'default' AS breakdown_scope,
  h.creative_id AS platform_delivery_entity_id,
  h.creative_id AS platform_creative_id,
  h.date AS report_date,
  NULL AS spend,
  h.impr AS impressions,
  h.clicks,
  h.views,
  NULL AS conversions,
  h.reach,
  h.frequency,
  h.ctr,
  NULL AS cpm,
  NULL AS cpc,
  NULL AS cpv,
  NULL AS cpa,
  h.view_25 AS video_views_25,
  h.view_50 AS video_views_50,
  h.view_75 AS video_views_75,
  h.view_100 AS video_views_100,
  NULL AS link_clicks,
  NULL AS likes,
  NULL AS comments,
  NULL AS shares,
  NULL AS reactions,
  NULL AS follows,
  NULL AS currency_code,
  NULL AS ingestion_run_id
FROM hyb_stats h
JOIN (
  SELECT platform_campaign_id, MIN(platform_account_id) AS platform_account_id
  FROM canonical_source_campaigns
  WHERE source_key = 'hybrid'
  GROUP BY platform_campaign_id
) AS campaign_accounts
  ON campaign_accounts.platform_campaign_id = h.campaign_id
WHERE h.date BETWEEN '2026-03-01' AND '2026-03-15';

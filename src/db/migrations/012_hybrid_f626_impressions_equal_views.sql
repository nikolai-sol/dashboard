-- Targeted canonical post-processing rule for one known Hybrid campaign.
-- Business exception: for campaign f_626 legacy semantics require impressions to match views.
-- Apply only to this campaign and keep the rule isolated from all other Hybrid rows.

UPDATE canonical_fact_ads_daily
SET impressions = views,
    updated_at = CURRENT_TIMESTAMP
WHERE source_key = 'hybrid'
  AND fact_scope = 'delivery_entity'
  AND platform_campaign_id = 'f_626'
  AND views IS NOT NULL
  AND (impressions IS NULL OR impressions <> views);

DROP EVENT IF EXISTS canonical_fix_hybrid_f626_impressions;

CREATE EVENT canonical_fix_hybrid_f626_impressions
ON SCHEDULE EVERY 1 DAY
STARTS '2026-03-18 06:45:00'
ON COMPLETION PRESERVE
ENABLE
DO
  UPDATE canonical_fact_ads_daily
  SET impressions = views,
      updated_at = CURRENT_TIMESTAMP
  WHERE source_key = 'hybrid'
    AND fact_scope = 'delivery_entity'
    AND platform_campaign_id = 'f_626'
    AND views IS NOT NULL
    AND (impressions IS NULL OR impressions <> views);

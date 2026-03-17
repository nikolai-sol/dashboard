-- Governance rows for VK Ads v2 canonical onboarding.

INSERT INTO source_parity_policy (
    source_key,
    authority_fact_scope,
    comparison_level,
    spend_tolerance_abs,
    impressions_tolerance_abs,
    clicks_tolerance_abs,
    conversions_tolerance_abs,
    coverage_mode,
    is_blocking,
    description
) VALUES (
    'vk_ads_v2',
    'delivery_entity',
    'account_day',
    0.01,
    0,
    0,
    0,
    'allow_canonical_ahead',
    FALSE,
    'VK Ads v2 v1 parity authority is delivery_entity/banner. Legacy storage lacks reliable account/campaign refs in stats, so parity is non-blocking until legacy-compatible joins are formalized.'
)
ON DUPLICATE KEY UPDATE
    authority_fact_scope = VALUES(authority_fact_scope),
    comparison_level = VALUES(comparison_level),
    spend_tolerance_abs = VALUES(spend_tolerance_abs),
    impressions_tolerance_abs = VALUES(impressions_tolerance_abs),
    clicks_tolerance_abs = VALUES(clicks_tolerance_abs),
    conversions_tolerance_abs = VALUES(conversions_tolerance_abs),
    coverage_mode = VALUES(coverage_mode),
    is_blocking = VALUES(is_blocking),
    description = VALUES(description),
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO source_metric_contracts (
    source_key,
    native_metric_name,
    canonical_metric_name,
    metric_scope,
    native_grain,
    is_required,
    is_parity_metric,
    is_derived,
    description
) VALUES
    (
        'vk_ads_v2',
        'base.spent',
        'spend',
        'delivery_entity',
        'banner',
        TRUE,
        FALSE,
        FALSE,
        'VK Ads v2 spend from base.spent. Present in API, absent from current legacy stats table.'
    ),
    (
        'vk_ads_v2',
        'base.shows',
        'impressions',
        'delivery_entity',
        'banner',
        TRUE,
        TRUE,
        FALSE,
        'VK Ads v2 impressions from base.shows.'
    ),
    (
        'vk_ads_v2',
        'base.clicks',
        'clicks',
        'delivery_entity',
        'banner',
        TRUE,
        TRUE,
        FALSE,
        'VK Ads v2 clicks from base.clicks.'
    ),
    (
        'vk_ads_v2',
        'base.goals',
        'conversions',
        'delivery_entity',
        'banner',
        FALSE,
        FALSE,
        FALSE,
        'VK Ads v2 conversions mapped from base.goals. Present in API, absent from current legacy parity path.'
    ),
    (
        'vk_ads_v2',
        'uniques.reach',
        'reach',
        'delivery_entity',
        'banner',
        FALSE,
        FALSE,
        FALSE,
        'VK Ads v2 reach from uniques.reach.'
    ),
    (
        'vk_ads_v2',
        'uniques.frequency',
        'frequency',
        'delivery_entity',
        'banner',
        FALSE,
        FALSE,
        FALSE,
        'VK Ads v2 frequency from uniques.frequency.'
    ),
    (
        'vk_ads_v2',
        'video.viewed_25_percent',
        'video_views_25',
        'delivery_entity',
        'banner',
        FALSE,
        FALSE,
        FALSE,
        'VK Ads v2 video quartile 25%.'
    ),
    (
        'vk_ads_v2',
        'video.viewed_50_percent',
        'video_views_50',
        'delivery_entity',
        'banner',
        FALSE,
        FALSE,
        FALSE,
        'VK Ads v2 video quartile 50%.'
    ),
    (
        'vk_ads_v2',
        'video.viewed_75_percent',
        'video_views_75',
        'delivery_entity',
        'banner',
        FALSE,
        FALSE,
        FALSE,
        'VK Ads v2 video quartile 75%.'
    ),
    (
        'vk_ads_v2',
        'video.viewed_100_percent',
        'video_views_100',
        'delivery_entity',
        'banner',
        FALSE,
        FALSE,
        FALSE,
        'VK Ads v2 video quartile 100%.'
    ),
    (
        'vk_ads_v2',
        'base.ctr',
        'ctr',
        'delivery_entity',
        'banner',
        FALSE,
        FALSE,
        TRUE,
        'VK Ads v2 CTR from source. Stored for reference but treated as derived.'
    )
ON DUPLICATE KEY UPDATE
    canonical_metric_name = VALUES(canonical_metric_name),
    metric_scope = VALUES(metric_scope),
    native_grain = VALUES(native_grain),
    is_required = VALUES(is_required),
    is_parity_metric = VALUES(is_parity_metric),
    is_derived = VALUES(is_derived),
    description = VALUES(description),
    updated_at = CURRENT_TIMESTAMP;

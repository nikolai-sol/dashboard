-- Draft governance rows for Hybrid canonical onboarding.
-- Preparation only. Do not apply automatically on this step unless Hybrid implementation wave starts.

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
    'hybrid',
    'delivery_entity',
    'delivery_entity_day',
    0.00,
    0,
    0,
    0,
    'allow_canonical_ahead',
    FALSE,
    'Hybrid first-pass parity is non-blocking and uses direct delivery_entity/day compare. Clicks, views and quartiles are parity-safe; impressions and reach stay as canonical metrics but are excluded from the first-pass parity gate. Spend is not part of parity baseline in current legacy storage.'
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
    'hybrid',
    'ImpressionCount',
    'impressions',
    'delivery_entity',
    'creative',
    TRUE,
    FALSE,
    FALSE,
    'Hybrid creative-level impressions. Valid canonical metric, but excluded from first-pass parity gate because legacy historical values drift from current raw API.'
),
(
    'hybrid',
    'ClickCount',
    'clicks',
    'delivery_entity',
    'creative',
    TRUE,
    TRUE,
    FALSE,
    'Hybrid creative-level clicks.'
),
(
    'hybrid',
    'completeEventsCount',
    'views',
    'delivery_entity',
    'creative',
    FALSE,
    TRUE,
    FALSE,
    'Hybrid completed views / completed video events.'
),
(
    'hybrid',
    'Reach',
    'reach',
    'delivery_entity',
    'creative',
    FALSE,
    FALSE,
    FALSE,
    'Hybrid reach metric. Valid canonical metric, but excluded from first-pass parity gate because reach is not parity-safe in the current Hybrid path.'
),
(
    'hybrid',
    'firstQuartileEventsCount',
    'video_views_25',
    'delivery_entity',
    'creative',
    FALSE,
    TRUE,
    FALSE,
    'Hybrid first quartile video events.'
),
(
    'hybrid',
    'midpointEventsCount',
    'video_views_50',
    'delivery_entity',
    'creative',
    FALSE,
    TRUE,
    FALSE,
    'Hybrid midpoint video events.'
),
(
    'hybrid',
    'thirdQuartileEventsCount',
    'video_views_75',
    'delivery_entity',
    'creative',
    FALSE,
    TRUE,
    FALSE,
    'Hybrid third quartile video events.'
),
(
    'hybrid',
    'completeEventsCount#100',
    'video_views_100',
    'delivery_entity',
    'creative',
    FALSE,
    TRUE,
    FALSE,
    'Hybrid completed video events mapped to canonical video_views_100. Uses synthetic native name suffix to coexist with views mapping.'
),
(
    'hybrid',
    'Frequency',
    'frequency',
    'delivery_entity',
    'creative',
    FALSE,
    FALSE,
    FALSE,
    'Hybrid frequency metric.'
),
(
    'hybrid',
    'Viewability',
    'viewability',
    'delivery_entity',
    'creative',
    FALSE,
    FALSE,
    FALSE,
    'Hybrid viewability metric.'
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

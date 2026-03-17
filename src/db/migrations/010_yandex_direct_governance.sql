-- Draft governance rows for Yandex Direct canonical onboarding.
-- Preparation only. Do not apply automatically on this step unless Yandex Direct implementation wave starts.

INSERT INTO source_parity_policy
(
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
)
VALUES
(
  'yandex_direct',
  'delivery_entity',
  'delivery_entity_day',
  0.01,
  0,
  0,
  0,
  'allow_canonical_ahead',
  0,
  'Yandex Direct first-pass parity should use direct delivery_entity/day compare against yandex_new. Spend, impressions, clicks and conversions are parity-safe. Start as non-blocking until canonical collector is validated on repeated runs.'
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

INSERT INTO source_metric_contracts
(source_key, native_metric_name, canonical_metric_name, metric_scope, native_grain, is_required, is_parity_metric, is_derived, description)
VALUES
('yandex_direct', 'cost', 'spend', 'delivery_entity', 'ad', TRUE,  TRUE,  FALSE, 'Daily spend from yandex_new at ad grain'),
('yandex_direct', 'impressions', 'impressions', 'delivery_entity', 'ad', TRUE,  TRUE,  FALSE, 'Daily impressions from yandex_new at ad grain'),
('yandex_direct', 'clicks', 'clicks', 'delivery_entity', 'ad', TRUE,  TRUE,  FALSE, 'Daily clicks from yandex_new at ad grain'),
('yandex_direct', 'conversions', 'conversions', 'delivery_entity', 'ad', FALSE, TRUE,  FALSE, 'Daily conversions from yandex_new at ad grain'),
('yandex_direct', 'impressionsReach', 'reach', 'delivery_entity', 'ad', FALSE, FALSE, FALSE, 'Reach metric available only for some Yandex Direct report types; valid canonical metric but not part of first-pass parity baseline'),
('yandex_direct', 'ctr', 'ctr', 'delivery_entity', 'ad', FALSE, FALSE, TRUE,  'Derived rate metric; do not use as first-pass parity baseline'),
('yandex_direct', 'avgCpc', 'cpc', 'delivery_entity', 'ad', FALSE, FALSE, TRUE,  'Derived rate metric; do not use as first-pass parity baseline'),
('yandex_direct', 'conversionRate', 'conversion_rate', 'delivery_entity', 'ad', FALSE, FALSE, TRUE,  'Derived rate metric; do not use as first-pass parity baseline'),
('yandex_direct', 'avgImpr', 'avg_impression_position', 'delivery_entity', 'ad', FALSE, FALSE, TRUE,  'Informational position metric; not part of first-pass parity baseline')
ON DUPLICATE KEY UPDATE
  canonical_metric_name = VALUES(canonical_metric_name),
  metric_scope = VALUES(metric_scope),
  native_grain = VALUES(native_grain),
  is_required = VALUES(is_required),
  is_parity_metric = VALUES(is_parity_metric),
  is_derived = VALUES(is_derived),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;

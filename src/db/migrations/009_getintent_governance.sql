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
  'getintent',
  'delivery_entity',
  'delivery_entity_day',
  0.00,
  0,
  0,
  0,
  'allow_canonical_ahead',
  0,
  'GetIntent first-pass parity uses direct delivery_entity/day compare against legacy creative-level stats. Spend and conversions are not available in current legacy storage. Non-blocking rollout recommended.'
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
('getintent', 'imps', 'impressions', 'delivery_entity', 'creative', TRUE,  TRUE,  FALSE, 'Daily impressions at GetIntent creative grain'),
('getintent', 'clicks', 'clicks', 'delivery_entity', 'creative', TRUE,  TRUE,  FALSE, 'Daily clicks at GetIntent creative grain'),
('getintent', 'unique_imps', 'views', 'delivery_entity', 'creative', FALSE, FALSE, FALSE, 'Provisional mapping only if unique impression semantics are accepted for canonical views'),
('getintent', 'video_completion_25', 'video_views_25', 'delivery_entity', 'creative', FALSE, TRUE, FALSE, 'Video completion 25 percent'),
('getintent', 'video_completion_50', 'video_views_50', 'delivery_entity', 'creative', FALSE, TRUE, FALSE, 'Video completion 50 percent'),
('getintent', 'video_completion_75', 'video_views_75', 'delivery_entity', 'creative', FALSE, TRUE, FALSE, 'Video completion 75 percent'),
('getintent', 'video_completion_100', 'video_views_100', 'delivery_entity', 'creative', FALSE, TRUE, FALSE, 'Video completion 100 percent'),
('getintent', 'view_rate', 'viewability', 'delivery_entity', 'creative', FALSE, FALSE, FALSE, 'Informational rate only. Not part of first-pass parity baseline and not materialized in canonical facts v1'),
('getintent', 'ctr', 'ctr', 'delivery_entity', 'creative', FALSE, FALSE, TRUE, 'Prefer derived usage downstream even if source returns CTR')
ON DUPLICATE KEY UPDATE
  canonical_metric_name = VALUES(canonical_metric_name),
  metric_scope = VALUES(metric_scope),
  native_grain = VALUES(native_grain),
  is_required = VALUES(is_required),
  is_parity_metric = VALUES(is_parity_metric),
  is_derived = VALUES(is_derived),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;

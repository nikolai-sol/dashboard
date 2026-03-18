-- Mark accepted canonical-only ads sources as non-blocking in parity policy.
-- These sources are monitored for freshness/collector health, but do not gate rollout by legacy parity.

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
  'linkedin',
  'delivery_entity',
  'campaign_day',
  0.01,
  10,
  2,
  0,
  'allow_canonical_ahead',
  0,
  'LinkedIn is accepted as a canonical-only reporting source. Keep collector health and freshness monitoring, but do not treat legacy parity drift as a blocking release gate.'
),
(
  'reddit',
  'campaign',
  'campaign_day',
  0.01,
  0,
  0,
  0,
  'allow_canonical_ahead',
  0,
  'Reddit is accepted as a canonical-only reporting source. Campaign scope remains reporting authority, while legacy parity checks stay informational and non-blocking.'
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

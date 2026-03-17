-- Governance/control layer for canonical ads schema
-- Purely additive migration.
-- Does not modify existing canonical_* tables, legacy tables, collectors, or facts.

CREATE TABLE IF NOT EXISTS source_metric_contracts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    source_key VARCHAR(64) NOT NULL,
    native_metric_name VARCHAR(128) NOT NULL,
    canonical_metric_name VARCHAR(128) NOT NULL,
    metric_scope VARCHAR(64) DEFAULT NULL,
    native_grain VARCHAR(64) DEFAULT NULL,
    is_required BOOLEAN DEFAULT FALSE,
    is_parity_metric BOOLEAN DEFAULT FALSE,
    is_derived BOOLEAN DEFAULT FALSE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_source_metric (source_key, native_metric_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS source_parity_policy (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    source_key VARCHAR(64) NOT NULL UNIQUE,
    authority_fact_scope VARCHAR(64) NOT NULL,
    comparison_level VARCHAR(64) NOT NULL,
    spend_tolerance_abs DECIMAL(18,6) DEFAULT 0,
    impressions_tolerance_abs INT DEFAULT 0,
    clicks_tolerance_abs INT DEFAULT 0,
    conversions_tolerance_abs INT DEFAULT 0,
    coverage_mode VARCHAR(64) DEFAULT 'strict',
    is_blocking BOOLEAN DEFAULT TRUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) VALUES
(
    'linkedin',
    'delivery_entity',
    'campaign_day',
    0.01,
    10,
    2,
    0,
    'allow_canonical_ahead',
    TRUE,
    'LinkedIn parity uses delivery_entity scope aggregated to campaign/day'
),
(
    'reddit',
    'campaign',
    'campaign_day',
    0.01,
    0,
    0,
    0,
    'strict',
    TRUE,
    'Reddit campaign-level authority for parity'
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
    'linkedin',
    'spend',
    'spend',
    'delivery_entity',
    'creative',
    TRUE,
    TRUE,
    FALSE,
    'Canonical spend metric for LinkedIn. Current collector maps LinkedIn costInLocalCurrency into canonical spend.'
),
(
    'linkedin',
    'impressions',
    'impressions',
    'delivery_entity',
    'creative',
    TRUE,
    TRUE,
    FALSE,
    'Canonical impressions metric for LinkedIn.'
),
(
    'linkedin',
    'clicks',
    'clicks',
    'delivery_entity',
    'creative',
    TRUE,
    TRUE,
    FALSE,
    'Canonical clicks metric for LinkedIn.'
),
(
    'linkedin',
    'conversions',
    'conversions',
    'delivery_entity',
    'creative',
    FALSE,
    TRUE,
    FALSE,
    'Canonical conversions metric for LinkedIn. Current collector maps externalWebsiteConversions into canonical conversions.'
),
(
    'reddit',
    'spend',
    'spend',
    'campaign',
    'campaign',
    TRUE,
    TRUE,
    FALSE,
    'Canonical spend metric for Reddit.'
),
(
    'reddit',
    'impressions',
    'impressions',
    'campaign',
    'campaign',
    TRUE,
    TRUE,
    FALSE,
    'Canonical impressions metric for Reddit.'
),
(
    'reddit',
    'clicks',
    'clicks',
    'campaign',
    'campaign',
    TRUE,
    TRUE,
    FALSE,
    'Canonical clicks metric for Reddit.'
),
(
    'reddit',
    'conversions',
    'conversions',
    'campaign',
    'campaign',
    FALSE,
    TRUE,
    FALSE,
    'Canonical conversions metric for Reddit. Current collector maps app_install_total_conversions into canonical conversions.'
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

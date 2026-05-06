# Source Governance

This document defines the governance layer for the canonical ads schema.

## Purpose of metric contracts

`source_metric_contracts` documents how each source exposes metrics and how those metrics map into canonical names.

This table exists to make metric semantics explicit per source, for example:

- LinkedIn canonical `conversions` currently comes from `externalWebsiteConversions`
- Reddit canonical `conversions` currently comes from `app_install_total_conversions`

The purpose is not to change collectors automatically. The purpose is to make source-specific meaning visible and govern future onboarding.

## Purpose of parity policy

`source_parity_policy` defines how parity should be evaluated per source.

This includes:

- which fact scope is parity authority
- what comparison level is valid
- what absolute tolerances are acceptable
- how coverage differences should be interpreted

Examples:

- LinkedIn canonical reporting authority is `delivery_entity`
- Reddit canonical reporting authority is `campaign`, and ad-level rows are analytics-only
- VK Ads v2 parity authority is `delivery_entity` at native `banner` grain, with a non-blocking `account_day` policy while legacy-compatible parity joins are still incomplete

`monitor_canonical_shadow.py` reads `source_parity_policy` as the operational source of truth for:

- parity authority scope
- comparison level
- parity tolerances
- coverage interpretation mode

If a source has no policy row, the monitor must not crash. It reports a configuration warning instead.

## Rule: collectors map source metrics into canonical names

Collectors must keep mapping source-native metrics into canonical names before writing to canonical fact tables.

Examples:

- source-native spend field -> canonical `spend`
- source-native impressions field -> canonical `impressions`
- source-native clicks field -> canonical `clicks`
- source-native conversion field -> canonical `conversions`

The canonical fact layer stays stable. Source-specific differences are documented in governance tables.

## Rule: every new source must add governance rows

When onboarding a new source:

1. add the collector / adapter
2. map source entities into canonical dictionaries
3. map source metrics into canonical fact fields
4. add rows to `source_metric_contracts`
5. add a row to `source_parity_policy`

This keeps the core schema stable while formalizing source semantics and parity rules.

## Current onboarded examples

- `linkedin`
  - authority scope: `delivery_entity`
  - comparison level: `campaign_day`
  - accepted canonical-only source: yes
  - required legacy parity gate: no
  - monitor priorities:
    - freshness
    - collector health
    - internal canonical consistency

- `reddit`
  - authority scope: `campaign`
  - comparison level: `campaign_day`
  - accepted canonical-only source: yes
  - required legacy parity gate: no
  - ad-level scope remains analytics-only
  - monitor priorities:
    - freshness
    - collector health
    - internal canonical consistency

- `vk_ads_v2`
  - authority scope: `delivery_entity`
  - comparison level: `account_day`
  - blocking parity gate: no, for now
  - reason: API collector can write richer canonical facts than legacy (`spend`, `conversions`, `reach`, `frequency`), but current legacy VK storage is too sparse for a clean blocking parity gate

# Yandex Direct Reporting Onboarding

## A. Executive Summary

`Yandex Direct` should be onboarded into the canonical reporting core only as a reporting/statistics source.

What the current legacy path provides:
- daily campaign names
- daily ad group / ad level delivery stats
- separate campaign-only marketplace summary stats
- standard paid-media metrics already close to canonical shape

Typical metrics available now:
- `impressions`
- `impressionsReach` for media accounts only
- `clicks`
- `conversions`
- `ctr`
- `cost`
- `avgCpc`
- `avgImpr`

Expected reporting grain:
- strongest detailed grain: `date + campaign_id + ad_group_id + ad_id`
- secondary campaign-only grain for marketplace cases: `date + campaign_id`

What makes `Yandex Direct` different from `VK` / `Hybrid` / `GetIntent`:
- unlike `Hybrid` and `GetIntent`, `spend` is already present in legacy stats and is parity-usable
- unlike `vk_ads_v2`, legacy Direct storage is richer and closer to canonical ads grain out of the box
- unlike `Hybrid`, there is no dependence on parsing semi-structured banner names to recover campaign or creative ids
- unlike `GetIntent`, Direct has a better baseline for blocking-grade parity in the future because `spend`, `impressions`, `clicks`, `conversions` all exist in legacy storage
- there is one structural complication: legacy uses two reporting paths
  - `yandex_new` for detailed ad-level stats
  - `yandex_market_stat` for campaign-only marketplace summary rows

Practical conclusion:
- first-pass canonical onboarding should use `yandex_new` as the primary fact authority
- `yandex_market_stat` should be treated as a secondary validation/reference path, not the main fact authority for v1

## B. Legacy Bridge Analysis

### Current legacy route

Internal route:
- `GET /direct?day=YYYY-MM-DD&secret=...`

Service:
- [`direct.service.ts`](/Users/nicko/ReportingDash/nest-second/src/services/direct/direct.service.ts)

External API:
- `POST https://api.direct.yandex.com/json/v5/reports`

Legacy system/access table in `report_bd_tech`:
- `req_system`

Legacy dictionary tables in `report_bd`:
- `yandex_names`
- `yandex_group_names`

Legacy stats tables in `report_bd`:
- `yandex_new`
- `yandex_market_stat`

### Legacy stat grains

Primary detailed fact table:
- `yandex_new`
- grain: `date + campaign_id + ad_group_id + ad_id`
- unique key:
  - `(ad_id, ad_group_id, campaign_id, date)`

Secondary marketplace fact table:
- `yandex_market_stat`
- grain: `date + campaign_id`
- unique key:
  - `(campaign_id, date)`

### Keys available for parity

`yandex_new` gives:
- `campaign_id`
- `ad_group_id`
- `ad_id`
- `date`

`yandex_market_stat` gives:
- `campaign_id`
- `date`

Strongest realistic parity level:
- `delivery_entity_day`
- concretely:
  - `report_date`
  - `platform_campaign_id`
  - `platform_delivery_entity_id`

Why:
- `yandex_new` already stores stable ad-level ids
- this is stronger than campaign-only parity
- it covers the detailed part of legacy Direct reporting where canonical should start

Secondary parity level:
- `campaign_day`
- used as aggregate smoke-check and for marketplace overlap analysis

### Fields realistically available for parity

Safe from `yandex_new`:
- `impressions`
- `clicks`
- `cost`
- `conversions`

Conditionally available:
- `impressionsReach`
  - only for media accounts / media report type
  - not safe as universal first-pass parity metric

Weak / derived metrics:
- `ctr`
- `avgCpc`
- `avgImpr`

### Legacy limitations / caveats

1. `req_system.media` changes field set and report type
- `media = 1` uses `REACH_AND_FREQUENCY_PERFORMANCE_REPORT`
- `media = 0` uses `CUSTOM_REPORT`
- `media = 2` writes campaign-only marketplace rows into `yandex_market_stat`

2. `yandex_group_names` is not a fully normalized hierarchy table
- stores `ad_id`, `ad_group_id`, `ad_group_name`
- useful for enrichment, but not an authority for facts

3. Current runtime is known degraded
- audit notes mention repeated `400` errors and auth/header issues in legacy runtime
- this does not block canonical onboarding design, but it means first-pass rollout should start non-blocking until canonical collector is proven stable

## C. Canonical Onboarding Recommendation

### Source identity

- `source_key = 'yandex_direct'`

### Recommended authority fact scope

- `authority_fact_scope = 'delivery_entity'`

Reason:
- strongest detailed legacy bridge is ad/day
- campaign-only marketplace rows should not replace the more granular authority source

### Recommended native grain

- `native_grain = 'ad'`

Recommended canonical dictionary interpretation:
- account:
  - `req_system.name` / client login
- campaign:
  - `campaign_id`
- delivery entity:
  - `ad_id`
- creative:
  - `ad_id` in first pass, unless a more specific creative asset id exists upstream

### Recommended comparison level

Primary:
- `delivery_entity_day`

Secondary:
- `campaign_day`

### Recommended first-pass canonical scope

Write in first pass:
- only detailed path from `yandex_new`
- one row per `date + campaign_id + ad_id`

Do not force into first pass:
- campaign-only `yandex_market_stat` rows as separate authority facts

Reason:
- detailed stats path is already sufficient for canonical fact onboarding
- marketplace summary path can be used later as supplemental validation or campaign-only fallback if business needs it

## D. Metric Mapping

### Legacy -> canonical mapping

From `yandex_new`:
- `date -> report_date`
- `campaign_id -> platform_campaign_id`
- `ad_group_id -> parent delivery grouping / raw payload only`
- `ad_id -> platform_delivery_entity_id`
- `ad_id -> platform_creative_id` for first pass
- `cost -> spend`
- `impressions -> impressions`
- `clicks -> clicks`
- `conversions -> conversions`
- `impressionsReach -> reach` only when available
- `ctr -> ctr`
- `avgCpc -> cpc`
- `avgImpr -> raw_payload` or source-specific informational field only

### Parity-safe metrics

First-pass parity-safe metrics:
- `impressions`
- `clicks`
- `spend`
- `conversions`

### Derived-only / informational metrics

Keep out of first-pass parity gate:
- `ctr`
- `avg_cpc`
- `conversion_rate`
- `avgImpr`
- `reach`

Reason:
- counts and spend are the strongest stable parity baseline
- rates should be derived or informational only
- `reach` is not universally available across Direct report types

## E. Governance Draft

Current state:
- governance is applied via `010_yandex_direct_governance.sql`
- source is monitored
- source remains non-blocking

### Proposed `source_parity_policy` row

```sql
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
);
```

Recommended interpretation:
- start as `non-blocking`
- keep rollout non-blocking through initial shadow cron phase

### Proposed `source_metric_contracts` rows

```sql
INSERT INTO source_metric_contracts
(source_key, native_metric_name, canonical_metric_name, metric_scope, native_grain, is_required, is_parity_metric, is_derived, description)
VALUES
('yandex_direct', 'Cost', 'spend', 'delivery_entity', 'ad', TRUE,  TRUE,  FALSE, 'Daily spend from Yandex Direct report'),
('yandex_direct', 'Impressions', 'impressions', 'delivery_entity', 'ad', TRUE,  TRUE,  FALSE, 'Daily impressions from Yandex Direct report'),
('yandex_direct', 'Clicks', 'clicks', 'delivery_entity', 'ad', TRUE,  TRUE,  FALSE, 'Daily clicks from Yandex Direct report'),
('yandex_direct', 'Conversions', 'conversions', 'delivery_entity', 'ad', FALSE, TRUE,  FALSE, 'Daily conversions from Yandex Direct report'),
('yandex_direct', 'ImpressionReach', 'reach', 'delivery_entity', 'ad', FALSE, FALSE, FALSE, 'Reach available only in media report variant; informational in first pass'),
('yandex_direct', 'Ctr', 'ctr', 'delivery_entity', 'ad', FALSE, FALSE, TRUE, 'Prefer derived parity usage downstream'),
('yandex_direct', 'AvgCpc', 'cpc', 'delivery_entity', 'ad', FALSE, FALSE, TRUE, 'Derived/informational metric'),
('yandex_direct', 'AvgImpressionPosition', 'avg_impression_position', 'delivery_entity', 'ad', FALSE, FALSE, TRUE, 'Informational metric, not part of canonical parity baseline');
```

## F. Validation Strategy

### 1. Dedupe checks

Confirm:
- `fact_rows == distinct_grain_rows`

Expected first-pass grain key:
- `report_date`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `fact_scope`
- `native_grain`
- `breakdown_scope`
- `platform_delivery_entity_id`
- `platform_creative_id`

### 2. Orphan dictionary checks

Validate facts against:
- `canonical_source_accounts`
- `canonical_source_campaigns`
- `canonical_source_delivery_entities`
- `canonical_source_creatives`

### 3. Null baseline checks

Validate first-pass baseline fields:
- `spend`
- `impressions`
- `clicks`
- `conversions`

### 4. Strongest direct parity grain

Primary compare:
- legacy `yandex_new`
- canonical `canonical_fact_ads_daily`
- join keys:
  - `report_date`
  - `platform_campaign_id`
  - `platform_delivery_entity_id`

Primary parity metrics:
- `spend`
- `impressions`
- `clicks`
- `conversions`

### 5. Secondary aggregate parity grain

Secondary compare:
- aggregate both sides to `campaign_day`

Use for:
- smoke-check totals
- coverage drift detection
- validating campaign-level behavior where marketplace summary overlap matters

### 6. Likely rollout mode

Recommended first rollout mode:
- `non-blocking`

Reason:
- current legacy runtime is degraded
- Direct has two legacy fact paths
- safer to validate canonical collector in shadow before promoting blocking behavior

## G. Implementation Order

1. governance migration draft
2. collector implementation
3. short backfill
4. validation
5. monitor integration
6. shadow cron decision

Practical first implementation window:
- start with `7-14 days`
- validate direct `yandex_new` parity first
- keep rollout non-blocking until repeated runs are stable

## H. Current rollout state

Current state:
- collector implemented: `fetch_yandex_direct_canonical.py`
- governance applied: `010_yandex_direct_governance.sql`
- monitor integrated
- source is non-blocking
- source is shadow-ready
- cron is enabled on VPS runtime

Documented production cron line:

```cron
34 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_yandex_direct_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/yandex-direct-canonical-cron.log 2>&1
```

Observed scheduled cron stability:

- `2026-03-17` `success`
- `2026-03-18` `success`
- `2026-03-19` `success`
- `2026-03-20` `success`

Continue checking:

Day 1
- verify cron executed
- inspect `/root/reportingdash-canonical/logs/yandex-direct-canonical-cron.log`
- run `/root/reportingdash-canonical/venv/bin/python monitor_canonical_shadow.py`
- verify latest `canonical_collector_runs` for `source_key='yandex_direct'`

Day 2
- confirm `rows_read`, `rows_written`, `rows_updated` stability
- confirm `gate_scope = delivery_entity`
- confirm policy still loads from DB
- confirm `is_blocking = 0`

Day 3
- confirm parity remains clean on:
  - `spend`
  - `impressions`
  - `clicks`
  - `conversions`
- confirm no unexpected coverage drift
- confirm source remains non-blocking

Failure signals:
- investigate `FAIL_RUN`
- investigate unexpected `WARN_PARITY`
- investigate coverage becoming in-window drift instead of clean or empty coverage

Known first-pass limitation:
- account bridge is partially synthetic
- this must remain documented, but it does not block shadow rollout

Current operational note:
- new client login candidate `porg-47e7bbnx` (`Client ID 322609311`) is not onboarded yet
- direct no-write probe against `POST https://api.direct.yandex.com/json/v5/reports` was executed with all currently active manager tokens from `report_bd_tech.req_system`
- observed result for all tested tokens:
  - `404`
  - `В HTTP-заголовке Client-Login указан несуществующий логин`
- practical conclusion:
  - do not add this login into `req_system`
  - do not include it into canonical collection
  - first obtain confirmation from Yandex on the exact valid `Client-Login` / access grant for the agency token

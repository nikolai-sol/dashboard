# GetIntent Reporting Onboarding

## Executive Summary

`GetIntent` should be onboarded only as a reporting/statistics source into the canonical reporting core.

What the current GetIntent path provides:
- advertiser/system allow-list
- campaign dictionary
- advertiser/group dictionary bridge
- creative dictionary
- daily creative-level delivery stats
- viewability-style/video-completion metrics

What is actually available in the current legacy path:
- `imps`
- `unique_imps`
- `clicks`
- `ctr`
- `view_rate`
- `video_completion_25`
- `video_completion_50`
- `video_completion_75`
- `video_completion_100`

What is confirmed in the current live reporting API path for `browser_traffic`:
- `imps`
- `clicks`
- `cpm`
- `cpc`
- `budget`

What is not available in the current legacy path:
- `spend`
- explicit `conversions`
- explicit `reach`

What makes `GetIntent` different from other onboarded sources:
- unlike `linkedin` and `reddit`, this is a programmatic/reporting feed with video-completion style metrics as first-class output
- unlike `vk_ads_v2`, legacy storage already has a strong direct shared parity grain with campaign and creative ids
- unlike `hybrid`, the current legacy feed is structurally simpler and appears closer to a stable direct parity bridge
- current API path uses a legacy oddity: code sends `axios.post()` to a URL that semantically looks like a `GET` request; this should not be copied blindly into final canonical implementation without verification against real API behavior

Practical conclusion:
- `GetIntent` is a good candidate for canonical onboarding as a `delivery_entity` source with direct parity on the shared creative/day grain
- first pass should stay narrow and focus on reliable observed metrics only

## Legacy Bridge Analysis

### Current legacy route

Internal route:
- `GET /getintent?day=YYYY-MM-DD&secret=...`

Service:
- [`getintent.service.ts`](/Users/nicko/ReportingDash/nest-second/src/services/getintent/getintent.service.ts)

Current external API request:
- `https://reporting.getintent.com/api/v2/reports`

Current params built by legacy code:
- `dataset_name=browser_traffic`
- `start={day}`
- `end={day}`
- `timezone=Europe/Moscow`
- `relations=1`
- `keys=day,campaign_id,campaign_group_id,creative_id,advertiser_id`
- `values=imps,unique_imps,clicks,ctr,view_rate,video_completion_25,video_completion_50,video_completion_75,video_completion_100`
- `token={token}`

Confirmed live API probe on the same reporting endpoint:
- `values=imps,clicks,cpm,cpc,budget`
- accepted successfully with HTTP `200`
- therefore the reporting endpoint supports:
  - `cpm`
  - `cpc`
  - `budget`

Rejected candidate spend fields:
- `cost`
- `spend`
- `media_cost`
- `budget_spent`

Important legacy oddity:
- code uses `axios.post(URL, requestData)` for what appears to be a query-style reporting endpoint
- first canonical collector pass should prefer the currently working legacy path, but this request shape must be verified explicitly during implementation

### Current legacy tables

Tech DB:
- `git_system`

Stats DB:
- `git_name`
- `git_group_campaign`
- `git_creative`
- `git_statistic`

Observed legacy table semantics:
- `git_system`
  - allow-list of active advertiser/system ids
- `git_name`
  - `campaign_id -> campaign name`
- `git_group_campaign`
  - `advertiser_id -> advertiser/group name`
- `git_creative`
  - `creative_id -> creative name`
- `git_statistic`
  - daily fact table

### Current legacy fact grain

`git_statistic` unique key:
- `day`
- `creative_id`
- `campaign_id`
- `campaign_group_id`

Strongest realistic shared parity grain:
- `delivery_entity_day`
- concretely:
  - `report_date`
  - `platform_campaign_id`
  - `platform_delivery_entity_id`

Why this is the strongest bridge:
- legacy already stores stable campaign + creative ids
- there is no dependence on parsing mixed free-text object names
- direct compare at shared grain is better than aggregate-only compare

### Legacy limitations

Known legacy limitations:
- no `spend`
- no explicit conversion counter
- `ctr` and `view_rate` are rate metrics, not best parity authority metrics
- `git_group_campaign` stores advertiser/group naming, but not a fully normalized account/campaign hierarchy for modern canonical semantics
- `git_group_campaign` unique key is on `advertiser_id`, so it behaves more like advertiser/account naming than campaign grouping

Practical implication:
- parity should rely on counts, not rates
- `spend` cannot be part of first-pass parity baseline
- direct parity should not depend on `git_group_campaign` semantics beyond naming/enrichment

## Canonical Onboarding Recommendation

### Source identity

- `source_key = 'getintent'`

### Recommended authority scope

- `authority_fact_scope = 'delivery_entity'`

Reason:
- strongest direct bridge is creative/day
- legacy feed is already stored at creative granularity

### Recommended native grain

- `native_grain = 'creative'`

Recommended dictionary interpretation:
- account:
  - `advertiser_id`
- campaign:
  - `campaign_id`
- delivery entity:
  - `creative_id`
- creative:
  - `creative_id`

### Recommended parity comparison level

Primary parity level:
- `delivery_entity_day`

Secondary parity level:
- `campaign_day`

Reason:
- direct shared grain should be the first source of truth
- campaign rollup is useful as secondary validation only

### Canonical fact write recommendation

Write into:
- `canonical_fact_ads_daily`

Recommended fact write shape:
- `source_key = 'getintent'`
- `fact_scope = 'delivery_entity'`
- `native_grain = 'creative'`
- `platform_account_id = advertiser_id`
- `platform_campaign_id = campaign_id`
- `platform_delivery_entity_id = creative_id`
- `platform_creative_id = creative_id`

### Baseline metric mapping

Recommended baseline mapping:
- `imps -> impressions`
- `clicks -> clicks`

Not available now:
- `spend`
- `conversions`
- `reach`

Confirmed additional financial/rate fields from the live reporting API:
- `cpm`
- `cpc`
- `budget`

### Extended metric mapping

Recommended extended mapping:
- `unique_imps -> views`
  - only as a pragmatic first-pass placeholder if no better canonical field exists for unique delivery count
  - should be documented explicitly because `unique_imps` is not the same semantic as video views
- `video_completion_25 -> video_views_25`
- `video_completion_50 -> video_views_50`
- `video_completion_75 -> video_views_75`
- `video_completion_100 -> video_views_100`
- `view_rate -> viewability`
- `cpm -> cpm`
- `cpc -> cpc`

Budget note:
- `budget` is available from the reporting API
- but `budget` is not the same semantic as daily spend
- it should be treated as informational only unless a dedicated higher-level budget storage layer is introduced

Derived spend recommendation:
- if product needs a spend-like metric for `GetIntent`, use:
  - `derived_spend = impressions / 1000 * cpm`
- this is acceptable on the shared `creative/day` grain
- but it must be marked as derived, not source-native spend
- do not use this derived spend as a legacy parity metric

Important semantic note:
- `unique_imps` is not a perfect semantic match for canonical `views`
- before implementation, decide whether canonical `views` should be left `NULL/0` or whether `unique_imps` should be mapped to `views` as a temporary first-pass compatibility choice
- the safer default for correctness is:
  - keep `views` empty unless product specifically wants `unique_imps` surfaced there

### Derived-only metrics

Should remain derived or informational only:
- `ctr`
- `view_rate` if mapped downstream as rate only
- any synthetic ratios
- `derived spend from cpm`
- `budget`

Reason:
- counts are stronger parity anchors than rates

## Governance Draft

Draft only. Do not apply on this step.

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
  'getintent',
  'delivery_entity',
  'delivery_entity_day',
  0.00,
  0,
  0,
  0,
  'allow_canonical_ahead',
  0,
  'GetIntent first-pass parity should use direct delivery_entity/day compare against legacy creative-level stats. Spend is not available in current legacy storage. Non-blocking rollout recommended until semantics for unique_imps/views are confirmed.'
);
```

Recommended interpretation:
- start as `non-blocking`
- promote only after direct-grain parity proves stable over repeated runs

### Proposed `source_metric_contracts` rows

```sql
INSERT INTO source_metric_contracts
(source_key, native_metric_name, canonical_metric_name, metric_scope, native_grain, is_required, is_parity_metric, is_derived, description)
VALUES
('getintent', 'imps', 'impressions', 'delivery_entity', 'creative', TRUE,  TRUE,  FALSE, 'Daily impressions at GetIntent creative grain'),
('getintent', 'clicks', 'clicks', 'delivery_entity', 'creative', TRUE,  TRUE,  FALSE, 'Daily clicks at GetIntent creative grain'),
('getintent', 'unique_imps', 'views', 'delivery_entity', 'creative', FALSE, FALSE, FALSE, 'Temporary/provisional mapping only if product decides to surface unique impressions through canonical views'),
('getintent', 'video_completion_25', 'video_views_25', 'delivery_entity', 'creative', FALSE, TRUE, FALSE, 'Video completion 25 percent'),
('getintent', 'video_completion_50', 'video_views_50', 'delivery_entity', 'creative', FALSE, TRUE, FALSE, 'Video completion 50 percent'),
('getintent', 'video_completion_75', 'video_views_75', 'delivery_entity', 'creative', FALSE, TRUE, FALSE, 'Video completion 75 percent'),
('getintent', 'video_completion_100', 'video_views_100', 'delivery_entity', 'creative', FALSE, TRUE, FALSE, 'Video completion 100 percent'),
('getintent', 'view_rate', 'viewability', 'delivery_entity', 'creative', FALSE, FALSE, FALSE, 'Rate metric, informational only'),
('getintent', 'ctr', 'ctr', 'delivery_entity', 'creative', FALSE, FALSE, TRUE, 'Prefer derived usage downstream even if source returns CTR');
```

First-pass parity-safe metrics:
- `impressions`
- `clicks`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`

Metrics that should stay out of first-pass parity baseline:
- `spend`
- `conversions`
- `views` until `unique_imps` semantics are explicitly accepted for that field
- rate metrics like `ctr` and `view_rate`
- `cpm`
- `cpc`
- `budget`
- any spend derived from `cpm`

## Validation Strategy

### 1. Dedupe checks

Confirm:
- `fact_rows == distinct_grain_rows`

Expected grain key:
- `report_date`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `fact_scope`
- `native_grain`
- `breakdown_scope`
- `platform_delivery_entity_id`
- `platform_creative_id`

### 2. Orphan checks

Validate facts against:
- `canonical_source_accounts`
- `canonical_source_campaigns`
- `canonical_source_delivery_entities`
- `canonical_source_creatives`

### 3. Null baseline checks

Validate first-pass baseline fields:
- `impressions`
- `clicks`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`

Also validate any provisional field choice for `views` if `unique_imps` is mapped there.

### 4. Strongest direct parity grain

Primary compare:
- legacy `git_statistic`
- canonical `canonical_fact_ads_daily`
- join keys:
  - `report_date`
  - `platform_campaign_id`
  - `platform_delivery_entity_id`

Primary parity metrics:
- `impressions`
- `clicks`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`

### 5. Secondary aggregate parity grain

Secondary compare:
- aggregate both sides to `campaign_day`

Use this for:
- smoke-check totals
- coverage drift detection

Do not use this as the only validation level.

### 6. Likely rollout mode

Recommended rollout mode:
- `non-blocking`

Reason:
- source is not yet validated in canonical path
- semantic question around `unique_imps -> views` is still open
- safer to start with direct-grain parity in monitor before any blocking promotion

## Recommended Implementation Order

1. governance draft
2. collector first-pass
3. short backfill
4. validation
5. monitor integration
6. shadow cron decision

Practical first implementation window:
- start with `7-14 days`
- verify direct creative/day parity first
- keep rollout `non-blocking` until repeated runs are stable

## Current Rollout State

Current state:
- collector implemented
- governance applied
- monitor integrated
- source is `non-blocking`
- source is `shadow-ready`
- cron is enabled on VPS runtime

Current monitor interpretation:
- direct parity on first-pass safe metrics is clean
- current coverage drift is informational only
- `canonical_only_rows_after_legacy_max` is expected when canonical is ahead of legacy dates

Additional confirmed API semantics:
- `browser_traffic` reporting path supports `cpm`, `cpc`, `budget`
- `browser_traffic` reporting path does not support:
  - `cost`
  - `spend`
  - `media_cost`
  - `budget_spent`
- if a future `v1.1` update is needed, `GetIntent` can add:
  - `cpm`
  - `cpc`
  - informational `budget`
  - derived spend from `cpm * impressions / 1000`

Post-migration note:
- do not expand the current collector during the active migration wave
- after the current migration milestone is closed, return to `GetIntent v1.1`
- scope of that follow-up:
  - read `cpm`
  - read `cpc`
  - read informational `budget`
  - derive `spend = impressions / 1000 * cpm`
- keep all of the above out of legacy parity baseline

## Recommended Shadow Cron Line

Production runtime:
- `/root/reportingdash-canonical`

Recommended cron line:

```cron
32 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_getintent_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/getintent-canonical-cron.log 2>&1
```

Current VPS runtime:
- `/root/reportingdash-canonical`
- cron line is enabled

## GetIntent Cron Rollout Monitoring

### Day 1

- verify cron executed
- check log:
  - `tail -n 100 /root/reportingdash-canonical/logs/getintent-canonical-cron.log`
- run monitor:
  - `cd /root/reportingdash-canonical && venv/bin/python monitor_canonical_shadow.py`
- verify collector runs:

```sql
SELECT id, status, rows_read, rows_written, rows_updated, started_at
FROM canonical_collector_runs
WHERE source_key = 'getintent'
ORDER BY id DESC
LIMIT 5;
```

Expected:
- `status = success`
- `error_count = 0`

### Day 2

Confirm ingestion stability:
- `rows_read`
- `rows_written`
- `rows_updated`

Verify monitor block:
- policy loaded
- `gate_scope = delivery_entity`
- `is_blocking = 0`

### Day 3

Verify parity stability:
- `impressions`
- `clicks`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`

Allowed informational signal:
- `INFO_COVERAGE:canonical_ahead_of_legacy`

Operational rule:
- this signal does not block rollout

# CANONICAL ENTITIES MEMORY

Current operational memory for canonical DB entities in `/Users/nicko/ReportingDash`.

Use this file first when the task is about:
- canonical schema
- canonical entity relationships
- fact grain
- metadata tables
- ingestion lineage
- parity checks against legacy
- SQL against canonical tables

This file is working memory, not historical design prose.
If runtime reality changes, rewrite this file.

## Scope

Canonical runtime currently uses:
- primary DB: `report_bd`
- tech DB: `report_bd_tech`

Canonical entity and fact tables live in `report_bd`.

## Core canonical tables

### 1. `canonical_source_accounts`

Purpose:
- account / advertiser dictionary for each source
- top-level business/account mapping used by dashboard and lineage

Current practical fields that matter:
- `id`
- `source_key`
- `platform_account_id`
- `external_account_ref`
- `account_name`
- `advertiser_name`
- `currency`
- `timezone`
- `account_status`
- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`

Operational notes:
- unique identity is effectively `source_key + platform_account_id`
- not every source has a clean real account-level bridge
- `yandex_direct` currently contains many fallback rows like `campaign::<campaign_id>` instead of clean business account names
- for some bridged sources, advertiser discovery is part of collector logic, not a separate sync job

### 2. `canonical_source_campaigns`

Purpose:
- campaign dictionary per source
- stable campaign identity and business-facing name layer

Current practical fields that matter:
- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `campaign_name`
- `objective`
- `buy_type`
- `campaign_status`
- `start_date`
- `end_date`
- `currency`
- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`

Operational notes:
- effective identity is `source_key + platform_campaign_id`
- dashboard channel binding often happens above campaign level, but raw canonical facts still map through campaign ids where available
- LinkedIn and Reddit common-table flow is still campaign-level in upstream legacy/common storage

### 3. `canonical_source_delivery_entities`

Purpose:
- delivery-level dictionary below campaign
- practical stand-in for creative/ad/ad-group/placement level lineage

Current practical fields that matter:
- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `platform_entity_id`
- `entity_name`
- `entity_level`
- `parent_entity_id`
- `status`
- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`

Operational notes:
- this is the main lower-grain entity dictionary used by current collectors
- actual source meaning differs by platform:
  - Hybrid: banner / creative-like entity
  - GetIntent: creative or group-linked delivery entity
  - Yandex Direct: ad / group / campaign bridge depending on available upstream ids
- not every source fills every semantic field consistently

### 4. `canonical_source_creatives`

Purpose:
- creative dictionary when collector exposes a creative-level object explicitly
- often parallels `canonical_source_delivery_entities`

Current practical fields that matter:
- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `platform_creative_id`
- `creative_name`
- `creative_type`
- `status`
- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`

Operational notes:
- some sources effectively mirror delivery entities into creatives
- current runtime still keeps both delivery-entity and creative tables; the old design doc suggested a future universal entity table, but that is not the active production layout now

### 5. `canonical_fact_ads_daily`

Purpose:
- main paid-media fact table for canonical reporting
- daily grain for dashboard, parity, and monitoring

Current practical identity:
- one row per source / date / lowest available delivery grain for that collector

Fields that matter operationally:
- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `platform_entity_id`
- `platform_creative_id`
- `fact_scope`
- `native_grain`
- `report_date`
- `currency`
- `spend`
- `impressions`
- `clicks`
- `conversions`
- `views`
- `reach`
- `frequency`
- `ctr`
- `cpm`
- `cpc`
- `cpv`
- `cpa`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`
- `viewability`
- `link_clicks`
- `raw_payload_ref`
- `ingestion_run_id`
- `created_at`
- `updated_at`

Operational notes:
- this is the main table to query for paid-media parity and dashboard source facts
- actual lowest grain differs by source
- `ingestion_run_id` is mandatory lineage back to `canonical_collector_runs`
- `native_grain` matters when collector grain is not fully uniform across platforms
- not every metric is native for every source; some are null, some are derived

Source caveats:
- LinkedIn / Reddit:
  - currently originate from common `ad_analytics_daily`
  - practical grain is campaign/day, not creative/day
- Yandex Direct:
  - canonical collector currently materializes from legacy bridge tables `yandex_new`, `yandex_names`, `yandex_group_names`
  - not a pure direct-to-canonical source yet
- Hybrid:
  - delivery metrics come from stable API path
  - spend currently may be derived from `ECPM` / `ECPC` if native `TotalSum` is not available in stable path
  - collector must not overwrite `views` and quartiles with zeroes when spend enrichment path lacks those fields
- GetIntent / VK / others:
  - some cost metrics are absent or partially bridged depending on upstream source

### 6. `canonical_fact_site_analytics_daily`

Purpose:
- analytics-domain daily facts
- not to be mixed with paid-media fact grain

Used for:
- Yandex Metrika and future analytics sources

Typical fields that matter:
- `source_key`
- `counter_id` / analytics entity ids
- `report_date`
- sessions / users / goal metrics / page metrics
- `ingestion_run_id`

Operational notes:
- separate domain from `canonical_fact_ads_daily`
- use for web/session/goal data, not ad spend facts

### 6a. `canonical_fact_promopages_daily`

Purpose:
- dedicated fact table for Yandex Promopages
- separate from ordinary paid-media ads facts

Agreed reason for separate table:
- Promopages uses a different metric model and should not be forced into `canonical_fact_ads_daily`
- source-specific metrics include:
  - `full_reads`
  - `full_read_percent`
  - `clickouts`
  - `clickout_cost`
  - `clickout_percent`
  - `metrica_visits`
  - `metrica_visit_percent`
  - `metrica_visit_cost`
  - `budget`
  - `cpm`

Agreed v1 grain:
- `platform_account_id + platform_campaign_id + report_date`

Agreed implementation phases:
- Phase 1:
  - separate source key: `yandex_promopages`
  - separate collector contour
  - separate dashboard section
  - no mixing into standard awareness plan/fact
- Phase 2:
  - optional media plan binding
  - optional inclusion into overall awareness spend totals

Status:
- implemented in production schema
- current source key:
  - `yandex_promopages`
- current phase 1 runtime:
  - collector writes isolated promopages facts here
  - dashboard loader reads from this table only for dedicated `promopages` section
- current phase 2 runtime:
  - not implemented
  - no media plan bindings
  - no inclusion in standard awareness spend totals

### 7. `canonical_collector_runs`

Purpose:
- canonical ingestion log and run lineage table

Fields that matter operationally:
- `id`
- `source_key`
- `status`
- `run_type`
- `date_from`
- `date_to`
- `rows_read`
- `rows_written`
- `rows_updated`
- `error_message`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

Operational notes:
- every fact backfill or cron pass should be traceable here
- use this table first for collector health, recent failures, and unusual backfills
- `ingestion_run_id` in fact tables points here

## Current relationship model

Practical lineage chain:
- `canonical_source_accounts`
  -> `canonical_source_campaigns`
  -> `canonical_source_delivery_entities`
  -> `canonical_source_creatives`
  -> `canonical_fact_ads_daily`
  -> `canonical_collector_runs`

Important:
- not every source fills every layer perfectly
- joins should be source-aware, not idealized
- when debugging parity, facts first, then campaign/entity dictionaries, then run lineage

## Current grain reality

Do not assume one universal grain.

Current practical source grain examples:
- LinkedIn: campaign/day
- Reddit: campaign/day
- Yandex Direct: ad/group/campaign bridge materialized from legacy reporting tables
- Hybrid: banner or delivery-entity/day
- GetIntent: creative or creative-linked/day
- VK Ads v2: creative/day
- Yandex Metrika: analytics counter/day or goal/session-style analytics grain in separate analytics family

## Canonical vs design-doc warning

Older design docs describe a cleaner future-state schema with:
- `source_accounts`
- `source_campaigns`
- one universal `source_entities`
- one ideal `fact_ads_daily`

Current production truth is different:
- production tables are prefixed `canonical_`
- production still uses both `canonical_source_delivery_entities` and `canonical_source_creatives`
- some sources are still bridged from legacy storage rather than collected directly into canonical

For implementation work, prefer runtime truth over aspirational design.

## Query order for debugging

When investigating canonical data issues, use this order:

1. `canonical_collector_runs`
- did the source run
- what date window
- how many rows read/written
- any error or unusual backfill

2. `canonical_fact_ads_daily` or `canonical_fact_site_analytics_daily`
- are fact rows present
- what metrics are null / zero / derived
- which `ingestion_run_id` wrote them

3. dictionary tables
- `canonical_source_campaigns`
- `canonical_source_delivery_entities`
- `canonical_source_creatives`
- `canonical_source_accounts`

4. legacy bridge tables if the source is not fully direct yet
- `yandex_new`
- `yandex_names`
- `yandex_group_names`
- `hyb_stats`
- `git_statistic`
- other source-specific tables

## SQL shortcuts

Latest runs:
```sql
SELECT id, source_key, status, run_type, date_from, date_to, rows_read, rows_written, rows_updated, started_at
FROM report_bd.canonical_collector_runs
ORDER BY id DESC
LIMIT 30;
```

Recent facts for one source:
```sql
SELECT report_date, COUNT(*) AS rows_n, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(spend) AS spend
FROM report_bd.canonical_fact_ads_daily
WHERE source_key = 'yandex_direct'
GROUP BY report_date
ORDER BY report_date DESC
LIMIT 14;
```

Campaign dictionary check:
```sql
SELECT platform_campaign_id, campaign_name, campaign_status, last_seen_at
FROM report_bd.canonical_source_campaigns
WHERE source_key = 'hybrid'
ORDER BY last_seen_at DESC
LIMIT 50;
```

Account bridge check:
```sql
SELECT platform_account_id, account_name, advertiser_name, account_status
FROM report_bd.canonical_source_accounts
WHERE source_key = 'yandex_direct'
ORDER BY id;
```

## Maintenance rule

Whenever canonical schema behavior changes, update this file immediately.

Examples:
- new canonical table added
- a source changes grain
- a source moves from legacy bridge to direct canonical ingest
- derived metrics rules change
- a dictionary layer stops being authoritative

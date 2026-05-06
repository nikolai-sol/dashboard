# Hybrid API Reference

## Purpose

Этот файл фиксирует, что именно из `Hybrid API` выглядит полезным для `ReportingDash` planning/discovery contour и что реально используется в текущем legacy reporting path.

Он нужен как рабочая reference-справка перед проектированием `Hybrid` onboarding в planning layer.

Official docs used:
- `https://hybrid.ru/hybrid-api/`

## What We Already Use In Legacy

Текущий legacy `nest-second` Hybrid collector использует reporting-oriented path:

- `POST https://api.hybrid.ru/token`
- `GET https://api.hybrid.ru/v3.0/agency/advertisers`
- `GET https://api.hybrid.ru/v3.0/advertiser/BannerName`

Это подтверждено в:
- `nest-second/src/services/hybrid/hybrid.service.ts`
- `nest-second/.development.env`

Current persisted Hybrid metrics in legacy:
- impressions
- views
- clicks
- reach
- video quartiles
- ctr
- viewability
- frequency

Important:
- current legacy Hybrid path does **not** persist spend
- current legacy path is reporting-focused, not planning/discovery-focused

Live reporting-path probe result:
- current `advertiser/BannerName` reporting path returns fields such as:
  - `ImpressionCount`
  - `ClickCount`
  - `Reach`
  - `CTR`
  - `ViewCount`
  - `firstQuartileEventsCount`
  - `midpointEventsCount`
  - `thirdQuartileEventsCount`
  - `completeEventsCount`
  - `Viewability`
  - `Frequency`
  - `VTR`
- current probe did **not** expose:
  - `Cost`
  - `Spend`
  - `CPM`
  - `CPC`
  - `Budget`

Practical implication:
- current Hybrid reporting path is not sufficient for native spend ingestion
- current Hybrid reporting path is also not sufficient for derived spend from `CPM` / `CPC`
- official documented statistics endpoint `agencyStatistic/getSplit` appears richer and documents:
  - `items[].eCPM`
  - `items[].CPC`
  - `items[].TotalSum`
- for ReportingDash this should be treated as a later canonical enrichment path, separate from the current stable legacy-compatible collector

## Official Hybrid API Methods Relevant To Planning / Discovery

### 1. `audience/getbydatacloudid?dataCloudId=`

Purpose:
- get the list of available audiences with IDs and sizes

Official meaning:
- returns all audiences ever created in the Console for the given `dataCloudId`
- includes audience size
- audience size is described as unique users in the audience

Why it matters for planning:
- this is the clearest officially documented audience-size style endpoint found in public docs
- can feed `planning_audience_snapshots`

Relevant fields from docs:
- `size`
- `audience.id`
- `audience.$type`
- `audience.userListType`
- `audience.actionId`
- `audience.name`

Planning interpretation:
- `source_key = 'hybrid'`
- `discovery_scope = 'audience'`
- `audience_key = audience.id`
- `audience_name = audience.name`
- `size_value = size`
- `size_unit = 'users'`
- `source_endpoint = 'audience/getbydatacloudid'`

### 2. `ssp/getall`

Purpose:
- get the list of active SSPs

Relevant fields from docs:
- `id`
- `name`

Why it matters for planning:
- SSP list is useful as inventory/capability reference
- alone it is not a forecast endpoint, but it gives inventory universe metadata

Planning interpretation:
- can feed `planning_audience_snapshots` with:
  - `discovery_scope = 'ssp'`
  - `inventory_key = id`
  - `metadata_json.name = name`
- or a future separate internal reference table if later justified

### 3. `agencyStatistic/getSplit`

Purpose:
- get statistics split by selected dimensions/metrics

Official docs explicitly show metric ids such as:
- `ImpressionCount`
- `ClickCount`
- `firstQuartileEventsCount`
- `midpointEventsCount`
- `thirdQuartileEventsCount`
- `completeEventsCount`
- `Reach`
- `CTR`
- `Viewability`
- `Frequency`
- `VTR`

Why it matters for planning:
- this is useful for benchmark generation from Hybrid reporting data
- can likely support benchmark/reference extraction by selected split
- public docs do not make it a forecast endpoint; it remains a stats endpoint

Planning interpretation:
- feed `planning_source_benchmarks`
- benchmark candidates:
  - `ctr`
  - `viewability`
  - `reach_rate` or `frequency` proxies
  - `vtr`
  - quartile completion rates

## Official Methods Relevant To Campaign Structure, Not Planning Authority

### `campaign/create`

Useful to understand:
- audienceGroup structure
- banner structure
- campaign requirements
- SSP dependency in campaign construction

Why it matters:
- good reference for what dimensions Hybrid campaigns may encode
- useful for future discovery mapping
- not itself a planning support endpoint

### `bannerModeration/get?id=bannerId`

Useful for operational campaign lifecycle, not for planning DB.

## What We Did Not Confirm In Public Docs

After reviewing the official public page, we did **not** confirm a documented dedicated forecast/reach planner endpoint that directly returns final media plan estimates.

Not confirmed from current public docs:
- final forecast endpoint
- guaranteed reach estimator endpoint
- direct audience x SSP x geo x device forecast matrix endpoint
- turnkey plan recommendation endpoint

Architectural implication:
- planning layer should assume that Hybrid will provide discovery signals and stats, not final recommendations
- if forecast endpoint exists privately or in a different doc set, that should be verified separately later

## Recommended Minimal Planning Mapping For Hybrid

### `planning_audience_snapshots`

Minimal fields likely useful from Hybrid discovery:
- `source_key = 'hybrid'`
- `snapshot_date`
- `discovery_scope`
- `advertiser_id` if request is advertiser-bound
- `audience_key`
- `audience_name`
- `inventory_key` for SSP or inventory slice
- `size_value`
- `size_unit`
- `source_endpoint`
- `metadata_json`

Likely first supported scopes:
- `audience`
- `ssp`
- later maybe `audience_ssp` if API exposes such relation in practice

### `planning_source_benchmarks`

Minimal benchmark fields likely derivable for Hybrid:
- `source_key = 'hybrid'`
- `benchmark_scope`
- `channel`
- `format`
- `geo_key`
- `device_key`
- `metric_name`
- `benchmark_value`
- `window_start`
- `window_end`
- `sample_size`
- `benchmark_origin`

Likely first benchmark metrics:
- `ctr`
- `viewability`
- `frequency`
- `vtr`
- quartile rates

## Practical Conclusion For ReportingDash

Current best reading of Hybrid for planning:

1. Historical truth should still come from canonical reporting core.
2. Hybrid planning value is primarily in:
- audience snapshots
- SSP/inventory reference data
- benchmark-supporting statistics
3. Final plan recommendation should stay outside DB in planner/app logic.
4. Before implementation, Hybrid API needs a focused feasibility pass on:
- real authentication flow for discovery methods
- whether audience list is advertiser-bound or datacloud-bound in our accounts
- whether SSP can be tied to usable inventory planning slices
- whether any non-public forecast capability exists for our account setup

## Confirmed vs Unconfirmed

Confirmed from official docs/public page:
- audience list with sizes
- SSP list retrieval
- statistics split endpoint
- campaign structure concepts

Confirmed from current repo behavior:
- token flow
- advertiser list retrieval
- reporting-focused daily stats collector path
- no spend-like fields confirmed in the current reporting payload

Unconfirmed and must not be assumed yet:
- dedicated forecast endpoint
- final reach planner endpoint
- ready-made planning recommendation endpoint
- spend-bearing reporting endpoint for the current collector path

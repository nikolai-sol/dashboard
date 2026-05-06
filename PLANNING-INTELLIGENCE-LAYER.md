# Planning Intelligence Layer

## Executive Summary

`ReportingDash` уже имеет рабочий canonical reporting core для observed campaign statistics. Этот контур остаётся source of truth для фактических рекламных данных, parity и monitoring.

Planning layer нужен в более узком и практичном смысле:

- audience discovery snapshots
- benchmark/supporting statistics for planning
- source capability and inventory reference data
- operational discovery runs for external planning signals

Этот слой не должен хранить сами медиаплановые сценарии, AI recommendations или финальный channel mix. Эти решения живут выше базы данных, в `Agency OS` / planner service.

Итоговое правило:

- reporting core = observed truth
- planning layer DB = supporting intelligence/statistics layer
- planner/app layer = tender logic, campaign selection, recommendations, channel mix suggestion

## Domain Separation

### 1. Reporting Core

Это текущий production контур для observed data:

- `canonical_source_platforms`
- `canonical_source_accounts`
- `canonical_source_campaigns`
- `canonical_source_delivery_entities`
- `canonical_source_creatives`
- `canonical_fact_ads_daily`
- `canonical_fact_site_analytics_daily`
- `canonical_collector_runs`
- `canonical_collector_run_events`
- `canonical_parity_daily`
- `source_metric_contracts`
- `source_parity_policy`

Этот домен отвечает за:

- collector ingestion
- dictionary normalization
- daily observed facts
- parity against legacy
- shadow cron monitoring
- reporting truth for dashboards and downstream reporting

### 2. Planning Intelligence Layer

Это отдельный supporting contour рядом с reporting core.

Он отвечает только за supporting inputs для planning:

- audience discovery
- source capability snapshots
- benchmark/reference values
- operational tracking of discovery jobs

Этот слой может использовать данные reporting core как input, но не должен переписывать reporting truth и не должен хранить application-level planning decisions.

### 3. Planner / App Layer

Это логика выше базы данных.

Именно здесь живут:

- выбор reference campaigns
- tender interpretation
- scenario building
- AI/planner recommendation logic
- channel mix suggestion
- final media plan shaping

Planning DB не должна брать на себя эти функции.

## Practical Planning Flow

Простой flow должен быть таким:

1. Canonical reporting DB хранит historical observed truth.
2. Planner или человек выбирает релевантные historical campaigns как reference set.
3. Planning layer хранит external supporting signals:
   - audience snapshots
   - inventory/capability snapshots
   - benchmark statistics
4. Planner service / Agency OS объединяет:
   - tender input
   - historical references from canonical reporting DB
   - supporting planning signals from planning DB
5. Recommendation строится вне planning DB.

Итог:
- historical truth остаётся в canonical reporting core
- supporting signals живут в planning DB
- recommendation logic живёт в planner/app layer

## Proposed Planning Tables

Ниже только proposal. Миграции на этом шаге не делаются.

### `planning_audience_snapshots`

Purpose:
- хранить snapshots размеров аудиторий, inventory availability и capability slices для planning/discovery

Minimal useful fields for v1:
- `id`
- `source_key`
- `snapshot_date`
- `discovery_scope` — например `audience`, `ssp`, `inventory`, `geo_inventory`
- `advertiser_id` — если snapshot относится к конкретному advertiser/account
- `audience_key` — native audience or segment id
- `audience_name`
- `inventory_key` — SSP / placement / supply bucket if available
- `geo_key`
- `device_key`
- `size_value` — primary count value for the snapshot
- `size_unit` — например `users`, `households`, `cookies`, `impressions_capacity`
- `source_endpoint` — из какого API method получен snapshot
- `metadata_json` — дополнительные dimensions/flags without schema explosion

Grain:
- 1 row = 1 source x 1 snapshot date x 1 discovered audience/inventory slice

Relation to reporting core:
- не является campaign fact
- не заменяет `canonical_fact_ads_daily`
- используется planner logic как supporting signal

### `planning_source_benchmarks`

Purpose:
- хранить normalized benchmark values для planning support

Minimal useful fields for v1:
- `id`
- `source_key`
- `benchmark_scope` — например `source`, `channel`, `format`, `geo_format`
- `channel`
- `format`
- `geo_key`
- `device_key`
- `metric_name` — `cpm`, `ctr`, `viewability`, `reach_rate`, `vtr`, etc.
- `benchmark_value`
- `window_start`
- `window_end`
- `sample_size`
- `benchmark_origin` — `canonical_history`, `manual`, `vendor_reference`

Grain:
- 1 row = 1 source x 1 benchmark slice x 1 metric

Relation to reporting core:
- может агрегироваться из historical canonical stats
- но это reference/benchmark layer, не observed truth layer

### `planning_source_discovery_runs`

Purpose:
- operational tracking for planning/discovery jobs

Key fields:
- `id`
- `source_key`
- `run_type`
- `started_at`
- `finished_at`
- `status`
- `rows_read`
- `rows_written`
- `error_summary`
- `job_key`

Grain:
- 1 row = 1 discovery/planning ingest run

Relation to reporting core:
- отдельный ops контур для planning/discovery jobs
- не смешивается с `canonical_collector_runs`

### `planning_source_discovery_events`

Purpose:
- detailed log/events for planning discovery runs

Key fields:
- `id`
- `run_id`
- `event_type`
- `severity`
- `event_payload`
- `created_at`

Grain:
- 1 row = 1 event inside one planning discovery run

Relation to reporting core:
- отдельно от reporting ingestion ops
- нужен только для planning/discovery operational visibility

## What Is Explicitly Out Of DB Scope

На этом этапе в planning DB не нужны:

- planning tender objects
- scenario rows
- recommendation rows
- channel mix outputs
- final plan objects

Эти вещи относятся к planner/app layer.

Если позже они понадобятся для product storage, это уже будет отдельное решение уровня приложения, а не обязательная часть planning intelligence DB.

## Data Sources For Planning Layer

Planning layer может использовать:

1. Historical canonical stats from reporting core
- observed performance history
- basis for benchmark calculation
- reference campaigns for manual or AI-assisted planning

2. Audience / vendor / platform API data
- audience sizes
- inventory dimensions
- geo/device/platform availability
- placement capability snapshots

3. Internal benchmark data
- agency knowledge
- negotiated rates
- manually curated priors

4. Future Hybrid audience discovery data
- audience availability
- size snapshots
- SSP / inventory coverage
- inventory dimensions

## Hybrid Planning Use Case

`Hybrid` в planning contour нужен не как storage for final plans, а как source of supporting signals.

Что нас интересует в planning DB:

- audience availability
- audience sizes
- inventory dimensions
- SSP / inventory coverage
- planning-relevant discovery snapshots

Что сюда не входит:

- final recommendation which channels to buy
- final tender scenario
- final media mix output

Если у Hybrid API нет готового forecast endpoint, planner service должен строить estimate вне БД на основе:

- selected historical campaigns from canonical reporting DB
- audience/inventory snapshots from planning DB
- benchmark priors from planning DB
- tender inputs from app layer

## Planning Principles

Planning layer должен работать по явным правилам:

- planning DB stores only supporting stats and discovery data
- planning DB never overwrites reporting truth
- historical campaign truth stays in canonical reporting core
- observed vs estimated must remain clearly separated
- AI planner and channel mix suggestions live outside DB
- planner may select relevant historical campaigns directly from canonical reporting DB
- Hybrid discovery data are intelligence inputs, not campaign facts and not final recommendations

## Recommended Rollout Order

Planning work has an explicit dependency: first finish migration of reporting sources into the new canonical structure. Planning implementation starts only after that reporting milestone is accepted.

1. Simplify planning DB scope and freeze boundary with reporting core
2. Finish reporting-source migration and shadow rollout in the canonical contour
3. Connect historical canonical stats as benchmark source
4. Study Hybrid API and document planning/discovery fields
5. Prepare first minimal planning migration draft for support tables only

## Immediate Next Design Questions

Перед implementation phase нужно отдельно ответить на вопросы:

- какие `discovery_scope` values нужны в v1
- какие `size_unit` values реально придут из platform APIs
- какие benchmark slices действительно нужны в v1
- как benchmark windows и sample thresholds считаются valid
- какие Hybrid discovery dimensions реально доступны через API
- где заканчивается DB-support layer и начинается planner/app logic

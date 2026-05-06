# Canonical DB Design

Дата фиксации: `2026-03-13`

## Goal

Спроектировать целевую структуру БД для нового collector cluster так, чтобы:

- собирать **максимум данных**, доступных у площадок
- не терять source-specific granularity
- иметь нормальный слой names / ids / metadata
- уметь строить dashboard без джойнов по legacy-хаосу
- контролировать рост БД
- архивировать всё неважное и всё старше рабочего горизонта

## Design Principles

### 1. Separation of concerns

Нельзя мешать в одну таблицу:

- account / token registry
- campaign dictionary
- creative dictionary
- daily facts
- analytics-only metrics
- ingestion logs
- archive

### 2. Canonical superset, not lowest common denominator

Новая схема должна поддерживать:

- campaign-level sources
- creative-level sources
- video quartiles
- reach / frequency
- engagement metrics
- analytics metrics

Даже если часть площадок не отдаёт конкретную метрику, схема всё равно должна её поддерживать.

### 3. Keep raw lineage

Каждая факт-строка должна быть трассируема:

- откуда пришла
- каким job/run была собрана
- какой raw payload её породил

### 4. Hot / warm / archive lifecycle

Не всё должно жить в одной active fact table вечно.

## Recommended Database Layout

Рекомендую держать **одну MySQL instance**, но логически разделить хранилище на 4 зоны:

### A. Control / Config

Для настроек collector cluster и dashboard.

### B. Metadata / Dictionaries

Таблицы сущностей:

- accounts
- campaigns
- ad groups
- creatives
- placements

### C. Facts

Главные daily/hourly metrics для отчётов и parity.

### D. Archive / Raw / Ops

- raw payload storage
- run logs
- archive fact tables
- size control / housekeeping

## Recommended Core Tables

## 1. Source registry

### `source_platforms`

- `id`
- `source_key` (`linkedin`, `reddit`, `vk_ads_v2`, `hybrid`, `getintent`, `yandex_direct`, `yandex_metrika`)
- `display_name`
- `source_type` (`ads`, `analytics`, `programmatic`, `social`, `search`)
- `entity_granularity_default` (`campaign`, `creative`, `mixed`)
- `currency_default`
- `timezone_default`
- `is_active`
- `created_at`
- `updated_at`

Use:

- реестр поддерживаемых платформ
- конфиг по умолчанию

## 2. Collector accounts

### `source_accounts`

- `id`
- `source_key`
- `platform_account_id`
- `external_account_ref`
- `account_name`
- `advertiser_name`
- `currency`
- `timezone`
- `status`
- `is_active`
- `first_seen_at`
- `last_seen_at`
- `raw_payload`
- `created_at`
- `updated_at`

Unique:

- `(source_key, platform_account_id)`

## 3. Campaign dictionary

### `source_campaigns`

- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `campaign_name`
- `objective`
- `buy_type`
- `status`
- `start_date`
- `end_date`
- `daily_budget`
- `total_budget`
- `currency`
- `first_seen_at`
- `last_seen_at`
- `raw_payload`
- `created_at`
- `updated_at`

Unique:

- `(source_key, platform_campaign_id)`

## 4. Entity dictionary

Нужна одна универсальная таблица вместо пяти отдельных.

### `source_entities`

- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `entity_level`
  - `ad_group`
  - `creative`
  - `placement`
  - `ad`
  - `post`
- `platform_entity_id`
- `parent_entity_id`
- `entity_name`
- `status`
- `destination_url`
- `final_url`
- `format`
- `creative_type`
- `post_id`
- `content_ref`
- `preview_url`
- `first_seen_at`
- `last_seen_at`
- `raw_payload`
- `created_at`
- `updated_at`

Unique:

- `(source_key, entity_level, platform_entity_id)`

### Why one universal entity table

Это позволяет:

- одинаково хранить LinkedIn creatives
- Reddit ads
- VK banners
- Hybrid creatives
- GetIntent creatives
- Yandex ad groups / ads

## 5. Daily fact table

### `fact_ads_daily`

Главная таблица отчётности.

- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `entity_level`
- `platform_entity_id`
- `report_date`
- `spend`
- `spend_usd`
- `impressions`
- `clicks`
- `link_clicks`
- `conversions`
- `leads`
- `views`
- `video_views`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`
- `reach`
- `frequency`
- `likes`
- `comments`
- `shares`
- `follows`
- `reactions`
- `sends`
- `opens`
- `ctr`
- `cpm`
- `cpc`
- `cpv`
- `cpa`
- `engagement_rate`
- `viewability`
- `currency`
- `raw_payload_ref`
- `ingestion_run_id`
- `created_at`
- `updated_at`

Unique:

- `(source_key, report_date, entity_level, platform_entity_id)`

Secondary indexes:

- `(source_key, report_date)`
- `(platform_campaign_id, report_date)`
- `(platform_account_id, report_date)`
- `(source_key, entity_level, report_date)`

### Why this is the main fact table

Она покрывает:

- LinkedIn creative daily
- Reddit ad daily
- Hybrid creative daily
- GetIntent creative daily
- VK creative daily
- Yandex Direct ad-group/ad daily

Если источник доступен только на уровне кампании:

- `entity_level='campaign'`
- `platform_entity_id = platform_campaign_id`

## 6. Hourly fact table

### `fact_ads_hourly`

Нужна не для всех источников, а только если реально доступен hourly breakdown и это полезно.

Колонки те же, плюс:

- `report_hour`

Unique:

- `(source_key, report_date, report_hour, entity_level, platform_entity_id)`

### Recommendation

Не включать сразу для всех.

Стартовать только если реально нужен:

- Reddit
- какие-то future DV360 / programmatic источники

Иначе БД раздуется без бизнес-пользы.

## 7. Analytics fact tables

`Yandex Metrika` нельзя смешивать в `fact_ads_daily`.

Нужна отдельная доменная модель.

### `analytics_counters`

- `id`
- `source_key='yandex_metrika'`
- `counter_id`
- `counter_name`
- `is_active`
- `has_params`
- `has_internal`
- `created_at`
- `updated_at`

### `fact_site_analytics_daily`

- `id`
- `source_key`
- `counter_id`
- `report_date`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `visits`
- `users`
- `new_users`
- `page_depth`
- `bounce_rate`
- `avg_visit_duration_seconds`
- `goal_id`
- `goal_name`
- `goal_reaches`
- `region_city`
- `page_url`
- `page_title`
- `traffic_source`
- `raw_payload_ref`
- `ingestion_run_id`
- `created_at`

### Recommendation

Сайтовая аналитика должна жить отдельно и подключаться к dashboard только там, где это реально нужно.

## 8. Raw payload storage

### `collector_raw_payloads`

- `id`
- `source_key`
- `endpoint_name`
- `request_fingerprint`
- `report_date_from`
- `report_date_to`
- `payload_json`
- `payload_gzip` optional
- `status_code`
- `received_at`
- `ingestion_run_id`

### Why this matters

Это даст:

- дебаг без повторного вызова API
- reprocessing без повторного network call
- расследование расхождений

### Retention for raw payloads

Не хранить вечно.

Рекомендация:

- hot: `30 days`
- потом удалить или вынести в object storage

## 9. Ingestion ops

### `collector_runs`

- `id`
- `source_key`
- `trigger_type`
- `mode` (`daily`, `shadow`, `backfill`, `reconcile`, `manual`)
- `date_from`
- `date_to`
- `status`
- `rows_inserted`
- `rows_updated`
- `rows_skipped`
- `raw_payload_count`
- `started_at`
- `finished_at`
- `duration_ms`
- `host`
- `error_count`
- `notes`

### `collector_run_events`

- `id`
- `run_id`
- `level`
- `event_type`
- `message`
- `payload`
- `created_at`

## 10. Parity / QA

### `parity_daily`

- `id`
- `source_key`
- `report_date`
- `metric_name`
- `legacy_value`
- `new_value`
- `diff_abs`
- `diff_pct`
- `status`
- `created_at`

### `parity_dimensions`

Для детального сверения по campaign/entity:

- `id`
- `source_key`
- `report_date`
- `dimension_type` (`campaign`, `creative`)
- `dimension_id`
- `metric_name`
- `legacy_value`
- `new_value`
- `diff_abs`
- `diff_pct`
- `status`
- `created_at`

## Reporting / Dashboard views

Рекомендую строить не напрямую из сырых fact tables, а через materialized-like summary tables или scheduled aggregates.

### `agg_campaign_daily`

- aggregated from `fact_ads_daily`
- one row per `source_key + campaign_id + report_date`

### `agg_platform_daily`

- aggregated from `fact_ads_daily`
- one row per `source_key + report_date`

### `agg_channel_daily`

- mapping from fact tables to media plan `channel`
- one row per `channel + report_date`

Это снизит нагрузку на dashboard.

## Ideal archive policy

## Working horizon

Для active dashboard / parity / ad-hoc analysis:

- держать в hot zone `180 days`

Почему:

- полгода покрывает большинство оперативных задач
- этого достаточно для trend, QoQ, replay и сверок

## Warm horizon

Для старых кампаний, которые уже завершены, но ещё нужны occasionally:

- `181 days -> 24 months`

Хранить:

- агрегированные daily facts
- dictionaries
- минимальный набор важных метрик

Удалять / выносить:

- raw payloads
- noisy run events
- вторичные технические поля

## Archive horizon

Старше `24 months`:

- только archive tables
- или внешний storage / dump

Например:

- `archive_fact_ads_daily_2024`
- `archive_fact_site_analytics_daily_2024`

## What to archive first

После завершения кампании можно архивировать:

### Safe to archive early

- raw payloads older than `30 days`
- verbose run events older than `30 days`
- debug-only logs

### Move to warm after 180 days

- creative-level facts for non-priority campaigns
- campaign/entity history for paused or completed campaigns

### Keep longer in hot if important

- flagship clients
- always-on campaigns
- benchmark campaigns
- anything used in current dashboard or board reporting

## Recommended archive tables

### `fact_ads_daily_archive`

Та же схема, что и `fact_ads_daily`, но:

- без heavy update activity
- with year/month partition marker
- maybe compressed row format if supported

### `collector_raw_payloads_archive`

- optional, only if raw payloads business-critical

### `collector_runs_archive`

- keep only summary, drop detailed events

## Database size control strategy

Нужно заложить контроль размера **сразу**, а не потом.

## 1. Partition large fact tables by month

Рекомендация для MySQL 8:

- partition `fact_ads_daily` by `RANGE COLUMNS(report_date)`
- partition monthly

Benefits:

- быстрый purge старых разделов
- меньше сканов
- проще move to archive

### Candidate partitioned tables

- `fact_ads_daily`
- `fact_ads_hourly` if introduced
- `fact_site_analytics_daily`
- `collector_raw_payloads`

## 2. Separate hot and archive tables

Не держать archive в той же hot table.

Flow:

1. move old partition to archive table
2. verify counts
3. drop old partition from hot

## 3. Housekeeping jobs

Нужен отдельный housekeeping cron.

### Daily jobs

- purge raw payloads older than `30 days`
- purge verbose run events older than `30 days`
- recompute table size report

### Weekly jobs

- move completed-campaign facts older than `180 days` to warm/archive
- optimize low-churn archive tables if needed

### Monthly jobs

- create next month partition
- drop or archive oldest hot partition
- produce DB size report

## 4. Table size monitoring

Нужна техническая таблица:

### `db_storage_snapshots`

- `id`
- `snapshot_date`
- `table_schema`
- `table_name`
- `row_count`
- `data_length_bytes`
- `index_length_bytes`
- `total_bytes`
- `notes`

И nightly job:

- read from `information_schema.tables`
- write snapshot

Это даст:

- growth by table
- forecast when storage becomes a problem
- evidence before cleanup

## 5. Campaign importance flag

Нужен бизнес-флаг для архивирования.

### `campaign_retention_policy`

- `id`
- `source_key`
- `platform_campaign_id`
- `retention_class`
  - `core`
  - `standard`
  - `ephemeral`
- `archive_after_days`
- `keep_raw_days`
- `notes`

Если политики нет:

- default = `standard`

### Suggested defaults

- `core`: keep hot `365 days`
- `standard`: keep hot `180 days`
- `ephemeral`: keep hot `60-90 days`

## 6. Compression / pruning

Что можно резать без потери смысла:

- raw JSON after 30 days
- debug event payloads
- duplicated URL / preview fields in archive
- hourly data after aggregation to daily

## Ideal first implementation

Для первого production шага не надо строить всё сразу.

Рекомендую MVP canonical schema:

### Phase 1 tables

- `source_platforms`
- `source_accounts`
- `source_campaigns`
- `source_entities`
- `fact_ads_daily`
- `collector_runs`
- `collector_run_events`
- `collector_raw_payloads`
- `db_storage_snapshots`

### Phase 1 sources

- `linkedin`
- `reddit`

### Why

Именно они уже подтверждены live на creative-level и могут сразу стать эталоном нового контура.

## Recommendation on current LinkedIn / Reddit rewrite

Для creative-level backfill за 2 недели:

### LinkedIn

Собирать:

- creatives dictionary -> `source_entities`
- daily creative facts -> `fact_ads_daily`

### Reddit

Собирать:

- ads dictionary -> `source_entities`
- ad groups optional as `entity_level='ad_group'`
- daily ad facts -> `fact_ads_daily`

### Important

Не писать creative-level rows в текущую `ad_analytics_daily`, потому что она campaign-level и сломает модель данных.

## Final recommendation

Идеальная структура для вас сейчас:

1. оставить legacy как read-only source of truth for old flow
2. строить новый collector на canonical schema
3. для `LinkedIn` и `Reddit` сразу идти в creative-level
4. `Metrika` держать отдельным analytics domain
5. включить archive / retention policy с первого дня
6. добавить table-size monitoring и housekeeping cron сразу, а не потом


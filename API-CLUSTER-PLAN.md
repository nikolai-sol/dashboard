# API Cluster Plan

Дата фиксации: `2026-03-13`

## Goal

Построить новый API / collector cluster рядом с текущим `nest-second`, не меняя текущий production flow до момента полной готовности нового контура.

Ключевое правило:

- текущую систему не трогаем
- новый контур поднимаем рядом
- некоторое время обе системы работают параллельно
- cutover делаем только после parity-check

## Current Baseline

Сейчас уже есть:

- legacy collector: `nest-second`
- legacy trigger: daily cron -> `/launch`
- новый dashboard: `dashboard-next`
- локальные ETL для `LinkedIn` и `Reddit`
- рабочий staging-домен: `https://dashboards.adreports.ru`

Legacy sources:

- Yandex Direct
- Yandex Metrika
- Hybrid
- GetIntent
- VK Ads v2
- Sape (исключаем из нового target scope)

New-only sources:

- LinkedIn
- Reddit

## Target Architecture

Новый контур делим на 4 слоя.

### 1. API Layer

Новый NestJS API или отдельный backend service:

- `GET /health`
- `POST /jobs/run/:source`
- `POST /jobs/run-batch`
- `GET /jobs`
- `GET /jobs/:id`
- `GET /parity`
- `GET /sources`

Этот API не должен зависеть от старого `/launch`.

### 2. Scheduler Layer

Отдельный scheduler без публичного query-secret.

Варианты:

- system cron + localhost HTTP trigger
- systemd timers
- встроенный scheduler inside new API

Рекомендуемый вариант для старта:

- обычный cron на VPS
- вызов локально через `127.0.0.1`
- без публичного запуска снаружи

### 3. Collector Workers

Отдельный collector per source:

- `linkedin`
- `reddit`
- `vk_ads_v2`
- `hybrid`
- `getintent`
- `yandex_direct`
- `yandex_metrika`

Каждый collector:

- сам аутентифицируется
- тянет данные за заданный диапазон
- пишет в canonical tables
- пишет ingestion run log
- идемпотентен по upsert

### 4. Read Layer

`dashboard-next` читает:

- canonical dimension tables
- canonical fact tables
- parity tables / internal discrepancy view

Legacy tables остаются только для сравнения и rollback.

## New Canonical Structure

## Core tables

### `collector_sources`

- `id`
- `source_key` (`linkedin`, `reddit`, `vk_ads_v2`, ...)
- `display_name`
- `source_type` (`ads`, `analytics`, `programmatic`)
- `is_active`
- `created_at`
- `updated_at`

### `collector_accounts`

- `id`
- `source_key`
- `platform_account_id`
- `account_name`
- `currency`
- `timezone`
- `status`
- `raw_payload`
- `created_at`
- `updated_at`

### `collector_campaigns`

- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `campaign_name`
- `campaign_status`
- `objective`
- `start_date`
- `end_date`
- `raw_payload`
- `created_at`
- `updated_at`

### `collector_entities`

Универсальная таблица под ad group / creative / placement.

- `id`
- `source_key`
- `entity_level` (`ad_group`, `creative`, `placement`)
- `platform_entity_id`
- `platform_campaign_id`
- `entity_name`
- `status`
- `raw_payload`
- `created_at`
- `updated_at`

### `collector_daily_facts`

Главная canonical fact table.

- `id`
- `source_key`
- `platform_account_id`
- `platform_campaign_id`
- `platform_entity_id`
- `entity_level`
- `report_date`
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
- `link_clicks`
- `raw_payload`
- `ingestion_run_id`
- `created_at`
- `updated_at`

Unique key:

- `(source_key, platform_campaign_id, platform_entity_id, entity_level, report_date)`

### `collector_runs`

- `id`
- `source_key`
- `trigger_type` (`cron`, `manual`, `backfill`, `preview`)
- `date_from`
- `date_to`
- `status` (`running`, `success`, `partial`, `failed`)
- `rows_written`
- `rows_updated`
- `error_count`
- `started_at`
- `finished_at`
- `host`
- `notes`

### `collector_run_events`

- `id`
- `run_id`
- `level` (`info`, `warning`, `error`)
- `event_type`
- `message`
- `payload`
- `created_at`

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

## Cron Model

Старый cron не трогаем.

Новый cron создаём отдельно.

### Legacy

Остаётся как есть:

```cron
0 6 * * * /usr/bin/node /var/www/www-root/data/ttt_cron_ttt_some-asaser.js
```

### New cluster

На старте делаем cron только для нового контура.

Пример:

```cron
20 6 * * * curl -fsS http://127.0.0.1:3100/jobs/run-batch?profile=daily-shadow >/dev/null 2>&1
50 6 * * * curl -fsS http://127.0.0.1:3100/parity/run?profile=daily >/dev/null 2>&1
```

Логика:

- legacy отрабатывает первым
- новый cluster запускается позже
- parity считается после обоих запусков

Почему так:

- не мешаем текущему прод-потоку
- получаем те же даты и близкое окно данных
- упрощаем расследование расхождений

## Source Rollout Order

### Wave 1

Источники, которых нет в legacy, можно заводить сразу:

1. LinkedIn
2. Reddit

### Wave 2

Источники из legacy, которые выглядят стабильными:

3. VK Ads v2
4. Hybrid
5. GetIntent

### Wave 3

Источники с риском / отдельной логикой:

6. Yandex Metrika
7. Yandex Direct

### Excluded for now

- Sape

## Parity Strategy

Parity нельзя делать одинаковым списком метрик для всех платформ.

### Parity sets by source

#### LinkedIn

- `spend`
- `impressions`
- `clicks`
- `conversions`

#### Reddit

- `spend`
- `impressions`
- `clicks`
- `conversions`
- `views` если видео-метрики уже будут в новой схеме

#### VK Ads v2

- `impressions`
- `clicks`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`

#### Hybrid

- `impressions`
- `views`
- `clicks`
- `reach`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`

#### GetIntent

- `impressions`
- `clicks`
- `video_views_25`
- `video_views_50`
- `video_views_75`
- `video_views_100`

#### Yandex Direct

- `spend`
- `impressions`
- `clicks`
- `conversions`
- `ctr`
- `cpc`

#### Yandex Metrika

Отдельный analytics parity:

- `visits`
- `users`
- `new_users`
- goal metrics

## Implementation Phases

### Phase A. Design Freeze

1. Зафиксировать canonical schema
2. Зафиксировать naming по source keys
3. Зафиксировать run lifecycle
4. Зафиксировать cron windows

Deliverable:

- SQL migration for new tables
- env contract
- source registry

### Phase B. Cluster Skeleton

1. Создать новый сервис, например:
   - `collector-cluster/`
2. Поднять базовый Nest app
3. Добавить:
   - health route
   - jobs controller
   - scheduler service
   - run logger
4. Подключить MySQL pool

Deliverable:

- новый сервис запускается локально и на VPS
- умеет создавать `collector_runs`

### Phase C. Wave 1 Collectors

1. Перенести `LinkedIn` в новый cluster
2. Перенести `Reddit` в новый cluster
3. Запись только в new canonical tables
4. Добавить ручной backfill route

Deliverable:

- первые 2 источника работают без legacy dependency

### Phase D. Parity Layer

1. Построить SQL/view/report по `platform/date/metric`
2. Сделать internal API:
   - `GET /parity`
   - `POST /parity/run`
3. Выводить:
   - missing rows
   - diff %
   - worst mismatches

Deliverable:

- ежедневный parity report

### Phase E. Wave 2 Collectors

1. VK Ads v2
2. Hybrid
3. GetIntent

Deliverable:

- programmatic/social sources переехали в новый cluster

### Phase F. Wave 3 Collectors

1. Yandex Metrika
2. Yandex Direct

Deliverable:

- закрыт основной legacy scope кроме исключённых источников

### Phase G. Dashboard Switch

1. `dashboard-next` переводится на canonical tables
2. legacy tables остаются для parity only
3. discrepancy panel доступна только internal admin

Deliverable:

- дашборд работает на новом контуре

### Phase H. Cutover

Делается по источникам, не одним большим переключением.

Порядок:

1. disable new-source shadow only -> make active
2. наблюдение
3. если стабильно, отключаем соответствующий legacy path

## Cron Profiles

### `daily-shadow`

Ежедневный сбор за:

- `today - 3`
- `today - 2`
- `today - 1`

Почему:

- рекламные платформы могут досчитывать spend и conversions
- снимаем риск недозрелых данных

### `backfill`

Ручной профиль:

- произвольный диапазон
- батчами по 7 / 14 / 30 дней в зависимости от source

### `reconcile`

Профиль пересчёта:

- обновить только период с расхождением

## Env Contract

Новый cluster должен использовать только env.

Никаких hardcoded secrets в коде.

Минимум:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `COLLECTOR_PORT`
- `COLLECTOR_INTERNAL_TOKEN`
- `LINKEDIN_*`
- `REDDIT_*`
- `VK_*`
- `HYBRID_*`
- `GETINTENT_*`
- `YANDEX_*`
- `TG_TOKEN`
- `TG_CHAT_ID`

## Deployment Plan

Новый cluster поднимаем отдельно от `dashboard-next` и legacy `nest-analytics`.

Например:

- app name: `collector-cluster`
- port: `3100`
- PM2 process: отдельный
- nginx наружу не обязателен

Рекомендуемо:

- internal-only на `127.0.0.1:3100`
- cron и internal curl работают по localhost

## First Sprint

Первый короткий спринт должен дать:

1. новый сервис `collector-cluster/`
2. canonical migrations
3. `collector_runs`
4. `collector_daily_facts`
5. manual run для `linkedin`
6. manual run для `reddit`
7. daily-shadow cron
8. parity report для `linkedin` и `reddit`

## Definition of Done for v1

Считаем новый cluster готовым к первой эксплуатации, когда:

1. `LinkedIn` и `Reddit` крутятся в новом cluster ежедневно
2. данные пишутся в canonical tables
3. parity report строится автоматически
4. `dashboard-next` умеет читать новый контур
5. legacy вообще не изменён

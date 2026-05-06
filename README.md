# ReportingDash

Сборщик рекламных данных и клиентский дашборд для SolGoood / Bayesly Digital.
Проект сейчас состоит из двух частей: ETL-скрипты для загрузки данных в MySQL и Next.js-дашборд для просмотра этих данных.

## Что уже сделано

- Подключены и проверены ETL для `LinkedIn Ads` и `Reddit Ads`
- Данные пишутся в MySQL на Beget VPS
- Поднят Next.js дашборд в `dashboard-next/`
- Реализован live API для дашборда через MySQL и YAML-схемы платформ
- Реализована admin-часть `/admin/*` для конфигурации дашбордов
- Добавлен preview для источников и media plan
- Настроен SSH-доступ к VPS по ключу с этого компьютера

## Текущее состояние migration

На `2026-03-20`:

- canonical cron уже стабильно работает несколько дней подряд для:
  - `linkedin`
  - `reddit`
  - `vk_ads_v2`
  - `getintent`
  - `hybrid`
  - `yandex_direct`
- по окну scheduled cron `2026-03-17 .. 2026-03-20` подтверждено:
  - `linkedin`: `4 / 4` successful cron runs
  - `reddit`: `4 / 4`
  - `vk_ads_v2`: `12 / 12`
  - `getintent`: `4 / 4`
  - `hybrid`: `4 / 4`
  - `yandex_direct`: `4 / 4`
- `yandex_metrika` уже реализована как canonical-first analytics source, но cron по ней пока не включён
- ранее ручные legacy-правки, которые были нужны для reporting, там где это было принято, считаются согласованным baseline и отражены в canonical

## Структура проекта

```text
/Users/nicko/ReportingDash
├── .env                       # локальные секреты и параметры окружения
├── README.md                  # текущее описание проекта
├── TODO.md                    # задачи и отдельный блок по безопасности
├── NEST-SECOND-AUDIT.md       # аудит programmatic / yandex nest-сервиса на сервере
├── CURRENT-COLLECTION-MODEL.md# текущее фактическое хранение данных и API-запросы по площадкам
├── CANONICAL-DB-DESIGN.md    # целевая canonical schema, retention и archive policy
├── CANONICAL-V1-TRACKER.md   # пошаговый трекер внедрения canonical schema v1
├── SHADOW-CRON-POLICY.md     # policy для canonical shadow cron, parity gates и monitoring
├── OPS.md                    # production runbook для dashboard-next на VPS
├── MIGRATION-PLAN.md          # план параллельной миграции без остановки legacy
├── METRICS-MATRIX.md          # матрица метрик по источникам и parity baseline
├── FIELD-MAPPING.md           # mapping legacy полей в будущую canonical schema
├── dashboard_server.py        # старый Python HTTP сервер
├── dashboard/                 # старый фронтенд, оставить как backup
├── dashboard-next/            # основной новый Next.js дашборд
├── fetch_linkedin_ads.py      # legacy ETL LinkedIn -> ad_campaigns/ad_analytics_daily
├── fetch_reddit_ads.py        # legacy ETL Reddit -> ad_campaigns/ad_analytics_daily
├── fetch_linkedin_canonical.py # canonical ETL LinkedIn -> canonical_*
├── fetch_reddit_canonical.py   # canonical ETL Reddit -> canonical_*
├── fetch_vk_ads_v2_canonical.py # canonical ETL VK Ads v2 -> canonical_*
├── fetch_hybrid_canonical.py    # first-pass canonical ETL Hybrid -> canonical_*
├── fetch_getintent_canonical.py # first-pass canonical ETL GetIntent -> canonical_*
├── fetch_yandex_direct_canonical.py # first-pass canonical ETL Yandex Direct -> canonical_*
├── canonical_writer.py         # shared upsert helpers for canonical collectors
├── monitor_canonical_shadow.py # daily monitor for canonical shadow runs and parity gates
├── nest-second/               # NestJS API для programmatic / yandex / vk / metrika
├── setup_oauth.py             # OAuth setup LinkedIn
├── venv/                      # локальное Python-окружение
└── logs/                      # локальные логи
```

## Текущий стек

- Backend ETL: Python
- Dashboard: Next.js App Router + TypeScript
- Charts: Nivo + Recharts
- Database: MySQL
- Hosting / VPS: Beget
- Admin panel VPS: ISPmanager

## База данных

Текущая база: `report_bd`

Основные рабочие таблицы:

- `ad_campaigns`
- `ad_analytics_daily`
- `dashboards`
- `dashboard_sources`
- `dashboard_campaign_filters`
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

Смысл схемы:

- `ad_campaigns` хранит названия и метаданные кампаний
- `ad_analytics_daily` хранит дневные метрики отдельно от названий
- `dashboards*` хранит конфигурацию клиентских дашбордов
- `canonical_*` это новый unified reporting layer рядом с legacy-таблицами
- canonical schema v1 создана additive migration и не меняет legacy path
- `003_collector_canonical.sql` отражает уже применённый базовый rollout, `004_canonical_v1.sql` хранит финализированный reference DDL для fresh/bootstrap сред
- `005_align_canonical_v1.sql` выравнивает уже существующий prod canonical layer до формы `004` без затрагивания legacy
- canonical ingestion rule: reporting endpoints are fact authority, metadata listings are metadata authority; historical facts must not be dropped only because current metadata snapshot is incomplete

FACT INGESTION RULE

- fact rows from reporting endpoints must never be rejected because of missing metadata dictionary rows
- metadata enrichment must be best-effort and asynchronous

ACCEPTED CANONICAL-ONLY SOURCES

- `linkedin` and `reddit` are accepted canonical-only sources
- they were onboarded directly into the canonical contour
- there is no comparable legacy reporting bridge that should be treated as a required parity gate
- for these sources the operational acceptance criteria are:
  - freshness
  - collector health
  - internal canonical consistency
- `reddit` campaign-level rows remain the canonical reporting authority
- `reddit` ad-level rows remain analytics-only
- campaign sentinel `__campaign__` in canonical facts is intentional and is not a real native delivery entity id
- `yandex_metrika` is a canonical-first analytics source
- it does not use paid-media fact logic and does not require legacy parity
- initial operational checks for `yandex_metrika` are:
  - freshness
  - collector health
  - row presence in `canonical_fact_site_analytics_daily`

## Canonical shadow cron policy

Текущие источники, готовые для shadow cron:

- `linkedin`
- `reddit`
- `vk_ads_v2` (`non-blocking`)

Accepted canonical-only sources:

## Yandex Metrika

Current state:

- type: analytics source
- mode: canonical-only
- parity: none
- blocking: no
- canonical table:
  - `canonical_fact_site_analytics_daily`
- first-pass grain:
  - `report_date + analytics_account_id(counter_id) + analytics_scope='traffic'`

Current collector:

- `fetch_yandex_metrika_canonical.py`
- writes daily aggregated stats per `counter_id`
- first-pass metrics:
  - `visits`
  - `users`
  - `pageviews`
  - `bounce_rate`
  - `avg_visit_duration_seconds`

Monitor semantics:

- no legacy parity
- no paid-media delivery/campaign logic
- operational health only:
  - latest run success
  - fresh data presence
  - recent row presence

- `linkedin`
- `reddit`

For these two sources:

- legacy parity is not required
- monitor priority is:
  - freshness
  - collector health
  - internal canonical consistency

Canonical reporting authority scope:

- `linkedin`
  - canonical reporting scope: `fact_scope = 'delivery_entity'`
  - analytical-only scope: none in `v1`

- `reddit`
  - canonical reporting scope: `fact_scope = 'campaign'`
  - analytical-only scope: `fact_scope = 'delivery_entity'`
  - campaign sentinel `__campaign__` is intentional marker for campaign-scope rows

- `vk_ads_v2`
  - monitored shadow scope: `fact_scope = 'delivery_entity'`
  - shared legacy compare grain: `report_date + platform_delivery_entity_id`
  - zero-only rows are filtered on both sides before parity compare
  - `source_parity_policy.is_blocking = 0`, so VK remains non-blocking in the monitor

- `yandex_direct`
  - monitored shadow scope: `fact_scope = 'delivery_entity'`
  - authority legacy source: `yandex_new`
  - shared parity grain: `report_date + platform_account_id + platform_campaign_id + platform_delivery_entity_id`
  - first-pass parity-safe metrics:
    - `spend`
    - `impressions`
    - `clicks`
    - `conversions`
  - source remains non-blocking via `source_parity_policy.is_blocking = 0`
  - first-pass account bridge is partially synthetic and stays documented as an onboarding limitation

Operational details:

- see `SHADOW-CRON-POLICY.md`

## Sources Health Dashboard

Temporary operational dashboard for canonical reporting sources:
- script: `sources_health_dashboard.py`
- location: project root
- purpose:
  - show unified collector health
  - show data coverage
  - show data freshness
  - show last collector run stats
  - show data window per source
  - show governance mode
  - show parity and coverage summary
  - show blocking vs non-blocking sources

CLI usage:

```bash
python sources_health_dashboard.py
python sources_health_dashboard.py --json
```

Output:
- five terminal-friendly sections:
  - `CANONICAL REPORTING HEALTH`
  - `DATA COVERAGE`
  - `DATA FRESHNESS`
  - `LAST COLLECTOR RUN`
  - `DATA WINDOW`
- final health summary table
- optional machine-readable JSON for CI/cron integrations

Exit code behavior:
- `0` if all blocking sources are `HEALTHY`
- `1` if any blocking source is `WARNING` or `CRITICAL`
- non-blocking sources do not affect exit code

Recommended read-only cron command:

```cron
45 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python sources_health_dashboard.py >> /root/reportingdash-canonical/logs/sources-health-dashboard.log 2>&1
```

This dashboard is read-only:
- no schema changes
- no collector changes
- no ingestion side effects

## Canonical Telegram Reporting

Canonical Telegram sender:
- script: `send_canonical_telegram_report.py`
- location: project root
- data source: `sources_health_dashboard.py --json`

Telegram credentials resolution:
- prefer local canonical runtime env:
  - `TG_TOKEN`
  - `TG_CHAT_ID`
- fallback:
  - `/var/www/www-root/data/.production.env`

Modes:
- `--mode alert`
  - default
  - sends only when meaningful issues exist
- `--mode summary`
  - always sends compact daily summary

Usage:

```bash
python send_canonical_telegram_report.py --mode alert
python send_canonical_telegram_report.py --mode summary
```

Notes:
- uses the same Telegram bot/chat as legacy, without modifying legacy sender code
- lightweight and read-only except for sending Telegram message

### Canonical Telegram Alert Rollout

Current rollout mode:
- prepared
- not enabled yet

Preferred first mode:
- `alert`

Why:
- sends only when meaningful operational issues exist
- keeps Telegram noise low during initial rollout

Summary mode:
- supported by `send_canonical_telegram_report.py`
- optional
- remains disabled for now

Credentials resolution:
- prefer local canonical runtime env:
  - `TG_TOKEN`
  - `TG_CHAT_ID`
- fallback:
  - `/var/www/www-root/data/.production.env`

Recommended production alert cron line:

```cron
50 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python send_canonical_telegram_report.py --mode alert >> /root/reportingdash-canonical/logs/canonical-telegram-alert.log 2>&1
```

This command is documented only and is not enabled automatically here.

## Planning Intelligence Layer

`ReportingDash` separates observed reporting truth from planning support data.

- canonical reporting core remains the source of truth for observed facts
- planning DB is a separate supporting intelligence/statistics layer
- planning DB is limited to audience snapshots, benchmark/reference data and discovery run tracking
- Hybrid planning/discovery belongs in the planning layer, not in canonical reporting facts
- historical campaign selection for prediction can come directly from canonical reporting DB
- AI planner logic, tender interpretation and channel mix suggestions live above DB in planner/app services
- current project priority remains finishing reporting-source migration into the canonical structure before starting Hybrid planner implementation

Planning docs:

- `PLANNING-INTELLIGENCE-LAYER.md`
- `PLANNING-TODO.md`
- `docs/HYBRID-API-REFERENCE.md`
- `HYBRID-REPORTING-ONBOARDING.md`
- `GETINTENT-REPORTING-ONBOARDING.md`
- `MANUAL-LEGACY-EXCEPTIONS.md`
- `CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md`

Hybrid reporting migration prep:

- `HYBRID-REPORTING-ONBOARDING.md` фиксирует canonical onboarding recommendation для `Hybrid` как reporting source
- `dashboard-next/src/db/migrations/008_hybrid_governance.sql` applied for `hybrid` governance and non-blocking monitor policy

GetIntent reporting migration prep:

- `GETINTENT-REPORTING-ONBOARDING.md` фиксирует canonical onboarding recommendation для `GetIntent` как reporting source
- `dashboard-next/src/db/migrations/009_getintent_governance.sql` applied for `getintent` governance and non-blocking monitor policy
- `fetch_getintent_canonical.py` implements first-pass canonical ETL for `GetIntent`
- monitor path is active in `monitor_canonical_shadow.py`
- current rollout state: `shadow cron enabled, non-blocking monitored source`

Yandex Direct reporting migration prep:

- `YANDEX-DIRECT-REPORTING-ONBOARDING.md` фиксирует canonical onboarding recommendation для `Yandex Direct` как reporting source
- `dashboard-next/src/db/migrations/010_yandex_direct_governance.sql` applied for `yandex_direct` governance and non-blocking monitor policy
- `fetch_yandex_direct_canonical.py` implements first-pass canonical ETL for `Yandex Direct`
- monitor path is active in `monitor_canonical_shadow.py`
- current rollout state: `shadow cron enabled, non-blocking monitored source`

### GetIntent Shadow Cron Rollout

GetIntent is currently:
- monitored
- non-blocking
- shadow-ready
- cron-enabled

Accepted rollout note:
- current coverage signal is `canonical_ahead_of_legacy`
- this is informational only and must not block rollout

Recommended production cron line:

```cron
32 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_getintent_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/getintent-canonical-cron.log 2>&1
```

First 3 days after enabling cron:

Day 1
- `tail -n 100 /root/reportingdash-canonical/logs/getintent-canonical-cron.log`
- `cd /root/reportingdash-canonical && venv/bin/python monitor_canonical_shadow.py`
- verify latest `canonical_collector_runs` rows for `source_key='getintent'`

Day 2
- confirm `rows_read`, `rows_written`, `rows_updated` are stable
- confirm monitor still loads policy from DB
- confirm source remains non-blocking

Day 3
- confirm parity stays clean on:
  - `impressions`
  - `clicks`
  - `video_views_25`
  - `video_views_50`
  - `video_views_75`
  - `video_views_100`
- confirm `canonical_only_rows_after_legacy_max` is the only coverage signal if canonical stays ahead of legacy

Current VPS state:
- runtime: `/root/reportingdash-canonical`
- cron: enabled

Governance-backed sources with special rollout mode:

- `vk_ads_v2`
  - authority scope: `delivery_entity`
  - native grain: `banner`
  - parity target level: `account_day`
  - current rollout state: `shadow cron enabled, non-blocking monitored source`
  - direct monitor compare uses shared `delivery_entity + date` grain instead of raw account/campaign parity

- `hybrid`
  - authority scope target: `delivery_entity`
  - native grain target: `creative`
  - current rollout state: `shadow cron enabled, non-blocking monitored source`
  - `008_hybrid_governance.sql` is applied
  - monitor path is active in `monitor_canonical_shadow.py`
  - direct validation is done on shared `campaign + creative + date` grain against `hyb_stats`
  - canonical matches current raw Hybrid API
  - first-pass parity-safe metrics are:
    - `clicks`
    - `views`
    - `video_views_25`
    - `video_views_50`
    - `video_views_75`
    - `video_views_100`
  - `impressions` and `reach` remain valid canonical metrics, but are excluded from first-pass parity gate because legacy historical rows drift from the current raw API
  - source remains non-blocking via `source_parity_policy.is_blocking = 0`
  - accepted manual legacy exceptions are tracked in `MANUAL-LEGACY-EXCEPTIONS.md`
  - 3-day manual verification checklist lives in `CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md`

### Hybrid Shadow Cron Rollout

Hybrid is currently:
- monitored
- non-blocking
- cron enabled

Accepted baseline alignment:
- tracked in `MANUAL-LEGACY-EXCEPTIONS.md`
- accepted into canonical where required for reporting
- must not block rollout

Recommended production cron line:

```cron
37 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_hybrid_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/hybrid-canonical-cron.log 2>&1
```

Current VPS state:
- runtime: `/root/reportingdash-canonical`
- cron: enabled

Manual verification checklist:
- `CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md`

### Yandex Direct Shadow Cron Rollout

Yandex Direct is currently:
- monitored
- non-blocking
- shadow-ready
- cron enabled

Important rollout note:
- first-pass account bridge remains partially synthetic
- this is a documented onboarding limitation, not a rollout blocker

Recommended production cron line:

```cron
34 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_yandex_direct_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/yandex-direct-canonical-cron.log 2>&1
```

Current VPS state:
- runtime: `/root/reportingdash-canonical`
- cron: enabled

First 3 days after enabling cron:

Day 1
- `tail -n 100 /root/reportingdash-canonical/logs/yandex-direct-canonical-cron.log`
- `cd /root/reportingdash-canonical && venv/bin/python monitor_canonical_shadow.py`
- verify latest runs:

```sql
SELECT id, status, rows_read, rows_written, rows_updated, started_at
FROM canonical_collector_runs
WHERE source_key = 'yandex_direct'
ORDER BY id DESC
LIMIT 5;
```

Day 2
- confirm `rows_read`, `rows_written`, `rows_updated` stability
- confirm policy still loads from DB
- confirm `gate_scope = delivery_entity`
- confirm `is_blocking = 0`

Day 3
- confirm parity stays clean on:
  - `spend`
  - `impressions`
  - `clicks`
  - `conversions`
- confirm no unexpected coverage drift
- confirm source remains non-blocking

Operational signals that require investigation:
- `FAIL_RUN` in `canonical_collector_runs`
- unexpected `WARN_PARITY`
- coverage shifting to in-window drift instead of clean or empty coverage

## Dashboard

Рабочий frontend лежит в `dashboard-next/`.

Ключевые разделы:

- клиентский view: `/dashboard/[id]`
- admin view: `/admin/dashboards`
- API дашборда: `/api/dashboard/[id]`
- preview API: `/api/dashboard/preview`

Фронт получает данные в формате `DashboardData`.
Если API недоступен или данных нет, включается fallback на mock-данные.

## Домены и окружения

Текущий рабочий deployment для нового дашборда:

- `https://dashboards.adreports.ru/dashboard/rag_mp`
- `https://dashboards.adreports.ru/admin/dashboards`

Это текущий operational / staging-домен проекта на VPS.

Важно:

- `adreports.ru` сейчас используется как технический домен для сборки и проверки нового контура
- основной бренд-домен `solgoood.ru` пока не переносим
- `solgoood.ru` сейчас лежит на обычном хостинге `nic.ru`, а не на VPS
- перенос на `solgoood.ru` будет делаться позже, когда новый контур полностью собран и проверен

Текущий принцип:

- сначала собираем и стабилизируем всю систему на `dashboards.adreports.ru`
- потом переносим готовый стек на VPS под домены `solgoood`
- только после этого меняем DNS и routing для бренд-домена

## Nest Second

В проекте есть отдельный NestJS-сервис `nest-second/`.
Это серверный сборщик статистики для части programmatic и Yandex/VK-источников, который уже работает на VPS.

Подробный аудит с маршрутами, cron, Telegram-отправкой и хранением ключей:

- `NEST-SECOND-AUDIT.md`
- `CURRENT-COLLECTION-MODEL.md`
- `CANONICAL-DB-DESIGN.md`
- `CANONICAL-V1-TRACKER.md`
- `OPS.md`
- `MIGRATION-PLAN.md`
- `METRICS-MATRIX.md`
- `FIELD-MAPPING.md`

## Media plan

Используется формат media plan v2 через Google Sheets CSV.

Ключевые поля:

- `platform`
- `channel`
- `format`
- `buy_type`
- `budget_plan`
- `impressions_plan`
- `clicks_plan`
- `views_plan`
- `conversions_plan`

Важная логика:

- `plan_vs_fact` группируется по `channel`, а не по `platform`
- одна позиция медиаплана может включать несколько платформ

## SSH и доступ к VPS

С этого компьютера SSH уже настроен по ключу.

Подключение:

```bash
ssh beget
```

Текущий alias использует:

- host: `5.35.85.218`
- user: `root`
- auth: `public key`

Проверено:

- вход по ключу работает
- пароль из локального `.env` удалён

Важно:

- не хранить root-пароль в `.env`
- не дублировать парольный доступ без необходимости на других машинах

## VPS deployment

`dashboard-next` уже задеплоен на Beget VPS рядом с legacy-сервисами.

Что уже работает на VPS:

- `dashboard-next` как отдельный `systemd` service
- legacy `nest-analytics` остаётся в root PM2
- HTTPS для `dashboards.adreports.ru` выпущен через Let's Encrypt

Текущий production URL:

```text
https://dashboards.adreports.ru
```

Важный организационный принцип проекта:

- текущую legacy-систему не ломаем
- новый контур поднимаем рядом
- миграцию делаем поэтапно и с периодом параллельной работы

Текущий runtime split на VPS:

- `dashboard-next` -> `systemd`, user `dashboard`, internal bind `127.0.0.1:3002`
- `nest-analytics` -> legacy root PM2

Это сделано специально, чтобы не смешивать новый дашборд с чужим / legacy PM2-контуром.

## Как запускать дашборд локально

```bash
cd /Users/nicko/ReportingDash/dashboard-next
npm install
npm run dev
```

Проверка production build:

```bash
npm run lint
npm run build
```

Миграции dashboard-конфига:

```bash
npm run db:migrate
```

## Как запускать ETL локально

```bash
cd /Users/nicko/ReportingDash
source venv/bin/activate
python fetch_linkedin_ads.py
python fetch_reddit_ads.py
```

OAuth setup для LinkedIn:

```bash
source venv/bin/activate
python setup_oauth.py
```

## Что важно помнить

- `dashboard/` и `dashboard_server.py` пока не трогаем без необходимости
- `dashboard-next/` сейчас основной фронтенд
- настройки media plan URL хранятся в `dashboard_sources.source_config`
- на VPS сейчас ещё не ужесточён `sshd`; это вынесено в `TODO.md`

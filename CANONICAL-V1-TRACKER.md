# Canonical V1 Tracker

Дата старта: `2026-03-14`

Цель:

- добавить новый canonical reporting layer в ту же MySQL базу
- не трогать legacy tables и legacy data path
- подготовить безопасный foundation для `LinkedIn` / `Reddit` creative-level ingestion

Current accepted source policy:

- `linkedin` = accepted canonical-only source
- `reddit` = accepted canonical-only source
- `yandex_metrika` = canonical-first analytics source
- legacy parity is not required for these two sources
- operational checks for these two sources are:
  - freshness
  - collector health
  - internal canonical consistency

## Current migration state

As of `2026-03-20`:

- canonical cron is stable for:
  - `linkedin`
  - `reddit`
  - `vk_ads_v2`
  - `getintent`
  - `hybrid`
  - `yandex_direct`
- observed scheduled cron window `2026-03-17 .. 2026-03-20`:
  - `linkedin`: `4 / 4` successful cron runs
  - `reddit`: `4 / 4`
  - `vk_ads_v2`: `12 / 12`
  - `getintent`: `4 / 4`
  - `hybrid`: `4 / 4`
  - `yandex_direct`: `4 / 4`
- `yandex_metrika` remains implemented and monitored, but cron is still a separate rollout decision
- accepted manual legacy edits that were required for reporting have now been accepted into canonical baseline where explicitly documented

Current practical next steps:

- keep the paid-media canonical cron wave stable and low-noise
- replace alert-only Telegram behavior with a short daily collector summary
- decide separately on `yandex_metrika` cron rollout
- continue analytics contour onboarding after paid-media stabilization

Canonical ingestion rule:

- `report` / reporting endpoint = authority for facts
- metadata listing endpoints = authority for metadata
- historical fact rows must never be dropped only because current metadata listing does not return the entity
- `linkedin` and `reddit` are accepted canonical-only sources
- there is no required legacy parity bridge for them
- operational acceptance for them is based on:
  - freshness
  - collector health
  - internal canonical consistency
- `yandex_metrika` is a canonical-first analytics source
- it does not use paid-media fact logic and does not require legacy parity
- initial operational acceptance for it is based on:
  - freshness
  - collector health
  - row presence in `canonical_fact_site_analytics_daily`
- for `reddit`, campaign-level report is authority for canonical campaign reporting
- for `reddit`, ad-level report is authority for ad/creative analytics
- `reddit` campaign totals are not guaranteed to equal `SUM(ad totals)` and must not be used as a required legacy parity condition

## Step 1. Freeze v1 scope

Status: `completed`

Результат:

- зафиксирован production-safe `v1` scope
- принято использовать префикс `canonical_`
- подтверждено разделение:
  - `canonical_source_delivery_entities`
  - `canonical_source_creatives`
- подтверждено:
  - `canonical_fact_ads_daily`
  - `canonical_fact_site_analytics_daily`
  - `canonical_parity_daily`
- raw payloads отложены на `v2`

Артефакты:

- `CANONICAL-DB-DESIGN.md`
- `CURRENT-COLLECTION-MODEL.md`

## Step 2. Finalize SQL migration v1

Status: `completed`

Цель:

- заменить draft migration на production-safe `canonical_*` schema
- оставить migration idempotent
- не использовать destructive SQL

Результат:

- `dashboard-next/src/db/migrations/003_collector_canonical.sql` заменён на production-safe `canonical_*` migration v1
- migration содержит только additive `CREATE TABLE IF NOT EXISTS`
- raw payload layer отложен на `v2`
- naming приведён к `canonical_*`

## Step 3. Apply migration

Status: `completed`

Цель:

- применить migration в ту же MySQL базу
- не затронуть legacy tables
- не затронуть legacy rows

Результат:

- `npm run db:migrate` выполнен успешно
- `001`, `002`, `003` прошли без ошибок
- legacy path не изменён

## Step 4. Verify schema

Status: `completed`

Проверки:

- таблицы созданы
- индексы созданы
- seed rows по `canonical_source_platforms` созданы
- legacy tables на месте

Результат:

- созданы все `canonical_*` таблицы v1
- seed rows вставлены для:
  - `linkedin`
  - `reddit`
  - `yandex_direct`
  - `hybrid`
  - `getintent`
  - `vk_ads_v2`
  - `yandex_metrika`
- legacy tables подтверждены на месте
- контрольные counts legacy:
  - `ad_campaigns = 5`
  - `ad_analytics_daily = 23`

## Step 5. Documentation update

Status: `completed`

Результат:

- обновить `README.md`
- зафиксировать completion status

Фактически сделано:

- обновлён `README.md`
- добавлены:
  - `CANONICAL-DB-DESIGN.md`
  - `CANONICAL-V1-TRACKER.md`
- зафиксировано, что canonical schema v1 уже создана в MySQL

## Step 6. Next implementation wave

Status: `pending`

Следующий технический шаг после schema:

- новые writers для `LinkedIn` / `Reddit`
- backfill последних `14 days`
- accept `LinkedIn` / `Reddit` as canonical-only sources without required legacy parity bridge

## Step 7. Finalize reference migration 004

Status: `completed`

Цель:

- зафиксировать финальный production-safe `004_canonical_v1.sql`
- не менять `003_collector_canonical.sql`
- сохранить отдельный reference migration для fresh/bootstrap environments

Результат:

- создан и выровнен `dashboard-next/src/db/migrations/004_canonical_v1.sql`
- в `004` добавлены:
  - `native_grain` в `canonical_fact_ads_daily`
  - `fact_scope` и tolerance-поля в `canonical_parity_daily`
  - расширенные run-поля в `canonical_collector_runs`
- `004` остаётся idempotent и безопасным для сред, где `canonical_*` ещё не существуют

## Step 8. Align existing prod canonical schema to 004

Status: `completed`

Цель:

- выровнять уже созданные через `003` prod-таблицы `canonical_*` к форме `004`
- не трогать legacy tables
- не пересоздавать canonical tables

Результат:

- создан `dashboard-next/src/db/migrations/005_align_canonical_v1.sql`
- `005` применён отдельно к текущему prod
- выровнены критические gaps:
  - `canonical_source_accounts.external_account_ref`
  - `canonical_fact_ads_daily.native_grain`
  - уникальный ключ и индексы `canonical_fact_ads_daily`
  - `canonical_parity_daily.delivery_entity_id`
  - `canonical_parity_daily.creative_id`
  - `canonical_parity_daily.tolerance_abs`
- `canonical_parity_daily.tolerance_pct`
- уникальный ключ и индексы `canonical_parity_daily`
- post-check через `information_schema` подтвердил alignment

## Step 9. Implement first canonical writers

Status: `completed`

Цель:

- добавить первые новые canonical write paths для `LinkedIn` и `Reddit`
- не трогать legacy collectors и legacy writes

Результат:

- добавлен shared writer module `canonical_writer.py`
- добавлен collector `fetch_linkedin_canonical.py`
- добавлен collector `fetch_reddit_canonical.py`
- оба коллектора пишут в:
  - `canonical_source_accounts`
  - `canonical_source_campaigns`
  - `canonical_source_delivery_entities`
  - `canonical_source_creatives`
  - `canonical_fact_ads_daily`
  - `canonical_collector_runs`
  - `canonical_collector_run_events`

## Step 10. Backfill last 14 days

Status: `completed`

Результат:

- выполнен `LinkedIn` canonical backfill за `14 days`
- выполнен `Reddit` canonical backfill за `14 days`
- фактически загружено:
  - `LinkedIn`: `191` fact rows, grain = `delivery_entity/creative`
  - `Reddit`: `50` fact rows, grain = `delivery_entity/ad`
- dictionaries заполнены:
  - accounts: `2`
  - campaigns: `5`
  - delivery_entities: `59`
  - creatives: `59`

## Step 11. Harden Reddit under Path B

Status: `completed`

Цель:

- перестать форсировать parity `reddit` через ad-level totals
- добавить отдельный `campaign` scope в canonical layer
- использовать `reddit` campaign-level report как authority для parity/reporting

Результат:

- `fetch_reddit_canonical.py` поддерживает `--scope ad|campaign|both`
- добавлен отдельный Reddit campaign-level canonical path
- `reddit` campaign rows пишутся в `canonical_fact_ads_daily` c:
  - `fact_scope = 'campaign'`
  - `native_grain = 'campaign'`
  - `platform_delivery_entity_id = '__campaign__'`
  - `platform_creative_id = ''`
- существующий ad-level path сохранён
- выполнен `14-day` backfill для `--scope campaign`
- parity против legacy для `reddit` теперь считается только по `fact_scope='campaign'`
- campaign-scope parity совпал по:
  - `impressions`
  - `clicks`
  - `conversions`
- `spend` совпал в пределах float noise порядка `0.000035`

## Step 12. Prepare shadow cron rollout policy

Status: `completed`

Цель:

- определить, какие canonical sources уже готовы к shadow cron
- зафиксировать source-aware parity gates
- зафиксировать daily monitoring queries

Результат:

- подготовлен `SHADOW-CRON-POLICY.md`
- `linkedin` помечен как accepted canonical-only source and ready for shadow cron
- `reddit` помечен как accepted canonical-only source and ready for shadow cron
- зафиксированы canonical reporting authority scopes:
  - `linkedin`: `fact_scope='delivery_entity'`
  - `reddit`: `fact_scope='campaign'`
- зафиксировано, что:
  - `reddit` `fact_scope='delivery_entity'` = analytics-only

## Step 13. Prepare Hybrid reporting implementation wave

Status: `in_progress`

Цель:

- перевести `Hybrid` из architecture design в implementation preparation
- не писать collector на этом шаге
- не применять governance migration на этом шаге

Результат на текущем шаге:

- создан implementation-ready onboarding reference:
  - `HYBRID-REPORTING-ONBOARDING.md`
- подготовлен draft governance migration:
  - `dashboard-next/src/db/migrations/008_hybrid_governance.sql`
- зафиксирован implementation plan для:
  - `fetch_hybrid_canonical.py`
- зафиксирован validation plan:
  - dedupe
  - orphan checks
  - null metrics
  - direct parity at `delivery_entity_day`
  - secondary aggregate parity at `campaign_day`

Важно:

- `008_hybrid_governance.sql` пока только draft
- migration не применялась
- collector ещё не реализован

## Step 14. Implement first-pass Hybrid collector

Status: `completed`

Цель:

- реализовать первый `fetch_hybrid_canonical.py`
- не трогать legacy tables
- писать только в canonical tables
- сохранить narrow reporting-only scope

Результат:

- создан:
  - `fetch_hybrid_canonical.py`
- collector использует current working Hybrid reporting path, совместимый с legacy
- collector пишет в:
  - `canonical_source_accounts`
  - `canonical_source_campaigns`
  - `canonical_source_delivery_entities`
  - `canonical_source_creatives`
  - `canonical_fact_ads_daily`
  - `canonical_collector_runs`
  - `canonical_collector_run_events`
- выполнен manual run и `14-day` backfill

Фактический результат backfill:

- latest successful backfill run:
  - `id = 24`
- `rows_read = 2371`
- `rows_written = 439`
- `rows_updated = 439`
- dictionaries:
  - accounts: `2`
  - campaigns: `4`
  - delivery_entities: `27`
  - creatives: `27`
- facts:
  - `379`
  - grain: `delivery_entity / creative`
  - window: `2026-03-02 -> 2026-03-16`

Validation summary:

- dedupe:
  - `379 = 379`
- orphan refs:
  - all `0`
- null baseline metrics:
  - all `0`
- direct parity vs legacy on shared `campaign + creative + date` grain:
  - `canonical_only_rows = 23`
  - `canonical_only_in_legacy_window = 0`
  - `canonical_only_after_legacy_max = 23`
  - `impressions_mismatches = 12`
  - `clicks_mismatches = 0`
  - `views_mismatches = 0`
  - quartile mismatches = `0`
  - `reach_mismatches = 11`

Current rollout decision:

- `hybrid` = `shadow-ready non-blocking monitored source`

Why not promoted further yet:

- completed drift investigation showed canonical matches the current raw Hybrid API
- remaining legacy drift is source-side on `impressions` and `reach`
- first-pass Hybrid parity should use only:
  - `clicks`
  - `views`
  - `video_views_25`
  - `video_views_50`
  - `video_views_75`
  - `video_views_100`
- `impressions` and `reach` remain valid canonical metrics, but are excluded from the first-pass parity gate
- revised `008_hybrid_governance.sql` was applied
- `monitor_canonical_shadow.py` now has an active Hybrid source block for:
  - shared grain `delivery_entity_day`
  - parity-safe metrics `clicks`, `views`, quartiles only
  - non-blocking rollout behavior
- Hybrid reads policy from DB:
  - `authority_fact_scope = delivery_entity`
  - `comparison_level = delivery_entity_day`
  - `coverage_mode = allow_canonical_ahead`
  - `is_blocking = 0`
- Hybrid cron command is prepared, but still disabled
- recommended rollout command:
  - `37 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_hybrid_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/hybrid-canonical-cron.log 2>&1`
- accepted one-off manual legacy exceptions are tracked in `MANUAL-LEGACY-EXCEPTIONS.md`
- current accepted exception:
  - `source=hybrid`
  - `campaign=f_626`
  - `dates=2026-03-11 .. 2026-03-15`
  - `reason=manual legacy edit during investigation`
- accepted baseline alignment does not block Hybrid rollout
- sentinel `__campaign__` intentional и не является реальным native delivery entity id
- добавлены рекомендуемые cron commands и daily monitoring SQL

### Hybrid shadow cron rollout

Status:
- enabled
- basic manual verification passed
- repeated scheduled cron runs observed stable on `2026-03-17 .. 2026-03-20`

Hybrid status:
- non-blocking shadow source
- runtime: `/root/reportingdash-canonical`

Recommended cron command:
- `37 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_hybrid_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/hybrid-canonical-cron.log 2>&1`

Operational verification:
- root crontab updated
- backup crontab saved:
  - `/root/crontab.backup.20260316205508`
- manual verification run passed
- latest collector run:
  - `id = 30`
  - `status = success`
  - `rows_read = 411`
  - `rows_written = 128`
  - `rows_updated = 128`
  - `error_count = 0`
- log file created:
  - `/root/reportingdash-canonical/logs/hybrid-canonical-cron.log`

Accepted manual legacy alignment:
- see `MANUAL-LEGACY-EXCEPTIONS.md`
- these values are accepted as the reporting baseline and must not block rollout

Post-migration follow-up:
- after the current migration wave is closed, return to `Hybrid v1.1`
- use documented `agencyStatistic/getSplit` enrichment for:
  - `TotalSum -> spend`
  - `eCPM -> cpm`
  - `CPC -> cpc`
- keep these fields outside legacy parity baseline

Manual 3-day verification:
- `CANONICAL-ROLLING-VERIFICATION-CHECKLIST.md`

### Canonical Telegram alert rollout

Status:
- enabled

Preferred first mode:
- `alert`

Why:
- sends only when meaningful blocking issues exist
- keeps Telegram rollout low-noise

Summary mode:
- supported
- optional
- disabled for now

Verification:
- basic manual verification passed

Runtime:
- `/root/reportingdash-canonical`

Cron:
- enabled

Credentials resolution for canonical runtime:
- prefer local `TG_TOKEN` / `TG_CHAT_ID`
- fallback to `/var/www/www-root/data/.production.env`

Enabled cron command:
- `50 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python send_canonical_telegram_report.py --mode alert >> /root/reportingdash-canonical/logs/canonical-telegram-alert.log 2>&1`

Deployed runtime components:
- `sources_health_dashboard.py`
- `send_canonical_telegram_report.py`

Operational notes:
- `Python 3.8` compatibility was accounted for in canonical runtime
- manual run `send_canonical_telegram_report.py --mode alert` completed with `EXIT=0`
- legacy cron was left unchanged
- summary mode is not enabled

## Step 13. Add daily canonical monitoring script

Status: `completed`

Цель:

- добавить lightweight monitor до фактического включения shadow cron
- получать короткий operational summary по `linkedin` и `reddit`

Результат:

- добавлен `monitor_canonical_shadow.py`
- скрипт читает только:
  - `canonical_collector_runs`
  - `canonical_fact_ads_daily`
  - legacy `ad_analytics_daily` только для parity compare
- скрипт печатает:
  - latest run status/time
  - rows_read / rows_written / rows_updated
  - recent row counts по `source_key + fact_scope + native_grain`
  - parity summary по gated scope
- добавлен `OK/WARN` policy:
  - `WARN`, если latest run failed
  - `WARN`, если parity mismatches > 0 для gate scope
  - `WARN`, если нет свежих rows в expected recent window

## Step 14. Refine LinkedIn shadow parity gate

Status: `completed`

Цель:

- убрать noisy false WARN по `linkedin` до включения shadow cron
- отделить true parity mismatches от coverage drift

Результат:

- `monitor_canonical_shadow.py` для `linkedin` теперь использует:
  - intersection-only parity summary
  - отдельный coverage summary
- введены tolerances:
  - spend abs = `0.01`
  - impressions abs = `10`
  - clicks abs = `2`
  - conversions abs = `0`
- status logic разделена на:
  - `FAIL_RUN`
  - `WARN_PARITY`
  - `WARN_COVERAGE`
  - `WARN_FRESHNESS`
- текущий practical result:
  - `linkedin` больше не даёт `WARN_PARITY`
  - если:
    - `legacy_only_rows = 0`
    - `canonical_only_rows > 0`
    - `canonical_only_min_date > legacy_max_report_date`
    то coverage классифицируется как `INFO_COVERAGE:canonical_ahead_of_legacy`
- текущий monitor result для `linkedin` = `INFO` с `INFO_COVERAGE:canonical_ahead_of_legacy`

## Step 15. Connect monitor to DB parity policy

Status: `completed`

Цель:

- убрать hardcoded per-source parity policy из `monitor_canonical_shadow.py`
- читать operational gate policy из БД

Результат:

- `monitor_canonical_shadow.py` теперь читает `source_parity_policy` для каждого source
- из БД берутся:
  - `authority_fact_scope`
  - `comparison_level`
  - `spend_tolerance_abs`
  - `impressions_tolerance_abs`
  - `clicks_tolerance_abs`
  - `conversions_tolerance_abs`
  - `coverage_mode`
  - `is_blocking`
- при отсутствии policy row monitor:
  - не падает
  - маркирует source как `WARN_CONFIG:missing_source_parity_policy`
- для `linkedin` и `reddit` practical monitor result не изменился, потому что seeded policy rows в БД соответствуют прежним hardcoded rules

## Step 16. Onboard vk_ads_v2 into canonical pipeline

Status: `completed`

Результат:

- добавлен governance migration:
  - `dashboard-next/src/db/migrations/007_vk_ads_v2_governance.sql`
- добавлен collector:
  - `fetch_vk_ads_v2_canonical.py`
- collector пишет только в `canonical_*`
- legacy VK collector и legacy tables не менялись

Semantic design:

- source key: `vk_ads_v2`
- canonical authority scope: `delivery_entity`
- native grain: `banner`
- planned parity comparison level: `account_day`
- blocking parity: `no` (`is_blocking = 0`)

Почему non-blocking в текущем состоянии:

- VK API отдаёт richer stats, чем current legacy storage:
  - `spend`
  - `conversions` (`base.goals`)
  - `reach`
  - `frequency`
  - quartiles
- legacy `vk_creative_stats` хранит только:
  - `impressions`
  - `clicks`
  - `ctr`
  - quartiles
- legacy names layer для VK неполный

Live backfill:

- 14-day backfill выполнен через isolated VPS runtime
- canonical results:
  - accounts: `3`
  - campaigns: `95`
  - delivery entities: `447`
  - creatives: `447`
  - facts: `6705`
  - grain: `delivery_entity/banner`
  - date window: `2026-03-01` -> `2026-03-15`

Validation:

- dedupe:
  - `fact_rows = 6705`
  - `distinct_grain_rows = 6705`
- orphan refs:
  - accounts `0`
  - campaigns `0`
  - delivery entities `0`
  - creatives `0`
- baseline nulls:
  - `spend = 0`
  - `impressions = 0`
  - `clicks = 0`
  - `conversions = 0`

Direct legacy compare on shared entity/day grain:

- `legacy_only_rows = 0`
- `canonical_only_rows = 910`
  - inside legacy window: `16`
  - after legacy max date: `894`
- intersect rows: `5795`
- mismatches on intersect rows:
  - impressions: `1`
  - clicks: `0`
  - quartiles: `0`

Current rollout decision:

- `vk_ads_v2` is `ready for shadow cron as a non-blocking monitored source`

### vk_ads_v2 collector refinement

Дополнительно после первичного onboarding:

- collector больше не пишет zero-activity fact rows
- zero-activity rows для `vk_ads_v2` теперь очищаются в пределах account/date window запуска
- нормализация метрик:
  - baseline and quartile metrics приводятся к `0`
  - negative values clamp-ятся до `0`
- fallback metadata больше не блокирует fact ingestion
- run summary теперь пишет в event payload:
  - `rows_skipped_zero`
  - `zero_rows_deleted`

Практический эффект:

- canonical `vk_ads_v2` fact rows сократились с `6705` до `19`
- direct compare against raw legacy rows стал некорректен как coverage metric, потому что legacy хранит тысячи zero-only rows
- compare after applying the same zero-row semantics to legacy:
  - `legacy_rows_filtered = 18`
  - `canonical_rows = 19`
  - `legacy_only_rows = 0`
  - `canonical_only_rows = 1`
  - `impressions_mismatches = 1`

### vk_ads_v2 monitor parity path

- `monitor_canonical_shadow.py` now supports `vk_ads_v2`
- shared compare grain:
  - `report_date`
  - `platform_delivery_entity_id`
- zero-only rows are filtered out on both legacy and canonical sides
- compared metrics:
  - `impressions`
  - `clicks`
  - `video_views_25`
  - `video_views_50`
  - `video_views_75`
  - `video_views_100`
- `source_parity_policy.is_blocking = 0` is respected:
  - VK warnings remain visible in monitor output
  - VK does not make overall monitor blocking

### vk_ads_v2 shadow cron rollout

Status: `completed`

Результат:

- `vk_ads_v2` promoted from manual-only to shadow cron

## Step 17. Implement GetIntent first-pass canonical path

Status: `completed`

Артефакты:

- `GETINTENT-REPORTING-ONBOARDING.md`
- `dashboard-next/src/db/migrations/009_getintent_governance.sql`
- `fetch_getintent_canonical.py`

Результат:

- prepared draft-only governance migration for `getintent`
- implemented first-pass canonical collector for `GetIntent`
- collector writes only into canonical tables through `canonical_writer.py`
- no legacy tables changed
- no canonical schema changes
- cron is now enabled and stable on VPS runtime

Accepted first-pass semantics:

- `source_key = 'getintent'`
- `authority_fact_scope = 'delivery_entity'`
- `native_grain = 'creative'`
- strongest parity grain = `delivery_entity_day`
- rollout mode recommendation = `non-blocking` until monitor integration is done

Current first-pass metric handling:

- parity-safe:
  - `impressions`
  - `clicks`
  - `video_views_25`
  - `video_views_50`
  - `video_views_75`
  - `video_views_100`
- provisional:
  - `unique_imps -> views`
  - `ctr`
- not materialized in facts v1:
  - `view_rate`
  - `spend`
  - `conversions`

Post-migration follow-up:
- after the current migration wave is closed, return to `GetIntent v1.1`
- add:
  - `cpm`
  - `cpc`
  - informational `budget`
  - derived `spend = impressions / 1000 * cpm`
- keep these fields outside legacy parity baseline

Backfill / validation:

- executed short backfill window: `2026-03-02 .. 2026-03-16`
- latest run:
  - `status = success`
  - `rows_read = 90`
  - `rows_written = 103`
  - `rows_updated = 103`
  - `error_count = 0`
- dictionaries after backfill:
  - accounts: `1`
  - campaigns: `4`
  - delivery_entities: `4`
  - creatives: `4`
- facts:
  - `90`
  - grain = `delivery_entity / creative`

Validation summary:

- dedupe:
  - `fact_rows = 90`
  - `distinct_grain_rows = 90`
- orphan checks:
  - accounts: `0`
  - campaigns: `0`
  - delivery_entities: `0`
  - creatives: `0`
- null baseline checks:
  - `impressions = 0`
  - `clicks = 0`
  - `views = 0`
  - `video_views_25 = 0`
  - `video_views_50 = 0`
  - `video_views_75 = 0`
  - `video_views_100 = 0`
- direct parity in backfill window:
  - `canonical_only_rows = 12`
  - `legacy_only_rows = 0`
  - `impressions_mismatches = 0`
  - `clicks_mismatches = 0`
  - `video_views_25/50/75/100 mismatches = 0`
- coverage interpretation:
  - all `canonical_only_rows` are after `legacy_max_report_date`
  - `canonical_only_after_legacy_max = 12`
  - `canonical_only_range = 2026-03-15 .. 2026-03-16`

Governance / monitor status:

- `009_getintent_governance.sql` applied successfully
- `monitor_canonical_shadow.py` now supports `getintent`
- source is now `monitored non-blocking`

Current monitor semantics:

- `gate_scope = delivery_entity`
- `comparison_level = delivery_entity_day`
- parity-safe metrics:
  - `impressions`
  - `clicks`
  - `video_views_25`
  - `video_views_50`
  - `video_views_75`
  - `video_views_100`
- `coverage_mode = allow_canonical_ahead`
- `is_blocking = 0`

Current monitor result:

- `[INFO] source=getintent`
- parity mismatches:
  - `impressions = 0`
  - `clicks = 0`
  - `video_views_25/50/75/100 = 0`
- coverage:
  - `legacy_only_rows = 0`
  - `canonical_only_rows = 12`
  - `canonical_only_rows_after_legacy_max = 12`
- interpretation:
  - canonical is ahead of legacy dates
  - this is informational and does not block rollout

Next step:

- prepare safe `GetIntent` shadow cron rollout, but do not enable cron until explicitly accepted
- source remains non-blocking according to `source_parity_policy.is_blocking = 0`
- legacy cron and existing Linkedin/Reddit shadow cron entries were left unchanged
- VK collector runs in the same isolated runtime on a separate cron slot before monitor

### GetIntent shadow cron rollout

Status: `enabled`

Current rollout state:
- `getintent` = `shadow-ready non-blocking monitored source`
- cron = `enabled`
- runtime = `/root/reportingdash-canonical`

Recommended cron line:

```cron
32 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_getintent_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/getintent-canonical-cron.log 2>&1
```

First 3 days after enable:

Day 1
- verify cron executed
- inspect `getintent-canonical-cron.log`
- run `monitor_canonical_shadow.py`
- check latest `canonical_collector_runs` for `source_key='getintent'`

Day 2
- confirm `rows_read`, `rows_written`, `rows_updated` stability
- confirm monitor policy is loaded from DB
- confirm `is_blocking = 0`

Day 3
- confirm parity remains clean on first-pass safe metrics
- confirm only informational coverage drift appears when canonical is ahead of legacy

Rollout note:
- accepted behavior is `INFO_COVERAGE:canonical_ahead_of_legacy`
- this does not block rollout

Operational verification:

- `fetch_getintent_canonical.py` deployed to `/root/reportingdash-canonical`
- Python runtime check passed on VPS
- manual collector run on VPS completed without error
- root crontab updated
- backup crontab saved:
  - `/root/crontab.backup.20260316204826`

## Yandex Direct first-pass collector

Status: `implemented`

Result:

- added collector `fetch_yandex_direct_canonical.py`
- first-pass authority source = `yandex_new`
- canonical mapping:
  - `fact_scope = 'delivery_entity'`
  - `native_grain = 'ad'`
  - `spend <- cost`
  - `impressions <- impressions`
  - `clicks <- clicks`
  - `conversions <- conversions`
- initial account bridge uses:
  - `yandex_names.brand` when available
  - stable fallback `campaign::<campaign_id>` when brand is missing
- 14-day backfill completed successfully
- direct parity vs `yandex_new` is clean on:
  - `spend`
  - `impressions`
  - `clicks`
  - `conversions`
- aggregate `campaign_day` parity vs `yandex_new` is also clean
- `yandex_market_stat` remains secondary validation only and has zero overlap with first-pass detailed path in the validation window
- recommended next step:
  - prepare safe shadow cron rollout

## Yandex Direct governance and monitor

Status: `completed`

Result:

- applied `010_yandex_direct_governance.sql`
- added `yandex_direct` monitor path in `monitor_canonical_shadow.py`
- source is now monitored and non-blocking
- monitor semantics:
  - `gate_scope = delivery_entity`
  - `comparison_level = delivery_entity_day`
  - parity-safe metrics:
    - `spend`
    - `impressions`
    - `clicks`
    - `conversions`
- latest monitor result:
  - policy loaded from DB
  - `is_blocking = 0`
  - parity mismatches = `0`
  - coverage drift = `0`
- first-pass account bridge remains partly synthetic and must stay documented as a limitation

## Yandex Direct shadow cron rollout

Status: `enabled`

Current rollout state:
- `yandex_direct` = `non-blocking monitored shadow source`
- cron = `enabled`
- runtime = `/root/reportingdash-canonical`

Exact prepared cron line:

```cron
34 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_yandex_direct_canonical.py --days-back 2 --run-type cron >> /root/reportingdash-canonical/logs/yandex-direct-canonical-cron.log 2>&1
```

Observed scheduled cron stability:

- `2026-03-17` `success`
- `2026-03-18` `success`
- `2026-03-19` `success`
- `2026-03-20` `success`

Operational verification notes:

- latest scheduled run:
  - `id = 65`
  - `status = success`
  - `rows_read = 19`
  - `rows_written = 61`
  - `rows_updated = 61`
  - `error_count = 0`

Keep checking:

Day 1
- verify cron executed
- inspect `yandex-direct-canonical-cron.log`
- run `monitor_canonical_shadow.py`
- check latest `canonical_collector_runs` for `source_key='yandex_direct'`

SQL:

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
- investigate coverage becoming in-window drift instead of clean/empty

## Yandex Metrika canonical analytics onboarding

Status: `implemented`

Result:

- added collector `fetch_yandex_metrika_canonical.py`
- source type:
  - canonical-first analytics source
  - no legacy parity
  - no paid-media grain reuse
- canonical fact table:
  - `canonical_fact_site_analytics_daily`
- first-pass grain:
  - `report_date + analytics_account_id(counter_id) + analytics_scope='traffic'`
- first-pass metrics:
  - `visits`
  - `users`
  - `pageviews`
  - `bounce_rate`
  - `avg_visit_duration_seconds`
- `canonical_writer.py` extended with:
  - `upsert_fact_site_analytics_daily`
- monitor now has analytics-only block for `yandex_metrika`:
  - freshness
  - row presence
  - collector health
  - parity = none
  - non-blocking

Backfill / validation:

- deployed to `/root/reportingdash-canonical`
- 14-day backfill completed successfully
- latest run:
  - `id = 36`
  - `status = success`
  - `rows_read = 135`
  - `rows_written = 135`
  - `rows_updated = 135`
  - `error_count = 0`
- skipped inaccessible counters:
  - collector now skips `403/404` counters instead of failing the full run
- analytics facts:
  - `row_count = 135`
  - `distinct_row_count = 135`
  - `account_count = 9`
  - `window = 2026-03-03 .. 2026-03-17`
- null checks:
  - `visits = 0`
  - `users = 0`
  - `pageviews = 0`
- monitor block:
  - `[OK] source=yandex_metrika`
  - `gate_scope = traffic`
  - `policy = canonical-only analytics source parity=none is_blocking=0`

Schema note:

- `canonical_fact_site_analytics_daily` already existed
- draft migration `011_yandex_metrika_analytics_schema.sql` was not needed

Next step:

- keep `yandex_metrika` as canonical-only analytics source
- do not force legacy parity or paid-media governance semantics onto this source
- prepare cron separately if scheduled rollout is desired

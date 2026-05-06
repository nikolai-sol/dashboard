# Yandex Metrika Canonical V1 Design

Дата фиксации: `2026-03-30`

## Status

Этот документ фиксирует шаги `1-5` для canonical analytics contour по Yandex Metrika.

Что входит:

- продуктовая модель
- audit текущей реализации
- canonical scope v1
- control layer model
- storage model

Что намеренно не входит:

- изменения schema
- изменения collector
- включение cron
- UI implementation

## 1. Product Model

Нужно поддерживать два разных режима, а не один общий "собираем всё из Metrika".

### 1.1 Ads analytics layer

Это основной слой.

Назначение:

- post-click analytics для paid traffic
- связка рекламных кампаний с поведением на сайте
- conversions как часть ads analytics, а не отдельный domain

Основные метрики:

- `visits`
- `users`
- `bounce_rate`
- `avg_visit_duration_seconds`
- `conversions` / goal reaches

Основная размерность:

- UTM-based attribution slice
- counter/account scope
- daily grain

Смысл:

- это canonical слой по умолчанию
- именно он нужен для dashboard/reporting parity с paid media

### 1.2 SEO / page performance layer

Это отдельный opt-in слой.

Назначение:

- page-level performance
- internal page performance
- page catalog / content performance

Для `page_performance v1` фиксируем узкий first-pass scope:

- source: `stat/v1/data`
- dimensions:
  - `ym:pv:URL`
  - `ym:pv:title`
- metrics:
  - `ym:pv:pageviews`
  - `ym:pv:users`
- grain:
  - `day x counter x page_url x page_title`

В этот scope намеренно НЕ входят:

- `visits`
- `bounce_rate`
- `avg_visit_duration_seconds`
- page/service filtering
- `source / medium` split
- traffic type split
- user behavior

Смысл:

- это не always-on слой
- он не должен по умолчанию расширять базовый ads analytics contour

### 1.3 Product priority

Приоритеты фиксируем так:

1. `ads analytics` = основной canonical слой
2. `seo/page analytics` = отдельный opt-in слой

Это значит:

- по умолчанию collector не должен тянуть page/internal/referral/search superset
- базовый режим должен быть достаточно узким для paid post-click analytics

## 2. Audit Current State

## 2.1 Что сейчас пишет canonical collector

Файл:

- [fetch_yandex_metrika_canonical.py](/Users/nafanya/ReportingDash/fetch_yandex_metrika_canonical.py)

Текущее поведение:

- источник жёстко фиксирован как `source_key = yandex_metrika`
- `analytics_scope` жёстко фиксирован как `traffic`
- `scope_hash` жёстко фиксирован как hash от `traffic:daily:account`
- активные counters читаются из legacy `yandex_metrika_names where active = 1`
- запрос к Metrika Stats API идёт без dimensions
- grain фактически: `1 day x 1 counter`

Что collector реально запрашивает из API:

- `ym:s:visits`
- `ym:s:users`
- `ym:s:pageviews`
- `ym:s:bounceRate`
- `ym:s:avgVisitDurationSeconds`

Что collector сейчас не запрашивает:

- UTM dimensions
- goals / conversions
- page-level dimensions
- source / medium / traffic type
- internal / returned / params breakdowns
- SEO-specific slices

Что collector реально пишет в canonical:

- `source_key`
- `analytics_account_id`
- `report_date`
- `analytics_scope = traffic`
- `scope_hash`
- `visits`
- `users`
- `pageviews`
- `bounce_rate`
- `avg_visit_duration_seconds`
- `ingestion_run_id`

Даже когда API по дню пустой, collector пишет zero row для `traffic` scope.

Вывод:

- текущий canonical collector это только account/day traffic summary
- он не покрывает ни ads post-click attribution slice, ни SEO/page layer
- с product точки зрения он слишком узкий для ads analytics v1 и слишком бедный для SEO layer

## 2.2 Что реально есть в canonical_fact_site_analytics_daily

Файлы:

- [canonical_writer.py](/Users/nafanya/ReportingDash/canonical_writer.py)
- [CANONICAL-ENTITIES-MEMORY.md](/Users/nafanya/ReportingDash/CANONICAL-ENTITIES-MEMORY.md)

Таблица поддерживает richer schema, чем текущий collector реально наполняет.

Поддерживаемые поля:

- scope identity:
  - `source_key`
  - `analytics_account_id`
  - `report_date`
  - `analytics_scope`
  - `scope_hash`
- UTM fields:
  - `utm_source`
  - `utm_medium`
  - `utm_campaign`
  - `utm_content`
  - `utm_term`
- goal fields:
  - `goal_id`
  - `goal_name`
  - `goal_reaches`
- page / traffic fields:
  - `page_url`
  - `page_title`
  - `region_city`
  - `traffic_source`
- metrics:
  - `visits`
  - `users`
  - `new_users`
  - `pageviews`
  - `page_depth`
  - `bounce_rate`
  - `avg_visit_duration_seconds`

Фактическое наполнение на дату фиксации:

- в таблице есть только `source_key = yandex_metrika`
- в таблице есть только `analytics_scope = traffic`
- объём: `135` строк
- диапазон дат: `2026-03-03 .. 2026-03-17`
- populated metrics:
  - `visits`
  - `users`
  - `pageviews`
  - `bounce_rate`
  - `avg_visit_duration_seconds`
- полностью пустые по данным поля:
  - все `utm_*`
  - `goal_id`
  - `goal_name`
  - `goal_reaches`
  - `page_url`
  - `page_title`
  - `region_city`
  - `traffic_source`
  - `new_users`
  - `page_depth`

Вывод:

- schema уже допускает разделение ads/page/goals/traffic slices
- но текущий canonical dataset фактически содержит только coarse traffic summary

## 2.3 Что реально есть в legacy

Файлы:

- [NEST-SECOND-AUDIT.md](/Users/nafanya/ReportingDash/NEST-SECOND-AUDIT.md)
- [FIELD-MAPPING.md](/Users/nafanya/ReportingDash/FIELD-MAPPING.md)
- [metrika.service.ts](/Users/nafanya/ReportingDash/nest-second/src/services/metrika/metrika.service.ts)
- [metrika.model.ts](/Users/nafanya/ReportingDash/nest-second/src/services/metrika/metrika.model.ts)

Legacy tables:

- `yandex_metrika_names`
- `yandex_metrika`
- `yandex_metrika_goals`
- `yandex_metrika_goals_stat`
- `yandex_metrika_internal`
- `yandex_metrika_params`
- `yandex_metrika_returned`
- `yandex_abbot_stats`

Legacy coverage на дату фиксации:

- `yandex_metrika_names`
  - `11` counters
  - `10` active
  - `2` counters with `params=1`
  - `2` counters with `internal=1`
- `yandex_metrika`
  - `83,604` rows
  - `2023-01-02 .. 2026-03-28`
  - `12` counters
  - `12,707` distinct UTM keys
- `yandex_metrika_goals_stat`
  - `137,473` rows
  - `2023-01-07 .. 2026-03-28`
  - `189` distinct goals
- `yandex_metrika_internal`
  - `373,804` rows
  - `2023-01-01 .. 2026-03-28`
  - `111,728` distinct URLs
- `yandex_metrika_params`
  - `98,103` rows
  - `2023-10-03 .. 2026-03-28`
  - `10` traffic IDs
- `yandex_metrika_returned`
  - `209,269` rows
  - `2024-07-01 .. 2026-03-28`
  - `46,136` distinct URLs
- `yandex_abbot_stats`
  - `5,949` rows
  - `2023-02-03 .. 2026-03-27`

Legacy service behaviour:

- `stats` uses env-defined dimensions/metrics and writes UTM-based traffic rows into `yandex_metrika`
- `goals` writes goal-level rows into `yandex_metrika_goals_stat`
- `internal` writes page/url rows into `yandex_metrika_internal`
- `params` writes traffic/source-level rows into `yandex_metrika_params`
- `returned` writes returned-user/page rows into `yandex_metrika_returned`
- `abbot` writes a dedicated custom slice into `yandex_abbot_stats`

Вывод:

- legacy уже реализует и ads-like UTM layer, и page/internal/traffic slices
- canonical пока не переносит почти ничего из этого объёма

## 3. Canonical Scope V1

## 3.1 Always-on scope

Для canonical v1 always-on должен быть только `ads analytics` слой.

Входит по умолчанию:

- post-click traffic, привязанный к UTM slice
- engagement metrics:
  - `visits`
  - `users`
  - `bounce_rate`
  - `avg_visit_duration_seconds`
  - при наличии `page_depth`
- conversions:
  - goal-based conversions / reaches

Базовый grain:

- `1 day x 1 counter/account x 1 UTM-based slice`

Ожидаемая логика:

- paid post-click analytics first
- conversions входят в тот же слой, а не в отдельный page/SEO domain

## 3.2 Opt-in scope

Отдельно включаемый `seo/page performance` слой.

Может включать:

- page-level rows
- source / medium / traffic type rows
- internal / returned / search / referral slices

Это должно собираться только если слой явно enabled для counter/account.

## 3.3 Что НЕ собираем по умолчанию

По умолчанию не должны собираться:

- все page-level rows
- internal page analytics
- returned visitors slice
- params / traffic-type exploratory slices
- SEO / search / referral wide breakdowns
- кастомные special-case slices вроде `abbot`
- произвольный superset всех dimensions из API

Правило:

- default mode не "всё, что отдаёт Metrika API"
- default mode = только то, что нужно для ads post-click analytics

## 4. Control Layer Model

UI пока не делаем, но продуктовая control model нужна уже сейчас.

Гранулярность:

- counter/account level

Минимальные флаги:

- `is_active`
- `ads_analytics_enabled`
- `seo_analytics_enabled`

Смысл флагов:

- `is_active`
  - counter участвует в canonical collection вообще
- `ads_analytics_enabled`
  - включён основной always-on ads analytics слой
- `seo_analytics_enabled`
  - включён opt-in page/SEO слой

Нормативная матрица режимов:

- `is_active=0`
  - counter не собирается
- `is_active=1`, `ads_analytics_enabled=1`, `seo_analytics_enabled=0`
  - режим `ads only`
- `is_active=1`, `ads_analytics_enabled=1`, `seo_analytics_enabled=1`
  - режим `ads + seo`
- `is_active=1`, `ads_analytics_enabled=0`, `seo_analytics_enabled=1`
  - пока не рекомендовать как основной режим
  - допустим только если позже появится явный use case

Продуктовое правило v1:

- canonical-first режим должен ориентироваться на `ads only`
- `seo_analytics_enabled` это расширение, а не базовая настройка

## 5. Storage Model

Главный принцип:

- ads analytics data и seo/page performance data не должны смешиваться как один и тот же semantic layer

## 5.1 Ads analytics storage

Сюда относятся:

- UTM-based post-click traffic rows
- engagement metrics
- conversions / goals

Обязательное правило:

- conversions являются частью `ads analytics` слоя
- они не должны выноситься в отдельный page-only domain

## 5.2 SEO / page storage

Сюда относятся:

- page URL / title performance
- internal navigation/page rows
- traffic-source exploration rows
- referral/search/non-paid page slices

Обязательное правило:

- page layer не смешивается с ads layer
- даже если физически используется одна canonical family, semantics должны быть разделены scope-моделью

## 5.3 Practical implication for current canonical table

Текущая таблица `canonical_fact_site_analytics_daily` уже допускает scope-based separation:

- `traffic`
- `goal`
- `page`
- `params`
- `returned`
- `other`

Но для v1 нужно трактовать её не как "сваливаем всё в одну таблицу без режима", а как scope-aware storage.

Нормативное разделение v1:

- ads analytics layer:
  - `traffic`
  - goal/conversion slice, если он materialized отдельно
- seo/page layer:
  - `page`
  - `params`
  - `returned`
  - другие opt-in page/traffic slices

## Decision Summary

Фиксируем:

1. `ads analytics` это основной canonical слой для Yandex Metrika.
2. `SEO/page performance` это отдельный opt-in слой.
3. Текущий canonical collector слишком узкий и пока пишет только coarse `traffic` summary без UTM/goals/page data.
4. Legacy уже содержит нужные данные для обоих слоёв, но canonical пока их почти не materializes.
5. Для v1 по умолчанию собираем только ads post-click analytics + conversions.
6. Page/internal/referral/search/SEO slices по умолчанию не собираем.
7. Нужен control layer с флагами:
   - `is_active`
   - `ads_analytics_enabled`
   - `seo_analytics_enabled`
8. Storage должен оставаться scope-aware:
   - conversions входят в ads layer
   - page layer не смешивается с ads layer

## Phase 2 Scope: `page_performance`

Дата фиксации: `2026-03-30`

`page_performance` принимается как следующий безопасный scope после `utm_ads + goals`.

### Canonical shape

- source: `stat/v1/data`
- dimensions:
  - `ym:pv:URL`
  - `ym:pv:title`
- metrics:
  - `ym:pv:pageviews`
  - `ym:pv:users`
- grain:
  - `day x counter x page_url x page_title`

### Canonical mapping

Таблица:

- `canonical_fact_site_analytics_daily`

Product scope:

- `analytics_scope = page_performance`

Поля:

- `report_date`
- `analytics_account_id`
- `page_url`
- `page_title`
- `pageviews`
- `users`

### Explicit exclusions for phase 2

В `page_performance v1` НЕ включаем:

- `visits`
- `bounce_rate`
- `avg_visit_duration_seconds`
- page/service filtering
- `source / medium` split
- traffic type split
- user behavior

### URL normalization rule

Нормализация URL не входит в collector path.

Фиксируем два слоя:

- `page_performance_v1_raw`
  - canonical layer
  - URL сохраняется в canonical "как есть" из `ym:pv:URL`
- `page_performance_v1_normalized`
  - downstream optional layer
  - любые правила cleanup / canonicalization / grouping URL применяются только после canonical ingestion

Практическое правило:

- collector не нормализует URL
- raw canonical page layer остаётся источником истины

### Safe implementation order

1. Добавить opt-in collector path только для counters с `seo_analytics_enabled`.
2. Для каждого `day x counter` запрашивать только `ym:pv:URL, ym:pv:title`.
3. Писать только `pageviews` и `users`.
4. Проверять row counts, sampling flags и daily coverage.
5. Сделать короткий manual backfill и validation.
6. Не включать cron до отдельного подтверждения.

## Out Of Scope Until Validation

До отдельного подтверждения не делаем:

- schema changes
- collector rewrite
- cron enable
- UI controls
- broad API superset collection

## Shadow Validation Policy

Дата фиксации: `2026-03-30`

Для `Yandex Metrika / utm_ads` фиксируем policy для shadow validation.

### Strict parity metric

- `visits`

Правило:

- `visits` это основной parity metric для shadow contour
- заметные расхождения по `visits` считаются сигналом проблемы в collector, grain или mapping

### Soft metric

- `users`

Правило:

- `users` считается informational metric
- допускаются отклонения при campaign-level aggregation

Причины допустимых отклонений:

- metric non-additivity при rollup с более детального UTM grain
- live API vs legacy restatement drift

### Accepted deviations

Для `utm_ads` на текущем этапе считаются допустимыми:

- case-sensitive UTM differences вроде `CLM` vs `clm`
- различия между current live API и legacy restated data
- небольшие расхождения по `users`, если `visits` parity сохраняется

### Goals policy

Для `goals` применяем stricter validation:

- `goal_reaches` ожидается как strict parity metric
- на текущем first pass `goals` parity подтверждена после case-sensitive validation

### Practical validation order

1. Coverage and grain correctness
2. `visits` parity for `utm_ads`
3. `goal_reaches` parity for `goals`
4. Informational review of `users`

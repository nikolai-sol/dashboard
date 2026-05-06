# Yandex Metrika Shadow Validation

Дата фиксации: `2026-03-30`

## Scope

Этот документ фиксирует правила shadow validation для first pass canonical ingestion по Yandex Metrika.

В текущий scope входят:

- `utm_ads`
- `goals`

В текущий scope не входят:

- `page_performance`
- `user_behavior`
- cron rollout
- schema changes

Отдельное решение:

- `page_performance` принят как `phase 2` scope
- но он пока не входит в текущий shadow contour
- его validation и rollout должны идти отдельно от `utm_ads + goals`

## Validation Policy

## 1. `utm_ads`

### Strict parity metric

- `visits`

Правило:

- `visits` это основной parity metric для shadow contour
- заметные расхождения по `visits` считаются сигналом проблемы в collector, grain или mapping

### Soft metric

- `users`

Правило:

- `users` считаются informational metric
- небольшие расхождения допустимы и сами по себе не блокируют shadow acceptance

Причины допустимых отклонений:

- non-additivity при campaign-level aggregation
- drift между current live API и legacy restated data

### Accepted deviations

Для `utm_ads` допустимы:

- case-sensitive UTM differences вроде `CLM` vs `clm`
- различия между live API и legacy restated rows
- небольшие расхождения по `users`, если parity по `visits` сохраняется

## 2. `goals`

### Strict parity metric

- `goal_reaches`

Правило:

- `goal_reaches` валидируется строго
- расхождения считаются blocking issue, если не доказано, что это artifact validation

### Accepted deviations

Для `goals` допустимы только validation artifacts:

- case-insensitive join/aggregation errors в SQL validation

Не считаются допустимыми:

- реальные unexplained deltas по `goal_reaches`

## Validation Order

1. Проверить coverage и grain correctness.
2. Проверить `utm_ads / visits`.
3. Проверить `goals / goal_reaches`.
4. Отдельно посмотреть `utm_ads / users` как soft metric.

## Current Status

По состоянию на `2026-03-30`:

- `goals` parity подтверждена после case-sensitive validation
- `utm_ads` structural parity подтверждена
- residual deviations по `utm_ads` признаны acceptable для shadow contour при сохранённой parity по `visits`

## Rollout Rule

Пока cron не включаем, если:

- нет стабильной parity по `visits`
- нет подтверждённой parity по `goal_reaches`
- wide backfill не подтверждён operationally

Shadow contour считается accept-ready, если:

- grain корректный
- coverage корректный
- `visits` parity сохранена
- `goals` parity сохранена

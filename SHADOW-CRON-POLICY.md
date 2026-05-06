# Shadow Cron Policy

Дата: `2026-03-15`

Цель:

- формализовать rollout policy для canonical shadow cron
- не трогать legacy collectors и legacy tables
- запускать canonical collectors параллельно
- использовать source-aware parity gates

Accepted canonical-only sources:

- `linkedin`
- `reddit`

Для этих источников:

- legacy parity bridge не требуется
- они принимаются как canonical reporting sources by design
- operational gate для rollout строится на:
  - freshness
  - collector health
  - internal canonical consistency

## Sources Ready Now

### LinkedIn

Статус: `ready`

Причина:

- canonical writer стабилен
- backfill прошёл
- duplicate grain rows не обнаружены
- базовые dictionary refs закрыты
- accepted canonical-only for shadow rollout

Canonical authority:

- authority fact scope: `delivery_entity`
- authority native grain: `creative`
- required legacy parity compare: no

Analytical-only scope:

- none in `v1`

Практически:

- для `linkedin` текущий canonical scope один и тот же используется и для canonical reporting, и для detail analytics

### Reddit

Статус: `ready`

Причина:

- ad-level canonical ingestion больше не зависит от metadata gating
- campaign-level canonical path добавлен отдельно
- accepted canonical-only for shadow rollout

Canonical authority:

- authority fact scope: `campaign`
- authority native grain: `campaign`
- required legacy parity compare: no

Analytical-only scope:

- `fact_scope = 'delivery_entity'`
- `native_grain = 'ad'`

Важное правило:

- Reddit campaign totals не обязаны равняться `SUM(ad totals)`
- Reddit ad-level rows не используются как release gate

## Sentinel Values

Для `reddit` campaign-scope rows используется:

- `platform_delivery_entity_id = '__campaign__'`
- `platform_creative_id = ''`

Это intentional sentinel.

Важно:

- `__campaign__` не является реальным native delivery entity id
- это технический marker campaign-scope row в `canonical_fact_ads_daily`

## Recommended Cron Schedule

Требования:

- запускать только на хосте, где есть:
  - рабочий `.env`
  - Python `venv`
  - доступ к production MySQL
- legacy cron не менять
- canonical cron запускать позже legacy

Рекомендуемое окно:

- legacy остаётся в `06:00 UTC`
- canonical shadow collectors запускать после него

Рекомендуемые cron entries:

```cron
20 6 * * * cd /Users/nicko/ReportingDash && /Users/nicko/ReportingDash/venv/bin/python fetch_linkedin_canonical.py --days-back 2 --run-type cron >> /Users/nicko/ReportingDash/logs/linkedin-canonical-cron.log 2>&1
30 6 * * * cd /Users/nicko/ReportingDash && /Users/nicko/ReportingDash/venv/bin/python fetch_reddit_canonical.py --days-back 2 --run-type cron --scope both >> /Users/nicko/ReportingDash/logs/reddit-canonical-cron.log 2>&1
35 6 * * * cd /Users/nicko/ReportingDash && /Users/nicko/ReportingDash/venv/bin/python fetch_vk_ads_v2_canonical.py --days-back 2 --run-type cron >> /Users/nicko/ReportingDash/logs/vk-ads-v2-canonical-cron.log 2>&1
```

Почему `--days-back 2`:

- даёт overlap по окну
- снижает риск потери данных из-за API lag / timezone boundary
- safe because canonical writes are idempotent

Если нужен более консервативный режим:

```cron
20 6 * * * cd /Users/nicko/ReportingDash && /Users/nicko/ReportingDash/venv/bin/python fetch_linkedin_canonical.py --days-back 3 --run-type cron >> /Users/nicko/ReportingDash/logs/linkedin-canonical-cron.log 2>&1
30 6 * * * cd /Users/nicko/ReportingDash && /Users/nicko/ReportingDash/venv/bin/python fetch_reddit_canonical.py --days-back 3 --run-type cron --scope both >> /Users/nicko/ReportingDash/logs/reddit-canonical-cron.log 2>&1
```

## Daily Monitoring Queries

For `linkedin` and `reddit`, these queries are now legacy-reference diagnostics only.

- they are not required release gates
- accepted rollout for these sources is based on:
  - freshness
  - collector health
  - internal canonical consistency

### 1. Latest successful runs

```sql
SELECT
  source_key,
  run_mode,
  MAX(id) AS latest_run_id,
  MAX(finished_at) AS latest_finished_at
FROM canonical_collector_runs
WHERE source_key IN ('linkedin', 'reddit')
  AND status = 'success'
GROUP BY source_key, run_mode
ORDER BY source_key, run_mode;
```

### 2. Recent run details

```sql
SELECT
  id,
  source_key,
  run_type,
  run_mode,
  status,
  rows_read,
  rows_written,
  rows_updated,
  error_count,
  error_summary,
  started_at,
  finished_at
FROM canonical_collector_runs
WHERE source_key IN ('linkedin', 'reddit')
ORDER BY id DESC
LIMIT 20;
```

### 3. Row counts by source and fact_scope

```sql
SELECT
  source_key,
  fact_scope,
  native_grain,
  COUNT(*) AS row_count,
  MIN(report_date) AS min_date,
  MAX(report_date) AS max_date
FROM canonical_fact_ads_daily
WHERE source_key IN ('linkedin', 'reddit')
GROUP BY source_key, fact_scope, native_grain
ORDER BY source_key, fact_scope, native_grain;
```

### 4. LinkedIn parity summary

```sql
WITH legacy AS (
  SELECT
    report_date,
    account_id AS platform_account_id,
    campaign_id AS platform_campaign_id,
    ROUND(SUM(cost_local), 6) AS legacy_spend,
    SUM(impressions) AS legacy_impressions,
    SUM(clicks) AS legacy_clicks,
    SUM(conversions) AS legacy_conversions
  FROM ad_analytics_daily
  WHERE platform='linkedin'
  GROUP BY report_date, account_id, campaign_id
),
canonical AS (
  SELECT
    report_date,
    platform_account_id,
    platform_campaign_id,
    ROUND(SUM(spend), 6) AS canonical_spend,
    SUM(impressions) AS canonical_impressions,
    SUM(clicks) AS canonical_clicks,
    SUM(conversions) AS canonical_conversions
  FROM canonical_fact_ads_daily
  WHERE source_key='linkedin'
    AND fact_scope='delivery_entity'
  GROUP BY report_date, platform_account_id, platform_campaign_id
),
compared AS (
  SELECT
    COALESCE(l.report_date, c.report_date) AS report_date,
    COALESCE(l.platform_account_id, c.platform_account_id) AS platform_account_id,
    COALESCE(l.platform_campaign_id, c.platform_campaign_id) AS platform_campaign_id,
    l.legacy_spend,
    c.canonical_spend,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_conversions,
    c.canonical_conversions
  FROM legacy l
  LEFT JOIN canonical c
    ON c.report_date = l.report_date
   AND c.platform_account_id = l.platform_account_id
   AND c.platform_campaign_id = l.platform_campaign_id
  UNION ALL
  SELECT
    c.report_date,
    c.platform_account_id,
    c.platform_campaign_id,
    l.legacy_spend,
    c.canonical_spend,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_conversions,
    c.canonical_conversions
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND l.platform_account_id = c.platform_account_id
   AND l.platform_campaign_id = c.platform_campaign_id
  WHERE l.report_date IS NULL
)
SELECT
  'linkedin' AS source_key,
  COUNT(*) AS compare_rows,
  SUM(CASE WHEN ABS(COALESCE(legacy_spend,0)-COALESCE(canonical_spend,0)) > 0.01 THEN 1 ELSE 0 END) AS spend_mismatches,
  SUM(CASE WHEN COALESCE(legacy_impressions,0) <> COALESCE(canonical_impressions,0) THEN 1 ELSE 0 END) AS impressions_mismatches,
  SUM(CASE WHEN COALESCE(legacy_clicks,0) <> COALESCE(canonical_clicks,0) THEN 1 ELSE 0 END) AS clicks_mismatches,
  SUM(CASE WHEN COALESCE(legacy_conversions,0) <> COALESCE(canonical_conversions,0) THEN 1 ELSE 0 END) AS conversions_mismatches
FROM compared;
```

### 5. Reddit parity summary

```sql
WITH legacy AS (
  SELECT
    report_date,
    account_id AS platform_account_id,
    campaign_id AS platform_campaign_id,
    ROUND(SUM(cost_local), 6) AS legacy_spend,
    SUM(impressions) AS legacy_impressions,
    SUM(clicks) AS legacy_clicks,
    SUM(conversions) AS legacy_conversions
  FROM ad_analytics_daily
  WHERE platform='reddit'
  GROUP BY report_date, account_id, campaign_id
),
canonical AS (
  SELECT
    report_date,
    platform_account_id,
    platform_campaign_id,
    ROUND(SUM(spend), 6) AS canonical_spend,
    SUM(impressions) AS canonical_impressions,
    SUM(clicks) AS canonical_clicks,
    SUM(conversions) AS canonical_conversions
  FROM canonical_fact_ads_daily
  WHERE source_key='reddit'
    AND fact_scope='campaign'
  GROUP BY report_date, platform_account_id, platform_campaign_id
),
compared AS (
  SELECT
    COALESCE(l.report_date, c.report_date) AS report_date,
    COALESCE(l.platform_account_id, c.platform_account_id) AS platform_account_id,
    COALESCE(l.platform_campaign_id, c.platform_campaign_id) AS platform_campaign_id,
    l.legacy_spend,
    c.canonical_spend,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_conversions,
    c.canonical_conversions
  FROM legacy l
  LEFT JOIN canonical c
    ON c.report_date = l.report_date
   AND c.platform_account_id = l.platform_account_id
   AND c.platform_campaign_id = l.platform_campaign_id
  UNION ALL
  SELECT
    c.report_date,
    c.platform_account_id,
    c.platform_campaign_id,
    l.legacy_spend,
    c.canonical_spend,
    l.legacy_impressions,
    c.canonical_impressions,
    l.legacy_clicks,
    c.canonical_clicks,
    l.legacy_conversions,
    c.canonical_conversions
  FROM canonical c
  LEFT JOIN legacy l
    ON l.report_date = c.report_date
   AND l.platform_account_id = c.platform_account_id
   AND l.platform_campaign_id = c.platform_campaign_id
  WHERE l.report_date IS NULL
)
SELECT
  'reddit' AS source_key,
  COUNT(*) AS compare_rows,
  SUM(CASE WHEN ABS(COALESCE(legacy_spend,0)-COALESCE(canonical_spend,0)) > 0.01 THEN 1 ELSE 0 END) AS spend_mismatches,
  SUM(CASE WHEN COALESCE(legacy_impressions,0) <> COALESCE(canonical_impressions,0) THEN 1 ELSE 0 END) AS impressions_mismatches,
  SUM(CASE WHEN COALESCE(legacy_clicks,0) <> COALESCE(canonical_clicks,0) THEN 1 ELSE 0 END) AS clicks_mismatches,
  SUM(CASE WHEN COALESCE(legacy_conversions,0) <> COALESCE(canonical_conversions,0) THEN 1 ELSE 0 END) AS conversions_mismatches
FROM compared;
```

## Release Gate Policy

Canonical shadow cron can be considered healthy when:

- latest collector run is `success`
- no unexpected spike in row count drop by source/scope
- parity gate metrics stay inside source-specific tolerance where a required legacy bridge exists

Current gate definitions:

- `linkedin`
  - accepted canonical-only source
  - required legacy parity gate: no
  - operational gate:
    - freshness
    - collector health
    - internal canonical consistency

- `reddit`
  - accepted canonical-only source
  - required legacy parity gate: no
  - canonical reporting scope: `fact_scope='campaign'`
  - analytical-only scope: `fact_scope='delivery_entity'`
  - operational gate:
    - freshness
    - collector health
    - internal canonical consistency

## Not A Gate

These checks are useful but not release gates:

- Reddit `delivery_entity/ad` totals vs legacy campaign totals
- cross-source equality of metric semantics
- forcing `SUM(ad)` to equal campaign totals on sources where API semantics differ

## Monitoring Script

Файл:

- `monitor_canonical_shadow.py`

Что делает:

- печатает latest run status по `linkedin` и `reddit`
- печатает latest run time и row counters
- печатает recent row counts по `source_key + fact_scope + native_grain`
- for `linkedin` and `reddit`, treats them as accepted canonical-only sources
- uses governance/policy rows mainly to classify blocking mode and canonical authority scope
- читает gate scope, comparison level, tolerances и coverage mode из `source_parity_policy`
- возвращает exit code:
  - `0` = `OK`
  - `1` = `WARN`

Simple WARN rules:

- `FAIL_RUN` if latest run failed
- `WARN_PARITY` if intersection mismatches exceed tolerance
- `WARN_COVERAGE` if non-intersect rows exist
- `WARN_FRESHNESS` if no fresh rows for expected recent window
- `WARN_CONFIG` if a source has no `source_parity_policy` row
- `INFO_COVERAGE` if canonical is only ahead of legacy in dates, with no in-window coverage gap

Severity hierarchy:

- `FAIL_RUN`
- `WARN_PARITY`
- `WARN_COVERAGE`
- `WARN_FRESHNESS`
- `WARN_CONFIG`
- `INFO_COVERAGE`
- `OK`

Пример запуска:

```bash
cd /Users/nicko/ReportingDash
venv/bin/python monitor_canonical_shadow.py
```

Пример cron после collectors:

```cron
40 6 * * * cd /Users/nicko/ReportingDash && /Users/nicko/ReportingDash/venv/bin/python monitor_canonical_shadow.py >> /Users/nicko/ReportingDash/logs/canonical-shadow-monitor.log 2>&1
```

## Non-Blocking Shadow Source

### VK Ads v2

Статус: `shadow-enabled, non-blocking`

Причина:

- canonical collector существует и 14-day backfill уже отработал
- authority scope: `delivery_entity`
- native grain: `banner`
- direct legacy compare on shared `creative_id/date` grain очень сильный
- `monitor_canonical_shadow.py` now supports a VK-specific parity path:
  - compares shared `delivery_entity + report_date` grain
  - filters zero-only rows on both legacy and canonical sides
  - compares `impressions`, `clicks`, and video quartiles
  - respects `is_blocking = 0`, so VK warnings do not make overall monitor blocking

Практический rollout:

- collector can run daily in shadow cron
- monitor shows VK block consistently
- VK warnings remain visible, but do not make the overall monitor blocking

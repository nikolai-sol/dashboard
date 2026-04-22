# Yandex Direct Cutover Status

This file captures the current known migration state so the future collectors repo
does not restart the Yandex Direct move from scratch.

## Current known state

Observed from local/server notes and current runtime:

- Yandex Direct production collection is now API-first
- production `source_key = yandex_direct` is written by `fetch_yandex_direct_canonical_api.py`
- the switch was accelerated because the legacy bridge began failing when `yandex_new` stopped filling
- legacy bridge collector still exists and depends on legacy-filled `yandex_new`
- legacy `/direct` cron remains only as a temporary safety/backfill path
- `fetch_yandex_direct_canonical_api.py` already exists as a canonical-first path
- API-first collector reads active access from `req_system`
- retry / wait handling exists for:
  - `201`
  - `202`
  - `429`
  - `5xx`
- the API wait window is intentionally long enough for large Direct reports such as `leovit-mtg`
- an additional late retry cron should re-request the latest closed day after the morning run
- canonical writes already go to:
  - `canonical_source_*`
  - `canonical_fact_ads_daily`
- run/events already go to:
  - `canonical_collector_runs`
  - `canonical_collector_run_events`
- fail-soft account handling already exists

## Production mode

Current production semantics are:

- production source:
  - `yandex_direct`
- production collector:
  - `fetch_yandex_direct_canonical_api.py`
- required runtime env:
  - `YANDEX_DIRECT_PRIMARY_COLLECTOR=api`
  - `YANDEX_DIRECT_API_SOURCE_KEY=yandex_direct`
- stale/history-only shadow source:
  - `yandex_direct_api_shadow`

This matters because bootstrap migration must preserve:

- source keys
- production API-first semantics
- legacy bridge rollback path until final cleanup
- health dashboards without treating old shadow runs as active collector failures

## Existing cutover monitoring

Existing shadow/cutover logic is already implemented in:

- current collector root `monitor_canonical_shadow.py`
- current collector root `sources_health_dashboard.py`
- current collector root `send_canonical_telegram_report.py`

These should move into the future repo with the current API-first production semantics.

## Bootstrap recommendation

When bootstrapping the separate collectors repo:

1. move the API-first Direct collector as the active production path
2. move the legacy bridge collector only as rollback/backfill support
3. move cutover/health monitoring scripts with shadow reporting disabled by default
4. reproduce the production API cron from the new repo path
5. reproduce the late retry cron for the latest closed day
6. do not rename source keys during bootstrap

## Remaining cutover cleanup

Yandex Direct has already crossed the main source-path cutover. Remaining work:

1. monitor 2-3 stable API-first days
2. confirm large-account runs such as `leovit-mtg` no longer stay partial after late retry
3. stop legacy `/direct` cron after stability is accepted
4. keep rollback command documented until the old runtime path is retired

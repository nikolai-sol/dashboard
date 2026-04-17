# Yandex Direct Cutover Status

This file captures the current known migration state so the future collectors repo
does not restart the Yandex Direct move from scratch.

## Current known state

Observed from local/server notes and current runtime:

- legacy bridge collector still exists and depends on legacy-filled `yandex_new`
- `fetch_yandex_direct_canonical_api.py` already exists as a canonical-first path
- API-first collector reads active access from `req_system`
- retry / wait handling exists for:
  - `201`
  - `202`
  - `429`
  - `5xx`
- canonical writes already go to:
  - `canonical_source_*`
  - `canonical_fact_ads_daily`
- run/events already go to:
  - `canonical_collector_runs`
  - `canonical_collector_run_events`
- fail-soft account handling already exists

## Shadow mode

The intended current shadow source semantics are:

- primary bridge source:
  - `yandex_direct`
- API shadow source:
  - `yandex_direct_api_shadow`

This matters because bootstrap migration must preserve:

- source keys
- shadow cron semantics
- parity/cutover dashboards

## Existing cutover monitoring

Existing shadow/cutover logic is already implemented in:

- current collector root `monitor_canonical_shadow.py`
- current collector root `sources_health_dashboard.py`
- current collector root `send_canonical_telegram_report.py`

These should move into the future repo without semantic changes in Phase 1.

## Bootstrap recommendation

When bootstrapping the separate collectors repo:

1. move Yandex Direct bridge collector unchanged
2. move API shadow collector unchanged
3. move cutover monitoring scripts unchanged
4. reproduce existing shadow cron from the new repo path
5. do not merge bridge and API collectors yet
6. do not rename source keys during bootstrap

## Cutover after bootstrap

Only after the repo migration is stable:

1. continue shadow verification
2. compare `yandex_direct` vs `yandex_direct_api_shadow`
3. decide cutover gate
4. then switch production source path if accepted

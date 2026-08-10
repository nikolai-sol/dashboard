# Yandex Webmaster query→page rollout — 2026-07-29

## Result

The free standard Query Analytics path passed the Enhanced Export comparison and the bounded collector is live for manual runs. The dashboard code is merged to `main`, but application deployment and the weekly cron remain intentionally blocked by the active Abbott successor-release gate.

## Verified implementation

- Standard exact-URL probe for `2026-07-22`: 152 standard rows = 152 Enhanced Export rows, 13 clicks = 13 clicks, 191 impressions = 191 impressions, 0 mismatches.
- Root collector `main`: `a7d2a63`; query-page implementation ends at `e928227`.
- Dashboard `main`: `833db89`, pushed to `origin/main`.
- Local verification after merge: 75 Python tests and 533 dashboard tests passed; dashboard security, lint, typecheck, and production build exited 0.
- Migration `045_yandex_webmaster_query_pages_daily.sql` applied to `report_bd`.
- Canonical unique grains verified:
  - fact: source × account × host × date × device × query hash × page hash;
  - coverage: source × account × host × date × device × page hash.
- Deployed collector SHA-256: `d09d2f405a2ead584af46cca50dfce343810bebe832427e942b78c0ab53375eb`.
- Collector backup: `/var/www/dashboard-backups/wm-query-pages-20260729T171410Z/fetch_yandex_webmaster_canonical.py`, mode `0600`.
- Deployed health module SHA-256: `7e935e6f90ff14118f013224328570c92cd1283986af0866d7e8583c5de0da96`.
- Health backup: `/root/reportingdash-canonical/backups/wm-query-pages-20260729T171410Z/zaruku_collector_health.py`, mode `0600`.

## Manual production run

- Run ID: `1715`.
- Mode/job: `weekly` / `yandex_webmaster:query_pages`.
- Window: `2026-07-21..2026-07-27`.
- Priority limit: 15 pages.
- Result: `success`, `error_count=0`, `rows_read=889`, `rows_written=172`.
- Coverage: 15 distinct pages, 105 page-day snapshots, 67 pair rows, 88 successful-empty snapshots.
- Facts: 67 rows, 60 distinct queries, 4 distinct pages, 1 click, 79 impressions, 0 invalid rows.
- Health layer: `healthy`, 15 selected pages, 15 covered pages, 67 pair rows, maximum report date `2026-07-27`, expected frequency 168 hours.

## Deferred gates

The production dashboard was not deployed. Abbott release `10` was still `staging` with 30 covered dates and 150 coverage rows; the active pointer remained release `8`. The Abbott contract requires 210 dates, 1050 coverage rows, zero bad rows, comparison, validation, activation, and smoke before another dashboard deployment.

The proposed weekly cron was not installed. `03:20 UTC` is free, but the approved sequence requires a production SEO UI smoke before cron activation. After the Abbott gate passes:

1. deploy dashboard commit `833db89` through the existing rollback-capable release procedure;
2. verify one canonical pair renders as `Яндекс:` under the same normalized query;
3. verify the confirmed filter accepts Google or exact Webmaster pairs only;
4. verify Webmaster impressions remain sourced from `canonical_fact_webmaster_queries_daily`;
5. install only the reviewed `20 3 * * 1` query-page cron line with `--priority-limit 15`;
6. verify the first scheduled run against the same 15-page coverage and zero-bad-row gates.

Enhanced Export remains the historical-backfill and exact fallback path. No paid quota, secret change, historical backfill, Telegram send, or unrelated cron edit occurred.

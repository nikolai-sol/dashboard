# Task 1 root integration report

## Conflicts resolved and decisions

- Completed the interrupted merge of `codex/zaruku-correctness` in merge commit `ff2da77`.
  - `fetch_yandex_metrika_canonical.py`: retained Abbott's `METRIKA_PAGE_LIMIT` name for the request limit. Both sides used the same effective value, 10,000, and the Abbott name keeps the page fetcher and request limit on one contract.
  - Preserved the Abbott release scopes, segmented session integrity, visit-level collection, and all incoming Zaruku collector correctness files and tests.
- Merged `codex/zaruku-webmaster-latest-page-lag` in merge commit `5ea4b41`.
  - `fetch_yandex_webmaster_canonical.py`: preserved the incoming URL/page facts and latest-day HTTP 400 soft-lag behavior, while retaining the correctness branch's transactional query snapshot replacement and summary upsert. Page rows are still upserted, and query rows still delete/insert/summary-commit atomically.
  - `DASHBOARDS-MEMORY.md`: retained the expanded Zaruku canonical-source, returning-content, map, and GSC descriptions.
  - `PLATFORMS-ACCESS-MEMORY.md`: retained the incoming detailed collector/runtime records and the correctness branch's query-replacement, externally owned SEO OS, and manual AI/GEO boundaries. Added an explicit statement that repository merges do not deploy, run, backfill, or edit cron.
  - `dashboard-next`: kept the Abbott root branch gitlink (`05bc19c`) because the task brief limits work to the root repository and the nested repository already contained unrelated unresolved/dirty work. No nested-repository file was edited or discarded.

## RED command/output summary

All production changes below followed an observed RED failure first.

1. `python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical.YandexMetrikaReturningCanonicalTests.test_request_retries_503_and_honors_retry_after_without_real_sleep`
   - RED: 1 error; the first 503 escaped immediately as `requests.exceptions.HTTPError`.
2. `python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical.YandexMetrikaReturningCanonicalTests.test_exhausted_429_uses_finite_long_exponential_backoff_with_jitter`
   - RED: 1 failure; expected 8 attempts, observed the old 5 attempts and approximately 30-second retry schedule.
3. `python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical.YandexMetrikaReturningCanonicalTests.test_exhausted_retry_diagnostics_exclude_request_and_client_secrets`
   - RED: 1 failure; the exception and request event exposed the counter ID, date, and secret-bearing URL.
4. `python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical.YandexMetrikaReturningCanonicalTests.test_request_honors_retry_after_http_date`
   - RED: 1 failure; an RFC HTTP-date header produced a 5-second wait instead of at least 50 seconds.
5. `python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical.YandexMetrikaReturningCanonicalTests.test_exhausted_retry_marks_run_failed_without_partial_writes`
   - RED: 1 failure; the first day's rows were written before the second day's exhausted retry.
6. `python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical.YandexMetrikaReturningCanonicalTests.test_transport_failure_is_sanitized_before_collector_telemetry`
   - RED: 1 failure; a raw `ConnectionError` containing the request URL escaped.
7. `python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical.YandexMetrikaReturningCanonicalTests.test_success_output_and_events_do_not_log_client_counter_ids`
   - RED: 1 failure; the success JSON included `account_ids`.

Each test passed immediately after its corresponding minimal implementation step before the next RED cycle began.

## Implementation summary

- Retryable responses are HTTP 429 and HTTP 5xx.
- Retry policy is finite and deterministic under patched sleeps:
  - 8 maximum attempts;
  - 5-second initial exponential delay;
  - 60-second per-delay exponential cap;
  - 0–1 second jitter;
  - 300-second aggregate retry-delay cap.
  - With deterministic 0.5-second jitter and no `Retry-After`, the regression test observes waits of `5.5, 10.5, 20.5, 40.5, 60.5, 60.5, 60.5` seconds, totaling 257.5 seconds rather than the old approximately 30 seconds.
- `Retry-After` supports non-negative delta seconds and RFC HTTP dates. Invalid values safely fall back to exponential backoff.
- Added `MetrikaReturningRequestError`, whose message contains only status, attempts, and a rate-limited flag. Raw request/transport exceptions are not propagated into collector telemetry.
- Retry/exhaustion events contain only sanitized status, attempt, maximum-attempt, retry-delay, sleep-delay, and rate-limit metadata. They do not contain bodies, Authorization, OAuth tokens, request URLs, dates, offsets, or client counter IDs.
- Removed counter IDs from normal event messages and success JSON.
- Collection now normalizes all requested account/day pages before one upsert transaction. If any request exhausts, no rows are written and the existing `finish_run(..., "failed", ...)` path records a failed collector run for current health/summary alerting.
- Updated `ops/abbott-runtime-manifest.sha256` using the computed SHA-256 of the merged root `fetch_yandex_metrika_canonical.py`; no hash was manually invented.
- No production, database, credential, API, cron, Telegram, or deployment action occurred.

## Tests run

- Pre-first-merge focused collectors: 30 passed, 0 failed.
- Post-second-merge focused Zaruku root collectors: 27 passed, 0 failed.
- Final returning collector suite: 9 passed, 0 failed.
- Root runtime-manifest authority test: 1 passed, 0 failed.
- Complete root suite before root manifest synchronization: 311 passed, 7 failed.
- Complete root suite after commit `c1be2e1`: 312 passed, 6 failed, 1 environment warning.
  - Four remaining failures are `AbbottMysqlRehearsalContractTest` cases whose harness rejects the pre-existing dirty/uncommitted `dashboard-next/src/db/migrations/033_google_search_console_daily_canonical.sql` and `034_google_search_console_country_daily.sql` authority.
  - Two remaining failures are `AbbottRuntimeClosureTest` cases because the pre-existing nested `dashboard-next/reportingdash-canonical-bootstrap` copies and its manifest still describe the predecessor root collector.

## Commits

- Correctness merge: `ff2da77`
- Zaruku operational/returning merge: `5ea4b41`
- Returning retry implementation: `c1be2e1d3a7b8dac2c3705aee438f9039a767ced`
- The report itself is committed separately after recording the implementation commit above.

## Remaining concerns

- The complete root suite is not fully green because `dashboard-next` was already dirty and contains unresolved work outside this root-only task. Making the six remaining tests green requires the owner of that nested repository to commit/reconcile its migrations and synchronize its Abbott bootstrap copies/manifests with the merged root authorities.
- The production incident's precise Yandex rate-limit bucket remains unknowable after the fact; the new collector intentionally records only safe diagnostic metadata on future retries.
- No missed production range was replayed in this task, consistent with the prohibition on API, DB, deployment, and operational actions.

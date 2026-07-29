# Abbott Telegram Health Summary Clarity

## Goal

Make the Abbott section of the canonical Telegram summary explain the operational state without implying that stale or incomplete data is healthy.

## Output contract

- Lead with the overall Abbott status and active release.
- Label the collector entry as the **last successful release run** and mark it `STALE` when the health snapshot contains `latest_release_run_freshness`.
- Label coverage as the **last N completed days**, show the complete-day count, and show the shared missing date range once.
- Describe session integrity as applying only to available dates. Preserve the exact `all = with_id + without_id` evidence and mismatch counters.
- Label scope `rows` as technical persisted canonical rows, not business metrics.
- Aggregate identical `scope_date_coverage` incidents into one readable line listing the affected scopes and dates. Preserve other incident types individually.
- Write explanatory labels in Russian while preserving operational identifiers such as `Abbott`, `Metrika`, `User ID`, scope keys, release IDs, and UTC timestamps.
- Keep all output HTML-escaped and aggregate-only; do not add PII, secrets, API calls, database writes, Telegram sends, or dashboard reads from source APIs.

## Data and failure behavior

The formatter consumes the existing sanitized Abbott health snapshot. It must not reinterpret coverage as complete when any required scope is missing. Missing or malformed optional display fields render as `unknown`/`none`; health severity remains sourced from the probe.

## Verification

Regression tests cover a healthy snapshot, a stale incomplete snapshot matching the July incident, session mismatch output, incident aggregation, and HTML escaping. The existing health-probe and Telegram-report test suites must remain green.

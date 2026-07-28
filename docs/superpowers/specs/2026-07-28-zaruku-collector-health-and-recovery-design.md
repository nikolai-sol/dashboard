# Zaruku Collector Health and Recovery Design

## Status

Approved in conversation on 2026-07-28 with three required corrections:

1. collector health and completeness logic must use a source-neutral module name;
2. the TypeScript and Python lag thresholds must not drift silently;
3. the dashboard threshold must return to `3` before RD-11 is implemented.

This design covers RD-09's threshold correction, RD-10, RD-11, and the read-only preparation portion of RD-12. The production backfill remains explicitly out of scope until RD-10 is deployed, RD-11 is active, and a scheduled Webmaster cron completes successfully.

## Goals

- Set `ZARUKU_DATA_LAG_DAYS = 3` in the dashboard and move its tests to the `3/4` boundary.
- Restore the Yandex Webmaster page-fact writer before the next collector release.
- Add Zaruku daily collector reporting, lag alerts, heartbeat detection, and partial-date alerts to the existing Telegram sender.
- Define partial dates once through `ingestion_run_id -> canonical_collector_runs.status = 'failed'` and reuse that definition for both RD-11 and RD-12.
- Produce a read-only July backfill plan with affected dates, distinct-date counts, missing dates, provenance, retention checks, and no API or fact writes.

## Non-goals

- No production Webmaster backfill.
- No collector API call as part of implementation verification.
- No cron edit, Telegram send, database migration, or deployment without a separate operational gate.
- No date-transaction rewrite of the collectors. Transactional per-date writes are the long-term fix for partial dates, but are a separate task.
- No `first_ingestion_run_id` schema change. The write-once provenance column remains a later migration.

## Verified production facts

The following was verified read-only on 2026-07-28:

- `ingestion_run_id` exists in all relevant Zaruku fact tables:
  - `canonical_fact_site_analytics_daily`;
  - `canonical_fact_metrika_returning_pages_daily`;
  - `canonical_fact_gsc_queries_daily`;
  - `canonical_fact_webmaster_queries_daily`;
  - `canonical_fact_webmaster_summary_daily`;
  - `canonical_fact_webmaster_pages_daily`.
- GSC stores `ingestion_run_id` as `VARCHAR(64)`, unlike the numeric columns in the other tables. All 91,796 current GSC values are numeric and resolve to `canonical_collector_runs.id`; joins must nevertheless validate numeric strings before casting.
- No current Zaruku fact row has a null or orphaned run reference.
- Current failed-run lineage exists only in Webmaster facts:
  - queries: 755 rows across four dates, `2026-07-14..2026-07-17`;
  - pages: 942 rows across two dates, `2026-07-14` and `2026-07-16`;
  - summary: one row on `2026-07-14`;
  - union: four distinct affected dates.
- There is no MySQL event that deletes from `canonical_collector_runs`. Runs currently begin on 2026-03-15 while the oldest relevant facts begin on 2026-03-17, so current retention is compatible but not enforced as a policy.

## Delivery order and gates

1. Change the dashboard lag threshold to `3` and verify the `3/4` boundary.
2. Restore RD-10 page collection and verify it locally without an API call.
3. Implement RD-11 and its common health/completeness module.
4. Implement and run the RD-12 read-only planner and capture its aggregate provenance snapshot.
5. Stop. A production deploy, scheduled-run observation, and backfill require later operational approval in that order.

Steps 1 and 2 do not share code, but this implementation will execute them serially in one working tree to keep review and provenance simple.

## Architecture

### 1. Lag threshold parity

The dashboard remains the product-facing implementation:

```ts
export const ZARUKU_DATA_LAG_DAYS = 3;
```

The Python health module exports the same named integer. This is an intentional duplicate because the two runtimes and repositories do not share a build artifact. It is protected by a root Python test that reads the TypeScript declaration and fails when the values differ. The test error must name both values and both files.

This is the accepted low-cost alternative to a new database/config authority. A silent duplicate is forbidden.

`expected_frequency_hours` remains separate:

- `ZARUKU_DATA_LAG_DAYS` answers whether facts are too old;
- `expected_frequency_hours` answers whether a scheduled collector run is missing.

All four Zaruku jobs are scheduled daily, so their heartbeat interval is `24` hours. The current dashboard metadata value `72` for GSC conflates source publication lag with schedule frequency and must be corrected to `24` as part of RD-11.

### 2. RD-10 page writer restoration

`fetch_yandex_webmaster_canonical.py` is the only active Webmaster fact writer. Its current checked-in/deployed form writes query and summary facts but does not write `canonical_fact_webmaster_pages_daily`. The previous deployed collector contained:

- page-query API request construction;
- page normalization;
- page upsert SQL;
- latest-day-not-ready handling;
- page row/event accounting.

RD-10 restores that behavior from the last known deployed implementation, preserving the current CLI and single-writer contract. Query, summary, and page facts must be attempted for every selected day. A latest-day page HTTP 400 may be recorded as the existing sanitized warning and skipped only for that latest day; other page failures still fail the run.

RD-10 does not claim end-to-end success until a separately authorized production run advances both query and page `max_data_date`. Local tests cover request construction, normalization, upsert selection, warning behavior, and row accounting without network or database writes.

### 3. Shared Zaruku health module

Create `zaruku_collector_health.py`. It owns source-neutral policy and read queries for the four Zaruku sources:

- Yandex Metrika, account `66624469`;
- Yandex Metrika returning content, account `66624469`;
- Yandex Webmaster, account `66624469`;
- Google Search Console, account `66624469`.

The module exposes focused interfaces:

```python
ZARUKU_DATA_LAG_DAYS: int
ZARUKU_SOURCES: Dict[str, Dict]

def load_zaruku_health(cursor, now_utc: datetime) -> List[Dict]: ...
def load_partial_fact_dates(cursor) -> List[Dict]: ...
def build_partial_date_scope(rows: List[Dict]) -> Dict: ...
def build_zaruku_incidents(health: List[Dict], partial_scope: Dict, now_utc: datetime) -> List[Dict]: ...
```

Each source configuration declares its run `source_key`, label, expected frequency, fact layers, account predicate, and max-date query. Webmaster exposes query/page dates separately and uses the older of the two as the source-level freshness date. A query/page difference greater than one day produces its own integrity incident.

The shared partial-date query is a single `UNION ALL` across configured fact layers. Every branch returns the same shape:

```text
source_key, layer, report_date, ingestion_run_id, run_type, run_status, row_count
```

The defining predicate is always:

```sql
JOIN canonical_collector_runs r ON r.id = f.ingestion_run_id
WHERE r.status = 'failed'
```

GSC is the only special join: it first requires `ingestion_run_id REGEXP '^[0-9]+$'` and then casts to `UNSIGNED`. The predicate still means the same thing.

`rows_read > rows_written` is never used as a completeness signal because healthy Webmaster runs exhibit the same difference.

### 4. RD-11 Telegram integration

Extend the existing `send_canonical_telegram_report.py`; do not create a second bot or transport.

The existing summary mode loads the shared Zaruku health snapshot and builds:

1. one always-present Zaruku subsection with latest run status, written rows, `max_data_date`, and calendar lag for all four sources;
2. a partial-date summary line only when the shared scope is non-empty;
3. separate incident messages for lag, heartbeat, page/query divergence, and newly observed partial dates.

Heartbeat uses the age of the latest run row compared with `expected_frequency_hours`. It does not use fact age. A run with `failed` status is a run failure, not a heartbeat miss; heartbeat means that the expected run row is absent.

Lag uses source `max_data_date` and fires only when age is greater than `ZARUKU_DATA_LAG_DAYS`.

Partial-date incidents use the exact same rows returned to the RD-12 planner. The message includes affected dates and row counts by layer. The wording states that the data is marked incomplete and requires a catch-up; it does not assert that every stored value is wrong.

Incident deduplication uses stable keys of the form:

```text
zaruku|YYYY-MM-DD|source_key|incident_type|scope_fingerprint
```

A small JSON state file in the canonical runtime stores only sent keys and timestamps. It is updated atomically only after Telegram confirms success and retains a bounded recent window. Tests inject a temporary path. The daily summary itself is not deduplicated because it is intentionally always sent.

No production Telegram message is sent during implementation verification.

### 5. RD-12 read-only planner

Create `plan_zaruku_webmaster_backfill.py`, which imports `load_partial_fact_dates` and `build_partial_date_scope` from `zaruku_collector_health.py`. It must not duplicate the failed-run SQL.

Inputs:

- explicit `--date-from` and `--date-to`;
- default output is human-readable;
- `--json` produces deterministic machine-readable output.

Output includes:

- partial dates by layer;
- `COUNT(DISTINCT report_date)` by layer and union;
- dates missing from query facts;
- dates missing from page facts;
- the ordered union that a future backfill may target;
- aggregate provenance rows grouped by layer, date, ingestion run, run type, run status, and first/last creation timestamp;
- null/orphan lineage counts;
- collector-run and fact retention bounds.

The planner makes only `SELECT` statements. The aggregate JSON output is the read-only provenance snapshot for this stage. The future pre-backfill database snapshot remains a required write gate immediately before the actual backfill.

The planner does not invoke `fetch_yandex_webmaster_canonical.py` and does not offer an execution flag.

## Error handling

- A malformed or unresolved GSC run identifier is reported as a lineage integrity problem and never coerced to run `0`.
- Missing fact tables fail the health collection visibly; they are not treated as empty healthy layers.
- An absent run produces a heartbeat incident after the configured interval.
- An absent fact date produces a freshness incident, not a fabricated lag value.
- Telegram transport failures do not record deduplication state and continue to sanitize tokens and remote response text.
- The RD-12 planner exits non-zero on invalid date ranges, orphan lineage, or inconsistent source configuration.
- No alerting path mutates fact tables or collector runs.

## Testing strategy

Implementation follows red-green-refactor.

### Dashboard

- age `3` days is healthy;
- age `4` days is delayed;
- a newer failed cron remains failed even at age `3`;
- GSC `expected_frequency_hours` is `24` while its product lag uses `3`.

### Webmaster collector

- URL/page API request uses the correct indicator and pagination;
- page normalization and deterministic hash match the canonical business key;
- page rows are included in run accounting;
- latest-day-not-ready is a warning/skip only for the latest day;
- non-latest page errors fail the run;
- the single-writer tests continue to reject the legacy JavaScript writer.

### Shared health module

- Python and TypeScript lag constants match;
- all configured source layers participate in the generated partial-date SQL;
- GSC validates and casts string run IDs safely;
- failed lineage produces distinct dates and counts;
- successful lineage is excluded;
- heartbeat and fact lag are independent;
- page/query divergence over one day produces an incident;
- incident keys are stable and source/day scoped.

### Telegram sender

- daily Zaruku summary includes all four sources in stable order;
- lag, heartbeat, divergence, and partial messages use sanitized Russian copy;
- duplicate incident keys are not resent;
- failed sends do not advance state;
- existing Abbott and canonical summary tests remain unchanged and passing.

### RD-12 planner

- partial scope is the same object returned by the shared module;
- missing and partial dates merge without duplication and sort oldest first;
- distinct-date counts are counts of dates, not rows;
- JSON snapshot is deterministic;
- database calls are `SELECT`-only;
- there is no backfill execution option.

## Acceptance criteria

1. Dashboard and Python both classify age `3` as current and age `4` as delayed, with an automated parity test between languages.
2. The checked-in Webmaster collector again contains and tests the page writer.
3. RD-11 reports all four Zaruku sources through the existing Telegram sender.
4. Heartbeat uses `expected_frequency_hours`; freshness uses `ZARUKU_DATA_LAG_DAYS`; neither substitutes for the other.
5. One shared failed-lineage query supplies both RD-11 partial alerts and RD-12 scope planning.
6. RD-12 reports four current unique affected Webmaster dates and layer-specific counts when run against the 2026-07-28 snapshot, subject to later data changes.
7. RD-12 produces provenance and retention evidence without writing to the database or calling Webmaster.
8. No production backfill occurs before RD-10 deployment, RD-11 activation, and a stable scheduled cron.

## Operational handoff gates

After code verification, the implementation stops and reports separately:

1. files and tests ready for review;
2. whether a deploy is requested;
3. whether the owner authorizes an end-to-end Webmaster run;
4. the first successful scheduled cron evidence;
5. only then, a proposed exact backfill date list and provenance snapshot for owner approval.

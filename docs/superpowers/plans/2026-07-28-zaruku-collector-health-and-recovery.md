# Zaruku Collector Health and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the Webmaster page writer, align the dashboard and alerts on a three-day lag policy, add four deterministic Zaruku collector signals, and produce a read-only July recovery scope.

**Architecture:** The dashboard and Python health runtime intentionally duplicate the integer lag constant, guarded by a cross-language parity test. `zaruku_collector_health.py` owns source catalog, lineage/completeness SQL, health normalization, and incident derivation; both Telegram reporting and the RD-12 planner consume that module. The Webmaster collector restores the previously deployed page API/normalization/upsert path without any production execution.

**Tech Stack:** Python 3.8-compatible stdlib + mysql-connector, existing unittest suite, TypeScript/Node test runner, MySQL canonical facts, existing Telegram sender.

## Global Constraints

- Work only on `codex/zaruku-product-readiness` in both repositories.
- `ZARUKU_DATA_LAG_DAYS = 3`; age 3 is healthy and age 4 is delayed.
- Preserve the newer-failed-cron precedence over otherwise healthy fact age.
- Heartbeat uses only `expected_frequency_hours`; product freshness never uses it.
- Do not run a collector, backfill, cron, deploy, migration, Telegram send, or Webmaster API request.
- RD-12 is SELECT-only and has no execution flag.
- GSC `ingestion_run_id` is `VARCHAR(64)` and must be validated before casting.
- Non-castable GSC IDs and orphaned run references are lineage defects, not partial dates.
- Partial dates are defined only by fact rows whose resolved run has `status = 'failed'`.

---

### Task 1: Set and lock the 3-day lag boundary

**Files:**
- Modify: `dashboard-next/src/lib/zaruku-seo.test.ts`
- Modify: `dashboard-next/src/lib/zaruku-seo.ts`

**Interfaces:**
- Produces: exported TypeScript constant `ZARUKU_DATA_LAG_DAYS = 3`.
- Preserves: `normalizeSourceFreshnessRow(row, now)` and failed-run precedence.

- [ ] **Step 1: Change tests to the 3/4 boundary before production code**

Rename the four-day healthy test to three days and set `success_date_to`/`now` so the calendar age is exactly 3. Replace the five-day delayed test with an exact age of 4. Keep the failed cron case and make its fact age exactly 3.

Add an assertion that the GSC catalog SQL carries `expected_frequency_hours = 24`, not 72.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd dashboard-next
node --import tsx --test src/lib/zaruku-seo.test.ts
```

Expected: the exact-four-day case remains healthy and/or GSC metadata remains 72, so the new assertions fail for the intended reasons.

- [ ] **Step 3: Make the minimal production change**

In `src/lib/zaruku-seo.ts`:

```ts
export const ZARUKU_DATA_LAG_DAYS = 3;
```

Set the GSC catalog `expected_frequency_hours` to `24`. Do not alter the condition:

```ts
successAgeDays > ZARUKU_DATA_LAG_DAYS
```

- [ ] **Step 4: Verify GREEN and the whole dashboard suite**

```bash
cd dashboard-next
node --import tsx --test src/lib/zaruku-seo.test.ts
npm test
```

Expected: focused tests pass and all 238+ tests pass.

- [ ] **Step 5: Commit the dashboard task**

```bash
git -C dashboard-next add src/lib/zaruku-seo.ts src/lib/zaruku-seo.test.ts
git -C dashboard-next commit -m "fix(zaruku): restore measured three-day lag threshold"
```

---

### Task 2: Restore the RD-10 Webmaster page writer

**Files:**
- Modify: `tests/test_fetch_yandex_webmaster_canonical.py`
- Modify: `fetch_yandex_webmaster_canonical.py`

**Interfaces:**
- Produces: `WEBMASTER_PAGE_UPSERT_SQL`, `normalize_query_analytics_url_rows`, `fetch_page_rows`, `is_latest_page_facts_lag_error`, and `upsert_webmaster_page_rows`.
- Preserves: CLI, query/summary writer, `run_type`, run accounting, and single-writer contract.

- [ ] **Step 1: Write failing page-writer tests**

Add tests that require:

```python
self.assertIn("canonical_fact_webmaster_pages_daily", WEBMASTER_PAGE_UPSERT_SQL)
self.assertEqual(row["page_url"], "https://zaruku.ru/help/")
self.assertEqual(row["page_hash"], hashlib.sha256(b"https://zaruku.ru/help/").hexdigest())
```

Mock `request_with_retry` and assert `fetch_page_rows` sends a POST to `query-analytics/list` with `text_indicator = "URL"`, requested day, `search_location`, and pagination.

Create HTTP 400 exceptions with response objects and assert `is_latest_page_facts_lag_error` is true only for the last selected day. Add a source-contract test that `collect` references page normalization/upsert and adds page rows to read/write accounting.

- [ ] **Step 2: Run the collector tests and verify RED**

```bash
python3 -m unittest -v tests.test_fetch_yandex_webmaster_canonical
```

Expected: imports/assertions fail because the current collector has no page writer.

- [ ] **Step 3: Restore the minimal previous implementation**

Port from `/var/www/dashboard-backups/20260728083338-eac2875-previous/fetch_yandex_webmaster_canonical.py`:

```python
WEBMASTER_PAGE_UPSERT_SQL = """INSERT INTO canonical_fact_webmaster_pages_daily (...) ..."""

def fetch_page_rows(access_token, user_id, host_id, day, device, run_id): ...
def is_latest_page_facts_lag_error(exc, day, selected_days): ...
def normalize_query_analytics_url_rows(payload, **context): ...
def upsert_webmaster_page_rows(rows): ...
```

In `collect`, fetch and normalize page rows per day, treat latest-day HTTP 400 as a warning/skip, include page rows in counters/events, and upsert them. Do not add a network probe or change cron/backfill behavior.

- [ ] **Step 4: Verify GREEN and regression contracts**

```bash
python3 -m unittest -v tests.test_fetch_yandex_webmaster_canonical
cd dashboard-next
node --import tsx --test src/lib/single-writer-contracts.test.ts scripts/collect-yandex-webmaster.test.ts
```

Expected: all focused tests pass; the legacy JavaScript writer remains a tombstone.

- [ ] **Step 5: Commit RD-10**

```bash
git add fetch_yandex_webmaster_canonical.py tests/test_fetch_yandex_webmaster_canonical.py
git commit -m "fix: restore Webmaster page fact writer"
```

---

### Task 3: Add shared Zaruku completeness and health logic

**Files:**
- Create: `tests/test_zaruku_collector_health.py`
- Create: `zaruku_collector_health.py`

**Interfaces:**
- Produces:
  - `ZARUKU_DATA_LAG_DAYS: int = 3`
  - `ZARUKU_SOURCES`
  - `PARTIAL_FACT_DATES_SQL`
  - `LINEAGE_DEFECTS_SQL`
  - `load_zaruku_health(cursor, now_utc)`
  - `load_partial_fact_dates(cursor)`
  - `load_lineage_defects(cursor)`
  - `build_partial_date_scope(rows)`
  - `build_zaruku_incidents(health, partial_scope, now_utc)`

- [ ] **Step 1: Write failing policy and SQL tests**

Tests must parse `dashboard-next/src/lib/zaruku-seo.ts` and compare its exported integer with Python `ZARUKU_DATA_LAG_DAYS`.

Assert the generated partial SQL includes all six fact layers, account `66624469`, `r.status = 'failed'`, and the GSC guard:

```sql
f.ingestion_run_id REGEXP '^[0-9]+$'
CAST(f.ingestion_run_id AS UNSIGNED)
```

Assert `LINEAGE_DEFECTS_SQL` separately counts non-castable GSC identifiers and unresolved run IDs.

- [ ] **Step 2: Write failing pure behavior tests**

Use dictionaries and fixed UTC datetimes to prove:

- age 3 produces no lag incident;
- age 4 produces a lag incident;
- a run older than its 24-hour expected frequency produces heartbeat;
- a current failed run is not mislabeled heartbeat;
- query/page divergence of two days produces integrity incident;
- partial scope counts distinct dates, rows, and layers;
- non-castable/orphan lineage is reported outside partial scope;
- incident keys are stable.

- [ ] **Step 3: Verify RED**

```bash
python3 -m unittest -v tests.test_zaruku_collector_health
```

Expected: module import fails because it does not exist.

- [ ] **Step 4: Implement the minimal module**

Use Python 3.8-compatible typing. The source catalog must set `expected_frequency_hours = 24` for all four sources. Compute source fact age from UTC calendar dates. Resolve Webmaster freshness from the older of query/page maxima and retain both layer dates.

Keep DB access cursor-injected; the module must not create connections or send messages.

- [ ] **Step 5: Verify GREEN**

```bash
python3 -m unittest -v tests.test_zaruku_collector_health
```

Expected: all policy, SQL, lineage, lag, heartbeat, divergence, and scope tests pass.

- [ ] **Step 6: Commit the shared module**

```bash
git add zaruku_collector_health.py tests/test_zaruku_collector_health.py
git commit -m "feat: add shared Zaruku collector health model"
```

---

### Task 4: Integrate the four RD-11 signals into the existing Telegram sender

**Files:**
- Modify: `tests/test_send_canonical_telegram_report.py`
- Modify: `send_canonical_telegram_report.py`

**Interfaces:**
- Consumes: health, partial scope, incidents, and source catalog from `zaruku_collector_health.py`.
- Produces: Zaruku summary lines, incident messages, stable JSON dedupe state.

- [ ] **Step 1: Write failing summary and message tests**

Add a fixed snapshot for four sources and assert the summary includes, in stable order:

```text
Яндекс Вебмастер
Яндекс Метрика
Метрика · возвратный контент
Google Search Console
```

Assert each line contains run status, rows, max data date, and lag. Assert partial dates appear only when non-empty.

Add exact behavior tests for lag, heartbeat, partial-date, and layer-divergence messages. Keep HTML escaping tests.

- [ ] **Step 2: Write failing dedupe tests**

With a temporary state path, prove a new incident is sendable once, a recorded incident is skipped, failed Telegram transport does not update state, and old keys are pruned.

- [ ] **Step 3: Verify RED**

```bash
python3 -m unittest -v tests.test_send_canonical_telegram_report
```

Expected: new imports/functions/assertions fail while legacy tests remain green.

- [ ] **Step 4: Implement the minimal integration**

Extend summary mode to load Zaruku health through the existing canonical DB connection. Append a `<b>Сбор Zaruku</b>` section. Send the daily summary first, then each new incident message; record a dedupe key only after the corresponding send succeeds.

Use an atomic temp-file replace for state. Never include tokens, raw SQL errors, or remote response bodies in user-facing messages.

- [ ] **Step 5: Verify GREEN and sender regressions**

```bash
python3 -m unittest -v tests.test_zaruku_collector_health tests.test_send_canonical_telegram_report
```

Expected: all tests pass without a real Telegram call.

- [ ] **Step 6: Commit RD-11**

```bash
git add send_canonical_telegram_report.py tests/test_send_canonical_telegram_report.py
git commit -m "feat: add Zaruku collector Telegram signals"
```

---

### Task 5: Add and run the RD-12 SELECT-only planner

**Files:**
- Create: `tests/test_plan_zaruku_webmaster_backfill.py`
- Create: `plan_zaruku_webmaster_backfill.py`
- Create after read-only execution: `docs/operations/zaruku-webmaster-provenance-2026-07-28.md`

**Interfaces:**
- Consumes: `load_partial_fact_dates` and `build_partial_date_scope` from the shared module.
- Produces: human/JSON backfill candidate plan; no execution interface.

- [ ] **Step 1: Write failing planner tests**

Test explicit date parsing, missing query/page date derivation, oldest-first union, distinct-date counts, deterministic provenance grouping, and JSON serialization. Inspect parser actions and assert there is no `--execute`, `--run`, or `--backfill` option.

Use a recording cursor and assert every executed SQL statement begins with `SELECT` or `WITH` after whitespace normalization.

- [ ] **Step 2: Verify RED**

```bash
python3 -m unittest -v tests.test_plan_zaruku_webmaster_backfill
```

Expected: module import fails because the planner does not exist.

- [ ] **Step 3: Implement the planner**

Provide:

```text
--date-from YYYY-MM-DD
--date-to YYYY-MM-DD
--json
```

Require both dates, reject inverted/future ranges, query partial/missing/provenance/retention evidence, and return non-zero if lineage defects exist. Do not import or invoke the Webmaster collector.

- [ ] **Step 4: Verify GREEN**

```bash
python3 -m unittest -v tests.test_plan_zaruku_webmaster_backfill
```

- [ ] **Step 5: Run the read-only production calculation**

Run locally against the configured reporting DB:

```bash
python3 plan_zaruku_webmaster_backfill.py \
  --date-from 2026-07-01 \
  --date-to 2026-07-27 \
  --json
```

Expected: only SELECT queries; output includes layer counts, union date list, provenance, lineage defects, and retention bounds. No fact/run row counts change.

- [ ] **Step 6: Capture the aggregate evidence**

Create the Markdown evidence file from the verified JSON using `apply_patch`. Include query/page/summary distinct-date counts, the union, missing dates, run IDs/types/statuses, lineage defect counts, and retention bounds. Do not include credentials or raw fact rows.

- [ ] **Step 7: Commit RD-12 read-only tooling**

```bash
git add plan_zaruku_webmaster_backfill.py tests/test_plan_zaruku_webmaster_backfill.py docs/operations/zaruku-webmaster-provenance-2026-07-28.md
git commit -m "feat: add read-only Zaruku backfill planner"
```

---

### Task 6: Full verification, memory, and Notion evidence

**Files:**
- Modify: `dashboard-next/AGENTS.md`
- Modify: `dashboard-next/PLATFORMS-ACCESS-MEMORY.md`
- Modify: root submodule pointer for `dashboard-next`

**Interfaces:**
- Produces: durable operational truth and task evidence; no production state changes.

- [ ] **Step 1: Run dashboard verification**

```bash
cd dashboard-next
npm run ci:verify
```

Expected: exit 0; existing allowed warnings are documented, no errors.

- [ ] **Step 2: Run focused root suites**

```bash
python3 -m unittest -v \
  tests.test_fetch_yandex_webmaster_canonical \
  tests.test_zaruku_collector_health \
  tests.test_send_canonical_telegram_report \
  tests.test_plan_zaruku_webmaster_backfill
```

Expected: all pass.

- [ ] **Step 3: Run the full root suite with a bounded timeout**

```bash
python3 -m unittest discover -s tests -v
```

Record pre-existing unrelated failures/hangs separately. No new failure may originate in modified/new files.

- [ ] **Step 4: Update durable project memory**

Record threshold `3`, GSC expected frequency `24`, restored page writer status, shared health module, exact RD-12 read-only counts, and the explicit no-deploy/no-backfill state. Remove stale statements that still claim lag `4` or a missing page writer after the code restoration.

- [ ] **Step 5: Update Notion**

In `ReportingDash — Source of Truth`, update RD-02/RD-09/RD-10/RD-11/RD-12 with commit IDs, tests, read-only evidence, and remaining operational gates. Do not mark RD-10 operationally complete until an authorized end-to-end run advances both layers. Do not mark RD-12 backfill complete.

- [ ] **Step 6: Commit memory and root pointer**

```bash
git add dashboard-next AGENTS.md PLATFORMS-ACCESS-MEMORY.md
git commit -m "docs: record Zaruku collector health readiness"
```

- [ ] **Step 7: Verify clean branches**

```bash
git status --short
git -C dashboard-next status --short
git log -1 --oneline
git -C dashboard-next log -1 --oneline
```

Expected: both worktrees are clean on `codex/zaruku-product-readiness`.

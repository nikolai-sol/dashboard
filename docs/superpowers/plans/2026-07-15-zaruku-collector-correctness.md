# Zaruku Collector Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Webmaster daily query facts replace stale snapshots atomically and add a canonical Metrika entry-page scope with real visit metrics for Zaruku content reporting.

**Architecture:** Webmaster writes one account/date/device snapshot in a single transaction: delete the old query grain, insert the complete current query set, and upsert its summary. Metrika keeps pageview-scope rows unchanged and adds a separate session-scope `entry_page` dataset based on `ym:s:startURL`, because pageview dimensions cannot provide visit metrics.

**Tech Stack:** Python 3.9+, mysql-connector-python, unittest/pytest, Yandex Webmaster API v4, Yandex Metrika Reporting API.

## Global Constraints

- Write tests first and observe the expected failure before modifying production code.
- Do not mutate production data, cron, credentials, or remote deployment state during implementation.
- Preserve existing `page`, `other`, `traffic`, and `goal` canonical grains.
- Never synthesize visits from users or pageviews.
- Webmaster replacement grain is exactly `source_key + analytics_account_id + host_id + report_date + device_type`.
- A failed Webmaster replacement must roll back both deletion and inserts.
- The new Metrika storage scope is exactly `entry_page`; its logical scope is exactly `entry_pages`.

---

### Task 1: Atomic Webmaster snapshot replacement

**Files:**
- Modify: `fetch_yandex_webmaster_canonical.py`
- Test: `tests/test_fetch_yandex_webmaster_canonical.py`

**Interfaces:**
- Consumes: normalized query rows plus one summary row for the same snapshot grain.
- Produces: `replace_webmaster_day_rows(query_rows: list[dict], summary_row: dict) -> int`.

- [ ] **Step 1: Write failing transaction tests**

Add fake connection/cursor objects and tests proving that `replace_webmaster_day_rows` executes a scoped delete before inserts, commits once, supports an empty query list, and rolls back on insert failure. Assert the delete parameters are:

```python
(
    summary_row["source_key"],
    summary_row["analytics_account_id"],
    summary_row["host_id"],
    summary_row["report_date"],
    summary_row["device_type"],
)
```

- [ ] **Step 2: Verify the new tests fail**

Run: `python3 -m pytest tests/test_fetch_yandex_webmaster_canonical.py -q`

Expected: FAIL because `replace_webmaster_day_rows` does not exist.

- [ ] **Step 3: Implement transactional replacement**

Add a parameterized `WEBMASTER_QUERY_SNAPSHOT_DELETE_SQL`. Implement the function with one connection and cursor, delete the snapshot, conditionally `executemany` query rows, execute the summary upsert, then commit. On any exception call `rollback()` and re-raise; always close cursor and connection. Return `len(query_rows) + 1`.

- [ ] **Step 4: Use replacement in collection flow**

Replace the two independent calls in `collect()` with:

```python
rows_written += replace_webmaster_day_rows(query_rows, summary_row)
```

- [ ] **Step 5: Verify tests**

Run: `python3 -m pytest tests/test_fetch_yandex_webmaster_canonical.py -q`

Expected: all Webmaster tests pass.

- [ ] **Step 6: Commit**

```bash
git add fetch_yandex_webmaster_canonical.py tests/test_fetch_yandex_webmaster_canonical.py
git commit -m "fix: replace webmaster daily query snapshots"
```

### Task 2: Canonical Metrika entry-page visits

**Files:**
- Modify: `fetch_yandex_metrika_canonical.py`
- Create: `tests/test_fetch_yandex_metrika_canonical.py`

**Interfaces:**
- Consumes: one-day Metrika response using `ym:s:startURL` and session metrics.
- Produces: canonical rows at `analytics_scope='entry_page'` with URL, visits, users, pageviews, bounce rate, duration, and depth.

- [ ] **Step 1: Write failing normalization tests**

Test `build_entry_page_rows` with a response containing one `ym:s:startURL` dimension and metrics in this order:

```python
[
    12,  # visits
    9,   # users
    20,  # pageviews
    25.5,  # bounce rate
    91.0,  # average duration seconds
    2.4,  # page depth
]
```

Assert exact scope, URL, metrics, run id, and deterministic scope hash. Also test empty URL rows are skipped.

- [ ] **Step 2: Verify normalization tests fail**

Run: `python3 -m pytest tests/test_fetch_yandex_metrika_canonical.py -q`

Expected: FAIL because the entry-page constants/function do not exist.

- [ ] **Step 3: Add entry-page request and normalizer**

Define:

```python
ENTRY_PAGES_SCOPE_LOGICAL = "entry_pages"
ENTRY_PAGES_SCOPE_STORAGE = "entry_page"
METRIKA_ENTRY_PAGES_DIMS = "ym:s:startURL"
METRIKA_ENTRY_PAGES_METRICS = ",".join([
    "ym:s:visits",
    "ym:s:users",
    "ym:s:pageviews",
    "ym:s:bounceRate",
    "ym:s:avgVisitDurationSeconds",
    "ym:s:pageDepth",
])
```

`build_entry_page_rows` must map metrics by this exact order and set `page_title` to `None`.

- [ ] **Step 4: Write failing payload integration test**

Patch `request_with_retry` to return deterministic responses by dimensions. Assert `build_payload` makes the entry-page request and includes normalized rows in `entry_page_rows` and `facts`.

- [ ] **Step 5: Verify the payload test fails**

Run: `python3 -m pytest tests/test_fetch_yandex_metrika_canonical.py -q`

Expected: FAIL because `build_payload` has not wired the new response.

- [ ] **Step 6: Wire entry-page rows through the collector**

Fetch the new response for each counter/day, increment `rows_read`, normalize it, include it in empty-response detection and `facts`, and record its row count/grain in the collector summary event.

- [ ] **Step 7: Extend scoped replacement cleanup**

Add `entry_page` to `delete_existing_scope_rows` so a date/counter rerun replaces the full scope. Keep the existing counter filter.

- [ ] **Step 8: Verify collector tests**

Run: `python3 -m pytest -q`

Expected: all collector tests pass.

- [ ] **Step 9: Commit**

```bash
git add fetch_yandex_metrika_canonical.py tests/test_fetch_yandex_metrika_canonical.py
git commit -m "feat: collect canonical metrika entry pages"
```

### Task 3: Operational documentation for the new grains

**Files:**
- Modify: `CANONICAL-ENTITIES-MEMORY.md`
- Modify: `PLATFORMS-ACCESS-MEMORY.md`

**Interfaces:**
- Consumes: final collector behavior from Tasks 1–2.
- Produces: operational source-of-truth documentation for deploy and incident diagnosis.

- [ ] **Step 1: Update canonical entity documentation**

Document `entry_page` as date + counter + start URL session-scope facts and state that `page` remains pageview-scope. Document Webmaster daily queries as transactional replacement snapshots.

- [ ] **Step 2: Update collector and cron documentation**

Record the verified Metrika `06:12` and Webmaster `06:50` schedules, four-day Webmaster window, external SEO OS ownership, manual AI/GEO status, and absent GSC automation. Do not include credentials.

- [ ] **Step 3: Verify documentation and tests**

Run:

```bash
rg -n "entry_page|transactional replacement|06:12|06:50|Google Search Console" CANONICAL-ENTITIES-MEMORY.md PLATFORMS-ACCESS-MEMORY.md
python3 -m pytest -q
```

Expected: documentation terms are present and all tests pass.

- [ ] **Step 4: Commit**

```bash
git add CANONICAL-ENTITIES-MEMORY.md PLATFORMS-ACCESS-MEMORY.md
git commit -m "docs: record zaruku seo collector contracts"
```

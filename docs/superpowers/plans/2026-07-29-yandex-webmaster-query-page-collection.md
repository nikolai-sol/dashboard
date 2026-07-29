# Yandex Webmaster Query-to-Page Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free, source-confirmed Yandex Webmaster `query -> page` links for 15–30 priority Zaruku pages without inferring relationships from separate query/page totals.

**Architecture:** First run one controlled `query-analytics/list` probe with `text_indicator = QUERY` and an exact `URL` filter, then compare its same-day query metrics with the already proven Enhanced Export artifact. Only an exact gate pass unlocks a weekly collector, a separate canonical pair-grain table and dashboard join; Enhanced Export remains the historical-backfill path and exact fallback.

**Tech Stack:** Python 3.8, Yandex Webmaster API, MySQL 8, Next.js/React/TypeScript, Node test runner, pytest/unittest, system cron in UTC.

**Notion:** [ReportingDash — Source of Truth / Yandex Webmaster query→page plan](https://app.notion.com/p/3ac7f8d546908145bd27ce6520f473a0)

## Global Constraints

- External source APIs are collector-only; dashboard request, render, filter, export and read-model code read canonical MySQL only.
- Never join `canonical_fact_webmaster_queries_daily` to `canonical_fact_webmaster_pages_daily` to manufacture a pair.
- Never treat `popular_complementary_indicator` or SEO OS `matched_url` as an observed Yandex landing.
- Use only the existing Yandex Webmaster OAuth and host access. Never print, persist in logs or copy OAuth tokens.
- The standard-API path is blocked until the probe matches Enhanced Export for the same exact URL and date.
- The probe target is the already verified base-quota sample: `/rak-molochnoj-zhelezy/nuzhno-li-sohranyat-molochnuyu-zhelezu-pri-rake/`, `2026-07-22`, task `26224340-8a5c-11f1-b8b7-21c9fbaae2a2`, 152 rows, 13 clicks and 191 impressions.
- Do not create another Enhanced Export task while the existing artifact can be downloaded. If recreation becomes unavoidable, use exactly one URL-day with `use_pro_tariff = false` and stop before any paid quota.
- Initial weekly scope is the 15 current distinct Zaruku sections from `seo_section_patterns`; the collector must never silently exceed 30 normalized URLs.
- A successful-empty page collection writes canonical coverage with `row_count = 0`; a failed request writes no coverage and remains visible in run/request logs.
- Existing daily Webmaster query, page and summary collection, their date rules and all other source periods remain unchanged.
- Historical collection older than the standard API's two-week window is out of the weekly path; use Enhanced Export through a separately reviewed backfill run.
- Implement in isolated `codex/` worktrees. Do not modify or merge the active Abbott backfill checkout.
- No migration, source API call, cron edit, deployment or backfill is authorized merely by executing local coding tasks; each operational action remains a separately reviewed gate.

---

## File Map

- `/Users/nafanya/ReportingDash/probe_yandex_webmaster_query_page.py` — one-shot, sanitized comparison of standard Query Analytics against an Enhanced Export CSV.
- `/Users/nafanya/ReportingDash/tests/test_probe_yandex_webmaster_query_page.py` — request-body, normalization and strict comparison tests for the probe.
- `/Users/nafanya/ReportingDash/fetch_yandex_webmaster_canonical.py` — weekly pair collection, deterministic priority selection and snapshot writes.
- `/Users/nafanya/ReportingDash/tests/test_fetch_yandex_webmaster_canonical.py` — collector request, pagination, normalization, coverage and transaction tests.
- `src/db/migrations/045_yandex_webmaster_query_pages_daily.sql` — pair facts and successful coverage tables.
- `src/db/yandex-webmaster-query-page-migration.test.ts` — migration contract test.
- `src/lib/types.ts` — canonical read-model types for Webmaster pair rows.
- `src/lib/zaruku-yandex-webmaster.ts` — weekly canonical pair query and fail-closed availability.
- `src/lib/zaruku-yandex-webmaster.test.ts` — SQL, normalization and partial-source tests.
- `src/components/zaruku-seo-workspace.ts` — exact normalized-query attachment of Yandex URLs without changing Webmaster totals.
- `src/components/zaruku-seo-workspace.test.ts` — deduplication and confirmed-landing filter tests.
- `src/components/ZarukuSeoDashboard.tsx` — selected-week pair rows passed into the unified workspace.
- `src/components/ZarukuSeoQueryComparison.tsx` — `Яндекс:` links and truthful explanatory copy.
- `src/components/ZarukuSeoQueryComparison.test.ts` and `src/components/ZarukuSeoDashboard.ui.test.ts` — presentation regression tests.
- `/Users/nafanya/ReportingDash/zaruku_collector_health.py` and `/Users/nafanya/ReportingDash/tests/test_zaruku_collector_health.py` — weekly freshness and coverage diagnostics.
- `/Users/nafanya/ReportingDash/AGENTS.md`, `/Users/nafanya/ReportingDash/DASHBOARDS-MEMORY.md`, `AGENTS.md`, `DASHBOARDS-MEMORY.md`, `PLATFORMS-ACCESS-MEMORY.md` — verified runtime contract and rollout evidence.

### Task 1: Build and run the controlled standard-API probe

**Files:**
- Create: `/Users/nafanya/ReportingDash/probe_yandex_webmaster_query_page.py`
- Create: `/Users/nafanya/ReportingDash/tests/test_probe_yandex_webmaster_query_page.py`
- Read: `docs/superpowers/reports/2026-07-28-rd06-rd08-operational-verification.md`

**Interfaces:**
- Consumes: `request_with_retry`, `refresh_access_token`, `get_user_id`, `discover_host_id`, `DEFAULT_SEARCH_LOCATION` and text cleaning from `/Users/nafanya/ReportingDash/fetch_yandex_webmaster_canonical.py`.
- Produces: `build_query_page_probe_body(page_url: str, report_date: str, offset: int) -> dict`, `normalize_query_analytics_query_rows(payload: dict, report_date: str, page_url: str) -> list[dict]`, `compare_query_page_rows(standard_rows: list[dict], export_rows: list[dict]) -> dict` and sanitized JSON with `gate = pass|fail`.

- [ ] **Step 1: Write failing request and comparison tests**

```python
import unittest

from probe_yandex_webmaster_query_page import (
    build_query_page_probe_body,
    compare_query_page_rows,
    normalize_query_analytics_query_rows,
)


class QueryPageProbeTest(unittest.TestCase):
    def test_body_requests_queries_for_one_exact_url(self):
        body = build_query_page_probe_body("/article/", "2026-07-22", 0)
        self.assertEqual(body["text_indicator"], "QUERY")
        self.assertEqual(body["sort_by_date"]["date"], "2026-07-22")
        self.assertEqual(body["filters"]["text_filters"], [{
            "text_indicator": "URL",
            "operation": "TEXT_MATCH",
            "value": "/article/",
        }])
        self.assertEqual(body["limit"], 500)

    def test_normalizer_uses_primary_query_and_requested_page(self):
        payload = {"text_indicator_to_statistics": [{
            "text_indicator": {"type": "QUERY", "value": " Рак  груди "},
            "popular_complementary_indicator": {"type": "URL", "value": "/wrong/"},
            "statistics": [
                {"date": "2026-07-22", "field": "IMPRESSIONS", "value": 9},
                {"date": "2026-07-22", "field": "CLICKS", "value": 2},
            ],
        }]}
        self.assertEqual(normalize_query_analytics_query_rows(payload, "2026-07-22", "/article/"), [{
            "query": "рак груди",
            "page": "/article/",
            "clicks": 2,
            "impressions": 9,
        }])

    def test_gate_requires_exact_query_metrics_and_totals(self):
        standard = [{"query": "рак груди", "page": "/article/", "clicks": 2, "impressions": 9}]
        export = [{"query": "рак груди", "page": "/article/", "clicks": 2, "impressions": 9}]
        self.assertEqual(compare_query_page_rows(standard, export)["gate"], "pass")
        export[0]["impressions"] = 10
        self.assertEqual(compare_query_page_rows(standard, export)["gate"], "fail")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the probe tests and verify the red state**

Run: `python3 -m unittest tests.test_probe_yandex_webmaster_query_page -v`

Expected: `ModuleNotFoundError: No module named 'probe_yandex_webmaster_query_page'`.

- [ ] **Step 3: Implement the minimal request builder, normalizer and strict comparator**

```python
def normalize_query(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def build_query_page_probe_body(page_url: str, report_date: str, offset: int) -> dict:
    return {
        "offset": offset,
        "limit": 500,
        "device_type_indicator": "ALL",
        "search_location": DEFAULT_SEARCH_LOCATION,
        "text_indicator": "QUERY",
        "filters": {"text_filters": [{
            "text_indicator": "URL",
            "operation": "TEXT_MATCH",
            "value": page_url,
        }]},
        "sort_by_date": {
            "date": report_date,
            "statistic_field": "IMPRESSIONS",
            "by": "DESC",
        },
    }


def normalize_query_analytics_query_rows(payload: dict, report_date: str, page_url: str) -> list[dict]:
    rows = []
    for item in payload.get("text_indicator_to_statistics") or []:
        indicator = item.get("text_indicator") or {}
        query = normalize_query(indicator.get("value")) if indicator.get("type") == "QUERY" else ""
        metrics = _statistics_for_report_date(item, report_date)
        if query and metrics["seen"]:
            rows.append({
                "query": query,
                "page": page_url,
                "clicks": int(metrics["clicks"]),
                "impressions": int(metrics["impressions"]),
            })
    return rows


def compare_query_page_rows(standard_rows: list[dict], export_rows: list[dict]) -> dict:
    def signature(rows: list[dict]) -> dict[tuple[str, str], tuple[int, int]]:
        result: dict[tuple[str, str], tuple[int, int]] = {}
        for row in rows:
            key = (normalize_query(row["query"]), str(row["page"]).strip())
            clicks, impressions = result.get(key, (0, 0))
            result[key] = (clicks + int(row["clicks"]), impressions + int(row["impressions"]))
        return result
    standard_signature = signature(standard_rows)
    export_signature = signature(export_rows)
    return {
        "gate": "pass" if standard_signature == export_signature else "fail",
        "standard_rows": len(standard_signature),
        "export_rows": len(export_signature),
        "standard_clicks": sum(value[0] for value in standard_signature.values()),
        "export_clicks": sum(value[0] for value in export_signature.values()),
        "standard_impressions": sum(value[1] for value in standard_signature.values()),
        "export_impressions": sum(value[1] for value in export_signature.values()),
        "mismatch_count": len(set(standard_signature.items()) ^ set(export_signature.items())),
    }
```

The CLI must require `--enhanced-export-csv`, parse `query`, `path`, `clicks`, and `impressions`, paginate until `count`, and print only the comparison object plus SHA-256 hashes of the input/output artifacts. It must never print headers, token state or raw query rows.

- [ ] **Step 4: Run unit tests and lint the script**

Run: `python3 -m unittest tests.test_probe_yandex_webmaster_query_page tests.test_fetch_yandex_webmaster_canonical -v`

Expected: all tests pass.

- [ ] **Step 5: Run exactly one live standard-API probe and save sanitized evidence**

Run on the canonical collector host with the existing Enhanced Export CSV:

```bash
python3 probe_yandex_webmaster_query_page.py \
  --account-id 66624469 \
  --domain zaruku.ru \
  --page-url /rak-molochnoj-zhelezy/nuzhno-li-sohranyat-molochnuyu-zhelezu-pri-rake/ \
  --report-date 2026-07-22 \
  --enhanced-export-csv /root/reportingdash/evidence/26224340-8a5c-11f1-b8b7-21c9fbaae2a2.csv \
  > /root/reportingdash/evidence/wm-query-page-probe-20260729.json
```

Expected gate for continuing: `gate=pass`, `mismatch_count=0`, `standard_clicks=13`, `export_clicks=13`, `standard_impressions=191`, `export_impressions=191`. If any value differs, stop this plan after committing the failed sanitized evidence; Tasks 2–9 remain blocked and Enhanced Export is the only approved exact path.

- [ ] **Step 6: Commit the probe and evidence decision**

```bash
git add probe_yandex_webmaster_query_page.py tests/test_probe_yandex_webmaster_query_page.py docs/superpowers/reports/2026-07-29-yandex-webmaster-query-page-probe.md
git commit -m "test: verify Webmaster query page filter"
```

### Task 2: Add canonical pair and coverage tables after the probe passes

**Files:**
- Create: `src/db/migrations/045_yandex_webmaster_query_pages_daily.sql`
- Create: `src/db/yandex-webmaster-query-page-migration.test.ts`

**Interfaces:**
- Consumes: the Task 1 `gate=pass` evidence.
- Produces: `canonical_fact_webmaster_query_pages_daily` at account/host/day/device/query/page grain and `canonical_webmaster_query_page_coverage_daily` at account/host/day/device/page grain.

- [ ] **Step 1: Write a failing migration contract test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./migrations/045_yandex_webmaster_query_pages_daily.sql", import.meta.url), "utf8");

test("migration defines exact pair grain and successful empty coverage", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canonical_fact_webmaster_query_pages_daily/i);
  assert.match(sql, /UNIQUE KEY uniq_webmaster_query_pages_daily \(source_key, analytics_account_id, host_id, report_date, device_type, query_hash, page_hash\)/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canonical_webmaster_query_page_coverage_daily/i);
  assert.match(sql, /UNIQUE KEY uniq_webmaster_query_page_coverage_daily \(source_key, analytics_account_id, host_id, report_date, device_type, page_hash\)/i);
  assert.match(sql, /row_count INT UNSIGNED NOT NULL DEFAULT 0/i);
});
```

- [ ] **Step 2: Verify the migration test fails**

Run: `npm test -- src/db/yandex-webmaster-query-page-migration.test.ts`

Expected: failure because migration `045` does not exist.

- [ ] **Step 3: Create the two canonical tables**

```sql
CREATE TABLE IF NOT EXISTS canonical_fact_webmaster_query_pages_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_webmaster',
  analytics_account_id VARCHAR(128) NOT NULL,
  host_id VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  query_hash CHAR(64) NOT NULL,
  page_hash CHAR(64) NOT NULL,
  query_text TEXT NOT NULL,
  page_url TEXT NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr DECIMAL(18,6) DEFAULT NULL,
  average_position DECIMAL(18,6) DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_webmaster_query_pages_daily (source_key, analytics_account_id, host_id, report_date, device_type, query_hash, page_hash),
  KEY idx_webmaster_query_pages_daily_account_date (analytics_account_id, report_date),
  KEY idx_webmaster_query_pages_daily_page_date (page_hash, report_date),
  KEY idx_webmaster_query_pages_daily_query_date (query_hash, report_date),
  KEY idx_webmaster_query_pages_daily_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical Yandex Webmaster exact query-page facts; grain: account x host x day x device x query x URL';

CREATE TABLE IF NOT EXISTS canonical_webmaster_query_page_coverage_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_webmaster',
  analytics_account_id VARCHAR(128) NOT NULL,
  host_id VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  page_hash CHAR(64) NOT NULL,
  page_url TEXT NOT NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_webmaster_query_page_coverage_daily (source_key, analytics_account_id, host_id, report_date, device_type, page_hash),
  KEY idx_webmaster_query_page_coverage_account_date (analytics_account_id, report_date),
  KEY idx_webmaster_query_page_coverage_run (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Successful Yandex Webmaster exact URL-filter coverage, including zero-row snapshots';
```

- [ ] **Step 4: Run the migration test**

Run: `npm test -- src/db/yandex-webmaster-query-page-migration.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/045_yandex_webmaster_query_pages_daily.sql src/db/yandex-webmaster-query-page-migration.test.ts
git commit -m "feat: add Webmaster query page canonical tables"
```

### Task 3: Implement atomic pair snapshots in the collector

**Files:**
- Modify: `/Users/nafanya/ReportingDash/fetch_yandex_webmaster_canonical.py:183-192,660-727,870-952`
- Modify: `/Users/nafanya/ReportingDash/tests/test_fetch_yandex_webmaster_canonical.py`

**Interfaces:**
- Consumes: canonical tables from Task 2 and the exact request contract proven in Task 1.
- Produces: `fetch_query_page_rows(...)`, `normalize_query_page_rows(...)`, `replace_webmaster_query_page_snapshot(rows, coverage) -> int`.

- [ ] **Step 1: Write failing collector tests**

Add tests that assert:

```python
def test_query_page_request_uses_query_primary_and_exact_url_filter(self):
    body = build_query_page_request_body("/article/", "2026-07-22", 0)
    self.assertEqual(body["text_indicator"], "QUERY")
    self.assertEqual(body["filters"]["text_filters"][0], {
        "text_indicator": "URL", "operation": "TEXT_MATCH", "value": "/article/",
    })

def test_query_page_normalizer_ignores_complementary_url(self):
    rows = normalize_query_page_rows(self.query_analytics_payload, page_url="/requested/", report_date="2026-07-22", source_key="yandex_webmaster", analytics_account_id="66624469", host_id="host", device_type="ALL", run_id=91)
    self.assertEqual(rows[0]["page_url"], "/requested/")
    self.assertEqual(rows[0]["query_text"], "рак груди")

def test_empty_success_replaces_stale_rows_and_writes_zero_coverage(self):
    written = replace_webmaster_query_page_snapshot([], self.zero_coverage)
    self.assertEqual(written, 1)
    self.connection.commit.assert_called_once()

def test_failed_insert_rolls_back_pair_and_coverage(self):
    self.cursor.executemany.side_effect = RuntimeError("insert failed")
    with self.assertRaisesRegex(RuntimeError, "insert failed"):
        replace_webmaster_query_page_snapshot(self.pair_rows, self.coverage)
    self.connection.rollback.assert_called_once()
```

- [ ] **Step 2: Run the focused tests and verify the red state**

Run: `python3 -m unittest tests.test_fetch_yandex_webmaster_canonical -v`

Expected: failures for the missing request builder, normalizer and snapshot writer.

- [ ] **Step 3: Implement pagination and normalization**

Use the Task 1 body exactly. `fetch_query_page_rows` posts to `/user/{user_id}/hosts/{quoted_host_id}/query-analytics/list`, advances `offset` by 500 and refuses an incomplete response when `count > fetched_rows`. Normalize only primary indicators of type `QUERY`, attach `page_url` from the request context, calculate hashes with the existing `query_hash` and `page_hash`, and retain the raw source row only in `raw_payload`.

```python
def normalize_query_page_rows(payload: dict, *, page_url: str, source_key: str, analytics_account_id: str, host_id: str, report_date: str, device_type: str, run_id: int) -> list[dict]:
    result = []
    for row in payload.get("text_indicator_to_statistics") or []:
        indicator = row.get("text_indicator") or {}
        query = clean_text(indicator.get("value")) if indicator.get("type") == "QUERY" else ""
        metrics = _statistics_for_report_date(row, report_date)
        if not query or not metrics["seen"]:
            continue
        result.append({
            "source_key": source_key,
            "analytics_account_id": analytics_account_id,
            "host_id": host_id,
            "report_date": report_date,
            "device_type": device_type,
            "query_hash": query_hash(query),
            "page_hash": page_hash(page_url),
            "query_text": query,
            "page_url": page_url,
            "impressions": safe_int(metrics["impressions"]),
            "clicks": safe_int(metrics["clicks"]),
            "ctr": metrics["ctr"],
            "average_position": metrics["average_position"],
            "raw_payload": json.dumps(row, ensure_ascii=False),
            "ingestion_run_id": run_id,
        })
    return result
```

- [ ] **Step 4: Implement one-transaction replacement**

For exactly one account/host/date/device/page snapshot: delete existing pair rows, insert the complete new set, then upsert coverage with `row_count = len(rows)`, all in one transaction. Roll back on any exception. Do not touch daily query/page/summary rows.

- [ ] **Step 5: Run tests**

Run: `python3 -m unittest tests.test_fetch_yandex_webmaster_canonical -v`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add fetch_yandex_webmaster_canonical.py tests/test_fetch_yandex_webmaster_canonical.py
git commit -m "feat: collect exact Webmaster query page facts"
```

### Task 4: Add deterministic 15–30 page weekly mode

**Files:**
- Modify: `/Users/nafanya/ReportingDash/fetch_yandex_webmaster_canonical.py:183-192,870-952`
- Modify: `/Users/nafanya/ReportingDash/tests/test_fetch_yandex_webmaster_canonical.py`

**Interfaces:**
- Consumes: Task 3 pair snapshot functions.
- Produces: `--layers core|query_pages` with default `core`, `load_priority_query_pages(account_id: str, limit: int = 30) -> list[str]`, and a separately schedulable weekly run.

- [ ] **Step 1: Write failing selection and isolation tests**

```python
def test_default_layer_remains_core(self):
    with patch("sys.argv", ["collector"]):
        self.assertEqual(parse_args().layers, "core")

def test_priority_pages_keep_active_sections_first_and_cap_at_30(self):
    pages = load_priority_query_pages("66624469", limit=30)
    self.assertEqual(pages[:15], self.active_sections)
    self.assertEqual(len(pages), 30)
    self.assertEqual(len(set(pages)), 30)

def test_query_pages_layer_does_not_call_core_fetchers(self):
    collect(self.query_page_args)
    self.fetch_query_rows.assert_not_called()
    self.fetch_page_rows.assert_not_called()
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `python3 -m unittest tests.test_fetch_yandex_webmaster_canonical -v`

Expected: missing `layers` and `load_priority_query_pages` failures.

- [ ] **Step 3: Add the explicit mode and deterministic SQL**

```python
parser.add_argument("--layers", default="core", choices=["core", "query_pages"])
parser.add_argument("--priority-limit", type=int, default=30)
```

`load_priority_query_pages` must:

1. select current `seo_section_patterns.section` for account `66624469`, ordered by `priority ASC, section ASC`, then keep the first occurrence of each normalized section;
2. normalize and deduplicate those current 15 URLs;
3. fill remaining slots from `canonical_fact_webmaster_pages_daily` for the latest complete ISO week, ordered by `SUM(impressions) DESC, SUM(clicks) DESC, page_url ASC`;
4. exclude already selected pages and stop at `min(max(limit, 15), 30)`.

Use this exact fill query after resolving the latest complete Sunday from canonical data:

```sql
SELECT page_url, SUM(impressions) AS impressions, SUM(clicks) AS clicks
FROM canonical_fact_webmaster_pages_daily
WHERE analytics_account_id = %s
  AND report_date BETWEEN %s AND %s
GROUP BY page_hash, page_url
ORDER BY impressions DESC, clicks DESC, page_url ASC
LIMIT 200
```

- [ ] **Step 4: Collect the latest seven collectable dates per selected page**

The weekly mode creates its own collector run with `run_mode = 'weekly'` and `job_key = 'yandex_webmaster:query_pages'`. It calls Task 3 once per selected page and date, writes coverage after every successful page response including empty responses, stops the run on the first failed page/date request, and records sanitized counts in collector events.

- [ ] **Step 5: Run collector tests**

Run: `python3 -m unittest tests.test_fetch_yandex_webmaster_canonical -v`

Expected: all tests pass and existing core tests remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add fetch_yandex_webmaster_canonical.py tests/test_fetch_yandex_webmaster_canonical.py
git commit -m "feat: schedule bounded Webmaster query page collection"
```

### Task 5: Expose weekly pair coverage in collector health

**Files:**
- Modify: `/Users/nafanya/ReportingDash/zaruku_collector_health.py`
- Modify: `/Users/nafanya/ReportingDash/tests/test_zaruku_collector_health.py`

**Interfaces:**
- Consumes: `canonical_webmaster_query_page_coverage_daily` from Task 2.
- Produces: optional `query_page_pairs` layer health with a 168-hour cadence, selected-page coverage count and zero-row success count.

- [ ] **Step 1: Write failing health tests**

Add fixtures proving that 15 covered pages and a successful run within 168 hours is healthy, 14/15 pages is incomplete, a zero-row covered page is successful-empty, and a failed run without coverage is failed rather than empty.

```python
self.assertEqual(report["sources"]["yandex_webmaster"]["layers"]["query_page_pairs"]["expected_frequency_hours"], 168)
self.assertEqual(report["sources"]["yandex_webmaster"]["layers"]["query_page_pairs"]["covered_pages"], 15)
self.assertEqual(report["sources"]["yandex_webmaster"]["layers"]["query_page_pairs"]["status"], "healthy")
```

- [ ] **Step 2: Run the health tests and verify failure**

Run: `python3 -m unittest tests.test_zaruku_collector_health -v`

Expected: missing `query_page_pairs` layer assertion failure.

- [ ] **Step 3: Add optional weekly health without changing daily source health**

Query coverage by the latest successful `canonical_collector_runs` row with `job_key = 'yandex_webmaster:query_pages'`. Report `selected_pages`, `covered_pages`, `zero_row_pages`, `max_report_date`, `last_success_at`, and `expected_frequency_hours = 168`. The layer is `unavailable` before the first rollout and must not downgrade the existing daily Webmaster source; after first activation it becomes `warning` when older than 192 hours or when `covered_pages < selected_pages`.

- [ ] **Step 4: Run health and Telegram regression tests**

Run: `python3 -m unittest tests.test_zaruku_collector_health tests.test_send_canonical_telegram_report -v`

Expected: all tests pass; existing daily Webmaster, GSC, Metrika and Direct statuses are unchanged.

- [ ] **Step 5: Commit**

```bash
git add zaruku_collector_health.py tests/test_zaruku_collector_health.py
git commit -m "feat: monitor weekly Webmaster query page coverage"
```

### Task 6: Add the canonical pair read model

**Files:**
- Modify: `src/lib/types.ts:880-930`
- Modify: `src/lib/zaruku-yandex-webmaster.ts:1-305`
- Modify: `src/lib/zaruku-yandex-webmaster.test.ts`

**Interfaces:**
- Consumes: `canonical_fact_webmaster_query_pages_daily` only.
- Produces: `ZarukuYandexWebmasterQueryPageRow`, `data_availability.query_pages`, `query_pages` and a fourth independent read query.

- [ ] **Step 1: Write failing read-model tests**

```ts
test("query-page SQL reads only exact canonical pairs", () => {
  const queries = buildWebmasterAccountQueries(["66624469"], { from: "2026-07-20", to: "2026-07-26" });
  assert.match(queries.query_pages.sql, /canonical_fact_webmaster_query_pages_daily/);
  assert.match(queries.query_pages.sql, /GROUP BY week_key, query_hash, query_text, page_hash, page_url, device_type/);
  assert.doesNotMatch(queries.query_pages.sql, /popular_query_text/);
});

test("pair failure is partial and never falls back to separate page rows", async () => {
  const data = await loadZarukuYandexWebmasterData(["66624469"], range, async (query) => {
    if (query.sql.includes("canonical_fact_webmaster_query_pages_daily")) throw new Error("missing pair table");
    return [];
  });
  assert.equal(data.data_availability.query_pages, false);
  assert.deepEqual(data.query_pages, []);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/lib/zaruku-yandex-webmaster.test.ts`

Expected: TypeScript/test failure because `query_pages` does not exist.

- [ ] **Step 3: Add the pair type and weekly SQL**

```ts
export interface ZarukuYandexWebmasterQueryPageRow {
  week: string;
  query_id: string;
  query: string;
  page_id: string;
  url: string;
  device: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
  week_from: string;
  week_to: string;
  is_partial_week: boolean;
}
```

Extend the query builder return key union to `"queries" | "pages" | "summary" | "query_pages"`. Aggregate pair metrics by ISO week and exact canonical query/page hashes. Load all four queries with `Promise.allSettled`; a pair-table failure sets only `data_availability.query_pages = false` and keeps existing source datasets available.

- [ ] **Step 4: Run focused and dependent tests**

Run: `npm test -- src/lib/zaruku-yandex-webmaster.test.ts src/lib/zaruku-seo.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/zaruku-yandex-webmaster.ts src/lib/zaruku-yandex-webmaster.test.ts
git commit -m "feat: read exact Webmaster query page facts"
```

### Task 7: Join Yandex pages into the existing query table

**Files:**
- Modify: `src/components/zaruku-seo-workspace.ts:1-365`
- Modify: `src/components/zaruku-seo-workspace.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx:660-715`
- Modify: `src/components/ZarukuSeoQueryComparison.tsx:145-330`
- Modify: `src/components/ZarukuSeoQueryComparison.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: selected-week `ZarukuYandexWebmasterQueryPageRow[]` from Task 6.
- Produces: `webmaster_pages: string[]` on `UnifiedSeoQueryRow`, source-labelled Yandex links and a two-source confirmed-landing filter.

- [ ] **Step 1: Write failing pure aggregation tests**

```ts
test("exact Webmaster pairs add Yandex pages without changing Webmaster metrics", () => {
  const [row] = buildUnifiedSeoQueryRows({
    gscRows: [],
    webmasterRows: [webmasterQuery({ query: "рак груди", impressions: 20 })],
    webmasterQueryPageRows: [webmasterPair({ query: " РАК  ГРУДИ ", url: "/article/", impressions: 7 })],
    seoOsRows: [],
  });
  assert.deepEqual(row.webmaster_pages, ["/article/"]);
  assert.equal(row.webmaster?.impressions, 20);
  assert.deepEqual(filterUnifiedSeoQueryRows([row], "confirmed_landing"), [row]);
});

test("representative-only Webmaster query is not a confirmed landing", () => {
  const rows = buildUnifiedSeoQueryRows({ gscRows: [], webmasterRows: [webmasterQuery()], webmasterQueryPageRows: [], seoOsRows: [] });
  assert.equal(filterUnifiedSeoQueryRows(rows, "confirmed_landing").length, 0);
});
```

- [ ] **Step 2: Run the workspace tests and verify failure**

Run: `npm test -- src/components/zaruku-seo-workspace.test.ts`

Expected: type failures for missing `webmasterQueryPageRows` and `webmaster_pages`.

- [ ] **Step 3: Attach pair URLs by the existing normalized query key**

Add `webmaster_pages: string[]` to public and mutable row types. Iterate `webmasterQueryPageRows` only to attach normalized, deduplicated URLs with the same bounded per-source cap as Google. Continue to derive Webmaster metrics exclusively from `webmasterRows`; pair metrics must not be summed into the displayed host-query totals.

```ts
if (filter === "confirmed_landing") {
  return rows.filter((row) => row.google_pages.length > 0 || row.webmaster_pages.length > 0);
}
```

- [ ] **Step 4: Select the pair week independently and render source-labelled links**

In `ZarukuSeoDashboard.tsx`, resolve `data.webmaster.query_pages` for the same displayed Webmaster week and pass the selected rows into `buildUnifiedSeoQueryRows`. In `ZarukuSeoQueryComparison.tsx`, render Yandex links as `<SafePageLink prefix="Яндекс: " ... />`, include them in search text, and replace the old Google-only explanation with:

```text
Подтверждённая посадочная берётся из строки query + page самого источника: Google Search Console или Яндекс Вебмастер. SEO OS и представительская страница Яндекса фильтр не подтверждают.
```

- [ ] **Step 5: Run component and UI tests**

Run: `npm test -- src/components/zaruku-seo-workspace.test.ts src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoDashboard.ui.test.ts`

Expected: all tests pass; the existing Google path and query-table ordering stay intact.

- [ ] **Step 6: Commit**

```bash
git add src/components/zaruku-seo-workspace.ts src/components/zaruku-seo-workspace.test.ts src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoQueryComparison.tsx src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: show confirmed Yandex query landings"
```

### Task 8: Verify, migrate, deploy and schedule the bounded weekly collector

**Files:**
- Read: `/Users/nafanya/ReportingDash/PLATFORMS-ACCESS-MEMORY.md`
- Read: `/Users/nafanya/ReportingDash/docs/superpowers/plans/2026-07-29-reportingdash-cron-rebalance.md`
- Create: `/Users/nafanya/ReportingDash/docs/superpowers/reports/2026-07-29-yandex-webmaster-query-page-rollout.md`

**Interfaces:**
- Consumes: all implementation commits and the Task 1 pass evidence.
- Produces: migration/deployment evidence, one 15-page manual collection, and an explicitly reviewed weekly UTC cron line.

- [ ] **Step 1: Run complete local verification in both isolated worktrees**

Root collector worktree:

```bash
python3 -m unittest tests.test_probe_yandex_webmaster_query_page tests.test_fetch_yandex_webmaster_canonical tests.test_zaruku_collector_health tests.test_send_canonical_telegram_report -v
```

Dashboard worktree:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: all tests, lint, typecheck and production build pass; only pre-existing documented lint warnings may remain.

- [ ] **Step 2: Review current UTC cron before proposing a slot**

Run read-only on the canonical host: `crontab -l`.

Proposed new line: `20 3 * * 1` (Monday 03:20 UTC) invoking `fetch_yandex_webmaster_canonical.py --account-id 66624469 --run-type cron --layers query_pages --priority-limit 15`. If the current cron inventory shows overlap at 03:20 UTC, stop and request a new slot; do not shift any existing job in this rollout.

- [ ] **Step 3: Apply migration 045 and verify empty state**

Run the repository's existing migration procedure, then execute read-only checks:

```sql
SHOW CREATE TABLE canonical_fact_webmaster_query_pages_daily;
SHOW CREATE TABLE canonical_webmaster_query_page_coverage_daily;
SELECT COUNT(*) AS pair_rows FROM canonical_fact_webmaster_query_pages_daily;
SELECT COUNT(*) AS coverage_rows FROM canonical_webmaster_query_page_coverage_daily;
```

Expected before collection: both counts are `0`; the unique keys exactly match Task 2.

- [ ] **Step 4: Deploy collector and app through their existing attested procedures**

Deploy the root collector first, verify its runtime manifest/commit, then deploy the dashboard. Do not edit secrets. Do not run historical backfill. Record both immutable runtime identifiers in the rollout report.

- [ ] **Step 5: Run one manual 15-page collection and verify canonical truth**

```bash
python3 fetch_yandex_webmaster_canonical.py \
  --account-id 66624469 \
  --run-type manual \
  --layers query_pages \
  --priority-limit 15
```

Required SELECT gates:

```sql
SELECT status, error_count, rows_read, rows_written
FROM canonical_collector_runs
WHERE source_key = 'yandex_webmaster'
  AND run_mode = 'weekly'
  AND job_key = 'yandex_webmaster:query_pages'
ORDER BY id DESC LIMIT 1;

SELECT COUNT(DISTINCT page_hash) AS covered_pages,
       SUM(row_count) AS pair_rows,
       SUM(row_count = 0) AS successful_empty_pages
FROM canonical_webmaster_query_page_coverage_daily
WHERE ingestion_run_id = ?;

SELECT COUNT(*) AS bad_rows
FROM canonical_fact_webmaster_query_pages_daily
WHERE ingestion_run_id = ?
  AND (query_text = '' OR page_url = '' OR impressions < 0 OR clicks < 0);
```

Required result: run `success`, `error_count=0`, `covered_pages=15`, `bad_rows=0`. Pair rows may be zero only for individually covered pages; the total pair count must be greater than zero before exposing Yandex links.

- [ ] **Step 6: Smoke the production SEO tab before enabling cron**

Verify one known pair from canonical MySQL appears as `Яндекс:` under the same normalized query, the confirmed filter retains it, Google links still render, and the displayed Webmaster impressions equal `canonical_fact_webmaster_queries_daily` rather than pair-row totals.

- [ ] **Step 7: Add the reviewed cron line and verify the next run**

After the user approves the UTC slot, back up the existing crontab, add only the new Monday `03:20 UTC` line, and leave all existing jobs byte-for-byte unchanged. The first scheduled run must meet the same run/coverage gates as Step 5. Only after that success may `--priority-limit` be raised from 15 to 30.

- [ ] **Step 8: Commit rollout evidence**

```bash
git add docs/superpowers/reports/2026-07-29-yandex-webmaster-query-page-rollout.md
git commit -m "docs: record Webmaster query page rollout"
```

### Task 9: Document the active contract and fallback

**Files:**
- Modify: `/Users/nafanya/ReportingDash/AGENTS.md`
- Modify: `/Users/nafanya/ReportingDash/DASHBOARDS-MEMORY.md`
- Modify: `AGENTS.md`
- Modify: `DASHBOARDS-MEMORY.md`
- Modify: `PLATFORMS-ACCESS-MEMORY.md`
- Modify: `docs/superpowers/specs/2026-07-28-zaruku-confirmed-query-landings-design.md`

**Interfaces:**
- Consumes: verified probe, deployment, manual collection and scheduled-run facts only.
- Produces: one consistent Source-of-Truth statement for standard weekly collection and Enhanced Export fallback.

- [ ] **Step 1: Update documentation only with observed results**

Record:

- the probe request shape and exact comparison result;
- canonical table grains and coverage semantics;
- active priority limit, UTC cron line and verified run ID;
- production runtime commits/releases;
- that standard Query Analytics covers only the recent API window;
- that Enhanced Export is reserved for historical backfill and exact fallback, with no paid quota unless separately authorized;
- that separate Webmaster query/page tables and `popular_complementary_indicator` remain forbidden as a pair source.

- [ ] **Step 2: Run the final drift scan**

```bash
rg -n "Google-only|только по данным Google|popular_complementary_indicator|yandex_webmaster:query_pages|03:20|canonical_fact_webmaster_query_pages_daily" \
  AGENTS.md DASHBOARDS-MEMORY.md PLATFORMS-ACCESS-MEMORY.md docs src
```

Expected: old Google-only copy remains only in dated historical evidence; current specs/types/components describe GSC plus exact Webmaster pairs and preserve the prohibition on representative URLs.

- [ ] **Step 3: Run final verification**

```bash
npm test && npm run lint && npm run typecheck && npm run build
```

Expected: success.

- [ ] **Step 4: Commit and push both feature branches**

```bash
git add AGENTS.md DASHBOARDS-MEMORY.md PLATFORMS-ACCESS-MEMORY.md docs/superpowers/specs/2026-07-28-zaruku-confirmed-query-landings-design.md
git commit -m "docs: activate Webmaster query page contract"
git push -u origin codex/yandex-webmaster-query-pages
```

## Acceptance Gates

1. The controlled standard-API probe matches the existing Enhanced Export sample exactly by normalized query, exact path, clicks and impressions; otherwise implementation stops.
2. No dashboard code calls Yandex APIs or reads OAuth credentials.
3. Every displayed Yandex landing comes from `canonical_fact_webmaster_query_pages_daily` and never from an inferred join.
4. Successful-empty page requests have coverage; failed requests do not.
5. The weekly run covers exactly 15 approved pages initially and never more than 30.
6. Existing daily Webmaster rows, periods, run lineage and UI metrics are unchanged.
7. `Только с подтверждённой посадочной` accepts a GSC pair or an exact Webmaster pair, but not SEO OS or representative URL data.
8. Enhanced Export remains the historical-backfill and exact fallback mechanism; no paid quota is used without separate approval.
9. The first manual and first scheduled weekly runs both finish successfully with full selected-page coverage before expanding from 15 to 30.

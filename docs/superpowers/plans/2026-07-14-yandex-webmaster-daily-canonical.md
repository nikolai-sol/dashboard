# Yandex Webmaster Daily Canonical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an idempotent daily Yandex Webmaster canonical collector and make Zaruku's "Факты Яндекс Поиска" aggregate those daily facts into ISO weeks.

**Architecture:** The collector writes daily canonical tables and logs request/run metadata through the existing canonical collector run tables. The dashboard read model no longer reads `seo_webmaster_queries_weekly`; it aggregates `canonical_fact_webmaster_queries_daily` and `canonical_fact_webmaster_summary_daily` by ISO week at query time, so partial current weeks are shown directly.

**Tech Stack:** Python 3 collector, mysql.connector, requests, existing canonical run helpers, MySQL migrations, Next.js/TypeScript read model, Node test runner.

## Global Constraints

- Do not delete `seo_webmaster_queries_weekly` or `seo_webmaster_pages_weekly`; mark them deprecated and stop using them in panels.
- Daily collector default window is yesterday plus a 3-day lag backfill.
- Upserts are idempotent by `source_key + analytics_account_id + host_id + report_date + device_type + query_hash`.
- Quota guard allows no more than one full cron run per UTC day unless explicitly forced/manual/backfill.
- Log Webmaster API requests in collector run events.
- Filter all dashboard reads by `analytics_account_id`.

---

### Task 1: Daily Collector Contract

**Files:**
- Create: `/Users/nafanya/ReportingDash/fetch_yandex_webmaster_canonical.py`
- Create: `/Users/nafanya/ReportingDash/tests/test_fetch_yandex_webmaster_canonical.py`
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/db/migrations/032_yandex_webmaster_daily_canonical.sql`

**Interfaces:**
- Produces: `collection_dates(anchor: date, lag_days: int) -> list[str]`
- Produces: `normalize_popular_query_rows(payload: dict, report_date: str, device: str, run_id: int) -> list[dict]`
- Produces: `upsert_webmaster_query_rows(rows: list[dict]) -> int`
- Produces: `upsert_webmaster_summary_rows(rows: list[dict]) -> int`

- [ ] **Step 1: Write failing tests** for default date window, query normalization, summary normalization, and idempotent SQL containing `ON DUPLICATE KEY UPDATE`.
- [ ] **Step 2: Run tests** with `python -m pytest tests/test_fetch_yandex_webmaster_canonical.py`.
- [ ] **Step 3: Implement collector** with OAuth refresh, host discovery, request logging, daily query fetch, summary fetch, quota guard, and canonical upserts.
- [ ] **Step 4: Re-run tests** until they pass.

### Task 2: Dashboard Daily Aggregation

**Files:**
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-yandex-webmaster.ts`
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-yandex-webmaster.test.ts`
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/components/zaruku-yandex-webmaster-panels.ts`
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/components/zaruku-yandex-webmaster-panels.test.ts`

**Interfaces:**
- Produces: `buildWebmasterAccountQueries(counterIds: string[], weeks?: string[]): Record<"queries" | "pages", SqlQuery>` where `queries` reads `canonical_fact_webmaster_queries_daily`.
- Produces: `buildWebmasterSelectionMeta(...)` with partial-week labels like `2026-W29 · частично, по 14.07`.

- [ ] **Step 1: Update failing tests** to expect daily canonical table names, no weekly fallback, and partial current-week labels.
- [ ] **Step 2: Run targeted tests** with `npm test -- src/lib/zaruku-yandex-webmaster.test.ts src/components/zaruku-yandex-webmaster-panels.test.ts`.
- [ ] **Step 3: Implement daily SQL aggregation** by ISO week with weighted average position and CTR from sums.
- [ ] **Step 4: Re-run targeted tests** until they pass.

### Task 3: Verification And Release

**Files:**
- Modify only files listed above unless tests reveal a direct contract break.

- [ ] **Step 1: Run collector tests** with `python -m pytest tests/test_fetch_yandex_webmaster_canonical.py`.
- [ ] **Step 2: Run Zaruku tests** with `npm test -- src/lib/zaruku-yandex-webmaster.test.ts src/components/zaruku-yandex-webmaster-panels.test.ts`.
- [ ] **Step 3: Run full verification** with `npm run ci:verify`.
- [ ] **Step 4: Commit and deploy** only after verification passes.

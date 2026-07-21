# Zaruku GSC Canonical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Search Console as an automated canonical source for Zaruku.

**Architecture:** Root collector writes daily canonical GSC facts with transactional replacement. Dashboard app reads those facts through a dedicated read model and renders GSC alongside Yandex Webmaster in the SERP tab.

**Tech Stack:** Python collector, MySQL canonical tables, Next.js/TypeScript read models, Node test runner.

## Global Constraints

- Use source key `google_search_console`.
- Use read-only OAuth scope `https://www.googleapis.com/auth/webmasters.readonly`.
- Default property is `https://zaruku.ru/`.
- Do not print or commit OAuth secrets.
- Daily collector reruns must not delete existing rows before a complete replacement snapshot is available.
- Dashboard must degrade to pending/partial when GSC tables are missing or empty.

---

### Task 1: Collector Schema And Normalization

**Files:**
- Create: `fetch_google_search_console_canonical.py`
- Create: `tests/test_fetch_google_search_console_canonical.py`
- Modify: `CANONICAL-ENTITIES-MEMORY.md`
- Modify: `PLATFORMS-ACCESS-MEMORY.md`

**Interfaces:**
- Produces `normalize_search_analytics_rows(payload, dimensions, ...)`.
- Produces `replace_gsc_day_rows(query_rows, page_rows, summary_row)`.
- Produces `fetch_search_analytics(access_token, site_url, date, dimensions)`.

- [ ] Write failing Python tests for row normalization, query/page hashing, CTR percent, empty snapshots, transaction rollback, and row-limit refusal.
- [ ] Implement the collector with OAuth refresh, GSC requests, normalization, daily transactional replacement, and collector-run logging.
- [ ] Update root memory docs with GSC auth, table grains, and non-deployed status.
- [ ] Run `python3 -m pytest -q tests/test_fetch_google_search_console_canonical.py`.
- [ ] Run `python3 -m py_compile fetch_google_search_console_canonical.py`.
- [ ] Commit root changes.

### Task 2: Dashboard Schema And Read Model

**Files:**
- Create: `src/db/migrations/033_google_search_console_daily_canonical.sql`
- Create: `src/lib/zaruku-google-search-console.ts`
- Create: `src/lib/zaruku-google-search-console.test.ts`
- Modify: `src/lib/account-read-models.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces `loadGoogleSearchConsoleFacts(accountId, weeks?)`.
- Extends account facts with `gsc`.
- Adds `ZarukuGoogleSearchConsoleData`, `ZarukuGoogleSearchConsoleQueryRow`, `ZarukuGoogleSearchConsolePageRow`, and `ZarukuGoogleSearchConsoleSummaryRow`.

- [ ] Write failing TypeScript tests proving SQL reads canonical GSC tables, aggregates by ISO week, weights average position by impressions, and returns unavailable on missing tables.
- [ ] Add migration and read model.
- [ ] Wire `loadAccountFacts` to include `gsc`.
- [ ] Run `npm test -- src/lib/zaruku-google-search-console.test.ts src/lib/account-read-models.test.ts`.
- [ ] Commit app changes.

### Task 3: Dashboard Source State And SERP UI

**Files:**
- Modify: `src/lib/zaruku-seo.ts`
- Modify: `src/lib/zaruku-seo.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/zaruku-yandex-webmaster-panels.ts`
- Modify: `src/components/zaruku-yandex-webmaster-panels.test.ts`
- Modify: `src/components/zaruku-seo-pending.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `DASHBOARDS-MEMORY.md`
- Modify: `ZARUKU-SEO-PENDING-SOURCES.md`

**Interfaces:**
- Consumes `facts.gsc`.
- `deriveSourceDataThrough` includes latest GSC `week_to`.
- `buildSources` marks GSC as automated connected/partial/pending based on read model status.
- Zaruku payload includes `gsc`.

- [ ] Write failing tests for GSC source provenance, pending requirement removal when connected, and SERP selection fallback.
- [ ] Replace the pending GSC card with live KPI strip and Google query/page tables.
- [ ] Update dashboard memory docs.
- [ ] Run targeted component/lib tests.
- [ ] Commit app changes.

### Task 4: Verification And Review

**Files:**
- No planned production-code edits.

- [ ] Run root `python3 -m pytest -q`.
- [ ] Run app `npm test`, `npm run typecheck`, and `npm run lint`.
- [ ] Run both repo `git diff --check`.
- [ ] Request final code review.
- [ ] Fix any Critical or Important findings and rerun affected checks.

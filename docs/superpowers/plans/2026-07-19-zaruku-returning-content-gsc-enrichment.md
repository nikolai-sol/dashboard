# Zaruku Returning Content And GSC Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Zaruku's stale legacy returning-content source with a canonical daily collector/read model, and add the next useful Google Search Console enrichment layers.

**Architecture:** Keep collectors as canonical ROOT writers and keep dashboard panels as read-only aggregations. Returning content gets a new Metrika canonical table and collector because `yandex_metrika_returned` stops at `2026-05-19` for counter `66624469`. GSC country/device summaries are derived from existing `canonical_fact_gsc_queries_daily`; `searchAppearance` and Google result `type` require additional optional Search Analytics API calls and separate canonical tables.

**Tech Stack:** Python canonical collectors, MySQL `report_bd`, Next.js 16 / React 19, TypeScript read models, Node test runner.

## Execution Status — 2026-07-19

- Done: production table `report_bd.canonical_fact_metrika_returning_pages_daily` exists with canonical idempotency key `(analytics_account_id, report_date, page_hash)`.
- Done: root collector `/root/reportingdash-canonical/fetch_yandex_metrika_returning_canonical.py` deployed and compiled on VPS.
- Done: Zaruku backfill for counter `66624469`, `2026-07-01..2026-07-18`, succeeded in runs `1478` and idempotency verification run `1479`; table stayed at `3963` rows after repeat run.
- Done: daily cron added at `06:18`: `fetch_yandex_metrika_returning_canonical.py --backfill-days 3 --run-type cron --account-id 66624469`.
- Done: dashboard returning-content panel reads `canonical_fact_metrika_returning_pages_daily`, not legacy `yandex_metrika_returned`, and shows visits plus 1-day / 2–7-day / 8–31-day returning user buckets.
- Done: Zaruku Quality/source freshness catalog includes `yandex_metrika_returning` with technical wording (`cron`, `collector`, `rows`).
- Done: GSC country and device panels are dashboard-side aggregations from existing `canonical_fact_gsc_queries_daily`; no new API calls added for these panels.
- Verified: `python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical -v`, `python3 -m py_compile fetch_yandex_metrika_returning_canonical.py`, targeted dashboard Node tests, and `npm run build`.
- Still optional / not implemented in this pass: GSC `searchAppearance` and result `type` collectors/tables. These need an explicit product decision because they add new API calls and new canonical contracts.

## Global Constraints

- Do not write Zaruku returning facts into legacy table `yandex_metrika_returned`.
- Zaruku active Metrika counter is `66624469`; counters `29137835`, `105559308`, and `99078698` remain inactive/on hold.
- Returning-content collection uses Yandex Metrika API dimensions `ym:s:endURL` and metrics `ym:s:visits`, `ym:s:upToDayUserRecencyPercentage`, `ym:s:upToWeekUserRecencyPercentage`, `ym:s:upToMonthUserRecencyPercentage`.
- GSC existing country/device panels must use already-collected `canonical_fact_gsc_queries_daily`; no new API calls for those panels.
- GSC Search Analytics supports grouping by dimensions such as `country`, `device`, `page`, `query`, filtering by `searchAppearance`, and `type` values including `web`, `image`, `video`, `news`, `discover`, and `googleNews`. Use `dataState="final"` for production cron unless a later product decision explicitly wants fresh partial data.
- Use technical wording in Quality/freshness: `cron`, `collector`, `rows`.
- Keep Abbott dashboard behavior unchanged.

---

## File Structure

- Create root collector: `/Users/nafanya/ReportingDash/fetch_yandex_metrika_returning_canonical.py`
- Create root tests: `/Users/nafanya/ReportingDash/tests/test_fetch_yandex_metrika_returning_canonical.py`
- Modify root docs/memory: `/Users/nafanya/ReportingDash/PLATFORMS-ACCESS-MEMORY.md`
- Modify dashboard read model: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-seo.ts`
- Modify dashboard types: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/types.ts`
- Modify dashboard UI: `/Users/nafanya/ReportingDash/dashboard-next/src/components/ZarukuSeoDashboard.tsx`
- Modify dashboard tests: `/Users/nafanya/ReportingDash/dashboard-next/src/components/ZarukuSeoDashboard.ui.test.ts`, `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-seo.test.ts`
- Modify GSC read model: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-gsc.ts`
- Modify GSC tests: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-gsc.test.ts`
- Later optional GSC collector extension: `/Users/nafanya/ReportingDash/fetch_gsc_canonical.py`, `/Users/nafanya/ReportingDash/tests/test_fetch_gsc_canonical.py`

---

### Task 1: Canonical Returning Content DB Contract

**Files:**
- Create migration SQL in the deployment/runbook section of `/Users/nafanya/ReportingDash/PLATFORMS-ACCESS-MEMORY.md`
- Create test: `/Users/nafanya/ReportingDash/tests/test_fetch_yandex_metrika_returning_canonical.py`

**Interfaces:**
- Produces table `canonical_fact_metrika_returning_pages_daily`
- Business key: `(analytics_account_id, report_date, page_hash)`

- [ ] **Step 1: Write the table-contract test**

Add:

```python
def test_returning_upsert_uses_canonical_table_and_business_key():
    from fetch_yandex_metrika_returning_canonical import RETURNING_PAGE_UPSERT_SQL

    assert "canonical_fact_metrika_returning_pages_daily" in RETURNING_PAGE_UPSERT_SQL
    assert "ON DUPLICATE KEY UPDATE" in RETURNING_PAGE_UPSERT_SQL
    assert "page_hash" in RETURNING_PAGE_UPSERT_SQL
    assert "yandex_metrika_returned" not in RETURNING_PAGE_UPSERT_SQL
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical -v
```

Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Apply production table DDL**

Run on VPS:

```sql
CREATE TABLE IF NOT EXISTS report_bd.canonical_fact_metrika_returning_pages_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_metrika',
  analytics_account_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  page_hash CHAR(64) NOT NULL,
  page_url TEXT NOT NULL,
  visits INT UNSIGNED NOT NULL DEFAULT 0,
  returning_1_day_users INT UNSIGNED NOT NULL DEFAULT 0,
  returning_2_7_days_users INT UNSIGNED NOT NULL DEFAULT 0,
  returning_8_31_days_users INT UNSIGNED NOT NULL DEFAULT 0,
  raw_payload JSON NULL,
  ingestion_run_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_metrika_returning_page_day (analytics_account_id, report_date, page_hash),
  KEY idx_metrika_returning_account_date (analytics_account_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Record DDL in memory**

Append this exact source contract to `PLATFORMS-ACCESS-MEMORY.md`:

```markdown
Zaruku returning content canonical source:
- collector: `fetch_yandex_metrika_returning_canonical.py`
- table: `canonical_fact_metrika_returning_pages_daily`
- grain: `analytics_account_id`, `report_date`, `page_url`
- business key: `analytics_account_id`, `report_date`, `page_hash`
- legacy table `yandex_metrika_returned` is not the Zaruku owner after this collector is enabled.
```

---

### Task 2: Returning Content Collector

**Files:**
- Create: `/Users/nafanya/ReportingDash/fetch_yandex_metrika_returning_canonical.py`
- Modify: `/Users/nafanya/ReportingDash/tests/test_fetch_yandex_metrika_returning_canonical.py`

**Interfaces:**
- Consumes table from Task 1
- Produces daily canonical returning rows
- Uses collector run logging through existing `canonical_writer.start_collector_run`, `finish_collector_run`, and `log_run_event`

- [ ] **Step 1: Write normalization test**

Add:

```python
def test_normalize_returning_rows_converts_percentages_to_user_counts():
    from fetch_yandex_metrika_returning_canonical import normalize_returning_rows

    rows = normalize_returning_rows(
        {
            "data": [
                {
                    "dimensions": [{"name": "https://zaruku.ru/rak-molochnoj-zhelezy/"}],
                    "metrics": [100, 10, 25, 40],
                }
            ]
        },
        analytics_account_id="66624469",
        report_date="2026-07-18",
        run_id=77,
    )

    assert rows[0]["visits"] == 100
    assert rows[0]["returning_1_day_users"] == 10
    assert rows[0]["returning_2_7_days_users"] == 25
    assert rows[0]["returning_8_31_days_users"] == 40
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical -v
```

Expected: FAIL because `normalize_returning_rows` is missing.

- [ ] **Step 3: Implement collector**

Implement the collector with:

```python
RETURNING_METRIKA_DIMENSION = "ym:s:endURL"
RETURNING_METRIKA_METRICS = ",".join([
    "ym:s:visits",
    "ym:s:upToDayUserRecencyPercentage",
    "ym:s:upToWeekUserRecencyPercentage",
    "ym:s:upToMonthUserRecencyPercentage",
])
```

Normalize each API row as:

```python
returning_1_day_users = round(visits * up_to_day_percent / 100)
returning_2_7_days_users = max(round(visits * up_to_week_percent / 100) - returning_1_day_users, 0)
returning_8_31_days_users = max(round(visits * up_to_month_percent / 100) - returning_1_day_users - returning_2_7_days_users, 0)
```

Use the same date window pattern as Zaruku Metrika canonical: yesterday plus backfill days, idempotent upsert, one run per cron unless `--force`.

- [ ] **Step 4: Run collector tests**

Run:

```bash
python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical -v
python3 -m py_compile fetch_yandex_metrika_returning_canonical.py
```

Expected: all tests PASS and compile exits 0.

- [ ] **Step 5: Deploy collector to VPS and run safe backfill**

Run:

```bash
scp fetch_yandex_metrika_returning_canonical.py beget:/var/www/dashboard/fetch_yandex_metrika_returning_canonical.py
ssh beget 'cd /var/www/dashboard && .gads-venv/bin/python -m py_compile fetch_yandex_metrika_returning_canonical.py'
ssh beget 'cd /var/www/dashboard && .gads-venv/bin/python fetch_yandex_metrika_returning_canonical.py --date-from 2026-07-01 --date-to 2026-07-18 --run-type backfill --account-id 66624469'
```

Expected: JSON result includes `status: "success"` and `rows_written > 0`.

---

### Task 3: Zaruku Returning Content Read Model And UI

**Files:**
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-seo.ts`
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/components/ZarukuSeoDashboard.tsx`
- Modify tests: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-seo.test.ts`, `/Users/nafanya/ReportingDash/dashboard-next/src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes `canonical_fact_metrika_returning_pages_daily`
- Produces `returning_pages` with `visits`, `returning_1_day_users`, `returning_2_7_days_users`, `returning_8_31_days_users` fields added to `ZarukuSeoMetricRow` or a dedicated `ZarukuReturningPageRow`

- [ ] **Step 1: Write read-model source test**

Assert that `queryReturningPages` reads from canonical and not legacy:

```ts
test("returning pages read from canonical returning table for Zaruku", () => {
  const source = readFileSync(new URL("./zaruku-seo.ts", import.meta.url), "utf8");

  assert.match(source, /canonical_fact_metrika_returning_pages_daily/);
  assert.doesNotMatch(source, /FROM yandex_metrika_returned/);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- src/lib/zaruku-seo.test.ts
```

Expected: FAIL while read model still references `yandex_metrika_returned`.

- [ ] **Step 3: Replace queryReturningPages SQL**

Use:

```sql
SELECT
  page_url AS label,
  page_url AS url,
  SUM(visits) AS visits,
  SUM(returning_1_day_users) AS returning_1_day_users,
  SUM(returning_2_7_days_users) AS returning_2_7_days_users,
  SUM(returning_8_31_days_users) AS returning_8_31_days_users,
  SUM(visits) AS pageviews
FROM canonical_fact_metrika_returning_pages_daily
WHERE source_key = 'yandex_metrika'
  AND analytics_account_id IN (...)
  AND report_date >= ?
  AND report_date <= ?
GROUP BY page_url
HAVING visits > 0
ORDER BY visits DESC
LIMIT 50
```

- [ ] **Step 4: Update UI table columns**

Change “Возвратный контент” table headers to:

```tsx
<th>Страница</th>
<th>Визиты</th>
<th>1 день</th>
<th>2–7 дней</th>
<th>8–31 день</th>
<th>Доля</th>
```

Keep empty state:

```tsx
Нет canonical returning rows за выбранный период. Проверь cron collector.
```

- [ ] **Step 5: Run focused dashboard tests**

Run:

```bash
npm test -- src/lib/zaruku-seo.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: PASS.

---

### Task 4: GSC Country And Device Summary From Existing Rows

**Files:**
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/types.ts`
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-gsc.ts`
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-gsc.test.ts`
- Modify: `/Users/nafanya/ReportingDash/dashboard-next/src/components/ZarukuSeoDashboard.tsx`

**Interfaces:**
- Produces `data.gsc.country_summary`
- Produces `data.gsc.device_summary`

- [ ] **Step 1: Write GSC read-model tests**

Add tests that expect `buildGscAccountQueries` to include country/device summary queries:

```ts
test("buildGscAccountQueries derives country and device summaries from canonical GSC rows", () => {
  const queries = buildGscAccountQueries(["66624469"], ["2026-W29"]);

  assert.match(queries.country_summary.sql, /GROUP BY week_key, country/);
  assert.match(queries.device_summary.sql, /GROUP BY week_key, device/);
  assert.match(queries.country_summary.sql, /canonical_fact_gsc_queries_daily/);
  assert.match(queries.device_summary.sql, /canonical_fact_gsc_queries_daily/);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- src/lib/zaruku-gsc.test.ts
```

Expected: FAIL until fields exist.

- [ ] **Step 3: Add DTOs and SQL**

Add DTOs with fields:

```ts
week: string;
country?: string;
device?: string;
impressions: number;
clicks: number;
ctr: number | null;
average_position: number | null;
week_from: string;
week_to: string;
is_partial_week: boolean;
```

Country SQL groups by `week_key, country`; device SQL groups by `week_key, device`.

- [ ] **Step 4: Render SEO panels**

Add two compact panels in SEO tab:

```tsx
<Panel data={data} title="GSC countries" source="gsc" layer="serp">
  <GscCountrySummaryTable rows={data.gsc.country_summary.slice(0, 10)} locale={currentLocale} />
</Panel>
<Panel data={data} title="GSC devices" source="gsc" layer="serp">
  <GscDeviceSummaryTable rows={data.gsc.device_summary} locale={currentLocale} />
</Panel>
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/lib/zaruku-gsc.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: PASS.

---

### Task 5: Optional GSC Search Appearance And Result Type Collector

**Files:**
- Modify: `/Users/nafanya/ReportingDash/fetch_gsc_canonical.py`
- Modify: `/Users/nafanya/ReportingDash/tests/test_fetch_gsc_canonical.py`

**Interfaces:**
- Produces optional table `canonical_fact_gsc_search_appearance_daily`
- Produces optional table `canonical_fact_gsc_type_daily`

- [ ] **Step 1: Write collector contract tests**

Add tests:

```python
def test_gsc_search_appearance_rows_use_dedicated_canonical_table():
    from fetch_gsc_canonical import GSC_SEARCH_APPEARANCE_UPSERT_SQL

    assert "canonical_fact_gsc_search_appearance_daily" in GSC_SEARCH_APPEARANCE_UPSERT_SQL
    assert "search_appearance" in GSC_SEARCH_APPEARANCE_UPSERT_SQL


def test_gsc_type_rows_use_dedicated_canonical_table():
    from fetch_gsc_canonical import GSC_TYPE_UPSERT_SQL

    assert "canonical_fact_gsc_type_daily" in GSC_TYPE_UPSERT_SQL
    assert "search_type" in GSC_TYPE_UPSERT_SQL
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
python3 -m unittest tests.test_fetch_gsc_canonical -v
```

Expected: FAIL until constants exist.

- [ ] **Step 3: Create optional GSC tables**

Use:

```sql
CREATE TABLE IF NOT EXISTS report_bd.canonical_fact_gsc_search_appearance_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(64) NOT NULL DEFAULT 'google_search_console',
  analytics_account_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  search_appearance VARCHAR(128) NOT NULL,
  impressions INT UNSIGNED NOT NULL DEFAULT 0,
  clicks INT UNSIGNED NOT NULL DEFAULT 0,
  ctr DECIMAL(18,8) NULL,
  position DECIMAL(18,6) NULL,
  raw_payload JSON NULL,
  ingestion_run_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_gsc_appearance_day (analytics_account_id, report_date, search_appearance),
  KEY idx_gsc_appearance_account_date (analytics_account_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_bd.canonical_fact_gsc_type_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(64) NOT NULL DEFAULT 'google_search_console',
  analytics_account_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  search_type VARCHAR(32) NOT NULL,
  impressions INT UNSIGNED NOT NULL DEFAULT 0,
  clicks INT UNSIGNED NOT NULL DEFAULT 0,
  ctr DECIMAL(18,8) NULL,
  position DECIMAL(18,6) NULL,
  raw_payload JSON NULL,
  ingestion_run_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_gsc_type_day (analytics_account_id, report_date, search_type),
  KEY idx_gsc_type_account_date (analytics_account_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Add collector API calls**

For search appearance, call Search Analytics with:

```json
{
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "dimensions": ["searchAppearance"],
  "rowLimit": 25000,
  "dataState": "final"
}
```

For result type, loop over:

```python
GSC_SEARCH_TYPES = ["web", "image", "video", "news", "discover", "googleNews"]
```

and call Search Analytics with no dimensions and `type` set to the current value.

- [ ] **Step 5: Run collector tests**

Run:

```bash
python3 -m unittest tests.test_fetch_gsc_canonical -v
python3 -m py_compile fetch_gsc_canonical.py
```

Expected: PASS.

---

### Task 6: Verification And Deployment

**Files:**
- No source changes unless verification exposes a direct defect.

- [ ] **Step 1: Run root collector tests**

Run:

```bash
python3 -m unittest tests.test_fetch_yandex_metrika_returning_canonical tests.test_fetch_gsc_canonical -v
```

Expected: PASS.

- [ ] **Step 2: Run dashboard tests**

Run:

```bash
cd dashboard-next
npm test -- src/lib/zaruku-seo.test.ts src/lib/zaruku-gsc.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: PASS.

- [ ] **Step 3: Build dashboard**

Run:

```bash
cd dashboard-next
npm run build
```

Expected: build exits 0.

- [ ] **Step 4: Deploy dashboard**

Run:

```bash
cd dashboard-next
npm run deploy
ssh beget 'curl -fsS http://127.0.0.1:3001/api/health'
curl -fsS https://dashboards.adreports.ru/api/health
```

Expected: both health checks return `{"status":"ok","database":"connected"}`.

- [ ] **Step 5: Production data check**

Run:

```bash
curl -fsS 'https://dashboards.adreports.ru/api/dashboard/zaruku?from=2026-07-01&to=2026-07-13' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const z=JSON.parse(s).zaruku_seo; console.log({returning:z.returning_pages.length,gscCountries:z.gsc.country_summary?.length,gscDevices:z.gsc.device_summary?.length});});"
```

Expected: `returning > 0`, `gscCountries > 0`, `gscDevices > 0`.

---

## Self-Review

- Spec coverage: returning-content canonical ownership, GSC existing-row summaries, and optional new GSC API dimensions are covered by separate tasks.
- Placeholder scan: no `TBD`, `TODO`, or “implement later” placeholders remain.
- Type consistency: `country_summary`, `device_summary`, `search_appearance`, and `search_type` names are consistent across collector/read-model/UI tasks.

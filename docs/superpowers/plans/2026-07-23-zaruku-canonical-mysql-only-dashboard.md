# Zaruku Canonical MySQL-Only Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Zaruku dashboard panel read organized canonical MySQL facts only, repair the failed daily collectors, and apply one explicit 48-hour daily period without changing Abbott.

**Architecture:** Platform APIs are called only by scheduled Python collectors. Twelve Russia-filtered Metrika breakdowns are stored in a dedicated daily fact table with explicit dimensions and a coverage table; GSC and Webmaster remain in their canonical daily tables. The Next.js loader uses bounded indexed SQL read models, loads sources in parallel, and contains no platform OAuth/API fetch path.

**Tech Stack:** Python 3 collectors, MySQL 8, Next.js 16, TypeScript, `mysql2`, Node test runner, Python `unittest`.

## Global Constraints

- Runtime path is exactly `external API -> scheduled collector -> canonical MySQL -> read model -> dashboard`.
- Opening, refreshing, filtering, or exporting the dashboard must not call Google Search Console, Yandex Metrika, Yandex Webmaster, or another source platform.
- Work only on `codex/zaruku-daily-cutoff-cron-repair` in both repositories until explicit acceptance.
- Do not merge to `main`, deploy, edit production cron, apply a migration, or run a production-writing backfill before acceptance.
- Zaruku Metrika account is only `66624469`; counters `29137835`, `105559308`, and `99078698` remain inactive and cron-disabled.
- Abbott release/private tables, `lastsign` attribution, five-scope publication gate, and append-only release behavior remain unchanged.
- Daily dashboard data uses `effective_to = min(requested_to, today - 2 calendar days)`.
- SEO OS and AI visibility keep independent snapshot periods and never constrain daily sources.
- A sum of daily users must not be labelled as exact unique users for a multi-day range.
- Browser/API responses remain authenticated, private, and `no-store`; shared response caching is not introduced.

---

### Task 1: Make the MySQL-only contract authoritative

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-07-23-zaruku-daily-cutoff-cron-repair-design.md`
- Modify: `dashboard-next/AGENTS.md`
- Modify: `dashboard-next/DASHBOARDS-MEMORY.md`

**Interfaces:**
- Consumes: the global data-plane rule above.
- Produces: authoritative repository guidance used by every later task and reviewer.

- [ ] **Step 1: Add the root repository rule**

Add an `Analytics dashboard data-plane rule` section to root `AGENTS.md` containing:

```text
External source APIs are collector-only. Dashboard request, render, filter,
export, and read-model code must read canonical MySQL and must not use source
OAuth tokens or call source APIs. Successful-empty collection is represented
by canonical coverage; failed collection is represented by collector/request
logs and never by silently reusing another period.
```

- [ ] **Step 2: Remove stale live-Metrika guidance**

In `dashboard-next/AGENTS.md` and `dashboard-next/DASHBOARDS-MEMORY.md`, replace the source-matrix wording that says Zaruku uses live Metrika cuts with the target canonical contract and the two new table names:

```text
canonical_fact_metrika_breakdowns_daily
canonical_metrika_breakdown_coverage_daily
```

Label the state as a branch target until production migration/deploy/backfill is accepted; do not claim production already uses the new tables.

- [ ] **Step 3: Verify documentation has no contradictory runtime rule**

Run:

```bash
rg -n "remaining live API|plus remaining live|live Metrika API cuts" \
  AGENTS.md docs/superpowers/specs/2026-07-23-zaruku-daily-cutoff-cron-repair-design.md \
  dashboard-next/AGENTS.md dashboard-next/DASHBOARDS-MEMORY.md
```

Expected: no stale statement describing live platform API calls as an allowed dashboard runtime path.

- [ ] **Step 4: Commit the documentation contract**

Commit root and nested documentation in their own repositories with messages:

```text
docs: require canonical mysql dashboard reads
```

---

### Task 2: Add replay-safe Metrika breakdown schema

**Files:**
- Create: `dashboard-next/src/db/migrations/043_zaruku_metrika_breakdowns_daily.sql`
- Create: `dashboard-next/src/db/zaruku-metrika-breakdowns-migration.test.ts`

**Interfaces:**
- Consumes: MySQL 8 and existing `canonical_collector_runs.id`.
- Produces:
  - `canonical_fact_metrika_breakdowns_daily`
  - `canonical_metrika_breakdown_coverage_daily`
  - `entry_page` compatibility in `canonical_fact_site_analytics_daily`
  - read indexes for Zaruku site and GSC facts.

- [ ] **Step 1: Write the failing migration contract test**

The test must read the SQL file and assert all of the following exact contracts:

```ts
assert.match(sql, /canonical_fact_metrika_breakdowns_daily/);
assert.match(sql, /canonical_metrika_breakdown_coverage_daily/);
assert.match(sql, /report_key VARCHAR\(64\) NOT NULL/);
assert.match(sql, /segment_key VARCHAR\(64\) NOT NULL DEFAULT 'russia'/);
assert.match(sql, /dimension_1_key VARCHAR\(64\)/);
assert.match(sql, /dimension_1_value TEXT/);
assert.match(sql, /dimension_2_key VARCHAR\(64\)/);
assert.match(sql, /dimension_2_value TEXT/);
assert.match(sql, /dimension_hash CHAR\(64\) NOT NULL/);
assert.match(sql, /UNIQUE KEY uniq_metrika_breakdown_daily/);
assert.match(sql, /KEY idx_metrika_breakdown_read/);
assert.match(sql, /KEY idx_site_analytics_scope_read/);
assert.match(sql, /KEY idx_gsc_country_date/);
assert.match(sql, /entry_page/);
```

Also assert the file does not alter any table whose name contains
`canonical_fact_metrika_*_release` or `report_bd_private`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/db/zaruku-metrika-breakdowns-migration.test.ts
```

Expected: FAIL because migration `043` does not exist.

- [ ] **Step 3: Create the replay-safe migration**

Define `canonical_fact_metrika_breakdowns_daily` with:

```text
source_key, analytics_account_id, report_date, report_key, segment_key,
row_kind(detail|total), dimension_1_key/id/value,
dimension_2_key/id/value, page_url, dimension_hash,
visits, users, new_users, pageviews, bounce_rate,
avg_visit_duration_seconds, page_depth, ingestion_run_id, timestamps
```

Use business key:

```text
(source_key, analytics_account_id, report_date, report_key,
 segment_key, row_kind, dimension_hash)
```

Use read index:

```text
(analytics_account_id, report_key, segment_key, report_date)
```

Define coverage at:

```text
(source_key, analytics_account_id, report_date, report_key, segment_key)
```

with `status ENUM('success','empty')`, `api_total_rows`,
`persisted_rows`, `pagination_complete`, and `ingestion_run_id`.

Use `information_schema` guards for the `entry_page` enum and new indexes so
the migration can be replayed. Add:

```text
canonical_fact_site_analytics_daily
  (source_key, analytics_account_id, analytics_scope, report_date)

canonical_fact_gsc_queries_daily
  (analytics_account_id, country, report_date)
```

- [ ] **Step 4: Run the migration test and full DB contract tests**

Run:

```bash
npm test -- src/db/zaruku-metrika-breakdowns-migration.test.ts src/db/dashboard-type-migration-replay.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```text
feat: add canonical metrika breakdown schema
```

---

### Task 3: Normalize all twelve Zaruku Metrika reports

**Files:**
- Create: `metrika_dashboard_breakdowns.py`
- Create: `tests/test_metrika_dashboard_breakdowns.py`

**Interfaces:**
- Produces:

```python
ZARUKU_BREAKDOWN_REPORTS: tuple[BreakdownReport, ...]
build_breakdown_rows(account_id, day, report, response, run_id) -> list[dict]
build_coverage_row(account_id, day, report, response, rows, run_id) -> dict
```

- [ ] **Step 1: Write failing registry tests**

Assert the registry contains exactly:

```python
{
    "search_engines": ("ym:s:searchEngine",),
    "search_phrases": ("ym:s:searchPhrase",),
    "organic_landing": ("ym:s:searchEngine", "ym:s:startURL"),
    "section_entrances": ("ym:s:startURL",),
    "map_city_demand": ("ym:s:regionCity", "ym:s:startURL"),
    "devices": ("ym:s:deviceCategory",),
    "browsers": ("ym:s:browser",),
    "operating_systems": ("ym:s:operatingSystem",),
    "age_intervals": ("ym:s:ageInterval",),
    "genders": ("ym:s:gender",),
    "interests": ("ym:s:interest",),
    "source_devices": ("ym:s:lastTrafficSource", "ym:s:deviceCategory"),
}
```

Every registry item must use:

```text
segment_key=russia
filter=ym:s:regionCountry=='Russia'
metrics=visits,users,pageviews,bounceRate,avgVisitDurationSeconds,pageDepth
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
python3 -m unittest tests.test_metrika_dashboard_breakdowns -v
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement immutable report definitions**

Use a frozen dataclass:

```python
@dataclass(frozen=True)
class BreakdownReport:
    report_key: str
    dimensions: tuple[str, ...]
    segment_key: str = "russia"
    filters: str = "ym:s:regionCountry=='Russia'"
```

- [ ] **Step 4: Add row normalization tests**

Cover one- and two-dimension rows, IDs and names, page URL extraction,
metrics, deterministic hash, a `row_kind='total'` row from API totals, and
`status='empty'` for HTTP-success with zero detail rows.

- [ ] **Step 5: Implement normalization**

Store explicit dimension keys/IDs/values; never use `dimension_hash` as the
only identity. Hash:

```text
account + date + report_key + segment_key + row_kind
+ dimension_1_key/id/value + dimension_2_key/id/value
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
python3 -m unittest tests.test_metrika_dashboard_breakdowns -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```text
feat: define zaruku metrika breakdown contract
```

---

### Task 4: Collect and publish breakdowns atomically

**Files:**
- Modify: `fetch_yandex_metrika_canonical.py`
- Modify: `canonical_writer.py`
- Create: `tests/test_yandex_metrika_breakdown_publication.py`
- Modify: `tests/test_fetch_yandex_metrika_canonical.py`

**Interfaces:**
- Consumes: Task 2 tables and Task 3 registry/builders.
- Produces:

```python
collect_zaruku_breakdowns(counter_id, day, run_id) -> BreakdownDayBundle
publish_generic_canonical_payload(payload, run_id) -> PublicationResult
```

- [ ] **Step 1: Write failing account-scope and pagination tests**

Assert breakdown calls occur only for `counter_id == "66624469"`, every report
uses full pagination and `accuracy=full`, and counters `29137835`,
`105559308`, `99078698`, plus Abbott `90602537`, never enter the breakdown
collector.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
python3 -m unittest tests.test_yandex_metrika_breakdown_publication -v
```

Expected: FAIL because collection/publication functions do not exist.

- [ ] **Step 3: Integrate collection without changing Abbott release code**

Call the Task 3 registry only in the generic Zaruku path. Validate for every
report:

```text
all pages downloaded
len(rows) == API total_rows
no sampled/truncated response
coverage row is success or empty
```

If any required report fails, return a failed day and publish no breakdown
facts or success coverage for that day.

- [ ] **Step 4: Write failing transaction-order tests**

With a recording fake connection assert:

```text
schema preflight -> BEGIN -> upsert current rows -> upsert coverage
-> prune stale rows for same account/date/report/run -> COMMIT
```

Force an upsert exception and assert `ROLLBACK` occurs and no prune SQL runs.
Assert prune predicates include source, account, date, report, segment, and
`ingestion_run_id <> current_run`.

- [ ] **Step 5: Implement connection-scoped writers**

Add writer functions that accept an existing connection and do not self-commit.
Keep all Abbott writer entry points and transaction behavior unchanged.

Before any collection/publication, preflight:

```text
entry_page enum exists
breakdown fact table exists
breakdown coverage table exists
```

- [ ] **Step 6: Replace destructive generic publication**

For existing generic site facts and Zaruku breakdowns, use current-run upsert
before stale prune. Remove the generic `delete target window -> insert`
sequence. Do not change `publish_metrika_day_bundle()` for Abbott releases.

- [ ] **Step 7: Run collector suites**

Run:

```bash
python3 -m unittest \
  tests.test_metrika_dashboard_breakdowns \
  tests.test_yandex_metrika_breakdown_publication \
  tests.test_fetch_yandex_metrika_canonical \
  tests.test_yandex_metrika_atomic_writer -v
python3 -m py_compile fetch_yandex_metrika_canonical.py metrika_dashboard_breakdowns.py canonical_writer.py
```

Expected: PASS with Abbott tests unchanged.

- [ ] **Step 8: Commit**

```text
fix: publish zaruku metrika facts atomically
```

---

### Task 5: Correct GSC optional requests and daily date scope

**Files:**
- Modify: `fetch_gsc_canonical.py`
- Modify: `tests/test_fetch_gsc_canonical.py`
- Modify: `dashboard-next/src/lib/zaruku-gsc.ts`
- Modify: `dashboard-next/src/lib/zaruku-gsc.test.ts`

**Interfaces:**
- `loadGoogleSearchConsoleFacts(accountIds, dateRange)` replaces week-based filtering.

- [ ] **Step 1: Write failing GSC collector request tests**

Assert:

```python
searchAppearance dimensions == ["searchAppearance"]
discover dimensions == ["page", "country"]
web/image/video/news/googleNews dimensions == ["page", "country", "device"]
```

Assert HTTP 200 with zero optional rows is successful-empty, not partial.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
python3 -m unittest tests.test_fetch_gsc_canonical -v
```

Expected: the current invalid dimension combinations fail the new assertions.

- [ ] **Step 3: Implement the valid request contracts**

Persist empty lower-grain values for Search appearance and empty device for
Discover. Preserve the existing canonical hash/idempotency contract.

- [ ] **Step 4: Write failing SQL date-bound tests**

Assert every GSC query uses:

```sql
analytics_account_id IN (...)
AND report_date BETWEEN ? AND ?
```

and does not use `YEARWEEK(report_date)` in `WHERE`.

- [ ] **Step 5: Implement direct date bounds**

Aggregate bounded daily facts into ISO weeks in `SELECT`/`GROUP BY`. Filter
Zaruku country with normalized `country = 'rus'` using the new composite
index.

- [ ] **Step 6: Run focused tests and commit in each repository**

Run:

```bash
python3 -m unittest tests.test_fetch_gsc_canonical -v
cd dashboard-next && npm test -- src/lib/zaruku-gsc.test.ts
```

Expected: PASS.

Commit message:

```text
fix: align gsc canonical request and period contracts
```

---

### Task 6: Apply one 48-hour daily range to every daily read model

**Files:**
- Create: `dashboard-next/src/lib/zaruku-daily-period.ts`
- Create: `dashboard-next/src/lib/zaruku-daily-period.test.ts`
- Modify: `dashboard-next/src/lib/account-read-models.ts`
- Modify: `dashboard-next/src/lib/zaruku-yandex-webmaster.ts`
- Modify: `dashboard-next/src/lib/zaruku-yandex-webmaster.test.ts`
- Modify: `dashboard-next/src/lib/zaruku-seo.ts`
- Modify: `dashboard-next/src/lib/zaruku-seo.test.ts`

**Interfaces:**
- Produces:

```ts
resolveZarukuDailyPeriod(input: {
  requestedFrom: string;
  requestedTo: string;
  today: string;
}): {
  requested: { from: string; to: string };
  expectedTo: string;
  effective: { from: string; to: string };
}
```

- [ ] **Step 1: Write failing cutoff tests**

Cover:

```text
today 2026-07-23 -> expectedTo 2026-07-21
requested 2026-07-01..2026-07-23 -> effective 2026-07-01..2026-07-21
requested 2026-07-01..2026-07-13 -> unchanged
from after effective to -> explicit error
invalid ISO date -> explicit error
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm test -- src/lib/zaruku-daily-period.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement the pure period helper**

Use UTC calendar arithmetic and an injected `today`; do not derive the
expected cutoff from collector freshness.

- [ ] **Step 4: Write failing GSC/Webmaster integration tests**

Assert `loadAccountFacts` receives/passes `{from,to}` and never receives
`seoOs.weeks`. Assert Webmaster SQL uses direct date bounds and ISO-week
aggregation only after filtering.

- [ ] **Step 5: Integrate one effective range**

Calculate the daily period once in `loadZarukuSeoData`. Pass it to Metrika
site facts, Metrika breakdowns, returning content, GSC, and Webmaster. Do not
pass it to SEO OS or AI visibility.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- \
  src/lib/zaruku-daily-period.test.ts \
  src/lib/zaruku-gsc.test.ts \
  src/lib/zaruku-yandex-webmaster.test.ts \
  src/lib/zaruku-seo.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```text
feat: unify zaruku daily reporting range
```

---

### Task 7: Replace all live Metrika requests with a MySQL read model

**Files:**
- Create: `dashboard-next/src/lib/zaruku-metrika.ts`
- Create: `dashboard-next/src/lib/zaruku-metrika.test.ts`
- Modify: `dashboard-next/src/lib/zaruku-seo.ts`
- Modify: `dashboard-next/src/lib/zaruku-seo.test.ts`
- Modify: `dashboard-next/src/lib/types.ts`

**Interfaces:**
- Produces:

```ts
loadZarukuMetrikaBreakdowns(
  accountIds: string[],
  range: { from: string; to: string },
): Promise<ZarukuMetrikaBreakdownReadModel>
```

- [ ] **Step 1: Write failing query-builder tests**

For all twelve report keys assert SQL filters:

```sql
source_key = 'yandex_metrika'
analytics_account_id IN (...)
report_key = ?
segment_key = 'russia'
report_date BETWEEN ? AND ?
```

Assert aggregation sums visits/pageviews, visit-weights bounce/duration/depth,
calculates share after aggregation, and applies limit after `GROUP BY`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm test -- src/lib/zaruku-metrika.test.ts
```

Expected: FAIL because the read model does not exist.

- [ ] **Step 3: Implement the MySQL read model**

Return the existing dashboard row shapes plus per-report availability from
coverage. Use a single bounded query for detail rows and one bounded coverage
query, then organize rows by `report_key` in TypeScript. Do not execute twelve
serial SQL queries.

For multi-day ranges, set the exact-period users KPI to unavailable. Do not
sum daily users and label the result unique users.

- [ ] **Step 4: Write a failing runtime-source gate**

In `zaruku-seo.test.ts`, read the loader source and assert it contains none of:

```text
api-metrika.yandex.net
METRIKA_TOKEN
YANDEX_METRIKA_TOKEN
fetchMetrikaReport
fetchMetrikaReportsSequential
```

- [ ] **Step 5: Remove the live runtime**

Delete the Metrika API constants, token lookup, fetch functions, sleep, and
sequential report loop. Map the Task 7 read model into the existing public
dashboard payload.

Start Metrika breakdowns, GSC, Webmaster, freshness, SEO OS, and AI SQL work
in the same parallel phase. Keep authentication outside and before any future
cache.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
npm test -- src/lib/zaruku-metrika.test.ts src/lib/zaruku-seo.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```text
perf: serve zaruku analytics from canonical mysql
```

---

### Task 8: Make periods, freshness, and loading behavior explicit

**Files:**
- Modify: `dashboard-next/src/components/ZarukuOverviewTab.tsx`
- Modify: `dashboard-next/src/components/ZarukuPeriodContext.tsx`
- Modify: `dashboard-next/src/components/ZarukuQualityTab.tsx`
- Modify: `dashboard-next/src/components/ZarukuAudienceTab.tsx`
- Modify: corresponding component test files
- Modify: `dashboard-next/src/app/api/dashboard/[id]/route.ts`
- Modify: `dashboard-next/src/lib/dashboard-data-loader.ts`

**Interfaces:**
- Consumes: effective daily range, independent SEO OS week, AI snapshot, and coverage/freshness from Tasks 4–7.
- Produces: manager-facing period/trust surfaces and internal timing evidence.

- [ ] **Step 1: Write failing UI copy tests**

Assert Overview renders:

```text
Ежедневные данные: DD.MM.YYYY–DD.MM.YYYY · стандартный лаг 48 часов
```

Assert it does not name a limiting source.

Assert SEO OS renders:

```text
2026-W29 · недельный срез позиций
```

with a circular `i` tooltip explaining it is not the selected daily period and
does not constrain Metrika, GSC, or Webmaster.

- [ ] **Step 2: Add users and quality tests**

For multi-day periods assert exact unique users render `—`, not a sum.
Quality must show technical collector/coverage dates and distinguish delayed,
successful-empty, and unavailable reports.

- [ ] **Step 3: Implement the manager-facing surfaces**

Keep the simple 48-hour rule in Overview. Keep cron, collector, row, and
coverage details in Quality. Preserve SEO OS and AI as independent snapshots.

- [ ] **Step 4: Add internal timing instrumentation**

Measure total Zaruku loading and major MySQL phases with monotonic time.
Return a private `Server-Timing` header with safe metric names only:

```text
metrika-db
gsc-db
webmaster-db
seo-db
total
```

Do not include SQL, account IDs, errors, tokens, or credentials in headers.
Keep `private, no-store`.

- [ ] **Step 5: Run component and route tests**

Run:

```bash
npm test -- \
  src/components/ZarukuOverviewTab.test.ts \
  src/components/ZarukuAudienceTab.test.ts \
  src/components/ZarukuQualityTab.test.ts \
  src/components/zaruku-seo-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run complete verification**

Root:

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile fetch_yandex_metrika_canonical.py fetch_gsc_canonical.py \
  metrika_dashboard_breakdowns.py canonical_writer.py
```

Dashboard:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 7: Run read-only production audit**

Without applying migration or writing facts, report:

```text
latest successful generic Zaruku Metrika run/date
latest GSC core/optional dates
latest Webmaster summary/query/page dates
inactive status of 29137835, 105559308, 99078698
proposed migration command
proposed targeted 66624469 backfill command
```

- [ ] **Step 8: Final review and acceptance handoff**

Run a whole-branch review against each repository merge base. Present:

```text
root commits
dashboard commits
tests/build evidence
schema/backfill proposal
known data limitations
```

Do not merge, deploy, migrate, edit cron, or backfill until the user explicitly accepts the branch.

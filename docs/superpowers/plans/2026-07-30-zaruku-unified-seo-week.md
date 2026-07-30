# Zaruku Unified SEO Week Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the primary SEO ISO-week selector drive GSC, Yandex Webmaster, Yandex Metrika, and SEO OS in both unified comparison tables, with an explicit latest-populated fallback and no false period-mismatch banner.

**Architecture:** Keep the existing SEO OS selector and source collectors unchanged. Add a canonical-only Metrika organic-landing weekly bundle, load GSC/Webmaster across the selector's bounded week range, and use one source-week selection contract in the client. Other Metrika panels retain their existing dashboard-period rows, GSC diagnostics retain their current latest-week behavior, and the existing GSC newest-first ordering remains present.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, mysql2, canonical MySQL.

## Global Constraints

- External source APIs remain collector-only; dashboard code reads canonical MySQL only.
- Do not change collector schedules, cron, credentials, migrations, or source API calls.
- Do not change SEO OS calculations or the selector's `seo_os.weeks` ownership.
- Do not remove or reverse the GSC landing-page `ORDER BY week_key DESC` fix.
- Do not change the daily-period behavior of Metrika panels outside the unified landing-page table.
- A missing requested week falls back to the source dataset's latest populated week, never to the mathematically nearest week.
- Every fallback is visible beside that source as `W30 недоступна, показано W31`.
- The global mismatch notice is present only when at least one displayed source has `fallback: true`.

---

### Task 1: Shared requested-versus-actual week contract

**Files:**
- Create: `src/components/zaruku-seo-source-week.ts`
- Create: `src/components/zaruku-seo-source-week.test.ts`
- Modify: `src/components/zaruku-yandex-webmaster-panels.ts`
- Modify: `src/components/zaruku-yandex-webmaster-panels.test.ts`

**Interfaces:**
- Consumes: rows with a `week: string` property, a requested week, and optional explicitly available weeks.
- Produces: `selectSourceWeekRows<T>(rows, requestedWeek, availableWeeks): SourceWeekSelection<T>`, `formatSourceWeekFallback(selection)`, and `hasSourceWeekFallback(selections)`.

- [x] **Step 1: Write the failing source-week tests**

Create tests covering exact selection, latest-populated fallback, coverage-backed empty selection, no-source state, and banner state:

```ts
const rows = [
  { week: "2026-W29", id: "old" },
  { week: "2026-W31", id: "latest" },
];

assert.deepEqual(
  selectSourceWeekRows(rows, "2026-W29", ["2026-W29", "2026-W31"]),
  {
    requestedWeek: "2026-W29",
    actualWeek: "2026-W29",
    rows: [rows[0]],
    fallback: false,
  },
);

const fallback = selectSourceWeekRows(rows, "2026-W30", ["2026-W29", "2026-W31"]);
assert.equal(fallback.actualWeek, "2026-W31");
assert.equal(fallback.fallback, true);
assert.equal(formatSourceWeekFallback(fallback), "W30 недоступна, показано W31");

assert.deepEqual(
  selectSourceWeekRows([], "2026-W30", ["2026-W30"]),
  { requestedWeek: "2026-W30", actualWeek: "2026-W30", rows: [], fallback: false },
);
assert.equal(hasSourceWeekFallback([fallback]), true);
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --import tsx --test src/components/zaruku-seo-source-week.test.ts src/components/zaruku-yandex-webmaster-panels.test.ts
```

Expected: FAIL because the new module is absent and the old helper preserves an empty selected week without fallback.

- [x] **Step 3: Implement the shared contract**

Create the focused helper:

```ts
export type SourceWeekSelection<T> = {
  requestedWeek: string | null;
  actualWeek: string | null;
  rows: T[];
  fallback: boolean;
};

export function selectSourceWeekRows<T extends { week: string }>(
  rows: T[],
  requestedWeek: string | null,
  availableWeeks: string[] = rows.map((row) => row.week),
): SourceWeekSelection<T> {
  const populatedWeeks = [...new Set(rows.map((row) => row.week))].sort();
  const knownWeeks = [...new Set(availableWeeks)].sort();
  if (requestedWeek && knownWeeks.includes(requestedWeek)) {
    return {
      requestedWeek,
      actualWeek: requestedWeek,
      rows: rows.filter((row) => row.week === requestedWeek),
      fallback: false,
    };
  }
  const actualWeek = populatedWeeks.at(-1) ?? null;
  return {
    requestedWeek,
    actualWeek,
    rows: actualWeek ? rows.filter((row) => row.week === actualWeek) : [],
    fallback: Boolean(requestedWeek && actualWeek && actualWeek !== requestedWeek),
  };
}
```

Format only the short `WNN` labels by removing the `YYYY-` prefix. Update the legacy Webmaster selection metadata to consume `actualWeek` and `fallback`; do not retain two competing row-selection implementations.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command.

Expected: all source-week and Webmaster panel tests pass.

- [x] **Step 5: Commit the week contract**

```bash
git add src/components/zaruku-seo-source-week.ts src/components/zaruku-seo-source-week.test.ts src/components/zaruku-yandex-webmaster-panels.ts src/components/zaruku-yandex-webmaster-panels.test.ts
git commit -m "feat(zaruku): add source week selection contract"
```

---

### Task 2: Canonical Metrika weekly organic-landing read model

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/zaruku-metrika.ts`
- Modify: `src/lib/zaruku-metrika.test.ts`

**Interfaces:**
- Consumes: canonical `organic_landing` facts and daily coverage for full ISO-week boundaries.
- Produces: `loadZarukuMetrikaOrganicLandingWeeks(accountIds, weeks, executor): Promise<ZarukuMetrikaWeeklyOrganicLandingData>`.

- [x] **Step 1: Write failing weekly Metrika query and loader tests**

Add the expected payload types and tests requiring a Monday-Sunday bound, ISO-week grouping, weighted metrics, and fail-closed complete coverage:

```ts
const model = await loadZarukuMetrikaOrganicLandingWeeks(
  ["66624469"],
  ["2026-W30", "2026-W31"],
  async (query) => query.sql.includes("canonical_metrika_breakdown_coverage_daily")
    ? [
        { week_key: "2026-W30", coverage_rows: 7, complete_rows: 7 },
        { week_key: "2026-W31", coverage_rows: 3, complete_rows: 3 },
      ]
    : [{
        week_key: "2026-W30",
        report_key: "organic_landing",
        row_kind: "detail",
        dimension_1_id: "google",
        dimension_1_value: "Google, search results",
        dimension_2_id: null,
        dimension_2_value: null,
        page_url: "https://zaruku.ru/example/",
        visits: 10,
        users: 0,
        pageviews: 12,
        bounce_rate: 20,
        avg_visit_duration_seconds: 60,
        page_depth: 2,
        share: 100,
      }],
);

assert.deepEqual(model.weeks, ["2026-W30"]);
assert.equal(model.rows[0].week, "2026-W30");
assert.equal(model.rows[0].users_available, false);
```

Assert query parameters span `2026-07-20..2026-08-02`, use only `report_key = 'organic_landing'`, and never call a source API.

- [x] **Step 2: Run the Metrika test and verify RED**

Run:

```bash
node --import tsx --test src/lib/zaruku-metrika.test.ts
```

Expected: FAIL because the weekly loader and types do not exist.

- [x] **Step 3: Add the weekly types**

Add:

```ts
export interface ZarukuSeoWeeklyMetricRow extends ZarukuSeoMetricRow {
  week: string;
}

export interface ZarukuMetrikaWeeklyOrganicLandingData {
  weeks: string[];
  rows: ZarukuSeoWeeklyMetricRow[];
}
```

Add `organic_landing_pages_weekly: ZarukuMetrikaWeeklyOrganicLandingData` to `ZarukuSeoData` without changing `organic_landing_pages`.

- [x] **Step 4: Implement the bounded canonical weekly loader**

Use `isoWeekDateRange()` for the first and last requested week. Build one detail query grouped by ISO week and exact canonical dimensions and one coverage query grouped by ISO week. Preserve the existing visit-weighted formulas:

```sql
SUM(COALESCE(bounce_rate, 0) * COALESCE(visits, 0))
  / NULLIF(SUM(COALESCE(visits, 0)), 0) AS bounce_rate
```

Publish a week only when both `coverage_rows` and `complete_rows` equal
`7 * normalizedAccountIds.length`. Return weekly detail rows only for published
weeks and set multi-day `users_available` to `false`.

- [x] **Step 5: Run the Metrika test and verify GREEN**

Run the Step 2 command.

Expected: all Metrika tests pass, including the existing mysql2 literal-LIMIT regression.

- [x] **Step 6: Commit the weekly Metrika model**

```bash
git add src/lib/types.ts src/lib/zaruku-metrika.ts src/lib/zaruku-metrika.test.ts
git commit -m "feat(zaruku): add weekly Metrika landing read model"
```

---

### Task 3: Load every selectable comparison week without changing other periods

**Files:**
- Modify: `src/lib/zaruku-gsc.ts`
- Modify: `src/lib/zaruku-gsc.test.ts`
- Modify: `src/lib/zaruku-seo.ts`
- Modify: `src/lib/zaruku-seo.test.ts`

**Interfaces:**
- Consumes: `seoOs.weeks`, `isoWeekDateRange()`, existing GSC/Webmaster canonical loaders, and `loadZarukuMetrikaOrganicLandingWeeks()`.
- Produces: GSC/Webmaster weekly arrays covering selectable SEO weeks and enriched `organic_landing_pages_weekly` in `ZarukuSeoData`.

- [x] **Step 1: Write failing bounded-range and per-week-limit tests**

Update source-contract tests to require:

```ts
assert.match(loaderSource, /const seoWeekRange = resolveSeoWeekRange\(seoOs\.weeks, dailyPeriod\.effective\)/);
assert.match(loaderSource, /loadAccountFacts\(accountId, seoWeekRange/);
assert.match(loaderSource, /loadZarukuMetrikaOrganicLandingWeeks\(normalizedCounterIds, seoOs\.weeks\)/);
```

For GSC landing pages, require the existing newest-first order and a per-week
rank before the 200-row presentation cap:

```ts
assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY week_key/);
assert.match(sql, /WHERE week_rank <= 200/);
assert.match(sql, /ORDER BY week_key DESC/);
```

- [x] **Step 2: Run GSC and SEO tests and verify RED**

Run:

```bash
node --import tsx --test src/lib/zaruku-gsc.test.ts src/lib/zaruku-seo.test.ts
```

Expected: FAIL because source facts still use the dashboard daily period, no weekly Metrika payload exists, and the page cap is global.

- [x] **Step 3: Preserve the GSC fix while making the cap per week**

Wrap the existing landing-page aggregation in a ranked subquery. Rank with
`ROW_NUMBER() OVER (PARTITION BY week_key ORDER BY impressions DESC, clicks DESC, page ASC)`, filter to 200, and retain final `ORDER BY week_key DESC, impressions DESC, clicks DESC, page ASC`.

- [x] **Step 4: Resolve and load the bounded SEO week range**

Add:

```ts
export function resolveSeoWeekRange(
  weeks: string[],
  fallback: { from: string; to: string },
) {
  const sorted = [...new Set(weeks)].sort();
  if (sorted.length === 0) return fallback;
  return {
    from: isoWeekDateRange(sorted[0]).from,
    to: isoWeekDateRange(sorted.at(-1)!).to,
  };
}
```

Load SEO OS without modifying its queries, derive `seoWeekRange`, and load GSC/Webmaster facts plus weekly Metrika from canonical MySQL. Keep the existing dashboard-period Metrika queries and `organic_landing_pages` field unchanged.

For every weekly Metrika week, call the existing exact-URL aggregation before title enrichment:

```ts
const weeklyRows = metrikaWeekly.weeks.flatMap((week) =>
  enrichRowsWithPageTitles(
    aggregatePageRowsByNormalizedUrl(
      metrikaWeekly.rows.filter((row) => row.week === week),
    ),
    pageRows,
  ).map((row) => ({ ...row, week })),
);
```

- [x] **Step 5: Run GSC and SEO tests and verify GREEN**

Run the Step 2 command.

Expected: all tests pass and the GSC newest-first assertion remains green.

- [x] **Step 6: Commit the bounded weekly payload**

```bash
git add src/lib/zaruku-gsc.ts src/lib/zaruku-gsc.test.ts src/lib/zaruku-seo.ts src/lib/zaruku-seo.test.ts
git commit -m "feat(zaruku): load selectable SEO source weeks"
```

---

### Task 4: Wire unified selection and truthful source notices into both tables

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`
- Modify: `src/components/ZarukuSeoQueryComparison.tsx`
- Modify: `src/components/ZarukuSeoQueryComparison.test.ts`
- Modify: `src/components/ZarukuSeoPageComparison.tsx`
- Modify: `src/components/ZarukuSeoPageComparison.test.ts`

**Interfaces:**
- Consumes: `selectSourceWeekRows()`, `SourceWeekSelection`, and `data.organic_landing_pages_weekly`.
- Produces: both comparison tables rendered from the same requested week with source-local fallback metadata.

- [x] **Step 1: Write failing dashboard and component tests**

Replace the obsolete test that declares GSC/Webmaster independent from the SEO
OS selector. Require every comparison selection to receive `primaryWeek`, and
require Metrika weekly rows instead of the 28-day field:

```ts
assert.match(seoSource, /selectSourceWeekRows\(data\.gsc\.queries, primaryWeek/);
assert.match(seoSource, /selectSourceWeekRows\(data\.webmaster\.queries, primaryWeek/);
assert.match(seoSource, /data\.organic_landing_pages_weekly\.rows/);
assert.doesNotMatch(seoSource, /metrikaRows: data\.organic_landing_pages,/);
```

Add rendering assertions for:

- `W30 недоступна, показано W31` under only the affected source;
- no mismatch notice when all `fallback` values are false;
- a mismatch notice when any `fallback` value is true;
- the Metrika heading displaying `2026-W30`, not a 28-day date range.

- [x] **Step 2: Run component tests and verify RED**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoPageComparison.test.ts
```

Expected: FAIL because the dashboard still selects source `latest_week`, the components accept only actual week strings, and Metrika still displays `trafficPeriod`.

- [x] **Step 3: Select all four sources from primaryWeek**

In `SeoTab`, build comparison-only selections:

```ts
const gscQuerySelection = selectSourceWeekRows(data.gsc.queries, primaryWeek, data.gsc.weeks);
const webmasterQuerySelection = selectSourceWeekRows(data.webmaster.queries, primaryWeek, data.webmaster.weeks);
const gscPageSelection = selectSourceWeekRows(data.gsc.landing_pages, primaryWeek, data.gsc.weeks);
const webmasterPageSelection = selectSourceWeekRows(data.webmaster.pages, primaryWeek, data.webmaster.weeks);
const metrikaPageSelection = selectSourceWeekRows(
  data.organic_landing_pages_weekly.rows,
  primaryWeek,
  data.organic_landing_pages_weekly.weeks,
);
const seoOsSelection = selectSourceWeekRows(data.seo_os.clusters, primaryWeek);
```

Use these rows only in the two unified comparison builders. Leave GSC diagnostics on their existing latest-week selections.

- [x] **Step 4: Render source-local fallback and correct banner state**

Replace `sourceWeeks` with `sourceWeekSelections` in both component contracts.
Headings show `actualWeek` and, when `fallback` is true, the formatted fallback
copy. Compute the global warning through:

```ts
const hasPeriodMismatch = hasSourceWeekFallback(Object.values(sourceWeekSelections));
```

Add Metrika to the landing-page selections and availability map. Remove
`trafficPeriod` from `ZarukuSeoPageComparison`; the heading displays the actual
Metrika ISO week.

- [x] **Step 5: Run component tests and verify GREEN**

Run the Step 2 command.

Expected: all comparison component and UI contract tests pass.

- [x] **Step 6: Commit unified comparison presentation**

```bash
git add src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts src/components/ZarukuSeoQueryComparison.tsx src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoPageComparison.tsx src/components/ZarukuSeoPageComparison.test.ts
git commit -m "fix(zaruku): unify SEO comparison weeks"
```

---

### Task 5: Full verification and production evidence package

**Files:**
- Verify: all files changed in Tasks 1-4
- Modify: `docs/superpowers/plans/2026-07-30-zaruku-unified-seo-week.md`

**Interfaces:**
- Consumes: completed unified-week implementation.
- Produces: a verified branch and a read-only production snapshot proving actual source weeks and collector state.

- [x] **Step 1: Run focused regression tests**

```bash
node --import tsx --test \
  src/components/zaruku-seo-source-week.test.ts \
  src/components/zaruku-yandex-webmaster-panels.test.ts \
  src/components/ZarukuSeoDashboard.ui.test.ts \
  src/components/ZarukuSeoQueryComparison.test.ts \
  src/components/ZarukuSeoPageComparison.test.ts \
  src/lib/zaruku-metrika.test.ts \
  src/lib/zaruku-gsc.test.ts \
  src/lib/zaruku-seo.test.ts
```

Expected: all focused tests pass.

- [x] **Step 2: Run repository verification**

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits 0; only already documented lint warnings may remain.

- [x] **Step 3: Inspect the diff and protected invariants**

```bash
git diff origin/main...HEAD --check
git diff origin/main...HEAD -- src/lib/zaruku-gsc.ts src/lib/zaruku-seo-os.ts
```

Expected: no whitespace errors, GSC still orders landing-page output by
`week_key DESC`, and `src/lib/zaruku-seo-os.ts` is unchanged.

- [x] **Step 4: Commit plan completion evidence**

Mark completed checkboxes and record exact test/build results without production secrets:

```bash
git add docs/superpowers/plans/2026-07-30-zaruku-unified-seo-week.md
git commit -m "docs: record unified SEO week verification"
```

- [x] **Step 5: Read-only production verification**

After the implementation is reviewed for deployment, obtain canonical counts by ISO week for GSC, Webmaster, and Metrika coverage, plus today's collector run/log state. Do not call collectors, edit cron, write canonical tables, or send Telegram messages during this verification.

Expected for W30: each source either reports W30 or exposes its explicit latest-populated fallback. The collector report from 07:00 is explained from run status, request logs, and coverage rather than from Telegram wording alone.

## Completion evidence (2026-07-30)

- Focused regression suite: 136 tests passed.
- Repository suite: 543 tests passed.
- `npm run lint`: 0 errors; 4 pre-existing warnings.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff origin/main...HEAD --check`: passed.
- Protected invariants: GSC final ordering remains `week_key DESC`; `src/lib/zaruku-seo-os.ts` is unchanged.
- Production evidence was read-only: no collector call, cron edit, canonical write, Telegram send, or deployment occurred.

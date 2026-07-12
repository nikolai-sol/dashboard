# Zaruku SEO OS Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the weekly SEO OS data layer, ISO-week comparison controls, SEO analytics, SEO operations, and traffic-versus-visibility panels to dashboard 28.

**Architecture:** A focused `zaruku-seo-os.ts` module owns SEO-table queries and pure weekly transformations. `zaruku-seo.ts` composes that result with the existing Metrika payload, while the Zaruku component owns shared week-selection state and renders analytical and operational views from normalized DTOs.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, mysql2, Recharts, Tailwind CSS, Node test runner through tsx.

## Global Constraints

- Read-only access to all `seo_*` tables.
- Scope every SEO query to `analytics_account_id = 66624469` through normalized dashboard account IDs.
- Use ISO-8601 Monday-Sunday weeks and display labels as `YYYY-Www`.
- Never convert `no_data` or a null SERP position to zero.
- Treat negative position deltas as improvement.
- Assign traffic sections only through `seo_section_patterns`.
- Keep GSC, Yandex Webmaster, and DataForSEO pending.
- Keep Metrika rendering available if SEO OS loading fails.

---

### Task 1: SEO OS Domain Types And Week Utilities

**Files:**
- Modify: `package.json`
- Modify: `src/lib/types.ts`
- Create: `src/lib/zaruku-seo-os.ts`
- Create: `src/lib/zaruku-seo-os.test.ts`

**Interfaces:**
- Produces: `ZarukuSeoOsData`, its row DTOs, `sortIsoWeeks()`, `previousAvailableWeek()`, `buildSectionPositionTrend()`, `buildRhythmWeeks()`, `matchSectionPattern()`, and `calculateApproveRate()`.
- Consumes: no database in pure utility tests.

- [ ] **Step 1: Add the test command and failing utility tests**

Add `"test": "node --import tsx --test src/**/*.test.ts"` to `package.json`. Create tests using `node:test` and `node:assert/strict` that assert:

```ts
assert.deepEqual(sortIsoWeeks(["2026-W02", "2025-W52", "2026-W01"]), ["2025-W52", "2026-W01", "2026-W02"]);
assert.equal(previousAvailableWeek(["2026-W28", "2026-W30"], "2026-W30"), "2026-W28");
assert.equal(previousAvailableWeek(["2026-W28"], "2026-W28"), null);
assert.equal(matchSectionPattern("https://zaruku.ru/map/moscow/1", patterns)?.section, "/map/");
assert.equal(matchSectionPattern("https://zaruku.ru/unknown", patterns)?.section, "/content/");
assert.equal(calculateApproveRate([{ decision: "approved" }, { decision: "rejected" }, { decision: "pending" }]), 50);
```

Also test that section averages exclude null positions, coverage includes `no_data` rows in the denominator, and rhythm generation inserts `2026-W29` between W28 and W30 as `missing`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test`

Expected: FAIL because `zaruku-seo-os.ts` and its exported utilities do not exist.

- [ ] **Step 3: Add normalized SEO OS DTOs**

Extend `ZarukuSeoSourceId` with `"seo_os"`. Add explicit types for section patterns, trend points, cluster rows, opportunity rows/summaries, task rows/summaries, run rows, traffic visibility rows, and:

```ts
export interface ZarukuSeoOsData {
  available: boolean;
  error: string | null;
  weeks: string[];
  latest_week: string | null;
  section_patterns: ZarukuSeoSectionPattern[];
  position_trend: ZarukuSeoPositionTrendPoint[];
  clusters: ZarukuSeoClusterRow[];
  opportunities: ZarukuSeoOpportunityRow[];
  tasks: ZarukuSeoTaskRow[];
  runs: ZarukuSeoRunRow[];
  traffic_visibility: ZarukuSeoTrafficVisibilityRow[];
}
```

Add `seo_os: ZarukuSeoOsData` to `ZarukuSeoData`.

- [ ] **Step 4: Implement the pure transformations**

In `zaruku-seo-os.ts`, implement ISO week parsing/iteration without locale-dependent date parsing, deterministic pattern matching by descending pattern length then ascending priority, nullable position aggregation, approve-rate calculation, and missing-week run generation. Keep these functions database-independent and exported for tests.

- [ ] **Step 5: Run tests and type checking**

Run: `npm test && npm run typecheck`

Expected: all new tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json src/lib/types.ts src/lib/zaruku-seo-os.ts src/lib/zaruku-seo-os.test.ts
git commit -m "Add Zaruku SEO OS domain model"
```

### Task 2: Account-Scoped SEO OS Database Loader

**Files:**
- Modify: `src/lib/zaruku-seo-os.ts`
- Modify: `src/lib/zaruku-seo.ts`
- Modify: `src/lib/zaruku-seo-os.test.ts`

**Interfaces:**
- Consumes: normalized account IDs, canonical page analytics, utility functions from Task 1.
- Produces: `loadZarukuSeoOsData(counterIds: string[]): Promise<ZarukuSeoOsData>`.

- [ ] **Step 1: Add failing row-normalization tests**

Add tests proving MySQL decimal strings become numbers, `serp_position: null` remains null, nullable URLs remain null, and all SQL builders include an `analytics_account_id IN (...)` predicate with account IDs passed as parameters.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --test-name-pattern="SEO OS row|account scope"`

Expected: FAIL because row normalizers and query builders do not exist.

- [ ] **Step 3: Implement five read-only SEO queries**

Query all rows for the selected account IDs from `seo_section_patterns`, `seo_positions_weekly`, `seo_opportunities`, `seo_tasks`, and `seo_weekly_runs`. Select explicit columns, order by week and stable business keys, and normalize decimal/tinyint values at the module boundary.

Derive available weeks from the union of positions, opportunities, tasks, and runs. Generate section trends and rhythm rows from the normalized records.

- [ ] **Step 4: Implement weekly canonical traffic aggregation**

Read page-scope rows from `canonical_fact_site_analytics_daily` for the date span covered by available SEO weeks. Assign each page to exactly one pattern in TypeScript using `matchSectionPattern()`, aggregate visits/users/pageviews by ISO week and section, then combine traffic with average SERP position and coverage.

The query must filter:

```sql
source_key = 'yandex_metrika'
AND analytics_scope = 'page'
AND analytics_account_id IN (...)
AND report_date BETWEEN ? AND ?
```

- [ ] **Step 5: Isolate failures and compose the payload**

Wrap SEO OS loading so database failures return `{ available: false, error, ...emptyCollections }`. In `loadZarukuSeoData()`, load SEO OS concurrently with canonical Metrika queries, add a connected `SEO OS` source when available (partial/unavailable otherwise), and remove only the obsolete blanket position placeholder language. Do not let SEO failures reject the full dashboard loader.

- [ ] **Step 6: Verify tests and inspect real W28 data**

Run: `npm test && npm run typecheck`

Then run a read-only local loader script and verify: 12 patterns, 13 clusters, 5 opportunities, 0 tasks, 1 completed run, latest week `2026-W28`, and null positions preserved.

- [ ] **Step 7: Commit**

```bash
git add src/lib/zaruku-seo-os.ts src/lib/zaruku-seo.ts src/lib/zaruku-seo-os.test.ts
git commit -m "Load weekly Zaruku SEO OS data"
```

### Task 3: Shared ISO Week Comparison Controls

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Create: `src/components/ZarukuSeoWeekToolbar.tsx`

**Interfaces:**
- Consumes: `data.seo_os.weeks`, `latest_week`, and `previousAvailableWeek()`.
- Produces: controlled `primaryWeek`, nullable `comparisonWeek`, automatic previous-week action, and manual A/B selectors shared by SEO, SEO Ops, and Content.

- [ ] **Step 1: Add selection-state behavior**

Initialize primary week from `latest_week`. Keep comparison disabled by default. Add a compact segmented control for `Single` and `Compare`, primary/secondary native selects labeled with full ISO weeks, and an icon button with tooltip `Сравнить с предыдущей доступной неделей`.

- [ ] **Step 2: Implement edge states**

Disable the previous-week button when no earlier available week exists. Prevent A and B from silently becoming the same value by updating the other selector to the nearest available alternative. Preserve selection when navigating between dashboard tabs.

- [ ] **Step 3: Run static verification**

Run: `npm run typecheck && npm run lint`

Expected: exit 0; only already-known unrelated warnings may remain.

- [ ] **Step 4: Commit**

```bash
git add src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoWeekToolbar.tsx
git commit -m "Add Zaruku ISO week comparison controls"
```

### Task 4: SEO Analytics Panels

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Create: `src/components/ZarukuSeoAnalytics.tsx`

**Interfaces:**
- Consumes: selected A/B weeks, position trends, clusters, and source metadata.
- Produces: inverted position chart, coverage display, selected-week cluster table, and comparison deltas.

- [ ] **Step 1: Render positions by section**

Add a responsive line chart grouped by section. Set the Y axis domain and `reversed` behavior so position 1 is visually highest. Exclude null position points and show coverage in tooltip/legend text. In comparison mode, emphasize A and render B with a dashed line.

- [ ] **Step 2: Render the cluster table**

Filter clusters to primary week and provide section/status filtering. Columns: section, query, position, change, matched URL, status. Render negative delta as green upward movement, positive as red decline, null as em dash, and `no_data` as a grey `не найдено` badge. Open matched links with `target="_blank" rel="noreferrer"`.

- [ ] **Step 3: Replace misleading pending position panel**

Remove the current panel that states all positions are pending. Keep compact pending cards specifically for GSC/Webmaster impressions, clicks, and CTR. Label SEO OS as tracked Yandex SERP positions rather than a substitute for Webmaster.

- [ ] **Step 4: Verify analytics states**

Run: `npm run typecheck && npm run lint`

Use dashboard data fixtures or the local API to verify W28, null positions, empty comparison, and mobile horizontal table scrolling.

- [ ] **Step 5: Commit**

```bash
git add src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoAnalytics.tsx
git commit -m "Build Zaruku SEO position analytics"
```

### Task 5: SEO Operations And Traffic Visibility

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Create: `src/components/ZarukuSeoOperations.tsx`
- Create: `src/components/ZarukuTrafficVisibility.tsx`

**Interfaces:**
- Consumes: shared A/B week state, opportunities, tasks, runs, and traffic visibility rows.
- Produces: `SEO Ops` navigation view and Content-tab combo panel.

- [ ] **Step 1: Add the SEO Ops navigation and opportunity funnel**

Add `seo_ops` to `TabId` and navigation with a workflow-oriented Lucide icon. Render decision counts for pending, approved, rejected, and carried-over; approve rate uses only approved plus rejected. Show priority, confidence, target URL, and reject reason in the detail table.

- [ ] **Step 2: Add the task board**

Render counts by status and a bounded table. Give `awaiting_medical_review` a prominent red badge. Render Notion links safely. For W28's empty task set, render exactly `ждёт первого approve`.

- [ ] **Step 3: Add rhythm health**

Render every generated calendar week, including synthetic missing weeks. Show status, `serp_requests / 50`, LLM tokens, and digest count. Use red treatment for failed and missing states, and visually distinguish noop from completed.

- [ ] **Step 4: Add traffic versus visibility to Content**

Render weekly section traffic as bars and average position as an inverted-axis line. Use only dictionary section names. In compare mode, show A/B values and deltas in a scannable table below the chart so exact values remain accessible.

- [ ] **Step 5: Verify UI compilation**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0, with no new lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoOperations.tsx src/components/ZarukuTrafficVisibility.tsx
git commit -m "Add Zaruku SEO operations and visibility views"
```

### Task 6: Documentation, API And Browser Verification

**Files:**
- Modify: `ZARUKU-SEO-PENDING-SOURCES.md`
- Modify: `DASHBOARDS-MEMORY.md`
- Modify: `../DASHBOARDS-MEMORY.md`

**Interfaces:**
- Consumes: completed dashboard payload and UI.
- Produces: accurate operational documentation and verified deployment candidate.

- [ ] **Step 1: Update source documentation**

Document SEO OS as connected for weekly Yandex tracked positions, opportunities, tasks, and pipeline telemetry. Keep GSC/Webmaster pending for impressions/clicks/CTR and DataForSEO pending for AI visibility. Record that sections now come from `seo_section_patterns`.

- [ ] **Step 2: Run complete local verification**

Run: `npm test && npm run lint && npm run typecheck && npm run build`

Expected: tests pass and all build gates exit 0. Record any pre-existing lint warnings separately.

- [ ] **Step 3: Inspect dashboard API**

Start the app on an available local port and request `/api/dashboard/28`. Verify the payload contains connected `seo_os`, latest `2026-W28`, 13 clusters, 5 opportunities, empty tasks, one run, and no regression to Metrika arrays.

- [ ] **Step 4: Verify the browser experience**

At desktop and mobile widths verify: dashboard loads; SEO and SEO Ops navigation works; W28 is selected; previous comparison is disabled with one week; manual selectors are stable; inverted chart is nonblank; `no_data` is grey; tasks empty state is correct; Content combo is readable; no controls overlap.

- [ ] **Step 5: Commit documentation**

```bash
git add ZARUKU-SEO-PENDING-SOURCES.md DASHBOARDS-MEMORY.md
git commit -m "Document Zaruku SEO OS integration"
```

From the parent repository:

```bash
git add DASHBOARDS-MEMORY.md dashboard-next
git commit -m "Update Zaruku SEO OS dashboard pointer"
```

- [ ] **Step 6: Deploy and perform production smoke checks**

Run `npm run deploy`, then verify public health, dashboard 28 API, and the production SEO/SEO Ops/Content views. Do not claim completion until these fresh checks pass.

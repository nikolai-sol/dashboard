# Zaruku SEO Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Zaruku SEO tab into a Russia-focused executive-to-detail workspace with unified Google/Yandex/SEO OS query and page views, responsive tables, and no database migration.

**Architecture:** Keep existing canonical loaders and `ZarukuSeoData` source boundaries, add Russia filters at the GSC and Metrika read edges, and build pure presentation adapters that aggregate exact phrases/URLs without persisting relationships. Split the large SEO tab into focused components while preserving SEO OS as the only writer and authoritative tracked-Yandex-position source.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Recharts, Node test runner, MySQL read models.

## Global Constraints

- Wait until the in-progress branch work is complete and integrated before starting implementation.
- This plan does not authorize deployment, database migration, production API probes, cron edits, secret changes, or SEO OS writes.
- Russia is the only intended geographic scope for the redesigned SEO workspace.
- Do not change database structure unless a separately reviewed source-contract task proves it unavoidable.
- Keep ReportingDash read-only for every `seo_*` table; SEO OS remains the only writer.
- Do not duplicate Yandex Search API collection.
- Keep Google average position, Yandex Webmaster average position, and SEO OS tracked position as three distinct metrics.
- Join queries only by normalized exact phrase and pages only by normalized exact URL.
- Keep source-specific actual weeks and fallback notices visible.
- Never convert missing positions to zero.
- Do not implement AI generation or AI chat in this plan; only preserve the agreed UI mount points in the design.

## Required Logic Changes

- GSC SQL read model: add `country = 'rus'` filtering before every Zaruku aggregation.
- Metrika Reports API read model: pass the Russia filter for SEO workspace reports.
- Presentation layer: aggregate source rows and combine them by normalized phrase/URL.
- SEO OS integration: enrich presentation rows from existing `seo_positions_weekly` DTO rows without writing anything back.
- No database schema change is planned.

## File Map

**Create:**

- `src/components/zaruku-seo-workspace.ts` — pure query/page aggregation, exact joins, KPI derivation, filters, and sorting.
- `src/components/zaruku-seo-workspace.test.ts` — transformation and source-boundary tests.
- `src/components/ZarukuSeoExecutiveSummary.tsx` — period context, executive source cards, and deterministic change strip.
- `src/components/ZarukuSeoExecutiveSummary.test.ts` — rendered executive summary contract.
- `src/components/ZarukuSeoQueryComparison.tsx` — unified sortable query workspace.
- `src/components/ZarukuSeoQueryComparison.test.ts` — table semantics, sort state, missing facts, and source-scope labels.
- `src/components/ZarukuSeoPageComparison.tsx` — unified page workspace.
- `src/components/ZarukuSeoPageComparison.test.ts` — URL grouping and mixed-period labelling.
- `src/components/ZarukuSeoDiagnostics.tsx` — collapsed secondary diagnostic panels without Countries.
- `src/components/ZarukuSeoDiagnostics.test.ts` — disclosure and panel-content contract.

**Modify:**

- `src/lib/zaruku-gsc.ts` — apply the Russia country filter to existing read queries.
- `src/lib/zaruku-gsc.test.ts` — prove every query is Russia-scoped before aggregation.
- `src/lib/zaruku-seo.ts` — make Metrika report filters explicit and apply the Russia filter to SEO reports.
- `src/lib/zaruku-seo.test.ts` — prove report parameters contain the Russia filter.
- `src/components/ZarukuSeoAnalytics.tsx` — allow the legacy cluster table to be hidden when the unified query workspace is present.
- `src/components/ZarukuSeoAnalytics.test.ts` — retain unavailable state and verify chart-only mode.
- `src/components/ZarukuSeoDashboard.tsx` — replace the flat SEO block list with the target workspace order and Russian labels.
- `src/components/ZarukuSeoDashboard.ui.test.ts` — update structural assertions and prohibit Countries/legacy duplicate tables.
- `DASHBOARDS-MEMORY.md` — record the final implemented UI/data-scope contract only after verification.

---

### Task 0: Integration Gate After The Other Branch Completes

**Files:**
- Read: `README.md`
- Read: `DASHBOARDS-MEMORY.md`
- Read: `src/components/ZarukuSeoDashboard.tsx`
- Read: `src/lib/zaruku-gsc.ts`
- Read: `src/lib/zaruku-seo.ts`
- Read: `src/lib/zaruku-seo-os.ts`

**Interfaces:**
- Consumes: the integrated branch state selected by the owner.
- Produces: a clean, current baseline for Tasks 1–8; no source changes.

- [ ] **Step 1: Confirm branch and worktree state**

Run:

```bash
git branch --show-current
git status --short
git log -5 --oneline
```

Expected: the intended integrated branch is active; any remaining changes are identified as owner changes before implementation starts.

- [ ] **Step 2: Re-read the current Zaruku contracts after integration**

Run:

```bash
rg -n "function SeoTab|country_summary|buildGscAccountQueries|fetchMetrikaReport|seo_positions_weekly" \
  src/components/ZarukuSeoDashboard.tsx \
  src/lib/zaruku-gsc.ts \
  src/lib/zaruku-seo.ts \
  src/lib/zaruku-seo-os.ts
```

Expected: every target still exists or its integrated replacement is identified before applying later tasks.

- [ ] **Step 3: Establish the pre-change test baseline**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS. If the integrated branch is already failing, record the exact failures and resolve ownership before starting this plan.

No commit is created for this read-only gate.

---

### Task 1: Enforce Russia Scope At Read Boundaries

**Files:**
- Modify: `src/lib/zaruku-gsc.ts`
- Modify: `src/lib/zaruku-gsc.test.ts`
- Modify: `src/lib/zaruku-seo.ts`
- Modify: `src/lib/zaruku-seo.test.ts`

**Interfaces:**
- Consumes: canonical GSC `country` values and Metrika Reports API parameters.
- Produces: `buildGscAccountQueries(...)` with the internal `ZARUKU_GSC_COUNTRY = "rus"` contract and `buildMetrikaReportParams(...)` whose facts are Russia-scoped before aggregation.

- [ ] **Step 1: Add failing GSC query-scope tests**

Extend the existing `buildGscAccountQueries` test with assertions equivalent to:

```ts
for (const query of Object.values(queries)) {
  assert.match(query.sql, /LOWER\(COALESCE\(country, ''\)\) = \?/);
  assert.ok(query.params.includes("rus"));
}
```

Also assert that the account, country, and week parameters each occur once for every query.

- [ ] **Step 2: Run the GSC test and verify failure**

Run:

```bash
node --import tsx --test src/lib/zaruku-gsc.test.ts
```

Expected: FAIL because the existing GSC SQL aggregates all countries.

- [ ] **Step 3: Add the GSC Russia filter without changing schema**

In `src/lib/zaruku-gsc.ts`, introduce:

```ts
export const ZARUKU_GSC_COUNTRY = "rus";

function countryClause(params: string[], country = ZARUKU_GSC_COUNTRY) {
  params.push(country);
  return "AND LOWER(COALESCE(country, '')) = ?";
}
```

Create one country clause per query parameter array and insert it into the `WHERE` block before grouping for `queries`, `summary`, `country_summary`, `landing_pages`, `brand_split`, `search_appearance`, and `search_type_summary`.

Do not remove `country_summary` from `ZarukuGscData`; it remains a compatibility field but is no longer rendered by the SEO tab.

- [ ] **Step 4: Run GSC tests**

Run:

```bash
node --import tsx --test src/lib/zaruku-gsc.test.ts
```

Expected: PASS, including query normalization, source availability, and Russia-scope assertions.

- [ ] **Step 5: Add failing Metrika parameter tests**

Export a parameter builder contract from `src/lib/zaruku-seo.ts` and test it with:

```ts
const params = buildMetrikaReportParams({
  counterId: "66624469",
  from: "2026-07-13",
  to: "2026-07-19",
  dimensions: "ym:s:searchPhrase",
  limit: 30,
  filters: ZARUKU_RUSSIA_FILTER,
});

assert.equal(params.get("filters"), "ym:s:regionCountry=='Russia'");
assert.equal(params.get("ids"), "66624469");
assert.equal(params.get("dimensions"), "ym:s:searchPhrase");
```

- [ ] **Step 6: Run the Zaruku loader test and verify failure**

Run:

```bash
node --import tsx --test src/lib/zaruku-seo.test.ts
```

Expected: FAIL because the builder/filter contract does not exist.

- [ ] **Step 7: Make the Metrika report filter explicit**

Add these contracts to `src/lib/zaruku-seo.ts`:

```ts
export const ZARUKU_RUSSIA_FILTER = "ym:s:regionCountry=='Russia'";

export type MetrikaReportRequest = {
  counterId: string;
  from: string;
  to: string;
  dimensions: string;
  limit: number;
  filters?: string;
};

export function buildMetrikaReportParams(request: MetrikaReportRequest) {
  const params = new URLSearchParams({
    ids: request.counterId,
    date1: request.from,
    date2: request.to,
    dimensions: request.dimensions,
    metrics: METRIKA_METRICS,
    sort: "-ym:s:visits",
    limit: String(request.limit),
    accuracy: "full",
  });
  if (request.filters) params.set("filters", request.filters);
  return params;
}
```

Extend `fetchMetrikaReport` and `fetchMetrikaReportsSequential` to accept the optional filter. Pass `ZARUKU_RUSSIA_FILTER` to the SEO-facing Reports API calls. Keep canonical table reads explicitly labelled as not country-scoped; do not relabel them as RF.

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node --import tsx --test src/lib/zaruku-gsc.test.ts src/lib/zaruku-seo.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 9: Commit the read-boundary change**

```bash
git add src/lib/zaruku-gsc.ts src/lib/zaruku-gsc.test.ts src/lib/zaruku-seo.ts src/lib/zaruku-seo.test.ts
git commit -m "fix: scope Zaruku SEO reads to Russia"
```

---

### Task 2: Build Exact-Join SEO Workspace Transformations

**Files:**
- Create: `src/components/zaruku-seo-workspace.ts`
- Create: `src/components/zaruku-seo-workspace.test.ts`

**Interfaces:**
- Consumes: `ZarukuGscQueryRow[]`, `ZarukuYandexWebmasterQueryRow[]`, `ZarukuSeoClusterRow[]`, GSC/Webmaster page rows, and Metrika landing rows.
- Produces: `buildUnifiedSeoQueryRows`, `sortUnifiedSeoQueryRows`, `filterUnifiedSeoQueryRows`, `buildUnifiedSeoPageRows`, and `buildSeoExecutiveSnapshot`.

- [ ] **Step 1: Write failing normalization and no-fuzzy-join tests**

Create fixtures where:

```ts
const googleQuery = "  Инвалидность   при онкологии ";
const yandexQuery = "инвалидность при онкологии";
const differentQuery = "инвалидность после онкологии";
```

Assert that the first two share one display row and `differentQuery` remains separate.

Assert that missing positions remain `null`, never `0`.

- [ ] **Step 2: Write failing weighted aggregation tests**

Use two Google rows for one query:

```ts
[
  { impressions: 100, clicks: 10, average_position: 2 },
  { impressions: 300, clicks: 15, average_position: 6 },
]
```

Expected aggregate:

```ts
{
  impressions: 400,
  clicks: 25,
  ctr: 6.25,
  average_position: 5,
}
```

- [ ] **Step 3: Write failing SEO OS ownership tests**

Assert that an exact SEO OS row contributes only:

```ts
{
  tracked_position: 4,
  delta_prev: -2,
  status: "found",
  section: "/map/",
  matched_url: "https://zaruku.ru/map/",
}
```

and does not overwrite Webmaster `average_position`.

- [ ] **Step 4: Run the new test and verify failure**

Run:

```bash
node --import tsx --test src/components/zaruku-seo-workspace.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement focused row contracts**

Define:

```ts
export type SeoSourceMetrics = {
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
};

export type UnifiedSeoQueryRow = {
  key: string;
  query: string;
  section: string | null;
  google: SeoSourceMetrics | null;
  webmaster: SeoSourceMetrics | null;
  seo_os: {
    tracked_position: number | null;
    delta_prev: number | null;
    status: "found" | "no_data";
    matched_url: string | null;
  } | null;
  google_pages: string[];
};

export type SeoQuerySortKey =
  | "google_position"
  | "webmaster_position"
  | "seo_os_position"
  | "impressions"
  | "clicks";

export type SeoQueryFilter = "all" | "top3" | "top10" | "top20" | "improved" | "declined" | "not_found";
```

Implement `normalizeQueryKey` as trim + `toLocaleLowerCase("ru-RU")` + whitespace collapse. Implement impression-weighted position and derived CTR. Keep a bounded, deduplicated list of source pages.

- [ ] **Step 6: Implement sorting and filters**

Sorting requirements:

```ts
// Nulls always last, for both ascending and descending position sorts.
// Stable tie break: query.localeCompare(..., "ru-RU").
```

Filters use the selected visible position source. `improved` means SEO OS `delta_prev < 0`; `declined` means `delta_prev > 0`; `not_found` means SEO OS status `no_data` or all three position values are null.

- [ ] **Step 7: Implement page rows and executive snapshot**

Define URL normalization using `new URL(value, "https://zaruku.ru")`, removal of query/hash, lowercase hostname, normalized slash, and no title-based matching.

Executive snapshot fields remain source-specific:

```ts
export type SeoExecutiveSnapshot = {
  google: SeoSourceMetrics | null;
  webmaster: SeoSourceMetrics | null;
  seo_os: { average_position: number | null; coverage: number | null } | null;
  ai: { presence_rate: number | null; mentions: number; citations: number } | null;
  post_click: { visits: number; users: number } | null;
};
```

- [ ] **Step 8: Run transformation tests**

Run:

```bash
node --import tsx --test src/components/zaruku-seo-workspace.test.ts
```

Expected: PASS for exact joins, aggregation, nulls-last sorting, filters, URL matching, mismatched rows, and SEO OS separation.

- [ ] **Step 9: Commit transformation layer**

```bash
git add src/components/zaruku-seo-workspace.ts src/components/zaruku-seo-workspace.test.ts
git commit -m "feat: add Zaruku SEO comparison read model"
```

---

### Task 3: Add Period Context And Executive Summary

**Files:**
- Create: `src/components/ZarukuSeoExecutiveSummary.tsx`
- Create: `src/components/ZarukuSeoExecutiveSummary.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`

**Interfaces:**
- Consumes: `SeoExecutiveSnapshot`, traffic period, selected SEO weeks, source actual weeks, and fallback notes.
- Produces: `ZarukuSeoExecutiveSummary` with explicit source scope and deterministic facts.

- [ ] **Step 1: Write the failing rendered contract test**

Render the component with `renderToStaticMarkup` and assert the output contains:

```text
Период поведения на сайте
Отчётная SEO-неделя
Google RF
Яндекс Вебмастер
SEO OS · Яндекс, отслеживаемые позиции
AI-видимость
```

Also assert that it does not contain `Countries`, `Страны`, or a claim that Webmaster is Russia-only.

- [ ] **Step 2: Run the component test and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoExecutiveSummary.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the executive component**

Use one period-context strip followed by a responsive four-card grid. Each card shows source, actual period, metric values, and coverage/scope note. Use deterministic selected-versus-comparison deltas only when both weeks exist for the same source.

Do not call the AI endpoint and do not render generated prose.

- [ ] **Step 4: Mount the summary first in `SeoTab`**

In `ZarukuSeoDashboard.tsx`, derive the snapshot through `buildSeoExecutiveSnapshot` and render:

```tsx
<ZarukuSeoExecutiveSummary
  snapshot={snapshot}
  trafficPeriod={data.period}
  primaryWeek={primaryWeek}
  comparisonWeek={comparisonWeek}
  sourcePeriods={sourcePeriods}
/>
```

Keep the AI Summary mount point immediately before this component documented in the design; do not add an empty UI placeholder.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --import tsx --test \
  src/components/ZarukuSeoExecutiveSummary.test.ts \
  src/components/zaruku-seo-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit executive hierarchy**

```bash
git add src/components/ZarukuSeoExecutiveSummary.tsx src/components/ZarukuSeoExecutiveSummary.test.ts src/components/ZarukuSeoDashboard.tsx
git commit -m "feat: add Zaruku SEO executive summary"
```

---

### Task 4: Add The Unified Sortable Query Workspace

**Files:**
- Create: `src/components/ZarukuSeoQueryComparison.tsx`
- Create: `src/components/ZarukuSeoQueryComparison.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`

**Interfaces:**
- Consumes: `UnifiedSeoQueryRow[]`, actual source weeks, default sort, and locale.
- Produces: accessible grouped columns, one active sort, quick filters, and bounded table scrolling.

- [ ] **Step 1: Write failing markup tests**

Assert rendered markup contains grouped labels:

```text
Фраза
Раздел
Google RF
Яндекс Вебмастер
SEO OS
Позиция
```

Assert sort controls are buttons, missing values render `—`, and no control is labelled simply `Яндекс RF`.

- [ ] **Step 2: Write failing interaction-state helper tests**

Extract a pure toggle helper:

```ts
toggleSeoSort(
  { key: "google_position", direction: "asc" },
  "google_position",
)
```

Expected result:

```ts
{ key: "google_position", direction: "desc" }
```

Selecting a new position key defaults to `asc` (`1 → 100`).

- [ ] **Step 3: Run the test and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoQueryComparison.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement the table**

Requirements:

- outer panel is `min-w-0`;
- table wrapper is `max-h-[42rem] overflow-auto`;
- table owns its `min-width`; the page does not;
- header is sticky;
- query and section columns remain readable;
- grouped source headers include actual source week;
- a source-week mismatch warning appears above the table;
- sort buttons expose current direction text and accessible state;
- filters are single-select buttons;
- URLs come only from source-provided GSC pages or SEO OS `matched_url`.

- [ ] **Step 5: Replace duplicate query tables**

Mount `ZarukuSeoQueryComparison` after the executive/change blocks. Remove the standalone `Запросы Яндекса`, `Google Search Console queries`, and SEO OS cluster-table rendering from the SEO tab only.

Do not remove the underlying DTOs or SEO Ops use of SEO OS data.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --import tsx --test \
  src/components/ZarukuSeoQueryComparison.test.ts \
  src/components/zaruku-seo-workspace.test.ts
```

Expected: PASS. The source-level dashboard structure assertions are updated once in Task 7, after both unified workspaces and diagnostics exist.

- [ ] **Step 7: Commit query workspace**

```bash
git add src/components/ZarukuSeoQueryComparison.tsx src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoDashboard.tsx
git commit -m "feat: unify Zaruku SEO query analysis"
```

---

### Task 5: Add The Unified Landing-Page Workspace

**Files:**
- Create: `src/components/ZarukuSeoPageComparison.tsx`
- Create: `src/components/ZarukuSeoPageComparison.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`

**Interfaces:**
- Consumes: unified page rows, source weeks, and Metrika traffic period.
- Produces: one page table with separate pre-click and post-click groups.

- [ ] **Step 1: Write failing URL and period-label tests**

Assert that these URLs join:

```text
https://zaruku.ru/map/?utm_source=test
/map/
```

Assert that `/map/` and `/map/moskva/` do not join.

Assert the rendered table shows both:

```text
SEO-неделя 2026-W29
Поведение на сайте 2026-03-03 — 2026-03-26
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoPageComparison.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement grouped page columns**

Render:

- URL/title;
- Google RF impressions, clicks, CTR, position;
- Webmaster impressions, clicks, CTR, position;
- Metrika visits, users, bounce rate, duration;
- SEO OS tracked-query count only for exact authoritative matched URLs.

Keep source periods visible. Do not calculate a synthetic conversion between impressions, clicks, and visits.

- [ ] **Step 4: Replace duplicate landing-page panels**

Remove standalone `Топ органических посадочных страниц`, `GSC landing pages`, and `Посадочные страницы Яндекса` from the SEO tab after the unified component is mounted.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --import tsx --test \
  src/components/ZarukuSeoPageComparison.test.ts \
  src/components/zaruku-seo-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit page workspace**

```bash
git add src/components/ZarukuSeoPageComparison.tsx src/components/ZarukuSeoPageComparison.test.ts src/components/ZarukuSeoDashboard.tsx
git commit -m "feat: unify Zaruku SEO landing page analysis"
```

---

### Task 6: Consolidate Secondary Diagnostics And Remove Countries

**Files:**
- Create: `src/components/ZarukuSeoDiagnostics.tsx`
- Create: `src/components/ZarukuSeoDiagnostics.test.ts`
- Modify: `src/components/ZarukuSeoAnalytics.tsx`
- Modify: `src/components/ZarukuSeoAnalytics.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`

**Interfaces:**
- Consumes: current GSC summary, brand split, search appearance, result type, semantic health, AI visibility, and SEO OS analytical data.
- Produces: one progressive-disclosure diagnostic region with no Countries panel.

- [ ] **Step 1: Write failing diagnostic structure tests**

Assert the component contains:

```text
Дополнительная диагностика
Устройства
Брендовые и небрендовые запросы
Внешний вид в поиске
Типы результатов
```

Assert it does not contain `Countries`, `Страны`, or `GSC countries`.

- [ ] **Step 2: Run the diagnostic test and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDiagnostics.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement progressive disclosure**

Use an accessible `<details>` region or equivalent controlled disclosure. Render the existing devices, brand/non-brand, appearances, and result-type tables inside it. Keep source period/fallback notes.

Do not render `data.gsc.country_summary`.

- [ ] **Step 4: Add chart-only mode to SEO OS analytics**

Extend `ZarukuSeoAnalytics` with:

```ts
type Props = {
  seoOs: ZarukuSeoOsData;
  primaryWeek: string | null;
  comparisonWeek: string | null;
  source?: ZarukuSeoSource;
  showClusterTable?: boolean;
};
```

Default `showClusterTable` to `true` for compatibility. Pass `false` from the redesigned SEO tab because the unified query workspace now owns row detail.

- [ ] **Step 5: Reorder the remaining SEO content**

After executive/query/page workspaces, render:

1. semantic health;
2. SEO OS position-by-section chart without duplicate cluster table;
3. AI visibility;
4. consolidated diagnostics;
5. post-click search-engine distribution and Metrika-known phrases.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --import tsx --test \
  src/components/ZarukuSeoDiagnostics.test.ts \
  src/components/ZarukuSeoAnalytics.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit diagnostic consolidation**

```bash
git add \
  src/components/ZarukuSeoDiagnostics.tsx \
  src/components/ZarukuSeoDiagnostics.test.ts \
  src/components/ZarukuSeoAnalytics.tsx \
  src/components/ZarukuSeoAnalytics.test.ts \
  src/components/ZarukuSeoDashboard.tsx
git commit -m "refactor: consolidate Zaruku SEO diagnostics"
```

---

### Task 7: Lock Information Architecture And Responsive Contracts

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`
- Modify: the new component tests from Tasks 3–6 when needed for responsive class contracts.

**Interfaces:**
- Consumes: all new SEO workspace components.
- Produces: final approved executive-to-detail order without duplicate tables or page-level overflow.

- [ ] **Step 1: Replace legacy source-text assertions with user-facing structure assertions**

Update `ZarukuSeoDashboard.ui.test.ts` to assert:

```ts
assert.match(source, /<ZarukuSeoExecutiveSummary/);
assert.match(source, /<ZarukuSeoQueryComparison/);
assert.match(source, /<ZarukuSeoPageComparison/);
assert.match(source, /<ZarukuSeoDiagnostics/);
assert.doesNotMatch(source, /title="GSC countries"/);
assert.doesNotMatch(source, /title="Запросы Яндекса"/);
assert.doesNotMatch(source, /title="Google Search Console queries"/);
```

Retain existing assertions for one AI visibility panel, Metrika phrase limitations, source fallback notes, and SEO OS availability.

- [ ] **Step 2: Add responsive class-contract assertions**

For every new table component, assert:

- the panel/root includes `min-w-0`;
- the scroll wrapper includes `overflow-auto` or `overflow-x-auto`;
- the table minimum width is inside that wrapper;
- header source metadata can wrap;
- no two-column panel combines a `min-w-[620px+]` table with a non-shrinking sibling outside a scroll wrapper.

- [ ] **Step 3: Run all component tests**

Run:

```bash
node --import tsx --test src/components/*.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run type and lint checks**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: PASS with no unused legacy helper/component imports.

- [ ] **Step 5: Commit final UI structure**

```bash
git add src/components
git commit -m "fix: make Zaruku SEO workspace readable and responsive"
```

---

### Task 8: Verify Data Truth, SEO OS Compatibility, And Layout

**Files:**
- Modify after verification: `DASHBOARDS-MEMORY.md`
- Read: `docs/superpowers/specs/2026-07-12-zaruku-seo-os-layer-design.md`
- Read: `docs/superpowers/specs/2026-07-13-zaruku-yandex-search-layers-design.md`

**Interfaces:**
- Consumes: completed Tasks 1–7.
- Produces: evidence that the UI is Russia-scoped where supported, source meanings remain distinct, and no DB/SEO OS write contract changed.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands PASS.

- [ ] **Step 2: Inspect generated GSC SQL without executing it**

Run a local test/helper that prints only normalized SQL structure, never credentials or row data, and verify each Zaruku query contains:

```sql
LOWER(COALESCE(country, '')) = ?
```

Expected: every GSC aggregate is filtered before `GROUP BY`.

- [ ] **Step 3: Confirm SEO OS remains read-only**

Run:

```bash
rg -n "INSERT|UPDATE|DELETE|REPLACE" src/lib/zaruku-seo-os.ts src/components/zaruku-seo-workspace.ts
```

Expected: no write statement. `seo_positions_weekly` remains selected only by `buildSeoOsAccountQueries`.

- [ ] **Step 4: Verify production-like desktop behavior locally**

Start the app using the normal local environment without migrations:

```bash
npm run dev
```

At 1280×720 verify:

- no document-level horizontal scrollbar;
- executive summary appears before detail;
- query and page tables scroll inside their panels;
- Google, Webmaster, and SEO OS positions are separately labelled;
- sorting by Google, Webmaster, and SEO OS position works in both directions;
- null positions remain last;
- Countries is absent;
- source-week mismatches remain visible.

- [ ] **Step 5: Verify mobile behavior**

At 390×844 verify:

- no document-level horizontal scrollbar;
- navigation remains usable;
- period context wraps;
- grouped tables scroll within the card;
- sort/filter controls are keyboard reachable and do not overlap;
- diagnostic disclosure opens and closes without layout breakage.

- [ ] **Step 6: Verify source semantics with fixture/API payload inspection**

Using a local fixture or existing authenticated dashboard response, not a production collector call, confirm:

- GSC rows exposed to the SEO workspace have `country = rus`;
- SEO OS tracked position comes from `seo_os.clusters[].serp_position`;
- Webmaster average position remains in its own group;
- different actual source weeks are labelled separately;
- no cross-source metric is presented as a synthetic score.

- [ ] **Step 7: Record the implemented contract**

Update `DASHBOARDS-MEMORY.md` with:

- Russia-scoped GSC/Metrika SEO reads;
- Countries removal;
- unified query/page workspaces;
- SEO OS authoritative tracked-position role;
- Webmaster region-grain limitation;
- AI Summary/chat extension points remain future work.

- [ ] **Step 8: Commit verification documentation**

```bash
git add DASHBOARDS-MEMORY.md
git commit -m "docs: record Zaruku SEO workspace contract"
```

## Explicit Data-Change Gate

The core plan requires no migration. Before implementation, the owner should treat the following as a separate decision:

- If `Яндекс Вебмастер` must be guaranteed Russia-only, the current stored grain is insufficient because it has no region/country field.
- Do not add a column merely to label existing rows as RF.
- First verify whether the upstream Webmaster endpoint/export can return an authoritative region scope.
- If it can, create a separate collector/schema design with provenance, backfill, and compatibility rules.
- If it cannot, keep Webmaster host-wide and use SEO OS for controlled RF Yandex position reporting.

## AI Follow-Up Boundary

After the core workspace is stable, create a separate design/plan for:

1. a Zaruku-specific AI summary payload and prompt grounded in source weeks, RF scope, SEO OS opportunities, and data-quality warnings;
2. a contextual chat endpoint and drawer scoped to active filters and selected query/page;
3. citations/anchors back to the exact dashboard rows used by the answer.

Do not reuse the current advertising-oriented summary payload for Zaruku SEO until that follow-up is approved.

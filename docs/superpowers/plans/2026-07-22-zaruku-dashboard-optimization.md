# Zaruku Dashboard Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full Zaruku dashboard truthful, readable, and client-oriented from executive state to operational detail while preserving existing source ownership and avoiding database or collector changes.

**Architecture:** Keep `ZarukuSeoData` as the read-only composition boundary, add explicit dataset metadata for period, geography, metric availability, and panel state, then split the large dashboard component into six focused tab components. Pure helpers own date policy, safe URLs, pagination, sorting, and trust-state derivation; current canonical and live-source loaders remain the only data inputs.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, Recharts, Node test runner, MySQL read models, Puppeteer browser verification.

## Global Constraints

- Data truth is implemented before navigation or visual reorganization.
- The target navigation is exactly `Обзор → SEO → Контент → Аудитория → Работы и задачи → Качество`.
- The default onsite period is the latest 28 complete days ending yesterday; an explicit valid `from`/`to` URL range or valid `days` selection overrides it.
- Search weeks and AI months remain independent source periods and never inherit the onsite period label.
- Users are never renamed or substituted as visits.
- Google average position, Yandex Webmaster average position, and SEO OS tracked position remain distinct metrics.
- `SEO-операции` is renamed to `Работы и задачи`; SEO OS remains the owner of approve, task, and run relationships.
- `Поведение` is merged into `Контент`.
- `Гео`, `Устройства`, and demographic audience are merged into `Аудитория`, with `город × /map/` as the first, explicitly product-oriented section.
- No Countries panel is rendered.
- RF wording is allowed only for GSC rows filtered to `country = 'rus'`, live Metrika cuts filtered to Russia, and Yandex Webmaster host data described without a country claim.
- Canonical traffic, page, organic-trend, traffic-visibility, and returning-content rows are not labelled RF-only under the current schema.
- This plan does not authorize edits under `src/db/migrations/**`, collector scripts, canonical bootstrap code, cron configuration, secrets, deployment, external API writes, or ReportingDash writes into SEO OS.
- If strict RF-only canonical reporting is required, stop before implementation and present the exact tables, columns, grains, writer changes, backfill window, validation queries, rollback steps, and affected UI panels for owner approval.
- No AI endpoint, placeholder panel, database table, collector, approval write, or chat implementation is part of this plan.
- Preserve the owner's existing uncommitted `README.md` change and never stage it with this work.

## Required Logic Changes

- Date selection: Zaruku's implicit range changes from saved/stale configuration to the latest 28 complete days; explicit URL selections continue to win.
- Read-model metadata: every redesigned dataset receives period, geography scope, state, source, and metric-availability metadata without changing stored rows.
- Content aggregation: missing visits remain unavailable and are not synthesized from users.
- Presentation: unsupported AI concentration/rank claims are removed; opportunity priority uses an explicit rank.
- UI composition: nine tabs become six; Behavior joins Content; Geo, Devices, and demographic Audience join the new Audience workspace.
- Large tables: query and page workspaces add search and pagination and mount no more than 50 body rows at once.
- Links: Zaruku content URLs normalize to `https://zaruku.ru`; external task links continue through the existing safe-link guard.
- Quality: trust state is derived from source freshness plus dataset state and names affected tabs rather than exposing unbounded raw errors.

## Locked Audit Contract (Approved 2026-07-22)

- Implement the honest read-only dashboard now; do not wait for a new Metrika canonical dimension table.
- GSC RF is ready for actual weeks `2026-W27..2026-W29`.
- Webmaster is ready without RF wording; its zero-row `2026-W30` summary does not prove a complete week.
- SEO OS positions/opportunities/tasks are ready; run counters before TASK-071 are labelled as incomplete historical telemetry.
- AI uses the `alisa_ai / 2026-07 / wm_alisa_manual` row and exposes its manual provenance.
- SOV row `2026-W29` is labelled as the actual 28-day window `2026-06-13..2026-07-10`, not as a one-week metric.
- Canonical onsite is unsegmented. For selection `2026-06-24..2026-07-21`, traffic coverage ends `2026-07-19` and returning-content coverage ends `2026-07-20`; panels show both requested and actual coverage.
- Page scope exposes users and pageviews only. It never synthesizes visits, site-unique users, bounce, duration, or depth.
- Section traffic uses pageviews plus section patterns and remains unsegmented.
- Search Appearance is empty.
- `city × /map/`, device, browser, OS, age, gender, and interest panels are unavailable until a stable stored contract exists. The production live Metrika API is not a fallback.
- The 40,757 channel-scope and 40,796 page-scope pageview totals remain separate and labelled by grain.
- No number is copied from SEO OS into an onsite dataset. Synchronization means shared definitions and reconciliation, not duplicated storage.

## File Map

**Create:**

- `src/lib/dashboard-date-range.ts` — pure Zaruku/default date-range selection.
- `src/lib/dashboard-date-range.test.ts` — complete-day and URL-override tests.
- `src/lib/zaruku-url.ts` — safe absolute Zaruku content URL normalization.
- `src/lib/zaruku-url.test.ts` — relative, absolute, foreign-host, and unsafe-scheme tests.
- `src/components/zaruku-dataset-state.ts` — dataset metadata, panel-state, metric-column, and trust-state helpers.
- `src/components/zaruku-dataset-state.test.ts` — empty/unavailable/partial/trust derivation tests.
- `src/components/zaruku-table-pagination.ts` — deterministic search and pagination helpers.
- `src/components/zaruku-table-pagination.test.ts` — page bounds and query-reset tests.
- `src/components/ZarukuPanelState.tsx` — shared client-facing populated/empty/unavailable/partial presentation.
- `src/components/ZarukuPeriodContext.tsx` — onsite/search/AI period disclosure.
- `src/components/ZarukuOverviewTab.tsx` — executive overview.
- `src/components/ZarukuContentTab.tsx` — merged content and behavior workspace.
- `src/components/ZarukuAudienceTab.tsx` — map demand, device, and demographic workspace.
- `src/components/ZarukuWorkTab.tsx` — weekly focus and SEO OS operations wrapper.
- `src/components/ZarukuQualityTab.tsx` — trust, impact, freshness, and collapsed diagnostics.

**Modify:**

- `src/lib/types.ts` — add read-only dataset metadata to `ZarukuSeoData`.
- `src/lib/dashboard-data-loader.ts` — delegate Zaruku period selection to the pure helper.
- `src/lib/zaruku-seo.ts` — populate metadata and stop visit substitution.
- `src/lib/zaruku-seo.test.ts` — enforce native metric grain and state semantics.
- `src/components/zaruku-north-star.ts` — factual AI focus copy only.
- `src/components/zaruku-north-star.test.ts` — prohibit unsupported percentages.
- `src/components/ZarukuSeoDashboard.tsx` — six-tab shell and focused tab composition.
- `src/components/ZarukuSeoDashboard.ui.test.ts` — navigation, grouping, and copy contract.
- `src/components/zaruku-seo-week-selection.ts` — toolbar visibility for the renamed tab.
- `src/components/zaruku-seo-week-selection.test.ts` — six-tab toolbar contract.
- `src/components/ZarukuSeoQueryComparison.tsx` — search and pagination.
- `src/components/ZarukuSeoQueryComparison.test.ts` — bounded rendering and search contract.
- `src/components/ZarukuSeoPageComparison.tsx` — search, pagination, and safe links.
- `src/components/ZarukuSeoPageComparison.test.ts` — bounded rendering and URL contract.
- `src/components/zaruku-seo-operations.ts` — explicit decision/priority/task sorting and readable labels.
- `src/components/zaruku-seo-operations.test.ts` — ordering and label tests.
- `src/components/ZarukuSeoOperations.tsx` — consume the pure ordering/label helpers.
- `DASHBOARDS-MEMORY.md` — record the verified six-tab and data-truth contract.

---

### Task 0: Baseline And Authorization Gate

**Files:**
- Read: `README.md`
- Read: `docs/superpowers/specs/2026-07-22-zaruku-dashboard-optimization-design.md`
- Read: `src/lib/zaruku-seo.ts`
- Read: `src/lib/types.ts`
- Read: `src/components/ZarukuSeoDashboard.tsx`

**Interfaces:**
- Consumes: commit `d59ac38` or its descendant and the approved design spec.
- Produces: a verified clean implementation baseline excluding the owner's `README.md`; no source change.

- [ ] **Step 1: Confirm branch, owner changes, and forbidden paths**

Run:

```bash
git branch --show-current
git status --short
git log -5 --oneline
```

Expected: branch `codex/zaruku-product-readiness`; `README.md` may be modified by the owner; no unexpected edits under database, collector, or cron paths.

- [ ] **Step 2: Confirm the schema gap before using RF wording**

Run:

```bash
rg -n "country|regionCountry|canonical_fact_metrika|traffic_visibility|returning" \
  src/lib/zaruku-gsc.ts src/lib/zaruku-seo.ts src/lib/zaruku-seo-os.ts src/lib/types.ts
```

Expected: GSC and live Metrika filters prove Russia scope; canonical traffic/content DTOs do not expose a country field. If that result differs, stop and amend the plan before coding.

- [ ] **Step 3: Establish the pre-change test baseline**

Run:

```bash
npm test
npm run typecheck
```

Expected: all tests and TypeScript checks pass. Existing unrelated failure output is recorded before Task 1 and is not hidden by later changes.

No commit is created for this read-only gate.

---

### Task 1: Complete-Day Zaruku Period Policy

**Files:**
- Create: `src/lib/dashboard-date-range.ts`
- Create: `src/lib/dashboard-date-range.test.ts`
- Modify: `src/lib/dashboard-data-loader.ts:339-389`

**Interfaces:**
- Consumes: `request.url`, `config.period_from`, `config.period_to`, dashboard type, and an injectable clock.
- Produces: `resolveDashboardDateRange(input: DashboardDateRangeInput): { from: string; to: string }`.

- [ ] **Step 1: Write failing date-policy tests**

Create `src/lib/dashboard-date-range.test.ts` with:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveDashboardDateRange } from "./dashboard-date-range";

const now = new Date("2026-07-22T10:00:00Z");

test("Zaruku defaults to the latest 28 complete UTC days", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/zaruku",
    configFrom: "2026-03-03",
    configTo: "2026-03-26",
    dashboardType: "zaruku_bi",
    now,
  }), { from: "2026-06-24", to: "2026-07-21" });
});

test("explicit Zaruku from/to overrides the rolling default", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/zaruku?from=2026-07-01&to=2026-07-14",
    configFrom: "2026-03-03",
    configTo: "2026-03-26",
    dashboardType: "zaruku_bi",
    now,
  }), { from: "2026-07-01", to: "2026-07-14" });
});

test("Zaruku days selection also ends on the last complete day", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/zaruku?days=7",
    configFrom: null,
    configTo: null,
    dashboardType: "zaruku_bi",
    now,
  }), { from: "2026-07-15", to: "2026-07-21" });
});

test("non-Zaruku dashboards preserve configured periods", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/other",
    configFrom: "2026-05-01",
    configTo: "2026-05-31",
    dashboardType: "generic",
    now,
  }), { from: "2026-05-01", to: "2026-05-31" });
});

test("multibrand preserves its current-month fallback", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/multibrand",
    configFrom: "2026-05-01",
    configTo: "2026-05-31",
    dashboardType: "multibrand",
    now,
  }), { from: "2026-07-01", to: "2026-07-31" });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --import tsx --test src/lib/dashboard-date-range.test.ts
```

Expected: FAIL with `Cannot find module './dashboard-date-range'`.

- [ ] **Step 3: Implement the pure resolver**

Create `src/lib/dashboard-date-range.ts`:

```ts
export type DashboardDateRange = { from: string; to: string };
export type DashboardDateRangeInput = {
  requestUrl: string;
  configFrom: string | null;
  configTo: string | null;
  dashboardType?: string;
  now?: Date;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function valid(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shift(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentMonth(now: Date): DashboardDateRange {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export function resolveDashboardDateRange(input: DashboardDateRangeInput): DashboardDateRange {
  const now = input.now ?? new Date();
  const params = new URL(input.requestUrl).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const daysRaw = params.get("days");
  if (valid(from) && valid(to)) return { from, to };

  const isZaruku = input.dashboardType === "zaruku_bi";
  const today = now.toISOString().slice(0, 10);
  const completeTo = shift(today, -1);
  const fallback = currentMonth(now);
  if (input.dashboardType === "multibrand" && !valid(from) && !valid(to) && !daysRaw) return fallback;

  const days = Number(daysRaw);
  if (Number.isInteger(days) && days > 0) {
    const rangeTo = isZaruku ? completeTo : today;
    return { from: shift(rangeTo, -(Math.floor(days) - 1)), to: rangeTo };
  }
  if (isZaruku) return { from: shift(completeTo, -27), to: completeTo };

  return {
    from: valid(input.configFrom) ? input.configFrom : fallback.from,
    to: valid(input.configTo) ? input.configTo : fallback.to,
  };
}
```

Replace the private date selection in `dashboard-data-loader.ts` with a call that passes `request.url`, nullable configuration values, and `dashboardType`. Keep `buildPreviousPeriod` unchanged.

- [ ] **Step 4: Verify focused and regression tests**

Run:

```bash
node --import tsx --test src/lib/dashboard-date-range.test.ts
npm test
npm run typecheck
```

Expected: PASS; the Zaruku default is `2026-06-24..2026-07-21` for the injected clock and other dashboards retain existing behavior.

- [ ] **Step 5: Commit the period policy**

```bash
git add src/lib/dashboard-date-range.ts src/lib/dashboard-date-range.test.ts src/lib/dashboard-data-loader.ts
git commit -m "fix: use complete-day periods for Zaruku"
```

---

### Task 2: Dataset Metadata And Native Metric Grain

**Files:**
- Modify: `src/lib/types.ts:600-628,1007-1045`
- Modify: `src/lib/zaruku-seo.ts:846-949`
- Modify: `src/lib/zaruku-seo.test.ts:89-149`
- Create: `src/components/zaruku-dataset-state.ts`
- Create: `src/components/zaruku-dataset-state.test.ts`

**Interfaces:**
- Consumes: canonical row arrays, live Metrika report `{ ok, rows, error }`, and actual source periods.
- Produces: `ZarukuDatasetMeta`, `ZarukuDatasetKey`, `dataset_meta`, `resolvePanelState(...)`, and `availableMetricColumns(...)`.

- [ ] **Step 1: Replace the visit-proxy test with native-grain tests**

In `src/lib/zaruku-seo.test.ts`, replace the proxy assertion with:

```ts
test("buildContentSections never converts users into visits", () => {
  const [section] = buildContentSections(
    [page("https://zaruku.ru/articles/example", 0, 9, 14)],
    [{ section: "Статьи", url_pattern: "/articles/", priority: 1 }],
  );
  assert.equal(section.visits, 0);
  assert.equal(section.users, 9);
  assert.equal(section.pageviews, 14);
  assert.equal(section.bounce_rate, undefined);
});
```

Create `src/components/zaruku-dataset-state.test.ts` with assertions for three distinct states:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { availableMetricColumns, resolvePanelState } from "./zaruku-dataset-state";

test("successful zero rows means empty, not unavailable", () => {
  assert.equal(resolvePanelState({ state: "empty", message: null }), "empty");
});

test("failed source means unavailable", () => {
  assert.equal(resolvePanelState({ state: "unavailable", message: "Срез Метрики недоступен" }), "unavailable");
});

test("page grain exposes users and pageviews but not visits", () => {
  assert.deepEqual(availableMetricColumns({
    visits: false, users: true, pageviews: true,
    bounce_rate: false, avg_duration_seconds: false, page_depth: false,
  }), ["users", "pageviews"]);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --import tsx --test src/lib/zaruku-seo.test.ts src/components/zaruku-dataset-state.test.ts
```

Expected: FAIL because visits still use the users proxy and dataset-state helpers do not exist.

- [ ] **Step 3: Add exact metadata types**

Add to `src/lib/types.ts`:

```ts
export type ZarukuDatasetState = "ready" | "empty" | "unavailable" | "partial";
export type ZarukuGeographyScope = "russia" | "host" | "unsegmented" | "mixed";
export type ZarukuMetricColumn = "visits" | "users" | "pageviews" | "bounce_rate" | "avg_duration_seconds" | "page_depth";
export type ZarukuDatasetKey =
  | "traffic_channels" | "organic_trend" | "content_sections" | "top_pages"
  | "high_bounce_pages" | "best_engagement_pages" | "returning_pages"
  | "search_engines" | "search_phrases" | "organic_landing_pages"
  | "map_city_demand" | "devices" | "source_devices" | "browsers"
  | "operating_systems" | "age" | "gender" | "interests";

export type ZarukuMetricAvailability = Record<ZarukuMetricColumn, boolean>;

export interface ZarukuDatasetMeta {
  state: ZarukuDatasetState;
  sources: ZarukuSeoSourceId[];
  period: { from: string; to: string };
  geography: ZarukuGeographyScope;
  metrics: ZarukuMetricAvailability;
  message: string | null;
}
```

Add this required field to `ZarukuSeoData` and update every in-repository fixture:

```ts
dataset_meta: Record<ZarukuDatasetKey, ZarukuDatasetMeta>;
```

- [ ] **Step 4: Implement state and metric helpers**

Create `src/components/zaruku-dataset-state.ts`:

```ts
import type { ZarukuDatasetMeta, ZarukuDatasetState, ZarukuMetricAvailability, ZarukuMetricColumn } from "@/lib/types";

const ORDER: ZarukuMetricColumn[] = [
  "visits", "users", "pageviews", "bounce_rate", "avg_duration_seconds", "page_depth",
];

export function resolvePanelState(meta: Pick<ZarukuDatasetMeta, "state" | "message">): ZarukuDatasetState {
  return meta.state;
}

export function availableMetricColumns(metrics: ZarukuMetricAvailability): ZarukuMetricColumn[] {
  return ORDER.filter((key) => metrics[key]);
}
```

- [ ] **Step 5: Remove the proxy and populate metadata at the composition edge**

In `buildContentSections`, replace:

```ts
const visits = page.visits > 0 ? page.visits : page.users;
```

with:

```ts
const visits = page.visits;
```

Build `dataset_meta` in `loadZarukuSeoData` using these fixed rules:

| Dataset | Geography | State input | Native metrics |
|---|---|---|---|
| traffic_channels, organic_trend, returning_pages | unsegmented | canonical rows | users/pageviews plus only fields actually returned |
| top_pages | mixed when Russia visit rows enrich unsegmented canonical page rows; otherwise unsegmented | canonical rows plus optional live visit rows | page metrics always; visit metrics only when the live cut succeeded |
| content_sections | unsegmented or russia | partial when canonical page rows are shown after a failed live visit cut | page metrics from canonical; visit metrics only when the live cut succeeded |
| search_engines, search_phrases, organic_landing_pages | russia | corresponding live report | visits/users/pageviews/behavior |
| map_city_demand, devices, source_devices, browsers, operating_systems, age, gender, interests | russia | corresponding live report | visits/users/pageviews/behavior |
| high_bounce_pages, best_engagement_pages | russia | landing-page live report | visits/users/pageviews/behavior |

Use `state: "empty"` when a report succeeded with zero rows, `state: "unavailable"` when `ok === false`, and `state: "partial"` only when visible fallback or mixed-scope rows remain. Use fixed client-facing messages such as `Срез Яндекс Метрики недоступен.` and `Показаны доступные canonical-данные без подтверждённого среза РФ.`; never copy `report.error`, tokens, request headers, or a raw response body into `message`.

Add loader assertions proving `dataset_meta.traffic_channels.geography === "unsegmented"`, successful Russian live cuts use `"russia"`, and mixed top-page enrichment uses `"mixed"`. The UI must disclose which metric comes from which scope when metadata is mixed.

- [ ] **Step 6: Verify native-grain and full type contracts**

Run:

```bash
node --import tsx --test src/lib/zaruku-seo.test.ts src/components/zaruku-dataset-state.test.ts
npm test
npm run typecheck
```

Expected: PASS; the test suite proves that 9 users remain 9 users and 0 visits.

- [ ] **Step 7: Commit the read-model truth layer**

```bash
git add src/lib/types.ts src/lib/zaruku-seo.ts src/lib/zaruku-seo.test.ts src/components/zaruku-dataset-state.ts src/components/zaruku-dataset-state.test.ts
git commit -m "fix: expose native Zaruku dataset grain"
```

---

### Task 3: Factual Copy, Safe URLs, And Work Ordering

**Files:**
- Create: `src/lib/zaruku-url.ts`
- Create: `src/lib/zaruku-url.test.ts`
- Modify: `src/components/zaruku-north-star.ts:240-275`
- Modify: `src/components/zaruku-north-star.test.ts:100-118`
- Modify: `src/components/zaruku-seo-operations.ts`
- Modify: `src/components/zaruku-seo-operations.test.ts`
- Modify: `src/components/ZarukuSeoOperations.tsx:105-125`
- Modify: `src/components/ZarukuSeoDashboard.tsx:530-555`

**Interfaces:**
- Consumes: untrusted page URLs and existing SEO OS opportunity/task rows.
- Produces: `resolveZarukuContentUrl`, `sortSeoOpportunities`, `sortSeoTasks`, and `formatOpportunityTitle`.

- [ ] **Step 1: Write failing URL, copy, and ordering tests**

Create URL tests:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveZarukuContentUrl } from "./zaruku-url";

test("normalizes a relative Zaruku path", () => {
  assert.equal(resolveZarukuContentUrl("/map/clinics/42"), "https://zaruku.ru/map/clinics/42");
});
test("keeps a safe Zaruku absolute URL", () => {
  assert.equal(resolveZarukuContentUrl("https://zaruku.ru/articles/a?x=1"), "https://zaruku.ru/articles/a?x=1");
});
test("rejects foreign hosts and executable schemes", () => {
  assert.equal(resolveZarukuContentUrl("https://example.com/a"), null);
  assert.equal(resolveZarukuContentUrl("javascript:alert(1)"), null);
});
```

Replace the north-star assertion with:

```ts
assert.doesNotMatch(focus.ai, /67%|источник №1|во всех случаях/i);
assert.match(focus.ai, /упоминан|цитирован|нет данных/i);
```

Add operation helper assertions using priorities `low`, `high`, `medium` and decisions `rejected`, `pending`, `approved`; expected order is pending/approved before rejected and high/medium/low within the decision group.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --import tsx --test src/lib/zaruku-url.test.ts src/components/zaruku-north-star.test.ts src/components/zaruku-seo-operations.test.ts
```

Expected: FAIL for the missing URL helper, hard-coded 67% sentence, and lexicographic priority ordering.

- [ ] **Step 3: Implement the safe Zaruku URL boundary**

Create `src/lib/zaruku-url.ts`:

```ts
const ZARUKU_ORIGIN = "https://zaruku.ru";

export function resolveZarukuContentUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, ZARUKU_ORIGIN);
    if (url.protocol !== "https:" || url.hostname !== "zaruku.ru") return null;
    return url.toString();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Replace unsupported copy with aggregate facts**

In `buildWeeklyFocus`, construct the AI sentence only from stored aggregate counts:

```ts
const aiFocus = ai
  ? `ИИ: ${ai.mentions.toLocaleString("ru-RU")} упоминаний и ${ai.citations.toLocaleString("ru-RU")} цитирований за ${ai.period}`
  : "ИИ: для выбранной недели нет связанного месячного среза";
```

Return `ai: aiFocus` in `WeeklyFocus` and remove the now-unused `sections` variable if no other sentence consumes it.

In the dashboard AI card, replace “источник №1 во всех случаях” with a neutral sentence that reports only `mentions`, `citations`, and the actual month. Do not infer rank or page concentration.

- [ ] **Step 5: Implement explicit manager ordering and labels**

Add to `zaruku-seo-operations.ts`:

```ts
const DECISION_RANK = { pending: 0, approved: 1, carried_over: 2, rejected: 3 } as const;
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function sortSeoOpportunities<T extends { decision: keyof typeof DECISION_RANK; priority: keyof typeof PRIORITY_RANK; confidence: number; title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    DECISION_RANK[a.decision] - DECISION_RANK[b.decision]
      || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      || b.confidence - a.confidence
      || a.title.localeCompare(b.title, "ru-RU"));
}

const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  content_refresh: "Обновить контент",
  internal_linking: "Усилить внутреннюю перелинковку",
  new_content: "Подготовить новый контент",
  title_meta: "Улучшить title и description",
  section_ranking_gap: "Закрыть разрыв позиций раздела",
};

export function formatOpportunityTitle(row: { title: string; opportunity_type: string }): string {
  const title = row.title.trim();
  const looksInternal = !title || title === row.opportunity_type || title.startsWith(`${row.opportunity_type}:`);
  return looksInternal ? (OPPORTUNITY_TYPE_LABELS[row.opportunity_type] ?? "SEO-возможность для раздела") : title;
}
```

Add an equivalent `sortSeoTasks` rank with active statuses first: `awaiting_medical_review`, `needs_target_page`, `in_progress`, `draft`, `done`, `cancelled`. Use the helpers in `ZarukuSeoOperations.tsx`; keep `opportunity_id`, `task_id`, and raw `opportunity_type` inside expandable detail cells.

```ts
const TASK_STATUS_RANK = {
  awaiting_medical_review: 0,
  needs_target_page: 1,
  in_progress: 2,
  draft: 3,
  done: 4,
  cancelled: 5,
} as const;

export function sortSeoTasks<T extends { status: keyof typeof TASK_STATUS_RANK; title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    TASK_STATUS_RANK[a.status] - TASK_STATUS_RANK[b.status]
      || a.title.localeCompare(b.title, "ru-RU"));
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --import tsx --test src/lib/zaruku-url.test.ts src/components/zaruku-north-star.test.ts src/components/zaruku-seo-operations.test.ts
npm test
npm run typecheck
```

Expected: PASS and no source contains the unsupported statements.

```bash
rg -n "67%|источник №1 во всех случаях" src
```

Expected: no matches.

```bash
git add src/lib/zaruku-url.ts src/lib/zaruku-url.test.ts src/components/zaruku-north-star.ts src/components/zaruku-north-star.test.ts src/components/zaruku-seo-operations.ts src/components/zaruku-seo-operations.test.ts src/components/ZarukuSeoOperations.tsx src/components/ZarukuSeoDashboard.tsx
git commit -m "fix: remove unsupported Zaruku conclusions"
```

---

### Task 4: Shared Period, Panel-State, And Pagination UI

**Files:**
- Create: `src/components/ZarukuPanelState.tsx`
- Create: `src/components/ZarukuPeriodContext.tsx`
- Create: `src/components/zaruku-table-pagination.ts`
- Create: `src/components/zaruku-table-pagination.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: `ZarukuDatasetMeta`, onsite period, optional source weeks/months, row arrays, search query, page number.
- Produces: `ZarukuPanelState`, `ZarukuPeriodContext`, `filterAndPaginate<T>(...)`, and `clampPage(...)`.

- [ ] **Step 1: Write failing pure pagination and UI-contract tests**

Create `zaruku-table-pagination.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { filterAndPaginate } from "./zaruku-table-pagination";

const rows = Array.from({ length: 121 }, (_, index) => ({ id: index, label: `Фраза ${index}` }));

test("mount window is capped at 50 rows", () => {
  const result = filterAndPaginate(rows, "", 1, 50, (row) => row.label);
  assert.equal(result.rows.length, 50);
  assert.equal(result.totalPages, 3);
});

test("search is case-insensitive and clamps an out-of-range page", () => {
  const result = filterAndPaginate(rows, "ФРАЗА 12", 9, 50, (row) => row.label);
  assert.equal(result.page, 1);
  assert.equal(result.totalRows, 2);
});
```

Add source assertions to `ZarukuSeoDashboard.ui.test.ts` for the exact strings `Нет данных`, `Источник недоступен`, and `Метрика не собирается` in the shared state component.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --import tsx --test src/components/zaruku-table-pagination.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: FAIL because the shared files do not exist.

- [ ] **Step 3: Implement deterministic pagination**

Create `zaruku-table-pagination.ts`:

```ts
export function filterAndPaginate<T>(
  rows: T[], query: string, requestedPage: number, pageSize: number, searchableText: (row: T) => string,
) {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  const filtered = normalized
    ? rows.filter((row) => searchableText(row).toLocaleLowerCase("ru-RU").includes(normalized))
    : rows;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return { rows: filtered.slice(start, start + pageSize), page, totalPages, totalRows: filtered.length };
}
```

- [ ] **Step 4: Implement explicit shared states and periods**

`ZarukuPanelState` accepts `meta`, `hasRows`, and `children`. Its visible copy is exact:

```tsx
if (meta.state === "unavailable") return <div role="status">Источник недоступен. {meta.message ?? "Повторите попытку позже."}</div>;
if (meta.state === "empty" || !hasRows) return <div role="status">Нет данных за выбранный период.</div>;
return <>{children}</>;
```

When a requested metric is false in `meta.metrics`, table headers omit it; explanatory legend text uses `Метрика не собирается в этом источнике.`. A `partial` state renders its children plus a visible fallback disclosure.

`ZarukuPeriodContext` accepts:

```ts
type Props = {
  onsite: { from: string; to: string };
  search: Array<{ label: string; period: string }>;
  aiMonth: string | null;
};
```

It always shows onsite, shows only search periods backed by rows, and shows AI only when a monthly row exists. Differing search weeks are listed separately rather than collapsed.

- [ ] **Step 5: Verify and commit the shared foundation**

Run:

```bash
node --import tsx --test src/components/zaruku-table-pagination.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/components/ZarukuPanelState.tsx src/components/ZarukuPeriodContext.tsx src/components/zaruku-table-pagination.ts src/components/zaruku-table-pagination.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: add Zaruku dashboard state primitives"
```

---

### Task 5: Six-Tab Shell And Executive Overview

**Files:**
- Create: `src/components/ZarukuOverviewTab.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx:80-90,622-801,1110-1190`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`
- Modify: `src/components/zaruku-seo-week-selection.ts`
- Modify: `src/components/zaruku-seo-week-selection.test.ts`

**Interfaces:**
- Consumes: `ZarukuSeoData`, selected SEO weeks, `ZarukuPeriodContext`, and `ZarukuPanelState`.
- Produces: exact six-tab navigation and `ZarukuOverviewTab`.

- [ ] **Step 1: Write the failing six-tab and overview contract**

Update the UI test to assert this exact ordered array and absence of legacy tab labels:

```ts
const labels = ["Обзор", "SEO", "Контент", "Аудитория", "Работы и задачи", "Качество"];
for (const label of labels) assert.match(source, new RegExp(`label: "${label}"`));
assert.doesNotMatch(source, /label: "SEO-операции"|label: "Гео"|label: "Устройства"|label: "Поведение"/);
```

Update toolbar tests:

```ts
assert.equal(shouldShowSeoWeekToolbar("seo"), true);
assert.equal(shouldShowSeoWeekToolbar("content"), true);
assert.equal(shouldShowSeoWeekToolbar("work"), true);
assert.equal(shouldShowSeoWeekToolbar("overview"), false);
assert.equal(shouldShowSeoWeekToolbar("audience"), false);
assert.equal(shouldShowSeoWeekToolbar("quality"), false);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-seo-week-selection.test.ts
```

Expected: FAIL because the shell still declares nine tabs and `seo_ops`.

- [ ] **Step 3: Replace the navigation contract**

Use this exact union and order:

```ts
type TabId = "overview" | "seo" | "content" | "audience" | "work" | "quality";
const NAV = [
  { id: "overview", label: "Обзор", icon: LayoutGrid },
  { id: "seo", label: "SEO", icon: Search },
  { id: "content", label: "Контент", icon: FileText },
  { id: "audience", label: "Аудитория", icon: Users },
  { id: "work", label: "Работы и задачи", icon: ListChecks },
  { id: "quality", label: "Качество", icon: ShieldCheck },
] satisfies Array<{ id: TabId; label: string; icon: typeof LayoutGrid }>;
```

The active-tab switch renders only these six IDs. Give the content wrapper `id="zaruku-tab-content"`, and use one deterministic tab handler:

```ts
function selectTab(tab: TabId) {
  setActiveTab(tab);
  window.requestAnimationFrame(() => {
    document.getElementById("zaruku-tab-content")?.scrollIntoView({ block: "start" });
  });
}
```

- [ ] **Step 4: Build the Overview in executive-to-detail order**

`ZarukuOverviewTab` renders:

1. `ZarukuPeriodContext`.
2. A factual executive sentence derived from current rows plus a `healthy/partial/critical` confidence badge.
3. Visibility cards for Google RF, Webmaster host, SEO OS tracked coverage, and AI monthly presence.
4. Onsite traffic cards: visits, users, organic share, bounce rate, duration.
5. Acquisition ranking and organic trend, each wrapped in `ZarukuPanelState`.
6. One highest-volume content or `/map/` city signal.
7. A button that activates `quality`; raw source diagnostics stay out of Overview.

Do not render the former `Россия` share card and do not attach RF to canonical traffic or content labels.

- [ ] **Step 5: Verify shell behavior and commit**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-seo-week-selection.test.ts
npm test
npm run typecheck
```

Expected: PASS; six tabs remain and Overview contains no Countries or Russia-share card.

```bash
git add src/components/ZarukuOverviewTab.tsx src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-seo-week-selection.ts src/components/zaruku-seo-week-selection.test.ts
git commit -m "feat: simplify Zaruku dashboard navigation"
```

---

### Task 6: Searchable And Paginated SEO Detail Tables

**Files:**
- Modify: `src/components/ZarukuSeoQueryComparison.tsx`
- Modify: `src/components/ZarukuSeoQueryComparison.test.ts`
- Modify: `src/components/ZarukuSeoPageComparison.tsx`
- Modify: `src/components/ZarukuSeoPageComparison.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`

**Interfaces:**
- Consumes: `filterAndPaginate`, `resolveZarukuContentUrl`, unified query/page rows, source availability, and existing sort/filter helpers.
- Produces: query/page search inputs, independent query/page sorting, 50-row pages, page counters, next/previous controls, composite source state, and safe absolute links.

- [ ] **Step 1: Write failing component contracts**

In query and page component tests, assert source contains:

```ts
assert.match(source, /type="search"/);
assert.match(source, /filterAndPaginate/);
assert.match(source, /PAGE_SIZE = 50/);
assert.match(source, /Предыдущая/);
assert.match(source, /Следующая/);
```

For the page component also assert visible sort controls for `Google: показы`, `Яндекс: показы`, `Визиты`, and `Название`.

For page links also assert:

```ts
assert.match(source, /resolveZarukuContentUrl/);
assert.match(source, /target="_blank"/);
assert.match(source, /rel="noreferrer"/);
assert.doesNotMatch(source, /href=\{row\.url\}/);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoPageComparison.test.ts
```

Expected: FAIL because every result row still mounts and page links use the raw value.

- [ ] **Step 3: Add bounded query-table rendering**

Use `PAGE_SIZE = 50`, `query`, and `page` state. Apply existing source filter and sort first, then:

```ts
const paginated = useMemo(
  () => filterAndPaginate(visibleRows, query, page, PAGE_SIZE, (row) => row.query),
  [page, query, visibleRows],
);
useEffect(() => setPage(1), [filter, query, sort]);
```

Render `paginated.rows`, not `visibleRows`. The count reads `N найдено · страница X из Y`; previous/next buttons are disabled at bounds. Keep independent sort buttons for Google, Webmaster, and SEO OS positions.

- [ ] **Step 4: Add bounded page-table rendering and safe links**

Add `SeoPageSortKey = "google_impressions" | "webmaster_impressions" | "visits" | "label"` and explicit ascending/descending controls. Apply the same 50-row contract after the selected page sort. Search text combines label and normalized URL. Resolve each link once:

```tsx
const href = resolveZarukuContentUrl(row.url);
{href ? <a href={href} target="_blank" rel="noreferrer">{shortUrl(href)}</a> : <span>{shortUrl(row.url)}</span>}
```

Keep the Google, Webmaster, post-click Metrika, and SEO OS column groups visually separate.

Pass source availability into both comparison components:

```ts
type SourceAvailability = { google: boolean; webmaster: boolean; seoOs: boolean };
```

If every source is unavailable, render `Источник недоступен`. If at least one source succeeded but the filtered set is empty, render `Нет данных`. If some sources are unavailable while other rows remain, show the table with a `Частичные данные` disclosure naming only the unavailable sources.

- [ ] **Step 5: Verify bounded DOM behavior and commit**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoPageComparison.test.ts src/components/zaruku-table-pagination.test.ts
npm test
npm run typecheck
```

Expected: PASS; any one table page contains at most 50 body data rows.

```bash
git add src/components/ZarukuSeoQueryComparison.tsx src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoPageComparison.tsx src/components/ZarukuSeoPageComparison.test.ts src/components/ZarukuSeoDashboard.tsx
git commit -m "feat: paginate Zaruku SEO workspaces"
```

---

### Task 7: Merge Content And Behavior Into One Workspace

**Files:**
- Create: `src/components/ZarukuContentTab.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx:803-899`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: `ZarukuSeoData`, `dataset_meta`, SEO week selection, shared state/period components, and table pagination.
- Produces: one `content` tab with native metrics and no standalone Behavior tab.

- [ ] **Step 1: Write the failing Content composition test**

Assert that `ZarukuContentTab.tsx` contains these ordered headings and that the dashboard has no `BehaviorTab` call:

```ts
const headings = [
  "Состояние контента", "Разделы сайта", "Популярные страницы",
  "Лучшее удержание", "Риск отказов", "Возврат к контенту", "Все страницы",
];
for (let index = 1; index < headings.length; index += 1) {
  assert.ok(source.indexOf(headings[index - 1]) < source.indexOf(headings[index]));
}
assert.doesNotMatch(dashboardSource, /BehaviorTab|activeTab === "behavior"/);
```

Also assert that available columns come from `data.dataset_meta` and no code maps users into visits.

- [ ] **Step 2: Run the UI test and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: FAIL because Content and Behavior remain separate functions.

- [ ] **Step 3: Implement Content executive-to-detail composition**

Build the tab in this order:

1. Period context and four factual summary values: leading section, leading page, strongest returning page, largest high-bounce page.
2. Section workspace joining `content_sections`, `seo_os.traffic_visibility`, and `seo_os.position_trend` only by the existing normalized section key; use ranked traffic bars and separate position markers and never connect category positions with a line.
3. Top pages with a native-metric selector limited to metrics marked true in `dataset_meta.top_pages.metrics`.
4. Best engagement and high-bounce entry panels with their own live-report state.
5. Returning content buckets `1 день`, `2–7 дней`, `8–31 день`.
6. Searchable, sortable, paginated page detail using a 50-row page.

When page-scope metadata says visits are unavailable, columns are `Пользователи` and `Просмотры`; bounce, duration, depth, and visits are absent. A small legend says `Метрика не собирается в этом источнике.` rather than rendering em dashes under misleading headers.

- [ ] **Step 4: Remove legacy duplication and verify**

Remove the old inline `ContentTab` and `BehaviorTab` functions and their imports. Keep traffic-channel ranking on Overview only; Content does not repeat the entire acquisition table.

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/lib/zaruku-seo.test.ts
npm test
npm run typecheck
```

Expected: PASS; Content contains behavior and no users-as-visits path exists.

- [ ] **Step 5: Commit the Content workspace**

```bash
git add src/components/ZarukuContentTab.tsx src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: unify Zaruku content insights"
```

---

### Task 8: Build Audience Around City × Map Demand

**Files:**
- Create: `src/components/ZarukuAudienceTab.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx:822-872`
- Modify: `src/lib/zaruku-seo.ts:950-1025,1161-1275`
- Modify: `src/lib/zaruku-seo.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`
- Test: `src/components/zaruku-russia-map-data.test.ts`

**Interfaces:**
- Consumes: existing Russia map data, `map_city_demand`, device/demographic arrays, dataset metadata, and shared state components.
- Produces: one `audience` tab with geography as its first product section and no Countries panel.

- [ ] **Step 1: Write the failing Audience order test**

Assert these strings occur in this order:

```ts
const sections = [
  "География спроса каталога", "Спрос по городам России", "Устройства",
  "Источник × устройство", "Браузеры и ОС", "Возраст и пол", "Интересы",
];
```

Assert `География спроса каталога` appears before `Возраст и пол`, source contains `/map/`, and source does not contain a Countries heading or `geo_countries` rendering.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-russia-map-data.test.ts
```

Expected: FAIL because Geo, Devices, and Audience are still separate tabs.

- [ ] **Step 3: Implement the product-first Audience layout**

Build in this order:

1. Executive `город × /map/` block with map visits, mapped-city count, and top city.
2. Russia demand map and top-city list; unresolved/non-Russian names stay in an explicit excluded count and never receive invented coordinates.
3. Device summary cards for mobile, desktop, tablet, and supported other groups.
4. Compact source × device matrix showing visits/share, not a repeated six-metric behavior table.
5. Collapsed browser and OS detail.
6. Age and gender estimates.
7. Interests with the note `Оценка Яндекс Метрики; доступна только для части аудитории.`

Wrap the first block in `ZarukuPanelState`. Its unavailable message identifies live-cut failure; its empty message identifies zero `/map/` visits; a separate map-resolution message identifies rows that exist but lack valid coordinates.

- [ ] **Step 4: Remove legacy tab functions and verify**

Delete the inline `GeoTab`, `DevicesTab`, and old demographic-only `AudienceTab`. Remove the now-unused `countries` and general `cities` live report definitions, remove `geoCountries` from `buildKpis`, and return empty `geo_countries`/`geo_cities` arrays only for DTO compatibility. Keep `mapCityDemand` because it is the sole city cut used by the product signal. Add a loader test proving no general Countries/cities report is requested while the Russia-filtered `mapCityDemand` report remains.

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-russia-map-data.test.ts src/lib/zaruku-seo.test.ts
npm test
npm run typecheck
```

Expected: PASS; one Audience tab starts with the `/map/` demand signal.

- [ ] **Step 5: Commit the Audience workspace**

```bash
git add src/components/ZarukuAudienceTab.tsx src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts src/lib/zaruku-seo.ts src/lib/zaruku-seo.test.ts
git commit -m "feat: center Zaruku audience on map demand"
```

---

### Task 9: Rename And Reframe Works And Tasks

**Files:**
- Create: `src/components/ZarukuWorkTab.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/ZarukuSeoOperations.tsx`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: selected SEO weeks, factual `buildWeeklyFocus`, sorted opportunities/tasks, and unchanged SEO OS DTOs.
- Produces: `work` tab whose primary question is “Что команда делает с найденными возможностями?”.

- [ ] **Step 1: Write the failing work-tab order test**

Assert this sequence in `ZarukuWorkTab.tsx`:

```ts
const sections = [
  "Фокус недели", "Требуют решения", "Воронка возможностей", "Задачи", "Ритм конвейера",
];
```

Assert client-facing source has `Работы и задачи` and does not contain `SEO Ops временно недоступен`; the unavailable sentence must be `Работы и задачи временно недоступны.`.

- [ ] **Step 2: Run the UI test and verify failure**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-seo-operations.test.ts
```

Expected: FAIL because weekly focus and operations are still presented as internal SEO operations.

- [ ] **Step 3: Implement the client-facing wrapper**

`ZarukuWorkTab` renders:

1. `ZarukuPeriodContext` for actual selected SEO weeks.
2. Factual focus cards from `buildWeeklyFocus`; no generated conclusion exceeds the facts in the row.
3. Pending approvals and medical review actions before historical outcomes.
4. Existing `ZarukuSeoOperations` funnel, task links, and run rhythm.

Rename visible headings only. Do not rename database fields, DTO ownership, `seo_os`, opportunity IDs, task IDs, run IDs, or write paths.

- [ ] **Step 4: Verify SEO OS ownership and commit**

Run:

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-seo-operations.test.ts src/components/zaruku-north-star.test.ts
npm test
npm run typecheck
```

Expected: PASS; approved task links and run relationships are unchanged.

```bash
git add src/components/ZarukuWorkTab.tsx src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoOperations.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: present Zaruku work in client language"
```

---

### Task 10: Quality As A Trust And Impact Surface

**Files:**
- Modify: `src/components/zaruku-dataset-state.ts`
- Modify: `src/components/zaruku-dataset-state.test.ts`
- Create: `src/components/ZarukuQualityTab.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx:970-1035`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: `source_freshness`, `data_quality`, `dataset_meta`, and a fixed dataset-to-tab map.
- Produces: `deriveZarukuTrustState(...)` returning overall state, affected tabs, and bounded issue summaries.

- [ ] **Step 1: Write failing trust derivation tests**

Add:

```ts
test("one unavailable live cut makes trust partial and names its tab", () => {
  const result = deriveZarukuTrustState({
    freshness: [],
    datasets: { map_city_demand: unavailableMeta },
  });
  assert.equal(result.state, "partial");
  assert.deepEqual(result.affectedTabs, ["Аудитория"]);
});

test("failed core traffic source makes trust critical", () => {
  const result = deriveZarukuTrustState({
    freshness: [{ source_key: "metrika", freshness_status: "failed" }],
    datasets: { traffic_channels: unavailableMeta },
  });
  assert.equal(result.state, "critical");
  assert.ok(result.affectedTabs.includes("Обзор"));
  assert.ok(result.affectedTabs.includes("Контент"));
});
```

Use complete typed fixture fields required by `ZarukuSourceFreshnessRow` and `ZarukuDatasetMeta`.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --import tsx --test src/components/zaruku-dataset-state.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: FAIL because no trust helper or focused Quality component exists.

- [ ] **Step 3: Implement deterministic trust rules**

Use this tab map:

```ts
export const DATASET_TABS = {
  traffic_channels: ["Обзор"], organic_trend: ["Обзор"],
  content_sections: ["Контент"], top_pages: ["Контент"], high_bounce_pages: ["Контент"],
  best_engagement_pages: ["Контент"], returning_pages: ["Контент"],
  search_engines: ["SEO"], search_phrases: ["SEO"], organic_landing_pages: ["SEO"],
  map_city_demand: ["Аудитория"], devices: ["Аудитория"], source_devices: ["Аудитория"],
  browsers: ["Аудитория"], operating_systems: ["Аудитория"], age: ["Аудитория"],
  gender: ["Аудитория"], interests: ["Аудитория"],
} as const;
```

Rules:

- `critical`: core traffic is unavailable or its freshness row is failed.
- `partial`: any non-core visible dataset is unavailable/partial, or any source is delayed/failed while historical rows remain.
- `healthy`: all visible datasets are ready/empty and every connected source is healthy or explicitly disabled.
- Successful zero-row datasets stay `empty`; they do not prove other dependent cuts are healthy.
- Issue summaries are client-safe and capped at 180 characters; full technical content is placed inside a closed `<details>` element.

- [ ] **Step 4: Build Quality in trust-to-diagnostics order**

Render:

1. Overall `healthy`, `partial`, or `critical` card with Russian labels `Можно доверять`, `Частичные данные`, `Критическая проблема`.
2. Affected-tab chips and missing-cut list.
3. Source freshness table.
4. Data-quality checks.
5. Closed technical disclosure with `cron`, `collector`, and `rows` fields.

Never render tokens, credentials, request headers, raw unlimited payloads, or a claim that a zero-row cut proves current completeness.

- [ ] **Step 5: Verify and commit Quality**

Run:

```bash
node --import tsx --test src/components/zaruku-dataset-state.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
npm test
npm run typecheck
```

Expected: PASS.

```bash
git add src/components/zaruku-dataset-state.ts src/components/zaruku-dataset-state.test.ts src/components/ZarukuQualityTab.tsx src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: explain Zaruku data trust"
```

---

### Task 11: Responsive, Accessibility, Performance, And Contract Verification

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: focused tab/component files from Tasks 5–10 only when verification exposes a defect.
- Modify: `DASHBOARDS-MEMORY.md`

**Interfaces:**
- Consumes: the completed six-tab dashboard.
- Produces: a verified desktop/mobile implementation and final repository contract.

- [ ] **Step 1: Run the complete static verification suite**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: PASS with no test, lint, type, or production-build error.

- [ ] **Step 2: Start a local production server for browser verification**

Run:

```bash
npm run start
```

Expected: Next.js serves the built dashboard on port 3001. Do not call production collectors or external write APIs.

- [ ] **Step 3: Verify all six tabs at desktop width**

Using the repository browser-verification workflow, open the Zaruku route at 1440×1000 and check:

- navigation order exactly matches the six labels;
- onsite, search, and AI periods remain visibly distinct;
- no blank white panel appears;
- SEO query/page search and next/previous controls work;
- Google, Webmaster, and SEO OS position sorts remain independent;
- Content contains retention, bounce, and returning-content sections;
- Audience starts with `город × /map/`;
- Work follows Content and Audience;
- Quality names affected tabs and keeps technical diagnostics collapsed;
- relative Zaruku links open on `https://zaruku.ru`, never the dashboard host.

Expected: every check passes with screenshots retained only in a temporary verification directory.

- [ ] **Step 4: Verify 390 px behavior and bounded DOM size**

At 390×844 check:

- no document-level horizontal overflow (`document.documentElement.scrollWidth === document.documentElement.clientWidth`);
- wide tables scroll inside their own sections;
- the active navigation tab is visible;
- tab switching lands at the intended content heading;
- no query/page table mounts more than 50 data rows;
- map labels and metric cards remain readable.

Expected: every check passes. Fix only the smallest scoped component responsible for a failure, then rerun Step 1.

- [ ] **Step 5: Verify forbidden changes and RF wording**

Run:

```bash
git diff --name-only d59ac38..HEAD
rg -n "Россия|РФ|Russia|rus" src/components/ZarukuOverviewTab.tsx src/components/ZarukuContentTab.tsx src/components/ZarukuAudienceTab.tsx src/components/ZarukuSeoDashboard.tsx
git status --short
```

Expected: no database migration, collector, cron, secret, or deployment file changed; RF wording appears only on proven search/live Metrika surfaces; the owner's `README.md` remains unstaged.

- [ ] **Step 6: Record the implemented contract**

Append a dated entry to `DASHBOARDS-MEMORY.md` recording:

- exact six-tab order;
- latest-28-complete-days onsite default;
- independent search/AI periods;
- native metric-grain rule;
- canonical RF limitation;
- pagination size 50;
- no database/collector/cron/API-write change;
- AI Summary and AI Chat remain future extension points after normalized period-aware read models are trusted.

- [ ] **Step 7: Commit verification documentation**

```bash
git add DASHBOARDS-MEMORY.md src/components/ZarukuSeoDashboard.tsx src/components/ZarukuOverviewTab.tsx src/components/ZarukuContentTab.tsx src/components/ZarukuAudienceTab.tsx src/components/ZarukuWorkTab.tsx src/components/ZarukuQualityTab.tsx
git commit -m "docs: verify Zaruku dashboard optimization"
```

Expected: Git stages only files actually changed during verification; `README.md` is excluded.

---

## Approval Stop-Gate For Strict RF Canonical Data

This plan completes a truthful UI without changing stored data. If the owner later requires canonical traffic/content to be mathematically RF-only, execution stops before any code change and produces a separate proposal containing all of the following:

1. exact canonical tables and current primary/idempotency keys;
2. proposed generic country dimension and allowed values;
3. writer and read-query changes by file;
4. collector/API segment definitions;
5. historical backfill range and expected row volume;
6. reconciliation checks proving all-country totals versus country segments;
7. rollback SQL and read-model fallback;
8. SEO OS compatibility impact;
9. cron/runtime impact;
10. explicit owner approval.

No part of that proposal is implied or authorized by completing Tasks 0–11.

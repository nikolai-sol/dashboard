# Zaruku Design System and Table Frames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Zaruku tab use one responsive card and table system, prevent document-level overflow, stabilize Overview, and prepare panels for a future admin layout editor.

**Architecture:** Keep Zaruku domain components responsible for data, sorting, filtering, and pagination. Add presentation-only foundations: CSS tokens, a semantic chart palette, a stateless table frame, a code-owned panel registry, and grid wrappers. The dashboard page receives the active Zaruku tab only to control the global date UI; no data or persistence contract changes.

**Tech Stack:** Next.js 16.1.6 App Router, React 19.2.3, TypeScript 5, Tailwind 4 via `@theme inline`, Recharts, Nivo, Visx, Node test runner with `tsx`.

## Global Constraints

- `src/app/globals.css` remains the single theme owner; do not add `theme.ts`.
- Continue using `.card-surface`; do not add a generic React `Card` component.
- Do not replace Zaruku domain tables with `CustomTable`, `PlatformTable`, or one universal table.
- Do not unify Recharts, Nivo, and Visx; unify only their palette source.
- At 430, 768, 1024, 1279, 1280, and 1440 px, `document.scrollWidth` must equal the viewport width.
- Drag-and-drop controls, layout persistence, database changes, API mutations, deployment, collector changes, cron changes, and external sends are out of scope.
- Preserve `?mobile=1`, sorting, filtering, pagination, week comparison, links, exports, and horizontal table access.
- Use TDD for each behavior change and commit each independently reviewable task.

---

## File map

**Create**

- `src/lib/chart-palette.ts` — semantic chart colors shared by all Zaruku chart libraries.
- `src/components/ZarukuTableFrame.tsx` — stateless overflow and height shell.
- `src/components/ZarukuTableFrame.test.ts` — table-frame mode and containment tests.
- `src/components/zaruku-panel-layout.ts` — panel IDs, sizes, order, visibility, and resolver functions.
- `src/components/zaruku-panel-layout.test.ts` — registry uniqueness and order tests.
- `src/components/ZarukuPanelGrid.tsx` — responsive panel wrapper driven by registry metadata.
- `src/components/ZarukuSeoOperations.test.ts` — operations table-frame source contract.
- `src/components/DashboardHeader.test.ts` — date-control mode rendering contract.

**Modify**

- `src/app/globals.css` — tokens, shared card geometry, table-frame classes, Overview desktop grid.
- `src/lib/types.ts` — add `hidden` to `ZarukuDatasetState`.
- `src/components/ZarukuPanelState.tsx` — quiet/hidden state rendering.
- `src/components/zaruku-dashboard-primitives.test.ts` — state presentation expectations.
- `src/components/ZarukuSeoQueryComparison.tsx` — comparison frame containment.
- `src/components/ZarukuSeoPageComparison.tsx` — comparison frame containment.
- `src/components/ZarukuContentTab.tsx` — shared panels and standard/operational frames.
- `src/components/ZarukuAudienceTab.tsx` — shared panels and standard frame.
- `src/components/ZarukuSeoOperations.tsx` — operational/standard frames.
- `src/components/ZarukuTrafficVisibility.tsx` — standard frame and palette.
- `src/components/ZarukuSeoAnalytics.tsx` — standard frame and palette.
- `src/components/ZarukuSeoDiagnostics.tsx` — standard frames.
- `src/components/ZarukuSeoDashboard.tsx` — panel contract, palette, visible navigation, active-tab callback, Overview composition.
- `src/components/ZarukuOverviewTab.tsx` — panel grid and desktop layout semantics.
- `src/components/ZarukuSeoDashboard.ui.test.ts` — containment, navigation, and active-tab wiring checks.
- `src/components/DashboardHeader.tsx` — active/disabled/hidden date-control modes.
- `src/app/dashboard/[id]/page.tsx` — Zaruku tab/date-control ownership.
- Relevant chart components under `src/components/Zaruku*.tsx` — replace literal chart colors with the shared palette.

---

### Task 1: Theme tokens and semantic chart palette

**Files:**

- Create: `src/lib/chart-palette.ts`
- Modify: `src/app/globals.css`
- Test: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**

- Produces `ZARUKU_CHART_PALETTE` with `seo`, `position`, `comparison`, `danger`, `grid`, `axis`, `surface`, and `series` fields.
- Produces CSS utilities `.zaruku-panel`, `.zaruku-panel-header`, and `.zaruku-panel-body` based on `.card-surface`.

- [ ] **Step 1: Add failing source assertions for tokens and palette use**

```ts
const globalsSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const paletteSource = readFileSync(new URL("../lib/chart-palette.ts", import.meta.url), "utf8");

test("Zaruku uses shared visual tokens and chart palette", () => {
  for (const token of ["--accent-seo", "--accent-pos", "--ink", "--surface-alt", "--card-pad", "--gap-card", "--gap-section"]) {
    assert.match(globalsSource, new RegExp(token));
  }
  assert.match(paletteSource, /export const ZARUKU_CHART_PALETTE/);
  assert.match(source, /ZARUKU_CHART_PALETTE/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --test-name-pattern="shared visual tokens"`

Expected: FAIL because `chart-palette.ts` and the new tokens do not exist.

- [ ] **Step 3: Add tokens and palette**

```ts
export const ZARUKU_CHART_PALETTE = {
  seo: "var(--accent-seo)",
  position: "var(--accent-pos)",
  comparison: "var(--muted)",
  danger: "var(--destructive)",
  grid: "var(--border)",
  axis: "var(--muted)",
  surface: "var(--surface)",
  series: ["var(--accent-seo)", "var(--accent-pos)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"],
} as const;
```

Add the exact CSS variables from the design spec to `:root`, map relevant variables through `@theme inline`, and change `.card-surface` to use tokenized radius, border, surface, and shadow. Add panel header/body utilities with 20 px padding and 24 px section gaps.

- [ ] **Step 4: Replace Zaruku chart literals with palette fields**

Import `ZARUKU_CHART_PALETTE` and replace chart `stroke`, `fill`, axis, and grid literals in Zaruku chart components. Keep SVG geography styling semantic and sourced from the same palette where SVG attributes accept CSS variables.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --test-name-pattern="shared visual tokens|Overview|Russia"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/lib/chart-palette.ts src/components/Zaruku*.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: add zaruku visual tokens and chart palette"
```

### Task 2: Panel registry and future layout-editor readiness

**Files:**

- Create: `src/components/zaruku-panel-layout.ts`
- Create: `src/components/zaruku-panel-layout.test.ts`
- Create: `src/components/ZarukuPanelGrid.tsx`
- Modify: `src/components/ZarukuOverviewTab.tsx`

**Interfaces:**

```ts
export type ZarukuPanelSize = "compact" | "half" | "wide" | "full";
export type ZarukuPanelHeight = "compact" | "standard" | "tall" | "auto";
export type ZarukuPanelTab = "overview" | "seo" | "content" | "audience" | "work" | "quality";

export type ZarukuPanelDefinition = {
  panelId: string;
  tabId: ZarukuPanelTab;
  defaultOrder: number;
  defaultSize: ZarukuPanelSize;
  allowedSizes: readonly ZarukuPanelSize[];
  height: ZarukuPanelHeight;
  movable: boolean;
  visible: boolean;
};

export function resolveZarukuPanels(tabId: ZarukuPanelTab): ZarukuPanelDefinition[];
export function panelGridClass(size: ZarukuPanelSize): string;
```

- [ ] **Step 1: Write failing registry tests**

```ts
test("panel registry has unique IDs and valid defaults", () => {
  const ids = ZARUKU_PANEL_REGISTRY.map((panel) => panel.panelId);
  assert.equal(new Set(ids).size, ids.length);
  for (const panel of ZARUKU_PANEL_REGISTRY) {
    assert.ok(panel.allowedSizes.includes(panel.defaultSize));
  }
});

test("panel order is deterministic", () => {
  const overview = resolveZarukuPanels("overview");
  assert.deepEqual(overview.map((panel) => panel.panelId), [
    "overview.north_star",
    "overview.traffic_health",
    "overview.channels",
    "overview.organic_search",
  ]);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --import tsx --test src/components/zaruku-panel-layout.test.ts`

Expected: FAIL because the registry is missing.

- [ ] **Step 3: Implement registry and class resolver**

Create deterministic code-owned definitions for every top-level movable panel. Map sizes to Tailwind classes: `compact -> xl:col-span-3`, `half -> xl:col-span-6`, `wide -> xl:col-span-8`, `full -> xl:col-span-12`. Always include `min-w-0`.

- [ ] **Step 4: Implement the grid wrapper**

```tsx
export default function ZarukuPanelGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid min-w-0 grid-cols-1 gap-[var(--gap-section)] xl:grid-cols-12 ${className}`}>{children}</div>;
}

export function ZarukuPanelSlot({ panel, children }: { panel: ZarukuPanelDefinition; children: ReactNode }) {
  return <div data-panel-id={panel.panelId} data-panel-size={panel.defaultSize} className={panelGridClass(panel.defaultSize)}>{children}</div>;
}
```

- [ ] **Step 5: Migrate Overview to stable IDs without changing behavior**

Use `resolveZarukuPanels("overview")` and render the four known slots in registry order. Do not add drag handles or persistence.

- [ ] **Step 6: Run tests and commit**

Run: `node --import tsx --test src/components/zaruku-panel-layout.test.ts src/components/ZarukuSeoDashboard.ui.test.ts`

Expected: PASS.

```bash
git add src/components/zaruku-panel-layout.ts src/components/zaruku-panel-layout.test.ts src/components/ZarukuPanelGrid.tsx src/components/ZarukuOverviewTab.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: register zaruku panel layout metadata"
```

### Task 3: Stateless table-frame modes

**Files:**

- Create: `src/components/ZarukuTableFrame.tsx`
- Create: `src/components/ZarukuTableFrame.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**

```ts
export type ZarukuTableFrameMode = "compact" | "standard" | "operational" | "comparison";

type Props = {
  mode: ZarukuTableFrameMode;
  label: string;
  children: ReactNode;
  className?: string;
};
```

- [ ] **Step 1: Write failing render tests**

```ts
test("comparison frame owns both axes without a minimum width", () => {
  const html = renderToStaticMarkup(
    <ZarukuTableFrame mode="comparison" label="Запросы"><table><tbody><tr><td>row</td></tr></tbody></table></ZarukuTableFrame>,
  );
  assert.match(html, /data-table-mode="comparison"/);
  assert.match(html, /overflow-auto/);
  assert.match(html, /max-h-\[42rem\]/);
  assert.doesNotMatch(html, /min-w-\[/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test src/components/ZarukuTableFrame.test.ts`

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement the minimal frame**

Use a fixed class map. All modes include `w-full max-w-full min-w-0`. `compact` uses `overflow-x-auto`; `standard` uses `overflow-x-auto`; `operational` uses `max-h-[30rem] overflow-auto`; `comparison` uses `max-h-[42rem] overflow-auto`. Set `role="region"`, `aria-label`, and `tabIndex={0}` only on scrollable frames.

- [ ] **Step 4: Add shared table CSS**

Add `.zaruku-table`, `.zaruku-table-head`, `.zaruku-table-row`, `.zaruku-table-cell`, and `.zaruku-table-number` utilities. Bounded frames make `thead` sticky with an opaque surface and correct z-index.

- [ ] **Step 5: Run tests and commit**

Run: `node --import tsx --test src/components/ZarukuTableFrame.test.ts`

Expected: PASS.

```bash
git add src/components/ZarukuTableFrame.tsx src/components/ZarukuTableFrame.test.ts src/app/globals.css
git commit -m "feat: add zaruku table frame modes"
```

### Task 4: Fix SEO comparison containment first

**Files:**

- Modify: `src/components/ZarukuSeoQueryComparison.tsx`
- Modify: `src/components/ZarukuSeoPageComparison.tsx`
- Modify: `src/components/ZarukuSeoQueryComparison.test.ts`
- Modify: `src/components/ZarukuSeoPageComparison.test.ts`

**Interfaces:**

- Consumes `ZarukuTableFrame mode="comparison"`.
- Keeps table canvases at 1180 px and 1320 px.

- [ ] **Step 1: Change source tests to require frame containment**

```ts
assert.match(source, /<ZarukuTableFrame mode="comparison"/);
assert.match(source, /<table className="w-\[1180px\]/);
assert.doesNotMatch(source, /overflow-auto min-w-\[1180px\]/);
```

Use the equivalent 1320 px assertion for the page table.

- [ ] **Step 2: Run both tests and verify failure**

Run: `node --import tsx --test src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoPageComparison.test.ts`

Expected: FAIL on the old minimum-width wrappers.

- [ ] **Step 3: Replace wrappers**

Wrap each explicit-width table with `ZarukuTableFrame`. Put width only on `<table>`. Keep grouped headers, sticky header, pagination, sort, search, and URLs unchanged. Add a sticky first column only after its header/body backgrounds and z-index pass the focused test.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --import tsx --test src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoPageComparison.test.ts`

Expected: PASS.

```bash
git add src/components/ZarukuSeoQueryComparison.tsx src/components/ZarukuSeoPageComparison.tsx src/components/ZarukuSeoQueryComparison.test.ts src/components/ZarukuSeoPageComparison.test.ts
git commit -m "fix: contain zaruku comparison tables"
```

### Task 5: Migrate remaining tables and panels

**Files:**

- Modify: `src/components/ZarukuContentTab.tsx`
- Modify: `src/components/ZarukuAudienceTab.tsx`
- Modify: `src/components/ZarukuSeoOperations.tsx`
- Modify: `src/components/ZarukuTrafficVisibility.tsx`
- Modify: `src/components/ZarukuSeoAnalytics.tsx`
- Modify: `src/components/ZarukuSeoDiagnostics.tsx`
- Modify: related existing tests
- Create: `src/components/ZarukuSeoOperations.test.ts`

**Interfaces:**

- `standard` for bounded-width normal datasets.
- `operational` for Content all-pages, opportunities, tasks, and long run history.

- [ ] **Step 1: Add failing source assertions per table assignment**

Assert that Content uses at least one `operational` frame and standard frames, Operations uses operational frames, and Audience/Diagnostics use standard frames. Assert that no local `overflow-x-auto` directly wraps a Zaruku table in migrated files.

- [ ] **Step 2: Run focused component tests and verify failure**

Run: `node --import tsx --test src/components/ZarukuContentTab.test.ts src/components/ZarukuAudienceTab.test.ts src/components/ZarukuSeoOperations.test.ts src/components/ZarukuSeoAnalytics.test.ts`

Expected: FAIL on missing shared frames.

- [ ] **Step 3: Migrate tables without changing data behavior**

Replace only the outer overflow wrappers and shared table classes. Preserve all row slicing, search, sorting, pagination, week filters, links, badges, and empty-state inputs. Content all-pages must keep 50-row pagination but render within an operational frame.

- [ ] **Step 4: Consolidate panel shells**

Replace local white-card class strings with `card-surface zaruku-panel`; replace header/body class strings with the shared panel utilities. Keep domain-specific inner grids and `details` blocks.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --import tsx --test src/components/ZarukuContentTab.test.ts src/components/ZarukuAudienceTab.test.ts src/components/ZarukuSeoOperations.test.ts src/components/ZarukuSeoAnalytics.test.ts src/components/zaruku-dashboard-primitives.test.ts`

Expected: PASS.

```bash
git add src/components/ZarukuContentTab.tsx src/components/ZarukuContentTab.test.ts src/components/ZarukuAudienceTab.tsx src/components/ZarukuAudienceTab.test.ts src/components/ZarukuSeoOperations.tsx src/components/ZarukuSeoOperations.test.ts src/components/ZarukuTrafficVisibility.tsx src/components/ZarukuSeoAnalytics.tsx src/components/ZarukuSeoAnalytics.test.ts src/components/ZarukuSeoDiagnostics.tsx src/components/zaruku-dashboard-primitives.test.ts
git commit -m "refactor: standardize zaruku panels and tables"
```

### Task 6: Dataset states and Audience visibility

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `src/components/ZarukuPanelState.tsx`
- Modify: `src/components/zaruku-dashboard-primitives.test.ts`
- Modify: `src/components/ZarukuAudienceTab.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx`

**Interfaces:**

```ts
export type ZarukuDatasetState = "ready" | "empty" | "unavailable" | "partial" | "hidden";
export function isZarukuDatasetVisible(state: ZarukuDatasetState): boolean;
```

- [ ] **Step 1: Update state tests to require quiet and hidden behavior**

```ts
assert.equal(renderState("hidden"), "");
assert.equal(renderState("unavailable"), "");
assert.match(renderState("empty"), /Нет данных за период/);
assert.doesNotMatch(renderState("empty"), /amber/);
assert.match(renderState("partial"), /Данные полные по/);
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test src/components/zaruku-dashboard-primitives.test.ts`

Expected: FAIL on current unavailable/partial banners.

- [ ] **Step 3: Implement state presentation**

Return `null` for `hidden` and client-facing `unavailable`. Render empty as unframed gray text. Render partial after children as a quiet footer using `meta.period.to` when no safe client message exists.

- [ ] **Step 4: Hide Audience navigation only when all relevant datasets are unavailable/hidden**

Add a pure helper that checks the nine Audience metadata entries. Build `visibleNav` from `NAV`. If the active tab becomes hidden, return to `overview` in an effect rather than setting state during render.

- [ ] **Step 5: Run tests and commit**

Run: `node --import tsx --test src/components/zaruku-dashboard-primitives.test.ts src/components/ZarukuSeoDashboard.ui.test.ts src/components/ZarukuAudienceTab.test.ts`

Expected: PASS.

```bash
git add src/lib/types.ts src/components/ZarukuPanelState.tsx src/components/zaruku-dashboard-primitives.test.ts src/components/ZarukuAudienceTab.tsx src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: simplify zaruku dataset states"
```

### Task 7: One time owner per tab

**Files:**

- Modify: `src/components/DashboardHeader.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/zaruku-seo-week-selection.ts`
- Modify: `src/components/zaruku-seo-week-selection.test.ts`
- Modify: `src/app/dashboard/[id]/page.tsx`
- Create: `src/components/DashboardHeader.test.ts`

**Interfaces:**

```ts
export type ZarukuTabId = "overview" | "seo" | "content" | "audience" | "work" | "quality";
export type DashboardDateControlsMode = "active" | "disabled" | "hidden";

export function zarukuTimeOwner(tab: ZarukuTabId): "url" | "week" | "none";
```

- [ ] **Step 1: Write failing time-owner tests**

```ts
assert.equal(zarukuTimeOwner("overview"), "url");
assert.equal(zarukuTimeOwner("audience"), "url");
assert.equal(zarukuTimeOwner("seo"), "week");
assert.equal(zarukuTimeOwner("content"), "week");
assert.equal(zarukuTimeOwner("work"), "week");
assert.equal(zarukuTimeOwner("quality"), "none");
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test src/components/zaruku-seo-week-selection.test.ts`

Expected: FAIL because the helper is absent.

- [ ] **Step 3: Add explicit types and active-tab callback**

Export `ZarukuTabId`. Add `onActiveTabChange?: (tab: ZarukuTabId) => void` to `ZarukuSeoDashboard` and call it from the tab selection handler. Keep the component as active-tab owner.

- [ ] **Step 4: Add date-control modes to DashboardHeader**

When `active`, render current controls. When `disabled`, render the controls disabled plus “Эта вкладка работает по неделям”. When `hidden`, omit quick ranges and date inputs. Default is `active`, preserving non-Zaruku dashboards.

- [ ] **Step 5: Wire the Zaruku page branch**

Add `zarukuActiveTab` state to the page. Derive mode from `zarukuTimeOwner`. Pass the mode to `DashboardHeader` and callback to `ZarukuSeoDashboard`. Do not change data loading or URL behavior.

- [ ] **Step 6: Run tests and commit**

Run: `node --import tsx --test src/components/zaruku-seo-week-selection.test.ts src/components/ZarukuSeoDashboard.ui.test.ts src/components/DashboardHeader.test.ts`

Expected: PASS.

```bash
git add src/components/DashboardHeader.tsx src/components/ZarukuSeoDashboard.tsx src/components/zaruku-seo-week-selection.ts src/components/zaruku-seo-week-selection.test.ts src/components/ZarukuSeoDashboard.ui.test.ts src/components/DashboardHeader.test.ts 'src/app/dashboard/[id]/page.tsx'
git commit -m "feat: give zaruku tabs one time owner"
```

### Task 8: Stable desktop Overview

**Files:**

- Modify: `src/components/ZarukuOverviewTab.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**

- Consumes Overview panel registry IDs and grid size metadata.
- Produces `.zaruku-overview-grid` active only at `min-width: 1280px`.

- [ ] **Step 1: Add failing Overview structure tests**

Assert that Overview contains stable `data-panel-id` values, uses the desktop grid class, limits channel rows to six, and moves technical-tail copy into an information tooltip.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --test-name-pattern="Overview"`

Expected: FAIL on current free-flow layout.

- [ ] **Step 3: Implement desktop-only grid**

At 1280 px and above, use rows `96px 104px minmax(280px, 1fr)`, two equal columns, 16 px card gap, and `overflow: hidden` only inside Overview. Below 1280 px, use normal vertical flow.

- [ ] **Step 4: Bound channel and chart cards**

Render the first six acquisition rows and place remaining rows behind the existing `ещё` interaction. Move technical-tail copy to the heading tooltip. Make both row-three panels fill their grid areas without changing height as the period changes.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- --test-name-pattern="Overview|panel registry"`

Expected: PASS.

```bash
git add src/components/ZarukuOverviewTab.tsx src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts src/app/globals.css
git commit -m "feat: stabilize zaruku overview layout"
```

### Task 9: Full verification and documentation memory

**Files:**

- Modify only if implementation truth changed: `DASHBOARDS-MEMORY.md`

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: exit 0 with zero failing tests.

- [ ] **Step 2: Run static verification**

Run: `npm run lint && npm run typecheck`

Expected: both commands exit 0.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: exit 0 and Next.js reports a successful production build.

- [ ] **Step 4: Run source guards**

Run: `rg -n 'overflow-auto min-w-\[|overflow-x-auto min-w-\[' src/components/Zaruku*.tsx`

Expected: no matches.

Run: `rg -n '#[0-9a-fA-F]{3,8}|rgb\(' src/components/Zaruku*.tsx`

Expected: no chart color literals; any remaining non-chart SVG literal must be documented and justified before completion.

- [ ] **Step 5: Browser verification**

Run the production-like app locally and inspect Zaruku at 430, 768, 1024, 1279, 1280, and 1440 px. On every tab, assert `document.documentElement.scrollWidth === window.innerWidth`. Verify internal table scrolling, sticky headers, visible keyboard focus, tab/date behavior, `?mobile=1`, and 1440 × 900 Overview fit. Inspect Gidrofuril and Abbott at desktop and narrow widths for shared-token regressions.

- [ ] **Step 6: Update memory if behavior changed**

Document the final panel/table contract, time-owner model, and responsive guarantees in `DASHBOARDS-MEMORY.md`. Do not record planned behavior that did not pass verification.

- [ ] **Step 7: Commit verification-backed documentation**

```bash
git add DASHBOARDS-MEMORY.md
git commit -m "docs: record zaruku design system contract"
```

Skip this commit if the memory file already contains the verified truth and has no required change.

# Abbott Page Statistics Filtered Totals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-row Abbott page-stat summary that totals views and page-level visitors across all currently filtered rows.

**Architecture:** A pure helper calculates numeric totals from filtered `AbbottBiPageStatRow[]`. The dashboard formats those totals and passes an optional summary row into its local table component, which renders that row before paginated rows without changing existing empty-state behaviour.

**Tech Stack:** TypeScript, React, Next.js, Node test runner, Tailwind CSS.

## Global Constraints

- Totals use the complete filtered `pageStatRows`, never only `pageStatsPage.pageRows`.
- Only `Просмотры` and `Посетители` are totalled.
- `Посетители` remains a sum of page-level row values, not a deduplicated site-wide audience.
- No summary row is shown when the filtered result is empty.
- No API, database, collector, cron, secret, or Bitrix behaviour changes.

---

### Task 1: Filter-aware page-stat summary row

**Files:**
- Modify: `src/components/abbott-page-stats.ts`
- Modify: `src/components/abbott-page-stats.test.ts`
- Modify: `src/components/AbbottBiDashboard.tsx`
- Create: `src/components/abbott-page-stats-summary.ui.test.ts`

**Interfaces:**
- Consumes: `AbbottBiPageStatRow[]` after existing page-stat filters.
- Produces: `summarizeAbbottPageStats(rows): { pageviews: number; users: number }`.
- Produces: optional `DataTable.summaryRow?: Record<string, string>` rendered before `rows`.

- [ ] **Step 1: Write the failing helper tests**

Add tests that import `summarizeAbbottPageStats` and verify:

```ts
assert.deepEqual(summarizeAbbottPageStats([
  sampleRow,
  { ...sampleRow, pageviews: 43, users: 18 },
]), { pageviews: 200, users: 140 });
assert.deepEqual(summarizeAbbottPageStats([]), { pageviews: 0, users: 0 });
```

- [ ] **Step 2: Write the failing UI contract test**

Read `AbbottBiDashboard.tsx` and assert that:

```ts
assert.match(source, /summarizeAbbottPageStats\(pageStatRows\)/);
assert.match(source, /summaryRow=\{activeTab === "page_stats" \? pageStatsSummaryRow : undefined\}/);
assert.ok(source.indexOf("{summaryRow ? (") < source.indexOf("rows.map((row, index)"));
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test \
  src/components/abbott-page-stats.test.ts \
  src/components/abbott-page-stats-summary.ui.test.ts
```

Expected: FAIL because `summarizeAbbottPageStats` and the `summaryRow` rendering contract do not exist.

- [ ] **Step 4: Implement the pure total helper**

Add:

```ts
export function summarizeAbbottPageStats(rows: AbbottBiPageStatRow[]) {
  return rows.reduce(
    (totals, row) => ({
      pageviews: totals.pageviews + row.pageviews,
      users: totals.users + row.users,
    }),
    { pageviews: 0, users: 0 },
  );
}
```

- [ ] **Step 5: Render the optional table summary**

Extend `DataTable` with `summaryRow?: Record<string, string>`. When present, render it as the first `<tbody>` row using bold text and `bg-lime-50`, with empty cells preserved as empty. Keep the existing empty-state row when ordinary `rows` is empty.

In the page-stat path:

```ts
const pageStatsTotals = summarizeAbbottPageStats(pageStatRows);
const pageStatsSummaryRow =
  pageStatRows.length > 0
    ? {
        page_title: "Итого",
        pageviews: formatNumber(pageStatsTotals.pageviews, locale),
        users: formatNumber(pageStatsTotals.users, locale),
      }
    : undefined;
```

Pass:

```tsx
summaryRow={activeTab === "page_stats" ? pageStatsSummaryRow : undefined}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --import tsx --test \
  src/components/abbott-page-stats.test.ts \
  src/components/abbott-page-stats-summary.ui.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Run complete verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: tests pass, lint has no errors, typecheck exits `0`, and the production build exits `0`.

- [ ] **Step 8: Commit**

```bash
git add \
  docs/superpowers/specs/2026-07-23-abbott-page-stats-filtered-totals-design.md \
  docs/superpowers/plans/2026-07-23-abbott-page-stats-filtered-totals.md \
  src/components/abbott-page-stats.ts \
  src/components/abbott-page-stats.test.ts \
  src/components/abbott-page-stats-summary.ui.test.ts \
  src/components/AbbottBiDashboard.tsx
git commit -m "feat: add filtered totals to Abbott page stats"
```


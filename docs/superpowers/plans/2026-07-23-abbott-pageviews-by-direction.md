# Abbott Pageviews by Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth Abbott page-statistics chart that shows pageviews grouped by direction and follows the active page-stat filters.

**Architecture:** Keep data loading unchanged and derive the chart from the already-filtered `pageStatRows`. Put the aggregation in the focused `abbott-page-stats.ts` module so sorting, filtering, and the top-eight limit are covered by a unit test; the dashboard component only memoizes the helper result and renders the existing pie-chart component.

**Tech Stack:** TypeScript, React 19, Next.js 16, Recharts, Node test runner.

## Global Constraints

- Change only Abbott page-statistics files and Abbott documentation.
- Do not modify Zaruku components, routes, loaders, styles, or tests.
- Use `pageviews` from filtered `pageStatRows`; do not change API or database schemas.
- Exclude blank or placeholder directions and show at most eight directions.
- Keep the current mobile single-column layout and use two columns at the `xl` breakpoint.

---

### Task 1: Add and render pageviews-by-direction aggregation

**Files:**
- Modify: `src/components/abbott-page-stats.test.ts`
- Modify: `src/components/abbott-page-stats.ts`
- Modify: `src/components/AbbottBiDashboard.tsx`

**Interfaces:**
- Consumes: `AbbottBiPageStatRow[]` after the dashboard's current period, search, material, direction, and access filters.
- Produces: `buildAbbottPageviewsByDirection(rows: AbbottBiPageStatRow[], limit?: number): Array<{ label: string; value: number }>` and a fourth `AbbottPieChart`.

- [ ] **Step 1: Write the failing aggregation test**

Add the helper import and this test to `src/components/abbott-page-stats.test.ts`:

```ts
test("pageviews by direction sums filtered rows, removes unnamed groups, sorts, and limits results", () => {
  const rows = [
    { ...sampleRow, direction: "Кардиология", pageviews: 10 },
    { ...sampleRow, direction: "Неврология", pageviews: 25 },
    { ...sampleRow, direction: "Кардиология", pageviews: 7 },
    { ...sampleRow, direction: null, pageviews: 999 },
    { ...sampleRow, direction: "Без направления", pageviews: 998 },
  ];

  assert.deepEqual(buildAbbottPageviewsByDirection(rows, 2), [
    { label: "Неврология", value: 25 },
    { label: "Кардиология", value: 17 },
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --import tsx --test src/components/abbott-page-stats.test.ts
```

Expected: FAIL because `buildAbbottPageviewsByDirection` is not exported.

- [ ] **Step 3: Add the minimal aggregation helper**

Add to `src/components/abbott-page-stats.ts`:

```ts
const unnamedDirections = new Set(["", "—", "Без значения", "Без названия", "Без направления"]);

export function buildAbbottPageviewsByDirection(rows: AbbottBiPageStatRow[], limit = 8) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const direction = String(row.direction ?? "").trim();
    if (unnamedDirections.has(direction)) return;
    totals.set(direction, (totals.get(direction) ?? 0) + row.pageviews);
  });

  return Array.from(totals, ([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "ru"))
    .slice(0, Math.max(0, limit));
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --import tsx --test src/components/abbott-page-stats.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 5: Render the fourth chart from filtered rows**

In `src/components/AbbottBiDashboard.tsx`:

1. Import `buildAbbottPageviewsByDirection`.
2. Add:

```ts
const pageViewsDirectionData = useMemo(
  () => buildAbbottPageviewsByDirection(pageStatRows),
  [pageStatRows],
);
```

3. Change the page-stat chart wrapper to `className="grid gap-4 xl:grid-cols-2"`.
4. Insert after «Посетители по направлению»:

```tsx
<ChartCard title="Просмотры по направлению">
  <AbbottPieChart data={pageViewsDirectionData} colors={theme.pieColors} locale={locale} />
</ChartCard>
```

- [ ] **Step 6: Run focused and full verification**

Run:

```bash
node --import tsx --test src/components/abbott-page-stats.test.ts
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits with code 0.

- [ ] **Step 7: Confirm Abbott-only scope and commit**

Run:

```bash
git diff --name-only origin/main...HEAD
git status --short
```

Expected: only the two Abbott component files, the Abbott test, and Abbott design/plan documents are listed.

Commit:

```bash
git add src/components/AbbottBiDashboard.tsx src/components/abbott-page-stats.ts src/components/abbott-page-stats.test.ts docs/superpowers/specs/2026-07-23-abbott-pageviews-by-direction-design.md docs/superpowers/plans/2026-07-23-abbott-pageviews-by-direction.md
git commit -m "feat: add Abbott pageviews by direction chart"
```

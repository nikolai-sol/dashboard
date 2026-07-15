# ABBOTT Page Statistics Filters And Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select material filtering, searchable page title/URL filtering, and full filtered XLSX export to ABBOTT tab 3.

**Architecture:** Keep all changes at the existing page-stat presentation boundary. Pure filtering and export-row mapping helpers will live in a small component helper module and be consumed by `AbbottBiDashboard`; the selected dashboard period will be passed from the route only for the export filename.

**Tech Stack:** Next.js 16, React 19, TypeScript, `xlsx`, Node test runner.

## Global Constraints

- Do not change SQL, database schema, Bitrix normalization, or page-stat aggregation.
- Use OR semantics for selected material types; no selection means all types.
- Export all filtered rows, not only the current pagination slice.
- Preserve `page_title + URL` as page identity and expose raw numeric metrics in the workbook.

### Task 1: Add failing page-stat helper tests

**Files:**
- Create: `dashboard-next/src/components/abbott-page-stats.test.ts`
- Create: `dashboard-next/src/components/abbott-page-stats.ts`

**Interfaces:**
- `matchesSelectedMaterialType(materialType: string | null, selectedTypes: string[]): boolean`
- `matchesPageStatsSearch(pageTitle: string, url: string, query: string): boolean`
- `buildAbbottPageStatsExportRows(rows: AbbottBiPageStatRow[]): Array<Record<string, string | number>>`

- [ ] **Step 1: Write failing tests**

Cover empty material selection, OR matching with multiple selected values, case-insensitive title/URL search, and preservation of URL plus raw metrics in export rows.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run `npm test -- src/components/abbott-page-stats.test.ts` from `dashboard-next`.
Expected: FAIL because the helper module and functions do not exist yet.

### Task 2: Implement the pure helpers

**Files:**
- Modify: `dashboard-next/src/components/abbott-page-stats.ts`

- [ ] **Step 1: Implement the minimal helper behavior**

Use trimmed, lower-cased comparisons for search. Treat an empty selected material array as an unrestricted filter. Map each page row to labeled export columns while keeping numeric metrics numeric.

- [ ] **Step 2: Run the focused test and confirm it passes**

Run `npm test -- src/components/abbott-page-stats.test.ts`.
Expected: PASS with zero failures.

### Task 3: Connect the helpers to the dashboard UI

**Files:**
- Modify: `dashboard-next/src/components/AbbottBiDashboard.tsx`
- Modify: `dashboard-next/src/app/dashboard/[id]/page.tsx`

**Interfaces:**
- Add optional `periodFrom` and `periodTo` props to `AbbottBiDashboard`.
- Add a page-stat-only multi-select field with checkbox options.
- Replace the title dropdown with a text search field that searches page title and URL.
- Add an `Экспорт XLSX` button that writes all filtered rows with `xlsx`.

- [ ] **Step 1: Add the failing integration expectations through helper usage**

Use the existing `pageStatRows` pipeline as the single source for charts, table, and export. The material filter must call `matchesSelectedMaterialType`, the title/URL field must call `matchesPageStatsSearch`, and the export must call `buildAbbottPageStatsExportRows`.

- [ ] **Step 2: Implement the UI changes**

Keep current filter layout and pagination. Add clear controls for material selections and title/URL search. Generate filenames as `abbott-page-stats-<from>-<to>.xlsx`, falling back to `period` when a route period is unavailable.

- [ ] **Step 3: Run focused tests and typecheck**

Run `npm test -- src/components/abbott-page-stats.test.ts` and `npm run typecheck` from `dashboard-next`.
Expected: PASS and no TypeScript errors.

### Task 4: Run full verification and review the diff

**Files:**
- Review: `dashboard-next/src/components/AbbottBiDashboard.tsx`
- Review: `dashboard-next/src/components/abbott-page-stats.ts`
- Review: `dashboard-next/src/components/abbott-page-stats.test.ts`
- Review: `dashboard-next/src/app/dashboard/[id]/page.tsx`

- [ ] **Step 1: Run lint**

Run `npm run lint` from `dashboard-next` and require exit code 0.

- [ ] **Step 2: Run the production build**

Run `npm run build` from `dashboard-next` and require exit code 0.

- [ ] **Step 3: Check the final diff**

Run `git diff --check` and `git status --short`; verify no database, API, or unrelated files changed.

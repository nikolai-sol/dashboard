# Zaruku Reporting Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Zaruku’s traffic, user, source-health, and period labels truthful while preserving the current dashboard structure.

**Architecture:** The content/SEO weekly read model switches from pageview-scope rows to collector-backed entry-page session rows. Period-unique users come from a successful Metrika API report total instead of summing daily/source user counts. Source objects gain compact provenance and freshness metadata, and the UI explicitly separates the traffic date range from the SEO reporting week.

**Tech Stack:** Next.js, React, TypeScript, mysql2, Node test runner.

## Global Constraints

- Write each behavior test first and observe it fail before production changes.
- Do not deploy, backfill, edit production data, or change credentials.
- The app must switch to `analytics_scope='entry_page'` only after the collector plan is implemented; production rollout must backfill entry-page rows before deploying this app branch.
- Do not represent summed daily/source users as unique users.
- Existing `Geo` content means visitor geography; label it `География`, never `GEO`.
- Generative Engine Optimization remains labeled `AI/GEO visibility` and must disclose manual provenance until automated.
- Source metadata must distinguish `automated`, `external`, `manual`, and `not_connected` collection modes.
- Keep the existing nine-tab information architecture in this correctness phase; broader brand/agency simplification is a later subproject.

---

### Task 1: Preserve zero visits when only pageview-scope facts exist

**Files:**
- Modify: `src/lib/zaruku-seo.ts`
- Test: `src/lib/zaruku-seo.test.ts`

**Interfaces:**
- Consumes: pageview-scope rows where visits can legitimately be zero.
- Produces: section aggregates that never relabel users as visits.

- [ ] **Step 1: Write the failing zero-visit semantics test**

Replace the existing users-as-visit-proxy expectation with a test asserting `visits: 0`, while users and pageviews remain unchanged. Include bounce, duration, and depth input and assert no visit-weighted behavior aggregate is emitted when the visit denominator is zero.

- [ ] **Step 2: Verify the test fails**

Run: `node --import tsx --test src/lib/zaruku-seo.test.ts`

Expected: FAIL because `buildContentSections` currently substitutes users for zero visits.

- [ ] **Step 3: Remove the synthetic visit fallback**

In `buildContentSections`, replace `page.visits > 0 ? page.visits : page.users` with the real `page.visits`. Continue accumulating users and pageviews independently.

- [ ] **Step 4: Verify tests**

Run: `node --import tsx --test src/lib/zaruku-seo.test.ts`

Expected: all file tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zaruku-seo.ts src/lib/zaruku-seo.test.ts
git commit -m "fix: preserve zero page-scope visits"
```

### Task 2: Read canonical entry-page traffic for weekly content visibility

**Files:**
- Modify: `src/lib/zaruku-seo-os.ts`
- Test: `src/lib/zaruku-seo-os.test.ts`

**Interfaces:**
- Consumes: canonical `entry_page` rows created by the collector plan.
- Produces: the existing `ZarukuSeoTrafficVisibilityRow[]` contract with real session visits.

- [ ] **Step 1: Write the failing query contract test**

Change the existing assertion for `buildSeoOsTrafficQuery` to require:

```typescript
assert.match(query.sql, /analytics_scope\s*=\s*'entry_page'/i);
assert.doesNotMatch(query.sql, /analytics_scope\s*=\s*'page'/i);
```

- [ ] **Step 2: Verify the test fails**

Run: `node --import tsx --test src/lib/zaruku-seo-os.test.ts`

Expected: FAIL because the query still selects `page` rows.

- [ ] **Step 3: Switch the query scope**

Update only `buildSeoOsTrafficQuery` to select `analytics_scope = 'entry_page'`. Preserve account/date parameterization and aggregation.

- [ ] **Step 4: Verify tests**

Run: `node --import tsx --test src/lib/zaruku-seo-os.test.ts`

Expected: all file tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zaruku-seo-os.ts src/lib/zaruku-seo-os.test.ts
git commit -m "fix: use entry-page visits for seo visibility"
```

### Task 3: Stop double-counting period users

**Files:**
- Modify: `src/lib/zaruku-seo.ts`
- Test: `src/lib/zaruku-seo.test.ts`

**Interfaces:**
- Consumes: `periodUsers: number | null`, taken from the `totals[1]` of a successful Metrika report for the selected period.
- Produces: `buildKpis(...).find(kpi => kpi.key === 'users')` with a real period-unique value or unavailable state.

- [ ] **Step 1: Write failing KPI tests**

Export `buildKpis` for direct testing. Add one test where traffic rows sum to 1,900 users but `periodUsers` is 1,250; assert the users KPI value/raw value use 1,250. Add a second test with `periodUsers: null`; assert `value === '—'` and `raw_value === null`.

- [ ] **Step 2: Verify tests fail**

Run: `node --import tsx --test src/lib/zaruku-seo.test.ts`

Expected: FAIL because `buildKpis` is not exported and has no `periodUsers` input.

- [ ] **Step 3: Implement the KPI contract**

Add `periodUsers: number | null` to `buildKpis`. Stop accumulating `row.users` for this KPI. Use the Metrika period total when present; otherwise show unavailable. Add a note explaining that the value is unique for the selected traffic period.

- [ ] **Step 4: Select an authoritative Metrika total**

After building the `reports` array, select the first successful report whose `totals[1]` is finite. Pass that value to `buildKpis`; pass `null` if all live reports failed.

- [ ] **Step 5: Verify tests**

Run: `node --import tsx --test src/lib/zaruku-seo.test.ts`

Expected: all file tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zaruku-seo.ts src/lib/zaruku-seo.test.ts
git commit -m "fix: report unique metrika period users"
```

### Task 4: Explicit traffic-period and reporting-week UI

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/ZarukuSeoWeekToolbar.tsx`
- Test: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: existing `data.period` plus existing SEO week selection.
- Produces: visible labels that prevent users interpreting both controls as one period.

- [ ] **Step 1: Write failing source/UI assertions**

Assert the dashboard source contains `Период трафика:` before the date range, the toolbar contains `Отчётная SEO-неделя`, and the navigation contains `География` instead of the ambiguous `Гео` label.

- [ ] **Step 2: Verify the assertions fail**

Run: `node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts`

Expected: FAIL for all three missing labels.

- [ ] **Step 3: Implement the labels**

Prefix the header range with `Период трафика:`. Add a compact `Отчётная SEO-неделя` label to the toolbar without changing its selectors. Rename only the navigation label from `Гео` to `География`.

- [ ] **Step 4: Verify tests**

Run: `node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts`

Expected: all file tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoWeekToolbar.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "fix: clarify zaruku reporting periods"
```

### Task 5: Source provenance and freshness contract

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/zaruku-seo.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Test: `src/lib/zaruku-seo.test.ts`
- Test: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Produces fields on `ZarukuSeoSource`: `collection_mode`, `data_through`, and optional `freshness_note`.

- [ ] **Step 1: Write failing source metadata tests**

Export `buildSources` and assert:

```typescript
metrika.collection_mode === "automated"
webmaster.collection_mode === "automated"
seoOs.collection_mode === "external"
ai.collection_mode === "manual"
gsc.collection_mode === "not_connected"
```

Pass explicit data-through values into the builder and assert they survive unchanged. Add UI source assertions for the Russian labels `автоматически`, `внешний импорт`, `вручную`, and `не подключено`.

- [ ] **Step 2: Verify tests fail**

Run:

```bash
node --import tsx --test src/lib/zaruku-seo.test.ts
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: FAIL because the metadata fields/rendering do not exist.

- [ ] **Step 3: Add typed metadata**

Extend `ZarukuSeoSource` with:

```typescript
collection_mode: "automated" | "external" | "manual" | "not_connected";
data_through: string | null;
freshness_note?: string;
```

Make all static and dynamic sources provide these fields. AI/GEO must remain manual even when its status is connected.

- [ ] **Step 4: Derive truthful data-through values**

Use the selected traffic range end only as a range label, not freshness. Derive data-through from loaded facts when present: Webmaster summary report dates, SEO OS latest week, and AI capture/period metadata. Until a canonical Metrika MAX-date query is added, set Metrika `data_through` to `null` with a note that live dimensions are requested for the selected traffic period.

- [ ] **Step 5: Render compact source health**

In source badges/sidebar, show status plus collection-mode text. Show `data_through` only when present; keep low-level errors out of the brand-facing rail.

- [ ] **Step 6: Verify tests**

Run: `npm test`

Expected: all app tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/zaruku-seo.ts src/components/ZarukuSeoDashboard.tsx src/lib/zaruku-seo.test.ts src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "feat: expose zaruku source provenance"
```

### Task 6: Correct AGENTS operational memory

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: current local paths, repository topology, source matrix, and model guidance for future agents.

- [ ] **Step 1: Correct workspace and repository truth**

Replace `/Users/nicko/ReportingDash` with `/Users/nafanya/ReportingDash`. State that the root and `dashboard-next/` are separate Git repositories and name their relevant worktree/deploy responsibilities accurately.

- [ ] **Step 2: Add Zaruku source matrix**

Document Metrika automated canonical plus remaining live cuts, Webmaster automated daily, SEO OS external weekly SQL, AI/GEO manual, and GSC absent. Explicitly distinguish Geography from Generative Engine Optimization.

- [ ] **Step 3: Correct schedules and model guidance**

Add Metrika `06:12` and Webmaster `06:50`. Remove stale or contradictory cron/auth statements. State that model versions are configured in Codex configuration and must not be pinned in `AGENTS.md`.

- [ ] **Step 4: Verify**

Run:

```bash
rg -n "/Users/nicko|06:12|06:50|Generative Engine Optimization|Google Search Console|Codex configuration" AGENTS.md
npm test
```

Expected: no `/Users/nicko` matches; required operational terms are present; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update zaruku agent operating context"
```

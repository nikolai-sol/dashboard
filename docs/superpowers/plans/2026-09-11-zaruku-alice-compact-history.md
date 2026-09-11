# Compact Alice History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Zaruku monthly AI history compact and fully labelled, and prevent query-table text overlap.

**Architecture:** Preserve canonical reads and existing snapshot types. Change only the Alice presentation and its pure view helpers, preserving the shared table frame. Build and publish only the isolated Zaruku runtime after verification.

**Tech Stack:** React, TypeScript, Recharts, Tailwind, Node test runner, existing isolated Next.js build.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-11-zaruku-alice-compact-history-design.md`, approved by owner on 2026-09-11.
- No DB, collector, auth, password, cron, shared CSS, Abbott, advertising or MedRoche changes.
- Keep every published monthly value and label; no fabricated September value or silent gap interpolation.
- Keep table search, presence filter, pagination, source expansion and safe links.
- Only Zaruku deployment; no combined app restart or change to its routing.

### Task 1: Compact history and contained query table

**Files:** Modify `src/components/ZarukuAliceVisibilityTab.tsx`, `src/components/zaruku-alice-visibility-view.ts` only if needed, their existing `.test.ts` files, and `docs/superpowers/specs/2026-07-27-zaruku-design-system-table-frames-design.md`.

**Interfaces:** Consumes unchanged `ZarukuSeoData['alice_visibility']`. Produces the same component props and canonical values; optional pure chart helper belongs in the existing view module.

- [ ] Add failing render tests for no month selector, explicit latest-period label, fixed table geometry and bounded block links. Render with unsorted snapshots and stale `latestMonth` to prove newest published snapshot wins. Preserve original tests for unavailable/partial/summary-only data and safe links.

```ts
const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, {
  data: { ...data([augustSnapshot, julySnapshot]), latestMonth: '2026-07' }, locale: 'ru-RU',
}));
assert.doesNotMatch(markup, /<option[^>]*value="2026-0[78]"/);
assert.match(markup, /Последний загруженный месяц/);
assert.match(markup, /43,91%/);
assert.match(markup, /table-fixed/);
assert.match(markup, /<colgroup>/);
```

- [ ] Run `node --import tsx --test src/components/ZarukuAliceVisibilityTab.test.ts src/components/zaruku-alice-visibility-view.test.ts`; record expected new-test failures. Existing baseline: 18 pass.
- [ ] Remove month state/selector; use `selectAliceSnapshot(data.snapshots, null)` and label latest period. Show compact chart sized by month count, targeting 100–120 px per month and bounded within its own scroll region. Label every tick with month/year (two lines allowed), disable automatic tick omission, provide edge padding and percent axis starting at zero. Keep true temporal gaps visible and never substitute null with zero. Retain Recharts; no new chart library or dashboard framework.

```tsx
// Latest detail never follows a stale initial month hint.
const snapshot = selectAliceSnapshot(data.snapshots, null);
// Query-table geometry, percentages total 100.
<colgroup>{[28, 8, 8, 22, 24, 10].map((width, index) =>
  <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
// Existing link sanitizers remain authoritative.
// Link geometry: block min-w-0 max-w-full truncate.
// Query geometry: min-w-0 whitespace-normal [overflow-wrap:anywhere].
```

- [ ] Add coverage for 1, 2, 3, 12 months, chronological ordering, an absent middle month and exact original values. Tests must exercise actual helper/render behavior, not merely comments.
- [ ] Add explicit table design rules: fixed columns, query wrapping, bounded block link ellipsis with full href/title, expanded-source containment, sticky header and one overflow owner.
- [ ] Re-run covering tests and targeted ESLint, review diff, commit only Task 1 files; report red/green evidence and any unresolved concerns.

### Task 2: Verify and publish only Zaruku

**Files:** No production code expected. Update this plan and an operations note with actual evidence.

**Interfaces:** Consumes reviewed Task 1 commit; produces isolated build and truthful publication status.

- [ ] Independently review Task 1 against approved spec and inspect full change range.
- [ ] Run `npm run typecheck`, targeted tests, `npm --workspace apps/zaruku run build`, and artifact validation. Investigate failures without relaxing release safety checks.
- [ ] Browser-check real component fixtures at 430, 768, 1024 and 1440 px: labels visible, current two points compact, long URLs/query/source expansion contained, search/filter/pagination work. Use internal Codex browser for user-facing view.
- [ ] Read current isolated release runbook, attest live Zaruku and combined app markers and routing before publication. Use the already approved Zaruku-only operational path; stop if deployment needs new authority or contradicts current runbook.
- [ ] Publish reviewed source only when release gates pass; verify live latest-month label, all chart dates, query table layout and retained auth. Confirm combined app marker and routing unchanged.
- [ ] Record exact commands/results and remaining blockers, if any; never describe a local-only fix as deployed.

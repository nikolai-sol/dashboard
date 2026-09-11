# Task 1 report: compact Alice history and contained query table

## Scope

Implemented only the presentation and pure-view changes required by Task 1. No database, collector, authentication, deployment, route, shared CSS, or source-API change was made.

## RED evidence

Baseline command:

```text
node --import tsx --test src/components/ZarukuAliceVisibilityTab.test.ts src/components/zaruku-alice-visibility-view.test.ts
```

Baseline result before new tests: 18 tests, 18 pass, 0 fail.

After adding the new tests, the same command exited 1 with 22 tests: 18 pass and 4 fail. The failures were expected and specific to the missing behavior:

- stale `latestMonth` still selected July and rendered the month `<select>`;
- the query table lacked `table-fixed`, `<colgroup>`, wrapping, bounded block-link, and sticky-header markup;
- `buildAliceHistoryChart` did not exist for chronological gap-preserving rows;
- `buildAliceHistoryChart` did not exist for compact 1/2/3/12-month sizing.

The component-only RED command also exited 1 with 13 tests: 11 pass and 2 expected assertion failures.

## GREEN evidence

Focused test command:

```text
node --import tsx --test src/components/ZarukuAliceVisibilityTab.test.ts src/components/zaruku-alice-visibility-view.test.ts
```

Result after implementation: exit 0; 22 tests, 22 pass, 0 fail.

Targeted lint command:

```text
./node_modules/.bin/eslint src/components/ZarukuAliceVisibilityTab.tsx src/components/ZarukuAliceVisibilityTab.test.ts src/components/zaruku-alice-visibility-view.ts src/components/zaruku-alice-visibility-view.test.ts
```

Result: exit 0 with no output.

Diff hygiene command:

```text
git diff --check
```

Result: exit 0 with no whitespace errors.

## Implementation

- Removed Alice month state and the month selector. Detail always uses `selectAliceSnapshot(data.snapshots, null)`, so an unsorted snapshot array and stale `latestMonth` cannot override the newest published snapshot.
- Added an explicit `Последний загруженный месяц` label for the detail period.
- Added `buildAliceHistoryChart`, which sorts snapshots chronologically, inserts `null` rows for unpublished middle months, preserves published numeric values exactly, and sizes the chart at 112 px per represented month with a 240 px minimum.
- Put the fixed-width chart canvas inside its own bounded horizontal scroll region. Recharts receives every month row, `interval={0}`, zero tick gap, left/right axis padding, a two-line full month/year tick, a Y domain starting at zero, and `connectNulls={false}`.
- Changed the query table to fixed layout with columns `28/8/8/22/24/10`, totaling 100%, and wired the existing bounded operational-frame sticky-header class.
- Added anywhere wrapping for long uninterrupted queries and block-level bounded ellipsis for sanitized portal/external links. The complete sanitized URL remains in `href` and `title`; expanded source rows use the same containment.
- Kept search, presence filtering, pagination, source expansion, safe-link resolution, partial/unavailable/empty states, summary-only behavior, and canonical data types unchanged.
- Added the Alice-specific fixed-column, wrapping, link, expanded-source, sticky-header, and single-overflow-owner rules to the existing table-frame design document.

## Files changed

- `src/components/ZarukuAliceVisibilityTab.tsx`
- `src/components/ZarukuAliceVisibilityTab.test.ts`
- `src/components/zaruku-alice-visibility-view.ts`
- `src/components/zaruku-alice-visibility-view.test.ts`
- `docs/superpowers/specs/2026-07-27-zaruku-design-system-table-frames-design.md`
- `.superpowers/sdd/task-1-report.md`

## Self-review

- The helper covers one, two, three, and twelve months, chronological input normalization, an absent middle month, and exact unrounded values.
- Month-gap rows use `null`, not zero. The line explicitly does not connect through them.
- With a 48 px Y axis, 28 px X-axis edge padding, and small chart margins, the 240/336/1344 px canvases keep the practical adjacent-month step near the specified 100–120 px range instead of distributing two points across the panel.
- Table column percentages total exactly 100. `ZarukuTableFrame` remains the table's only scroll owner.
- Existing safe-link tests remain present and green; the new long-URL test verifies complete source `href` and `title` values.
- Concurrent release-predecessor edits in `deploy/zaruku/repository.json` and `scripts/freeze-zaruku-shadow-release*.mjs`, generated preview files, and operations notes were not edited or staged for this task.

## Concerns and follow-up boundary

- No unresolved Task 1 code concern is known from focused tests, lint, or diff review.
- Browser checks at 430/768/1024/1440 and the Zaruku production build are intentionally owned by parent Task 2. They were not claimed here.
- During implementation the filesystem briefly reached ENOSPC. The parent moved only disposable/recoverable build artifacts out of this worktree, after which edits and focused verification completed. No dependency install or build was run in this task.

# Task 4 Report: SEO Analytics Panels

## Delivered

- Added `ZarukuSeoAnalytics` to render selected-week Yandex SERP section positions, coverage, cluster filters, and a bounded cluster table.
- Wired controlled `primaryWeek` and `comparisonWeek` from `ZarukuSeoDashboard` into the SEO tab.
- Replaced the misleading all-position pending panel with a compact GSC/Webmaster pending card for impressions, clicks, and CTR only.
- Labelled SEO OS as tracked Yandex SERP positions, not a Webmaster substitute.

## TDD Evidence

### RED

1. `npm test -- src/components/zaruku-seo-analytics.test.ts`
   - Failed because `@/components/zaruku-seo-analytics` did not yet exist.
2. After implementing the helper, the delta presentation assertion failed for `3.5`: the intended Russian locale format was `3,5`, not `3.5`.

### GREEN

- Corrected the locale expectation and reran the focused test suite: 22 passed, 0 failed.
- Final full run: `npm test` passed with 22 tests and 0 failures.

The focused pure tests cover selected A/B trend transforms with coverage, selected-week section/status filtering, stable ordering, comparison deltas, green/red/neutral delta presentation, and safe HTTP(S)-only external links.

## Static Verification

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0 with 0 errors. The two existing `react-hooks/exhaustive-deps` warnings in `src/components/admin/DashboardUtmSourceMatching.tsx` (lines 66 and 152) remain unchanged.
- `git diff --check`: exit 0.

## UI Verification

- Started `npm run dev -- -p 3002` and verified `http://localhost:3002/dashboard/28`.
- Desktop: W28 rendered section position points, `7 / 13` coverage, null positions as non-plotted rows, no-data badges, and green upward/red downward changes.
- Empty comparison: enabling Compare with no selected B week left the position panel visible and the comparison select enabled without a second series or runtime error.
- Mobile at `390 x 844`: chart and filters remained readable. The cluster table container had `clientWidth: 280`, `scrollWidth: 960`, and `overflow-x: auto`, confirming horizontal scrolling. The shared panel header was adjusted to stack its metadata on mobile after visual inspection found title fragmentation.

## Files

- Modified: `src/components/ZarukuSeoDashboard.tsx`
- Added: `src/components/ZarukuSeoAnalytics.tsx`
- Added: `src/components/zaruku-seo-analytics.ts`
- Added: `src/components/zaruku-seo-analytics.test.ts`
- Added: `.superpowers/sdd/task-4-report.md`

## Self-Review

- The rank axis uses `domain={[1, "dataMax + 1"]}` with `reversed`, placing position 1 at the top.
- Null positions are excluded from plotted rows and do not connect lines; coverage remains visible in chart context and tooltip text.
- A is emphasized and B uses a dashed line whenever a comparison week is selected.
- The table uses a fixed `960px` minimum width, fixed columns, bounded vertical scrolling, stable row keys/order, and protocol-safe external URLs opened with `target="_blank" rel="noreferrer"`.
- The shared dashboard panel header change is limited to its responsive flex arrangement and prevents source badges from constraining mobile titles.

## Concerns

- The local dashboard record currently exposes only W28, so the rendered two-week dashed comparison line could not be verified against live data. The pure tests cover the A/B transform and comparison delta behavior.

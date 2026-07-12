# Task 1 Report: SEO OS Domain Types And Week Utilities

## Scope

Implemented the Task 1 domain contract and pure ISO-week utilities only. No SEO OS database query, loader, or UI behavior was implemented. The existing Zaruku SEO loader now returns the required empty SEO OS shape so `ZarukuSeoData` remains type-safe until Task 2 supplies real data.

## RED

Command:

```bash
npm test
```

Output (exit 1):

```text
Error: Cannot find module '@/lib/zaruku-seo-os'
Require stack:
- /Users/nafanya/ReportingDash/dashboard-next/src/lib/zaruku-seo-os.test.ts
...
tests 1
pass 0
fail 1
```

The failure was expected: the test suite imported the not-yet-created `zaruku-seo-os.ts` module.

## GREEN

Command:

```bash
npm test && npm run typecheck && git diff --check
```

Output (exit 0):

```text
tests 7
pass 7
fail 0

> dashboard-next@0.1.0 typecheck
> tsc --noEmit
```

`git diff --check` produced no output and exited 0.

## Files Changed

- `package.json`
  - Added the Node test runner command: `node --import tsx --test src/**/*.test.ts`.
- `src/lib/types.ts`
  - Added the `seo_os` source ID and normalized SEO OS DTOs for patterns, trends, clusters, opportunities, tasks, run telemetry, traffic visibility, and the aggregate `ZarukuSeoOsData` payload.
- `src/lib/zaruku-seo-os.ts`
  - Added pure ISO-week sorting/selection/iteration, deterministic section-pattern matching, nullable position aggregation, approve-rate calculation, and missing-rhythm-week generation.
- `src/lib/zaruku-seo-os.test.ts`
  - Added seven real-behavior unit tests for all required transformations and edge cases.
- `src/lib/zaruku-seo.ts`
  - Added the typed unavailable SEO OS placeholder required by the new mandatory `ZarukuSeoData.seo_os` property. It performs no database work and is the explicit Task 2 replacement point.
- `.superpowers/sdd/task-1-report.md`
  - Added this implementation report.

## Self-Review

- `ZarukuSeoSourceId` includes `seo_os`; `ZarukuSeoData` contains the required `seo_os` payload.
- Position aggregation preserves null positions, excludes them from averages, and counts `no_data` rows in coverage denominators.
- ISO week parsing validates the ISO week range and iterates calendar boundaries without parsing locale-formatted dates.
- Pattern matching uses longest `url_pattern` first, then lowest numeric priority, with input order only as a deterministic final tie-breaker.
- Approve rate uses approved plus rejected opportunities only and returns `null` when no decision exists.
- Rhythm generation fills every calendar week between first and last run with a `missing` run row.
- No mocks, test-only production APIs, database access, or UI changes were added.

## Concerns

No active blocker. `seo_os` is intentionally unavailable and empty until Task 2 replaces the placeholder with the account-scoped read-only loader.

## Task 1 Review Fix: Early ISO Years

### Fix Details

- `formatIsoWeek` now pads numeric years to four digits, preserving canonical `YYYY-Www` labels while iterating rhythm weeks.
- `isoWeeksInYear` now uses `setUTCFullYear(year, 0, 1)` on an existing `Date`, avoiding the `Date.UTC` remapping of years `0000` through `0099` to `1900` through `1999`.
- Added regression coverage for valid `0004-W53` and iteration across the `2020-W53` to `2021-W01` rollover.

### RED

Command:

```bash
node --import tsx --test --test-name-pattern='buildRhythmWeeks (accepts and preserves a zero-padded early ISO week 53|iterates through a 53-week ISO year boundary)' src/lib/zaruku-seo-os.test.ts
```

Output (exit 1):

```text
✖ buildRhythmWeeks accepts and preserves a zero-padded early ISO week 53
✔ buildRhythmWeeks iterates through a 53-week ISO year boundary
tests 2
pass 1
fail 1

Error: Invalid ISO week: 0004-W53
```

### GREEN

Focused command:

```bash
node --import tsx --test --test-name-pattern='buildRhythmWeeks (accepts and preserves a zero-padded early ISO week 53|iterates through a 53-week ISO year boundary)' src/lib/zaruku-seo-os.test.ts
```

Output (exit 0):

```text
✔ buildRhythmWeeks accepts and preserves a zero-padded early ISO week 53
✔ buildRhythmWeeks iterates through a 53-week ISO year boundary
tests 2
pass 2
fail 0
```

Full verification command:

```bash
npm test && npm run typecheck
```

Output (exit 0):

```text
tests 9
pass 9
fail 0

> dashboard-next@0.1.0 typecheck
> tsc --noEmit
```

### Review-Fix Concerns

No remaining concerns. The accepted ISO-year range remains exactly four digits (`0000` through `9999`), matching the existing parser contract.

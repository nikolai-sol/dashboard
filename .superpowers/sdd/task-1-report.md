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

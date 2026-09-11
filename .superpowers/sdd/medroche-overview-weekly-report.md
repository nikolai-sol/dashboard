# MedRoche overview weekly follow-up report

## Result

- The universal `apps/site-seo` overview keeps the accepted five-panel composition.
- `Поисковые системы` now presents only Google and Яндекс in a two-column grid. Other canonical engine rows remain untouched in MySQL and in the generic read model/export path; filtering is local to `Overview.tsx`.
- `Органический поиск` aggregates the observed canonical daily rows into ISO-week points. A single selected week produces one point and the accessible table exposes the same observed weekly sum. The chart shows visit-count Y-axis labels and ISO-week X-axis labels. No absent date is filled or extrapolated.
- A bare dashboard request now selects the previous completed ISO week, including the `2026-01-01` -> `2025-W52` boundary. GSC and Alice keep the current calendar-month default.
- Non-empty `analytics_scope='other'` facts covering all seven dates of the selected week now produce `trafficMeta.state='ready'` and `completeness='complete'`. Four covered dates remain `partial`; zero fact rows remain `missing` and are not converted to `complete_empty` without canonical coverage.
- No source API, collector, export, profile, release metadata, Zaruku runtime/source, dependency, deployment, cron, secret, or database data/schema change was made.

## TDD evidence

RED command:

```sh
node --import tsx --test apps/site-seo/src/lib/runtime.test.ts apps/site-seo/src/lib/db.test.ts apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/styles.test.ts
```

Observed RED: 51 tests, 46 passed, 5 failed for the intended missing behaviours:

1. previous completed default ISO week;
2. seven-date all-traffic week marked ready;
3. two-column Google/Яндекс-only overview;
4. weekly trend point and accessible weekly total;
5. labelled weekly chart axis geometry.

GREEN command:

```sh
node --import tsx --test apps/site-seo/src/lib/runtime.test.ts apps/site-seo/src/lib/db.test.ts apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/styles.test.ts
```

Observed GREEN: 51 tests, 51 passed, 0 failed.

## Verification

```sh
npm run typecheck:site-seo
```

Passed with exit code 0.

```sh
npm run test:site-seo
```

The first site-seo suite passed 122/122. The release/isolation suite passed 23/27; four `site-seo-build.test.mjs` cases stopped at the expected immutable-template guard `template source tree has uncommitted files`. That guard necessarily rejects the implementation-under-test before commit, and the worktree also contains pre-existing dirty `.superpowers/sdd/task-1-report.md` and `.superpowers/sdd/task-3-report.md` files which were not touched by this task. No product assertion failed before that guard.

```sh
git diff --check
```

Passed with exit code 0 before commit.

## Concerns

- The four immutable-template build tests cannot be green inside this dirty integration worktree until the separately owned template/profile release contract is advanced. This task intentionally did not edit profile or release metadata.
- Pre-existing dirty files `.superpowers/sdd/task-1-report.md`, `.superpowers/sdd/task-3-report.md`, and untracked `apps/site-seo/.next-medroche/` were preserved and excluded from the commit.

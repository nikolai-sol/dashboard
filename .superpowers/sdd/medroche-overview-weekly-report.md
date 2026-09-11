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

## Independent-review fix cycle

### Result

- Google and Яндекс overview rows now aggregate every matching canonical read-model row. Visits and pageviews are summed; bounce rate, average visit duration, and page depth use the same visit-weighted treatment as the canonical SQL read. Bing and other engines remain present in the generic read model/export path and are omitted only in this overview projection.
- The search-engine panel always renders exactly two visible slots in stable Google/Яндекс order. A missing engine uses `—`, an empty track, and explicit `нет строк за период` copy; it is not presented as a collected zero.
- Weekly Y ticks are derived once and reused by the visible axis and SVG grid. A zero maximum renders only the zero baseline; a maximum of one renders unique `1` and `0` ticks. The single ISO-week X label is centred with the single point.
- Traffic default-week calculation now derives its calendar date in the configured business timezone. At `2026-09-13T22:00:00Z` in `Europe/Moscow`, the previous completed week is `2026-W37`; GSC and Alice retain the existing UTC calendar-month default behaviour.

### TDD evidence

RED command:

```sh
node --import tsx --test apps/site-seo/src/lib/runtime.test.ts apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/styles.test.ts
```

Observed RED: 40 tests, 34 passed, 6 failed for the intended missing behaviours: business-timezone boundary, multi-row engine aggregation and metric weighting, two always-visible missing slots, zero/one unique tick geometry, and centred single X label.

GREEN command:

```sh
node --import tsx --test apps/site-seo/src/lib/runtime.test.ts apps/site-seo/src/lib/db.test.ts apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/styles.test.ts
```

Observed GREEN: 54 tests, 54 passed, 0 failed.

### Verification

```sh
npm run typecheck:site-seo
git diff --check
```

Both passed with exit code 0.

```sh
npm run test:site-seo
```

The complete unit/read/UI phase passed 125/125. The release/isolation phase passed 23/27; the same four immutable-template build tests stopped at `template source tree has uncommitted files` before their product assertions. Advancing the profile template pin is independently owned and explicitly outside this fix cycle.

### Remaining concern

- The four immutable-template build cases stay gated until the separately owned profile/release pin is advanced. No pin, profile, deployment, database, or canonical fact change was made.

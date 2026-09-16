# MedRoche Zaruku-parity follow-up report

## Status

Implemented the approved universal `apps/site-seo` follow-up at base commit
`cfee491ae1a57157274eebd558e52b967b3be698`.

Implementation commit: `67a7b014bc1b9effad75a0aa2cb6db9003560092`.

No schema migration, source API call, database write, backfill, cron edit,
deployment, secret change, or production action was performed.

## RED evidence

Command:

```text
node --import tsx --test apps/site-seo/tests/medroche-zaruku-parity.test.ts
```

Observed before production changes: 8 tests, 1 passed, 7 failed. Expected
failures proved the missing behavior for navigation order/labels, the compact
week selectors, W37-to-W36 fallback, canonical full-week discovery, Webmaster
query facts/unbounded pages, the new SEO composition, and overview copy
cleanup. The eighth test initially passed because the old toolbar happened to
retain the same week values; subsequent assertions covered the native select
contract directly.

First full-suite command:

```text
npm run test:site-seo
```

Observed before legacy expectation updates: the TypeScript test phase ran 135
tests with 125 passed and 10 failed. The failures were the expected old
Webmaster mock shape, old monthly GSC default, removed traffic tab, old labels
and controls, old Search panel layout, and removed overview completeness copy.

After those were green, the same full command exposed a concrete base-commit
contract problem: `scripts/site-seo-profile.mjs` rejected the already-approved
optional `seoSections` field. Ten script tests failed before reaching their
intended assertions. The JavaScript profile validator was minimally aligned
with the schema and validation rules already established by base commit
`cfee491`.

## Implemented behavior

- Navigation is ordered and labelled as `Обзор`, `SEO`,
  `ИИ-видимость и конкуренты`, `Спрос Wordstat`, `Работы и задачи`,
  `Источники`; the standalone traffic page is no longer navigable.
- The overview and SEO page use a compact native-select SEO-week toolbar.
  Options come from fully successful seven-day canonical Metrika coverage.
  An unavailable primary week falls back to the latest available full week.
  Explicit GSC monthly periods and the Alice month remain independent hidden
  URL/read-model fields; the default GSC period is the previous full ISO week.
- Overview completeness prose and the repeated organic-search subtitle/legend
  were removed while missing/failed no-fact states remain explicit. The search
  engine projection remains exactly Google and Yandex; canonical facts and
  exports are unchanged.
- The SEO page presents the compact Alice summary and profile-driven section
  positions side-by-side, followed by the unified Google/Yandex/SEO OS query
  table. Section aggregation strips query/fragment, uses longest-prefix-first
  matching, sums clicks/impressions, and computes impression-weighted position.
  Sections without facts and absent source facts render `—`.
- The Webmaster canonical reader now returns selected-week `ALL`-device query
  facts and all scoped page rows required for section grouping. Every fact read
  remains constrained by source, account, host, and date.

## Files changed in implementation commit

- `apps/site-seo/src/app/dashboard/[siteSlug]/page.tsx`
- `apps/site-seo/src/app/globals.css`
- `apps/site-seo/src/components/Dashboard.tsx`
- `apps/site-seo/src/components/Overview.tsx`
- `apps/site-seo/src/components/PeriodSelector.tsx`
- `apps/site-seo/src/components/Search.tsx`
- `apps/site-seo/src/lib/db.ts`
- `apps/site-seo/src/lib/db.test.ts`
- `apps/site-seo/src/lib/period-selection.ts`
- `apps/site-seo/src/lib/read-model.ts`
- `apps/site-seo/src/lib/runtime.ts`
- `apps/site-seo/src/lib/runtime.test.ts`
- `apps/site-seo/tests/dashboard.test.ts`
- `apps/site-seo/tests/medroche-zaruku-parity.test.ts`
- `scripts/site-seo-profile.mjs`

The protected pre-existing paths `.superpowers/sdd/task-1-report.md`,
`.superpowers/sdd/task-3-report.md`, and `apps/site-seo/.next-medroche/` were not
modified or staged by this task.

## Verification

Focused affected suites:

```text
node --import tsx --test apps/site-seo/src/lib/db.test.ts apps/site-seo/src/lib/runtime.test.ts apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/medroche-zaruku-parity.test.ts
```

Result: 53/53 passed.

Final parity/dashboard focus after overview copy cleanup:

```text
node --import tsx --test apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/medroche-zaruku-parity.test.ts
```

Result: 32/32 passed.

Type checking:

```text
npm run typecheck:site-seo
```

Result: passed with exit code 0.

Whitespace validation:

```text
git diff --check
```

Result: passed with exit code 0 before the implementation commit.

Post-commit full suite:

```text
npm run test:site-seo
```

Result: TypeScript phase 135/135 passed; script/integration phase 23/27 passed.
The four expected failures are all `scripts/site-seo-build.test.mjs` template
source assertions because the MedRoche profile intentionally remains pinned to
`7d2caf2ec5fe032942fc7429cde686990ce72df2`. The task brief explicitly forbids
updating the MedRoche template pins; the coordinator must pin the reviewed
implementation commit before those four assertions can pass.

## Pre-closure concern

At the end of the implementation-agent turn, only the intentional
coordinator-owned template pin remained. Before that pin was updated,
MedRoche build preview correctly refused to package an unpinned template tree.

## Coordinator closure

Independent review of the first implementation found four important edge
cases: successful-empty Metrika coverage, the no-full-week state, normalized
query collisions, and position weighting when some facts have no position.
Commit `934d7d0f63d11cee3060e5858052fdf28fce7b7c` closes all four with regression
tests. A second review found two server-form edge cases; commit
`ff09f6dd24667cc9f8be4b0aba5a898dfeae3517` separates comparison mode from the
previous-week action, disables submission when no full week exists, and omits
Metrika-only panels rather than labelling a configured source as disabled.

The final independent verdict for `ff09f6d` is PASS for both specification
compliance and code quality, with no Critical, Important, or Minor findings.
The reviewer independently ran 60 focused tests. The coordinator then pinned
the MedRoche profile, registry, and release manifest to that exact source in
commit `46aa763e97d54580021f3adf62fbaeaa3826ad6b`.

Fresh post-pin verification passed 140 functional tests, 27 release/isolation
tests, TypeScript checking, and diff checking. A clean detached worktree also
produced an optimized standalone Next build with 100 manifest files; its
artifact-manifest SHA-256 is
`d5cb0f92e767c07b2658e4458302c71d0e07c17675a50d30a36f8bae6a744801` and it
pins template source `ff09f6dd24667cc9f8be4b0aba5a898dfeae3517`.

Canonical inspection showed that MedRoche W36 (`2026-08-31..2026-09-06`) is
already fully collected, so no backfill was required. No source API call,
database write, schema or cron change, production deployment, secret change,
or Zaruku activation was performed in this closure.

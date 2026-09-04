# Task 6c report: integrate latest origin/main

## Status

Merged `origin/main` commit `0e4c6e84c2e297818e345d6dac7758c9aa67fd2a`
into the reviewed integrated release branch with a normal non-fast-forward merge.
The merge applied cleanly without textual conflicts or integration-only code
changes.

The authoritative Excel integer-view behavior is present in both shared loader
locations and throughout the Excel route, while the accepted Zaruku Wordstat,
Alice, canonical-read, and deployment-isolation changes remain present.

## Merge contents

- `src/app/api/dashboard/[id]/excel/route.ts`: rounds view totals, platform
  values, plan/fact values, daily exports, and workbook cells to whole numbers.
- `src/lib/dashboard-data-loader.ts`: rounds both merged channel-series view
  projections (`item.views` and `row.views`) while preserving the integrated
  Zaruku loader branch.
- `src/lib/dashboard-excel-views.test.ts`: retains main's focused source-level
  regression for loader and Excel-route rounding.

## Verification

Focused route/view/loader and Zaruku read-model batch:

```text
node --import tsx --test \
  src/lib/dashboard-excel-views.test.ts \
  src/app/api/dashboard/route.test.ts \
  src/lib/dashboard-runtime-canonical-only.test.ts \
  src/lib/abbott-loader-source.test.ts \
  src/lib/advertising-binding-read-model.test.ts \
  src/lib/zaruku-wordstat.test.ts \
  src/lib/zaruku-alice-visibility.test.ts \
  src/lib/zaruku-seo.test.ts
tests 94; pass 94; fail 0; skipped 0
```

Deploy guard batch:

```text
npm run test:deploy-source
deploy source guard tests passed
dashboard deploy lock tests passed
dashboard deploy integration tests passed
```

Full verification:

```text
npm test
Node: tests 934; pass 924; fail 0; skipped 10
Python: Ran 13 tests; OK

npm run typecheck
exit 0

npm run lint
exit 0; 0 errors; 10 pre-existing warnings

npm run build
exit 0; compiled successfully; 28/28 static pages generated

git diff --check
git diff --cached --check
exit 0 before commit

git diff HEAD^ HEAD --check
exit 0 after commit
```

The first sandboxed `npm test` attempt reached 923 passing Node tests and then
hit the known `tsx` temporary IPC socket `EPERM` in
`scripts/set-dashboard-shared-password.test.ts`. The complete suite was rerun
with local IPC permission and passed as recorded above.

## Scope and concerns

No deployment, production/database access, migration execution, source API
call, secret change, cron edit, or production-data operation occurred. The
pre-existing modified `.superpowers/sdd/task-1-report.md` and untracked
`docs/2026-08-22-abbott-handover.md` were neither edited nor staged.

No active integration concern remains. The existing ten lint warnings and ten
intentional Node-test skips are unchanged; deployment/runtime behavior was
verified locally only because production access was explicitly out of scope.

# Task 2: Abbott Metrika-first root release controls report

## Status

Implemented and committed the root/Python/runbook portion of the approved
Metrika-first release design without any production, API, database, cron,
secret, deployment, Telegram, or Hermes mutation.

## RED evidence

Before production changes:

```text
python3 -m unittest tests.test_canonical_release_store tests.test_abbott_rollout_preflight tests.test_abbott_operations_runbook
Ran 39 tests
FAILED (failures=5, errors=3)
```

The failures proved the old behavior was still fixed to four sources, reported
a repeat-safe schema rehearsal as `partial`, included Bitrix dump inputs in the
production baseline/import commands, and checked the legacy daily behavior
table instead of the private visit-level authority.

## Implementation

- `canonical_release_store.py` now requires exactly the two workbook kinds and
  admits either optional Bitrix kind only when declared by the frozen baseline.
- The validation gate rejects unknown/duplicate/missing kinds and IDs, exact-set
  mismatches, undeclared release-scoped executions, and missing, failed, or
  incomplete declared optional sources.
- Existing fingerprint, manifest, parser-version, execution revision/status,
  row-count, validation evidence, warning review, and five-scope coverage gates
  remain enforced.
- `abbott_rollout_preflight.py` reports a repeat-safe schema rehearsal as
  `ready` independently of deferred live Bitrix.
- The production runbook baseline/import commands contain only workbook inputs,
  keep local Bitrix evidence explicitly test-only, and verify
  `report_bd_private.canonical_fact_metrika_visits` rather than accepting the
  legacy daily table as visit-level evidence.
- The root runtime manifest contains the computed release-store SHA-256. Under
  integration-owner authorization, the matching bootstrap lib/runtime copies
  and their two nested manifest entries were mechanically synchronized for the
  runtime-closure check; those nested changes are intentionally not committed
  by Task 2 and are handed to Task 3.

## Verification

```text
Focused RED-to-GREEN suite: 39/39 passed
Focused suite plus runtime closure: 53/53 passed
Root runtime manifest: 15/15 files verified OK
Complete root suite: 323 run; 319 passed; 4 failed
```

The four complete-suite failures are all in
`test_abbott_mysql_rehearsal_contract` and stop at its clean-authority setup
gate because the shared nested `dashboard-next` worktree contains existing
conflicts/uncommitted integration work and a migration present on disk but not
at nested `HEAD`. No Task 2 release-control assertion fails.

## Commit

Implementation commit: `d56c460` (`feat: allow Metrika-first Abbott releases`).

## Concerns

- Task 3 must commit the synchronized nested canonical release-store copies and
  exact bootstrap manifest entries together with the other nested integration
  work.
- The four rehearsal-contract tests cannot pass until the shared nested
  dashboard authority is clean and its migrations are committed at nested
  `HEAD`.
- The full run emitted the existing urllib3/LibreSSL compatibility warning; it
  did not cause a test failure.

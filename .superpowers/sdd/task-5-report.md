# Task 5 report: observed URL identity gaps

## RED

- Added tests for an unaliased observed page, daily-row collapse, known-alias
  suppression, aggregate-only discovery SQL, service-route evidence, and raw
  `Архив` lifecycle semantics.
- The first focused run failed because `ObservedPage` was absent. A later RED
  run exposed the missing `MaterialCandidate` import, and then deterministic
  hashing rejected the required `Decimal("1.0")` confidence. Both failures
  were corrected before the corresponding GREEN runs.

## GREEN

`PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11 -m unittest tests.abbott_page_classifier.test_workflow_service tests.abbott_page_classifier.test_workflow_repository tests.abbott_page_classifier.test_reconcile tests.abbott_page_classifier.test_sources`

Result: `Ran 83 tests ... OK`.

`PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11 -m unittest tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_runtime_manifest_covers_runbook_entrypoints_and_local_import_closure tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_bootstrap_manifest_hashes_every_runtime_file_against_root_authority`

Result: `Ran 2 tests ... OK`.

The implementation reads only aggregate canonical page facts from release 24,
normalizes and collapses them deterministically, drops off-domain/non-web
values, and never reads private visits or calls source APIs. Observed unmapped
or ambiguous URLs are new immutable review items; matched strong aliases are
not duplicated. Service routes emit the reviewed proposal and archive labels
are lifecycle evidence without replacing a valid material type. Batch 6 is
not loaded or mutated by this task.

## Commits

- Bootstrap runtime closure: `8ae6881949767e799d66a72d3362fe8515c5e5d0`
- Root Task 5: `0096afdb3ae673cb74ad8ba0ccf6a11d1f83c8a5`

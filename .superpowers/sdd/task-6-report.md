# Task 6 report: reviewed URL alias decisions

## RED

- Added a Sheet projection regression for `IDENTITY_COLLISION`: acceptance
  fails closed until an `attach` decision has a positive selected entity and a
  nonempty reason. The first focused run failed with no validation raised.
- The task brief omitted persistence columns needed for replay-safe accepted
  choices. Added additive migration 051 and the byte-identical canonical
  bootstrap copy; it is not applied to any database.

## GREEN

- Sheet conflict rows now expose `Нормализованный URL`, `Текущий entity ID`,
  `Кандидат entity ID`, `Решение по URL`, and `Причина решения`.
- `selected_content_entity_id` and `url_alias_decision` participate in item,
  batch, and accepted-decision hashes. Allowed decisions are attach, retire,
  reject; unexpected or incomplete collision choices fail closed.
- Accepted fields are persisted in the additive approval-item columns and
  reconstructed during ingestion, preserving replay hash checks.

## Commands

```text
PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11 -m unittest tests.abbott_page_classifier.test_sheets_sync tests.abbott_page_classifier.test_repository tests.abbott_page_classifier.test_approval_ingestion tests.test_abbott_content_registry_schema
# Ran 118 tests: OK

PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11 -m unittest tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_all_synchronized_bootstrap_copies_match_root_authorities_and_manifest tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_runtime_manifest_covers_runbook_entrypoints_and_local_import_closure
# Ran 2 tests: OK
```

## Commits

- Nested dashboard/bootstrap: `16213d999e532f26cf7e342800bd3d666d1deed8`
- Root: pending

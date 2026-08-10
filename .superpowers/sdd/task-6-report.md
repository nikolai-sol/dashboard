# Task 6 report: reviewed URL alias decisions

## Step 3 transactional completion

- `attach` locks the selected active Abbott entity first, then locks the exact
  strong `url` alias row and rechecks its owner before inserting.
- `retire` locks the exact strong `url` alias row, requires exactly one active
  row, and retires it with the accepted review evidence. `reject` writes no
  alias.
- A conflicting owner, duplicate active aliases, missing selected entity, or a
  lost retire update raises `IDENTITY_COLLISION`; the enclosing ingestion
  transaction rolls back before the batch can become `ingested`.
- Alias evidence is canonical JSON bound to `accepted_decision_hash`, batch and
  item IDs, immutable `row_hash`, URL, decision, selected entity, and reason.
  Replay remains a status/hash-checked no-op and cannot create another alias.
- Published-item and accepted-item reads now include the persisted alias fields
  and conflict codes, so hash attestation reconstructs the exact immutable
  decision rather than silently dropping it.

## TDD evidence

- RED: `test_url_alias_decisions_are_locked_before_batch_ingestion_finishes`
  initially failed as `DB_TRANSACTION_FAILED`: the partial helper was a static
  method that referenced `self._json`.
- Added and ran focused regressions for lock ordering/evidence, collision
  rollback without batch transition, and locked retirement evidence.
- GREEN: focused command completed `Ran 3 tests ... OK`.

## Verification

```text
PYTHONPATH=/tmp/abbott-task1-deps:. /Users/nafanya/.local/bin/python3.11 -m unittest tests.abbott_page_classifier.test_sheets_sync tests.abbott_page_classifier.test_approval_ingestion tests.abbott_page_classifier.test_repository tests.abbott_page_classifier.test_workflow_repository tests.test_abbott_content_registry_schema tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_all_synchronized_bootstrap_copies_match_root_authorities_and_manifest tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_runtime_manifest_covers_runbook_entrypoints_and_local_import_closure tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_bootstrap_manifest_hashes_every_runtime_file_against_root_authority
# Ran 142 tests in 0.441s: OK
```

## Authority closure

- Nested bootstrap runtime copies match their root authorities byte-for-byte.
- `ops/abbott-runtime-manifest.sha256` and the bootstrap
  `MIGRATION-MANIFEST.md` attest the updated `repository.py` and
  `sheets_sync.py` hashes.
- No production API, database, migration execution, secret, cron, Telegram, or
  dashboard action was performed.

## Commits

- Nested dashboard/bootstrap: `35ff05af3c8ab9f2b0be5bb8660acdf7c7103790`
- Root: recorded by the follow-up root commit.

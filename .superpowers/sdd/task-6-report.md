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
# Ran 145 tests in 0.446s: OK
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

## Follow-up transaction correction

- The published item hash deliberately excludes the two editable URL-decision
  cells; the accepted-decision hash includes them. This permits a blank
  published collision row to be edited in Sheets and accepted without changing
  the immutable published attestation.
- URL alias decisions now run only in `record_batch_acceptance`, before the
  accepted status update. Ingestion is read-only for aliases, so a replay
  cannot mutate alias state.
- The decision-event table intentionally has no foreign keys: this additive
  migration follows the existing approval-table migration contract and avoids
  coupling historical batch cleanup to an immutable audit ledger. The event is
  instead bound by non-null batch/item/hash fields plus unique item and
  deterministic fingerprint keys, and is inserted in the same locked
  transaction as the acceptance and alias mutation.
- Attach and retire normalize with the shared URL normalizer, lock both strong
  alias types, retain the current classification-event identity where an owner
  exists, and include actor, reason, normalized URL, decision, selected entity,
  accepted hash, and predecessor identity in the deterministic event fingerprint.

## Review follow-up: projection guardrails

- The conflict tab now has a strict `attach` / `retire` / `reject` dropdown for
  URL decisions and a strict custom-formula guard for a blank or positive
  integer selected entity ID. The existing reason-required validation remains.
- Retirement changes only alias status. It does not overwrite the original
  alias `source_evidence`; the immutable decision event is the retirement audit.

## Final review follow-up: stateful acceptance lifecycle

- Added stateful `record_batch_acceptance` boundary tests that begin with a
  persisted published `IDENTITY_COLLISION` item whose decision cells are blank
  and whose original row/batch hashes remain authoritative. The accepted
  snapshot then supplies the Sheets-review `attach` decision.
- The successful path proves one transaction durably writes the accepted batch
  state, approval-item decision fields, immutable decision event, and exactly
  one strong `url` alias for the selected entity.
- A locked conflicting `canonical_url` owned by another entity raises
  `IDENTITY_COLLISION`; transaction rollback restores the published batch,
  blank approval-item decision fields, and leaves no decision event or alias
  mutation.
- TDD: both tests first failed because the stateful transaction fake was absent
  (`NameError`), then passed after the fake implemented the repository's actual
  lock/read/write sequence and rollback snapshot semantics.

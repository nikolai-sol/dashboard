# Task 10 report — Abbott dashboard boundary, runtime closure, and handoff

## RED → GREEN

RED was captured before runtime packaging: the closure suite reported twelve
missing bootstrap authorities (weekly entrypoint/workflow closure plus migration
047), the isolated bootstrap could not import `weekly_proposal`, and
`ApprovalItem.conflict_codes` was annotated as `tuple[ConflictCode | str, ...]`.
The dashboard DB-boundary assertion passed immediately: the existing dashboard
content read path was already active-release MySQL only, so no dashboard
production query change was warranted.

GREEN: the bootstrap now contains the minimal weekly/operator Python authority
closure, every copy is byte-identical to its root authority, and an isolated
fake-gateway weekly execution imports and runs without parent-repository,
network, DB, Sheets, or OpenAI access. Migration 047 is packaged and attested
at `reportingdash-canonical-bootstrap/src/db/migrations/`, not inside the
importable `runtime/` unit. `ApprovalItem.conflict_codes` is now
`tuple[ConflictCode, ...]`; persisted JSON values are fail-closed converted at
the repository/materializer boundary.

## Runtime closure and hashes

The root runtime manifest adds these authorities:

```text
weekly_proposal.py      16b67d580b6300de3f6c78871c1639959ae669cd3f6d999c6dc18534e2074420
workflow.py             00d0e17e0bb56bbc9b1e5720847edcb9fbcf8eb4a3efb063f101a94e31c9073d
workflow_service.py     f7e14e0008ec1c79868032c8dc542095ed33209dc08c79cfe10806fdf71a335b
workflow_repository.py  3465652267f7f483dc907d7c05f6fd53e3e153842d6bf7c456ddb123a81ab0d0
repository.py           cdea0cfc942e40aa416d292cd3672ddb07c307796017c0eba86994832526c24e
batch_service.py        619d3b2ce8018be34c150b4b66c74086d04bf1ee6190eb778e9067d7fca589b7
reconcile.py            45ad50b7459d7808f62e451d2bf75278253e8c53bf21e9bb8e2af736b6f4f7f0
identity.py             39e0e961dbb5c91a65a737f953f1534141f84719d9690ddc648c4f313d6da6d7
sources.py              7f0c7fca84b021eac669726165336a978d2eeff0c92a1626f44af60d363dce9d
llm_classifier.py       43cfd180f64da3afe74aa8252e644fa4ddecc1d294783f9660274b0b17eb3ce7
sheets_sync.py          6c3a09329cc89bea3fd759fdc860c8eee99ff63a2be438455a5b2c1533173123
```

The separately packaged additive migration 047 hash is
`9ba5254bc4adcdd94c17a0dfde09f256d6540f9ae505f8e1c38d90c43a78e032`.
Migrations 033 and 046 remain byte-identical at
`c3d23b0ccbee8ddf2fd77906f7fe3045dcf7e59b8ed8c4d978dd7d774a56c2aa`
and `460406eb14d98e32ec8b71576a5fd06812384434ba12c74545e118cc0ac3c456`.

## Current operator flow

The weekly system creates a proposal only:

```text
reconcile -> run_id -> classify -> batch_id -> publish-projection -> manual approval
```

Registry 2 is accepted input evidence, not approval of a proposal batch.
Before approval the canonical/active release is unchanged. After approval,
`pull-accepted`, `ingest`, `materialize`, and `validate` remain individually
controlled; activation is separate and unreachable from weekly/operator CLIs.
The runbooks document the eight Sheet tabs, Batch 2 accounting, correction
actor/reason/predecessor/hash, lifecycle-only `Архив`, minimization, stable
errors, recovery, and schedule template with no live schedule change.

## Verification evidence

```text
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'  -> 792 passed
.venv classifier discovery                                  -> passed
schema/release/runtime/reconciliation suite                  -> 63 passed
dashboard npm test                                           -> 535 passed
dashboard lint                                               -> 0 errors, 4 unchanged warnings
dashboard typecheck/build/security:public-assets             -> passed
compileall agents/abbott_page_classifier                     -> passed
runtime manifest sha256sum -c                                -> passed
runtime copy/manifest + isolated fake weekly tests           -> passed
offline reconcile                                            -> source=9 ready=7 rejected=1 conflict=0 unresolved=0
weekly proposal dry run                                      -> {"status":"dry_run"}
golden fixture                                               -> 80/80, all hard gates true
```

The root `unittest discover -s tests -t .` spelling is not valid in this
repository because `tests/` intentionally has no package initializer; the
successful full-discovery equivalent above uses its importable discovery root.

## Commits and no-live boundary

Nested dashboard commit: `0be0e14d388bead9cc500ee1ac89bef914c35d63`.
The root commit carrying this report is the second commit in the required
nested-first/root-second sequence and is recorded in the handoff.
No DB migration/grant, secret installation, API request, Sheet publication,
deployment, cron/Hermes/Telegram action, candidate activation, or active
pointer mutation occurred. Migration 047/grants/secrets/first real proposal and
any live schedule remain separately authorized work.

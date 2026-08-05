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
workflow.py             0a5b279e1b813756844a713711ef56ac60d5a4adf01a4c8ec8d7b6136a958485
workflow_service.py     1f838621b600ac31ef158533d747aa934039f2e847dfb7edd129b62e76a992be
workflow_repository.py  fd4357bbfe1f802acb8045892807cf3885e50a08c2c610a893f8ec620e504a23
repository.py           36f0612679b65ee9342f8582696dc837bdfede8952434c6b11edf2113ef7566e
batch_service.py        619d3b2ce8018be34c150b4b66c74086d04bf1ee6190eb778e9067d7fca589b7
reconcile.py            45ad50b7459d7808f62e451d2bf75278253e8c53bf21e9bb8e2af736b6f4f7f0
identity.py             39e0e961dbb5c91a65a737f953f1534141f84719d9690ddc648c4f313d6da6d7
sources.py              7f0c7fca84b021eac669726165336a978d2eeff0c92a1626f44af60d363dce9d
llm_classifier.py       43cfd180f64da3afe74aa8252e644fa4ddecc1d294783f9660274b0b17eb3ce7
sheets_sync.py          ac179656f8fe46988ef0abfac6ffe23356fd93cdbc49eba54eea14f0cdc1eaca
```

The separately packaged additive migration 047 hash is
`0aab4d08ed7c8b2f7dd8cc5aadba5097d7f98cde5fb19226df29d082bd44fe3e`.
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

## Review correction: Sheets closure, tabs, and legacy CLI

RED review tests showed that the bootstrap did not declare the Google API/auth
distributions imported by `load_creds`/`services`, the three operator documents
described stale tab names, and direct `sheets_sync.py` commands could still
enter legacy publish/pull/share code. GREEN adds compatible root ranges and
bootstrap pins for `google-api-python-client`, `google-auth`, and
`google-auth-oauthlib`; an AST-backed test maps each direct default-gateway
module import to its declared distribution.

The exact Sheet contract is now derived in tests from `APPROVAL_TAB_TITLES` and
documented verbatim in README, PROCESS, and the runbook:

```text
Апрув batch, Предложения, Конфликты, Не определено,
История, Справочники, Сводка, Как это работает
```

Bootstrap README and `.env.example` name the dedicated workflow DB variables,
reviewed spreadsheet ID, code/taxonomy/prompt/routing bindings, eligible-only
OpenAI use, and operator-owned `~/.hermes/google_token.json` path without any
values. Direct `sheets_sync.py publish`, `pull-approved`, and `share` (including
bare `share`) now terminate before any authority with exactly
`LEGACY_SHEETS_CLI_DISABLED`; library projection/read authorities and
`workflow.py publish-projection` remain the canonical route.

Review verification: 6 focused Python contracts pass; root discovery, compile,
manifest/copy, offline reconcile, and weekly dry run pass; dashboard full suite
passes 535 tests with lint at 0 errors/4 unchanged warnings plus typecheck,
build, and public-asset scan. No live action occurred.

Review correction nested commit: `9baf9dd88cc538a1e10a9f68cc1fc730d8ad4073`.
The root commit carrying this amended report is recorded in the handoff.

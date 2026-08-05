# Abbott content registry process

## State and authority

Registry 1 and accepted Registry 2 are captured inputs. They reconcile against
the locked active canonical predecessor in MySQL; neither is an approval batch.
The reconciliation run is content-addressed and immutable. Classification
finalizes one immutable approval batch, and only `publish-projection` writes a
Sheet. The dashboard reads the active release's `portal_content_catalog` and
`portal_content_lookup_projection` only.

## Weekly stop point

```text
capture inputs -> reconcile -> run_id -> classify -> batch_id -> publish projection
                                                              -> manual approval
```

No canonical classification, candidate, active release, or pointer changes
before manual approval. The weekly workflow stops after the projection.

## Manual review and subsequent controlled stages

The reviewer checks these eight Sheet tabs in order:

1. `Апрув batch`
2. `Предложения`
3. `Конфликты`
4. `Не определено`
5. `История`
6. `Справочники`
7. `Сводка`
8. `Как это работает`

Accepted Registry 2 is Batch 2 source evidence, not an approval decision for
the proposal batch.

After separate approval, run `pull-accepted --batch-id N` to attest, then
`ingest --batch-id N --execute`, `materialize --batch-id N --execute`, and
`validate --batch-id N`. Activation is a different controlled release decision
and is unavailable from both proposal/operator workflow CLIs.

## Classification invariants

- A direction never changes automatically. A correction is a reviewed event
  bound to predecessor/hash and carries actor and reason.
- `Архив` describes lifecycle only; it is never a material type.
- Reconciliation state is exactly ready, conflict, unresolved, rejected, or
  no_change, with stable `ConflictCode` values and deterministic counts.
- Failures are sanitized status codes. Retry exact `run_id`/`batch_id` stages;
  do not replay by mutating a predecessor or active release.
- Persist only minimized content metadata and hashes. No credentials, OAuth
  tokens, raw LLM response/chain-of-thought, or visitor/client data is allowed.

## Golden gates

Require source accounting, taxonomy/schema validity, anti-flip correctness,
and reviewed direction/material-type evaluation before a separately authorized
LLM evaluation. Review conflict/unresolved tabs and hashes before Sheet
approval. A failed candidate is recovered by not activating it; active facts
are append-only and never silently rewritten.

## Authorized runtime configuration

The dedicated workflow DB role is configured only through
`ABBOTT_CONTENT_WORKFLOW_DB_HOST`, `ABBOTT_CONTENT_WORKFLOW_DB_PORT`,
`ABBOTT_CONTENT_WORKFLOW_DB_NAME=report_bd`, `ABBOTT_CONTENT_WORKFLOW_DB_USER`,
and `ABBOTT_CONTENT_WORKFLOW_DB_PASSWORD`. The reviewed Sheet ID is
`ABBOTT_CONTENT_APPROVAL_SPREADSHEET_ID`; `CODE_REVISION` and the explicit
taxonomy/prompt/routing versions bind each proposal. `OPENAI_API_KEY` is only
used for eligible `--execute --execute-llm`. The operator owns Google token
setup at `~/.hermes/google_token.json`. Direct legacy `sheets_sync.py`
`publish`, `pull-approved`, and `share` commands are disabled; only workflow
`publish-projection` can write the Sheet.

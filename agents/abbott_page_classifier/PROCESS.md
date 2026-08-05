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

The reviewer checks the eight Sheet tabs: `Апрув batch`, `Готово`, `Конфликты`,
`Не определено`, `Отклонено`, `Без изменений`, `Справочники`, and `Инструкция`.
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

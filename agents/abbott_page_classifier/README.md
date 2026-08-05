# Abbott content registry

This package creates a weekly, immutable **proposal** from Registry 1 and the
accepted Registry 2 input. Canonical classifications and the active release are
unchanged until a later, separately authorized approval/ingest/materialize/
validate/activation sequence.

The canonical state is MySQL. Registry files are captured inputs; Registry 2 is
not an approval batch. Legacy JSONL registry state is not a workflow input or
output.

## Weekly proposal

The only weekly flow is:

```text
reconcile --execute -> run_id -> classify --run-id N --execute -> batch_id
-> publish-projection --batch-id N --execute -> stop for manual approval
```

The runnable wrapper is `weekly_proposal.py`; it composes exactly those three
stages. It never calls ingest, materialize, validate, activation, or an
active-release pointer operation.

```bash
python3 agents/abbott_page_classifier/weekly_proposal.py \
  --registry1 /protected/registry1.xlsx \
  --registry2 /protected/registry2-accepted.csv \
  --taxonomy-version abbott.v1 \
  --prompt-version <reviewed-prompt-version> \
  --model-routing-version <reviewed-routing-version> \
  --code-revision <reviewed-40-hex-revision>
```

The command above is a zero-I/O dry run. The separately authorized proposal
execution adds `--execute` and, only when eligible fields need it,
`--execute-llm`. The latter never authorizes a call without `--execute`.

The equivalent recoverable stage commands are:

```text
reconcile --registry1 PATH --registry2 PATH --execute
classify --run-id N --execute [--execute-llm]
publish-projection --batch-id N --execute
pull-accepted --batch-id N
ingest --batch-id N --execute
materialize --batch-id N --execute
validate --batch-id N
status --batch-id N
```

`pull-accepted` is read-only. `ingest` records the reviewed Sheet acceptance,
then candidate materialization and validation are separate. Activation is not
reachable through `weekly_proposal.py` or `workflow.py`.

## Projection and review

The published Sheet has these eight tabs:

1. `Апрув batch`
2. `Предложения`
3. `Конфликты`
4. `Не определено`
5. `История`
6. `Справочники`
7. `Сводка`
8. `Как это работает`

Batch 2 means the supplied Registry 2 snapshot is accepted source evidence. It
does not approve the newly produced batch. Every source row must end in ready,
conflict, unresolved, rejected, or no-change accounting before review.

Direction anti-flip is a hard gate. A reviewed correction must bind the exact
predecessor classification/hash and record the correction actor and reason;
automatic model, source, or heuristic changes never flip a locked direction.
`Архив` is lifecycle evidence (`archive_candidate`/`archived`), never a
material type.

## Privacy and stable failures

Only bounded content metadata, provenance hashes, taxonomy codes, and
sanitized aggregate receipts are persisted or printed. Do not store or emit
OAuth values, raw provider responses, chain-of-thought, visitor/client IDs,
emails, phone numbers, or source URLs beyond the approved content contract.
Operators receive stable status codes, not tracebacks or raw content.

## Separately authorized publish configuration

The first real proposal uses the dedicated workflow role with
`ABBOTT_CONTENT_WORKFLOW_DB_HOST`, `ABBOTT_CONTENT_WORKFLOW_DB_PORT`,
`ABBOTT_CONTENT_WORKFLOW_DB_NAME=report_bd`,
`ABBOTT_CONTENT_WORKFLOW_DB_USER`, and `ABBOTT_CONTENT_WORKFLOW_DB_PASSWORD`.
`ABBOTT_CONTENT_APPROVAL_SPREADSHEET_ID` selects the reviewed destination.
`CODE_REVISION` and the explicit weekly taxonomy/prompt/routing arguments bind
the run. `OPENAI_API_KEY` is required only for eligible
`--execute --execute-llm` classification. Google token ownership/setup remains
operator-only at `~/.hermes/google_token.json`; this package never installs,
prints, or rotates it. Direct `sheets_sync.py publish`, `pull-approved`, and
`share` are disabled; `workflow.py publish-projection` is the sole Sheet writer.

## Gates and recovery

Before a proposal: capture reviewed input snapshots; bind active predecessor,
taxonomy, prompt/routing versions, and reviewed code revision; run the offline
reconcile/golden checks. Before approval: review `Конфликты` and `Не
определено`, counts, hashes, and anti-flip evidence. A stable failure is retried
by rerunning the same command with the returned numeric `run_id` or `batch_id`.
Same input bindings resume the same immutable run/batch; changed bindings create
a different run. Never rewrite an active release to recover a failed candidate:
do not activate it.

See [the operator runbook](../../ops/runbooks/abbott_content_registry.md) for
the full reviewed handoff and authorization boundary.

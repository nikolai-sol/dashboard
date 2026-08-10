# Abbott content registry

This package creates a weekly, immutable **proposal** from Registry 1 and the
accepted Registry 2 input. Canonical classifications and the active release are
unchanged until a later, separately authorized approval/ingest/materialize/
validate/activation sequence.

The canonical state is MySQL. Registry files are captured inputs; Registry 2 is
not an approval batch. Reconciliation also derives proposal-only items for
non-archived predecessor entities whose direction or material type is still
missing and which are not already represented by either registry. The
sanitized `catalog_gap_count` receipt accounts for those derived items. Legacy
JSONL registry state is not a workflow input or output.

## Weekly proposal

The only weekly flow is:

```text
reconcile --execute -> run_id -> classify --run-id N --execute -> batch_id
-> publish-projection --batch-id N --execute -> stop for manual approval
```

The reviewed runnable wrapper is `run_weekly_proposal.sh`; it performs the
exact Python 3.11 preflight and then delegates to `weekly_proposal.py`, which
composes exactly those three stages. It never calls ingest, materialize,
validate, activation, or an active-release pointer operation.

Select an owner-reviewed absolute executable. The launcher has no `python3`
or `PATH` fallback and refuses every version other than Python 3.11:

```bash
export ABBOTT_CONTENT_PYTHON311_BIN=/absolute/reviewed/path/to/python3.11
case "$ABBOTT_CONTENT_PYTHON311_BIN" in /*) ;; *) exit 78 ;; esac
test -x "$ABBOTT_CONTENT_PYTHON311_BIN"
"$ABBOTT_CONTENT_PYTHON311_BIN" -c \
  'import sys; raise SystemExit(78 if sys.version_info[:2] != (3, 11) else 0)'
```

```bash
agents/abbott_page_classifier/run_weekly_proposal.sh \
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
validate --batch-id N --execute
status --batch-id N
```

`pull-accepted` is read-only. `ingest` records the reviewed Sheet acceptance,
then candidate materialization and validation are separate. Executed
validation persists the reviewed gate evidence and may move only the bound
candidate from `staging` to `validated`; it never activates the candidate.
Activation is not reachable through `weekly_proposal.py` or `workflow.py`.

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

Candidate materialization and its read-only validation gate use only the
dedicated `ABBOTT_CONTENT_MATERIALIZER_DB_HOST`,
`ABBOTT_CONTENT_MATERIALIZER_DB_PORT`,
`ABBOTT_CONTENT_MATERIALIZER_DB_NAME=report_bd`,
`ABBOTT_CONTENT_MATERIALIZER_DB_USER`, and
`ABBOTT_CONTENT_MATERIALIZER_DB_PASSWORD`. Persisting reviewed validation
evidence and the `staging` to `validated` transition uses the existing release
operator role only: `ABBOTT_RELEASE_DB_HOST`, `ABBOTT_RELEASE_DB_PORT`,
`ABBOTT_RELEASE_DB_NAME=report_bd`, `ABBOTT_RELEASE_DB_USER`, and
`ABBOTT_RELEASE_DB_PASSWORD`. `ABBOTT_CONTENT_VALIDATION_REVIEWED_BY` is the
reviewed non-secret operator identifier written with that validation evidence.
None of these roles may fall back to a generic report, collector, or workflow
credential. Copy the names—not values—from
[`content.env.example`](content.env.example) into the protected owner-managed
environment file.

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

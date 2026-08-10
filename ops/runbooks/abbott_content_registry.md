# Abbott content registry operator runbook

Status: offline implementation and review procedure. This document does not
authorize a production API call, Sheet publication, migration/grant execution,
credential installation, deployment, cron/Hermes change, activation, or active
pointer change.

## Current workflow

Registry 1 and the accepted Registry 2 capture are inputs, not a pre-existing
approval batch. The weekly proposal has one stop point:

```text
reconcile -> run_id -> classify -> batch_id -> publish-projection -> manual approval
```

Before manual approval, canonical classification and the active release remain
unchanged. After approval, ingest, candidate materialization, and validation
are controlled stages. Activation is a separate decision and cannot be reached
from `weekly_proposal.py` or `workflow.py`.

The dashboard is DB-only: it reads the active release through
`portal_content_catalog` and `portal_content_lookup_projection`; it does not
read reconciliation, event, or approval tables and never calls Google/OpenAI
or source APIs.

## Preconditions and local checks

Use protected, explicit snapshot paths. Never put a credential in a shell
command, log, ticket, or repository. The workflow role is separate from
collector, materializer, release-operator, and dashboard-reader roles. Select
an owner-reviewed absolute Python 3.11 executable; there is no `PATH` fallback:

```bash
export ABBOTT_CONTENT_PYTHON311_BIN=/absolute/reviewed/path/to/python3.11
case "$ABBOTT_CONTENT_PYTHON311_BIN" in /*) ;; *) exit 78 ;; esac
test -x "$ABBOTT_CONTENT_PYTHON311_BIN"
"$ABBOTT_CONTENT_PYTHON311_BIN" -c \
  'import sys; raise SystemExit(78 if sys.version_info[:2] != (3, 11) else 0)'

agents/abbott_page_classifier/python311_runtime.sh \
  -m unittest discover -s tests/abbott_page_classifier -t . -v
agents/abbott_page_classifier/python311_runtime.sh \
  agents/abbott_page_classifier/evaluation.py \
  --fixture agents/abbott_page_classifier/evals/golden.v1.jsonl --classifier fixture
agents/abbott_page_classifier/run_classifier.sh reconcile \
  --registry1 tests/fixtures/abbott_registry1_minimal.xlsx \
  --registry2 tests/fixtures/abbott_registry2_accepted_minimal.csv --dry-run
```

The dry run performs no DB, Sheet, OpenAI, source API, or materializer I/O.
Review stable counts and hashes only. A separately authorized real snapshot
capture is read-only and records input digests, parser versions, row counts,
and acceptance/rejection/duplicate-collapse accounting in canonical metadata.

## Weekly proposal command

First run this exact dry-run shape with reviewed values:

```bash
agents/abbott_page_classifier/run_weekly_proposal.sh \
  --registry1 /protected/abbott/registry1.xlsx \
  --registry2 /protected/abbott/registry2-accepted.csv \
  --taxonomy-version abbott.v1 \
  --prompt-version <reviewed-prompt-version> \
  --model-routing-version <reviewed-routing-version> \
  --code-revision <reviewed-40-hex-revision>
```

Only after separate authorization for database access, optional eligible LLM
classification, and Google Sheet publication, repeat it with `--execute` and
optionally `--execute-llm`. That executes precisely:

```text
reconcile --registry1 PATH --registry2 PATH --execute
classify --run-id N --execute [--execute-llm]
publish-projection --batch-id N --execute
```

Record the emitted numeric `run_id`, numeric `batch_id`, `batch_key`, source
counts, and hashes. Do not infer IDs from a Sheet title. Same input digests,
predecessor, taxonomy, prompt/routing, and code revision resume the same
content-addressed run/batch. A changed binding intentionally produces a new
one.

## Sheet review

The projection always contains exactly these tabs:

1. `Апрув batch`
2. `Предложения`
3. `Конфликты`
4. `Не определено`
5. `История`
6. `Справочники`
7. `Сводка`
8. `Как это работает`

Batch 2 means accepted Registry 2 source evidence. It is not approval of the
new proposal batch. Require every captured row to be accounted for as ready,
conflict, unresolved, rejected, or no_change. Review `Конфликты` and `Не
определено` before accepting anything.

Direction anti-flip is a publication gate: no automatic source, heuristic, or
model action changes a locked direction. A correction must retain the exact
predecessor and hash, plus reviewed actor and reason. `Архив` is a lifecycle
state (`archive_candidate`/`archived`), never a material type.

## Acceptance, recovery, and activation boundary

After a manual approval, the explicit operator stages are:

```text
pull-accepted --batch-id N
ingest --batch-id N --execute
materialize --batch-id N --execute
validate --batch-id N --execute
status --batch-id N
```

`pull-accepted` is read-only. Ingest can re-read a published Sheet or resume
an accepted canonical snapshot; materialization is idempotent and has no
activation path. Executed validation records the reviewed gate evidence and
may transition only the bound release from `staging` to `validated`; it cannot
activate it. Retry a stable failure with the same `run_id` or `batch_id`.
If a candidate fails, do not activate it and do not silently rewrite the active
release; retain the receipt for review.

URL-identity successors are DB-native clones of the active Abbott release. They
never trigger a Metrika backfill, OAuth use, Logs job, or Reports request. The
materializer records an exact predecessor/candidate count and deterministic
hash for every release-scoped fact table (including coverage, receipts,
snapshots, and manifests). Validation compares sessions, users, pageviews, and
goal conversions exactly for 2026-06-01..2026-06-30,
2026-07-01..2026-07-31, and 2026-08-01..2026-08-09; metadata direction/type
changes are permitted only when all fact controls still match.

Observed-page publication evidence contains aggregate unresolved counts only.
Every content-like observed page must resolve both direction and material type.
Every non-content observed page must be `service_page` or have a reviewed
exclusion. An exclusion is only an immutable accepted `reject` URL-decision
event bound to this candidate batch and its accepted-decision hash; registry
aliases and mutable review state are never exclusion authority. Do not include
URLs, visitor/user/client identifiers, or visit data in validation evidence or
operator output.

## Data minimization and gates

Persist and print only bounded content metadata, taxonomy codes, source/batch
hashes, aggregate counts, and sanitized status. Never persist or print OAuth
values, raw provider responses, chain-of-thought, visitor/client IDs, email,
phone, or unapproved URL/behavior data. Failures are stable status codes, not
tracebacks.

## Separately authorized first publish configuration

The owner installs the dedicated role values outside this repository:
`ABBOTT_CONTENT_WORKFLOW_DB_HOST`, `ABBOTT_CONTENT_WORKFLOW_DB_PORT`,
`ABBOTT_CONTENT_WORKFLOW_DB_NAME=report_bd`, `ABBOTT_CONTENT_WORKFLOW_DB_USER`,
and `ABBOTT_CONTENT_WORKFLOW_DB_PASSWORD`. The first projection also needs the
reviewed `ABBOTT_CONTENT_APPROVAL_SPREADSHEET_ID`. Bind every run with
`CODE_REVISION` plus the explicit taxonomy, prompt, and model-routing versions.
`OPENAI_API_KEY` is used only for eligible `--execute --execute-llm`; it is not
needed for dry runs or deterministic classifications. Google token setup and
ownership remains operator-only at `~/.hermes/google_token.json`.

Candidate materialization and gate reads require the separate
`ABBOTT_CONTENT_MATERIALIZER_DB_HOST`,
`ABBOTT_CONTENT_MATERIALIZER_DB_PORT`,
`ABBOTT_CONTENT_MATERIALIZER_DB_NAME=report_bd`,
`ABBOTT_CONTENT_MATERIALIZER_DB_USER`, and
`ABBOTT_CONTENT_MATERIALIZER_DB_PASSWORD`. The reviewed validation evidence
write and `staging` to `validated` transition require the existing release
operator settings `ABBOTT_RELEASE_DB_HOST`, `ABBOTT_RELEASE_DB_PORT`,
`ABBOTT_RELEASE_DB_NAME=report_bd`, `ABBOTT_RELEASE_DB_USER`, and
`ABBOTT_RELEASE_DB_PASSWORD`, plus the non-secret reviewed operator identifier
`ABBOTT_CONTENT_VALIDATION_REVIEWED_BY`. Every family is mandatory for its own
stage; none may fall back to generic report, collector, workflow, or another
role's settings.

The complete blank configuration surface is maintained in
`agents/abbott_page_classifier/content.env.example`. Copy names only into the
protected owner-managed environment and install real values out of band.

The direct legacy `sheets_sync.py publish`, `pull-approved`, and `share`
commands always return `LEGACY_SHEETS_CLI_DISABLED`. The library projection and
read authorities remain internal to the canonical workflow; only
`workflow.py publish-projection` writes a Sheet.

Golden gates are source accounting, taxonomy and schema validity, anti-flip
correctness, and reviewed direction/material-type accuracy. Real LLM evaluation
is separately authorized and stores sanitized metrics only. Migrations 047–049,
workflow-role grants, secrets, the first proposal, and any live schedule each
need distinct review/authorization.

## Schedule template only

Do not edit a live schedule from this runbook. A separately reviewed wrapper
may use a serialized weekly shape such as:

```text
30 8 * * 1 /usr/bin/flock -n /run/lock/abbott-content-proposal.lock /opt/reportingdash/bin/run-abbott-content-proposal
```

The wrapper must use protected input paths and a reviewed environment file; it
must not discover mutable inputs or embed credentials. No cron, Hermes,
Telegram, or deployment action was performed for this task.

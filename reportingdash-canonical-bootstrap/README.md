# reportingdash-canonical bootstrap

This is a versioned bootstrap skeleton for the future `reportingdash-canonical` repository.

It exists here temporarily so we can:

- define the target repo shape
- stage collector migration work in git
- keep rollout notes next to the dashboard repo until the separate collectors repo is created

## Important

This folder is not the live collector runtime.

Current live/runtime paths are still:

- local unversioned collector root: `/Users/nafanya/ReportingDash`
- server runtime: `/root/reportingdash-canonical`

## Current migration reality

The Yandex Direct cutover has already started.

Confirmed current state:

- legacy bridge collector still exists
- new API-first collector exists:
  - `fetch_yandex_direct_canonical_api.py`
- shadow source is already in use:
  - `source_key = yandex_direct_api_shadow`
- shadow cron has already been introduced on server
- current cutover readiness is monitored in:
  - `monitor_canonical_shadow.py`
  - `sources_health_dashboard.py`
  - `send_canonical_telegram_report.py`

This bootstrap therefore assumes:

- Yandex Direct is not a greenfield migration
- Yandex Direct should be treated as an in-progress cutover source
- first repo migration should preserve that shadow structure exactly

## Intended repo structure

```text
reportingdash-canonical/
  README.md
  requirements.txt
  .env.example
  collectors/
  lib/
  ops/
  docs/
  deploy/
```

See:

- [MIGRATION-MANIFEST.md](./MIGRATION-MANIFEST.md)
- [docs/YANDEX-DIRECT-CUTOVER-STATUS.md](./docs/YANDEX-DIRECT-CUTOVER-STATUS.md)
- [docs/BOOTSTRAP-ROLLOUT-CHECKLIST.md](./docs/BOOTSTRAP-ROLLOUT-CHECKLIST.md)

## Abbott runtime closure smoke test

The flat `runtime/` directory is intentionally self-contained for local Python
imports. From this bootstrap directory, verify it without reading a parent
checkout:

```bash
test -x "$ABBOTT_CONTENT_PYTHON311_BIN"
"$ABBOTT_CONTENT_PYTHON311_BIN" -c \
  'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 78)'
(cd runtime && PYTHONDONTWRITEBYTECODE=1 "$ABBOTT_CONTENT_PYTHON311_BIN" -c \
  'import fetch_yandex_metrika_canonical, canonical_writer, metrika_logs_api, canonical_release_store, run_abbott_metrika_active_release, abbott_release_operator, probe_yandex_metrika_access, capture_abbott_canonical_baseline, compare_abbott_canonical_release, abbott_canonical_controls, metrika_pagination, backfill_abbott_metrika_2026, abbott_health_probe, send_canonical_telegram_report, sources_health_dashboard; import agents.abbott_page_classifier.weekly_proposal, agents.abbott_page_classifier.workflow')
```

Then verify every `runtime/` digest against `MIGRATION-MANIFEST.md` before
packaging it into the private canonical repository.

The bootstrap also packages the additive `src/db/migrations/047_abbott_content_reconciliation_staging.sql` beside its exact root authority. It is not copied into `runtime/` and this package does not apply it. The weekly Abbott entrypoint composes only reconcile, classify, and Sheet projection, then stops for manual batch approval; ingest, candidate materialization, validation, and activation are separately controlled stages.

## Abbott weekly proposal configuration

Set `ABBOTT_CONTENT_PYTHON311_BIN` to an owner-reviewed absolute Python 3.11
executable. The bootstrap deliberately has no `python3`/`PATH` fallback.

The separately authorized first proposal uses the dedicated workflow role only:
`ABBOTT_CONTENT_WORKFLOW_DB_HOST`, `ABBOTT_CONTENT_WORKFLOW_DB_PORT`,
`ABBOTT_CONTENT_WORKFLOW_DB_NAME=report_bd`, `ABBOTT_CONTENT_WORKFLOW_DB_USER`,
and `ABBOTT_CONTENT_WORKFLOW_DB_PASSWORD`. Set the reviewed destination as
`ABBOTT_CONTENT_APPROVAL_SPREADSHEET_ID`. Bind every operation with
`CODE_REVISION` and the explicit taxonomy, prompt, and model-routing versions
passed to `weekly_proposal.py`. `OPENAI_API_KEY` is needed only for eligible
`--execute --execute-llm`, never for a dry run.

Candidate materialization and the first validation-gate read use only
`ABBOTT_CONTENT_MATERIALIZER_DB_*`. Persisting validation evidence and changing
`staging` to `validated` use only `ABBOTT_RELEASE_DB_*`, with the human reviewer
recorded in `ABBOTT_CONTENT_VALIDATION_REVIEWED_BY`. None of these credential
families falls back to `MYSQL_*`, `DB_*`, or collector credentials.

Google OAuth setup/token ownership remains with the operator at
`~/.hermes/google_token.json`; this bootstrap neither installs nor prints a
token. Direct `sheets_sync.py publish`, `pull-approved`, and `share` commands
are disabled. `workflow.py publish-projection` is the sole Sheet writer after
separate authorization.

## Abbott UTM/frequency successor release

The packaged Logs visit contract includes `ym:s:lastsignUTMSource`, normalized
to nullable `utm_source`. Application migration
`044_abbott_private_visit_utm_source.sql` adds the private visit column and
release/date/UTM index repeat-safely; historic active-release rows are never
updated in place.

Production rollout is deferred to a reviewed successor release. After backup
and migration verification, the operator backfills every requested date,
requires successful complete coverage with zero bad rows, compares visit,
identity, direction, and UTM aggregates against the predecessor, and rechecks
`all.sessions = with_user_id.sessions + without_user_id.sessions` for every
date/source. Manager reads may expose exact visit UTM values and aggregate
period-local frequency; embed continues to perform zero private queries.

The authoritative ordered procedure and rollback rule remain in
`docs/ABBOTT-OPERATIONS-RUNBOOK.md` in the operational repository. This branch
does not apply the migration, collect data, cut over, deploy, or change cron.

## Copied, pinned runtime environment

From the installed canonical repository root, create the runtime venv with
copied executables and verify both its containment and exact dependency pins:

```bash
export CANONICAL_ROOT=/root/reportingdash-canonical
test ! -e "$CANONICAL_ROOT/venv"
test -x "$ABBOTT_CONTENT_PYTHON311_BIN"
"$ABBOTT_CONTENT_PYTHON311_BIN" -c \
  'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 78)'
"$ABBOTT_CONTENT_PYTHON311_BIN" -m venv --copies "$CANONICAL_ROOT/venv"
"$CANONICAL_ROOT/venv/bin/python" -m pip install --disable-pip-version-check \
  --no-input --requirement "$CANONICAL_ROOT/requirements.txt"
"$CANONICAL_ROOT/venv/bin/python" - \
  "$CANONICAL_ROOT/venv" "$CANONICAL_ROOT/requirements.txt" <<'PY'
import importlib.metadata
from pathlib import Path
import re
import sys

venv, requirements = map(Path, sys.argv[1:])
for path in venv.rglob("*"):
    if path.is_symlink():
        resolved = path.resolve(strict=False)
        if resolved != venv and venv not in resolved.parents:
            raise SystemExit("runtime venv contains an external symlink")

pins = {}
for raw in requirements.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    requirement, separator, marker = line.partition(";")
    match = re.fullmatch(
        r"([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+!-]+)", requirement.strip()
    )
    if not match:
        raise SystemExit("runtime requirement is not exactly pinned")
    if separator:
        if marker.strip() != 'python_version < "3.9"':
            raise SystemExit("runtime requirement environment marker is unsupported")
        if sys.version_info >= (3, 9):
            continue
    pins[match.group(1)] = match.group(2)

for name, expected in pins.items():
    try:
        actual = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        raise SystemExit("required runtime distribution is missing") from None
    if actual != expected:
        raise SystemExit("required runtime distribution version differs")
PY
"$CANONICAL_ROOT/venv/bin/python" -m pip check
```

No package hashes are claimed by this requirements file. This checkpoint
verifies exact pins and dependency consistency; only separately reviewed real
package hashes may be used for a future hash-locked artifact. Stop if the host
Python cannot create the copied venv.

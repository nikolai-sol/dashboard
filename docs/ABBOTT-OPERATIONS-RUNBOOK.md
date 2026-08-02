# Abbott Canonical/Private Operations Runbook

Status: operator procedure only. No production database, deployment, token,
crontab, or Hermes automation was changed while this runbook was written.

This is the only approved order for moving Abbott counter `90602537` to the
canonical/private release model. Stop at the first failed gate. Commands that
mutate a server are examples for a reviewed maintenance window; do not run
them from an ordinary development session.

## Abbott visit-level operational truth

- Abbott source summaries use Reports API attribution `lastsign` and exact traffic segments `all`, `with_user_id`, and `without_user_id`. Per day/source, `all.sessions = with_user_id.sessions + without_user_id.sessions` is a hard publication gate.
- `user_behavior` uses Logs API `source=visits`. One private database row is one Metrica visit. The private destination is `report_bd_private.canonical_fact_metrika_visits`. Raw User ID, visit ID, start URL, and end URL are manager-only. Raw client ID is never stored; only its hash is persisted.
- Run each Logs request through evaluate → create → poll → download all parts → clean in finally. Prepared files count against the 10 GB quota until cleaned.
- `METRIKA_TOKEN` remains the only OAuth environment key. Never print it. The owner installs or revokes it; this change does not issue or rotate a token.
- Current cron remains collection `06:12`, health `07:05`, and one summary `07:10`. The summary includes session integrity; a mismatch is `CRITICAL`.
- Logs cannot return the current day. Active releases remain append-only: late visit changes require a reviewed successor release/backfill, rather than rewriting an active day.
- Bitrix dump remains test-only; the live connector is deferred.
- No deployment, secret installation, API call, database migration, cron edit, Telegram send, or Hermes schedule occurred.

## Non-negotiable boundaries

- Abbott authority is Yandex Metrika counter `90602537` only. Every collector,
  query, comparison, coverage row, health probe, and cron command must retain
  that filter.
- The required daily scope set is exactly `other`, `traffic`, `page`,
  `user_behavior`, and `returning`.
- `METRIKA_TOKEN` is the only Yandex Metrika OAuth environment key. Do not add
  aliases or put its value in commands, logs, tickets, Git, or chat.
- `LEGACY_LAUNCH_SECRET` is supplied to the legacy Nest service through the
  `x-internal-token` header. Query-string secrets are forbidden.
- Private imports and checkpoints stay outside every web root and release
  archive. Directories are mode `0700`; credential, source, env, SQL, and
  checkpoint files are mode `0600`.
- Activation and rollback change the shared active release pointer atomically.
  They never copy facts, delete the candidate, or enable a silent legacy
  fallback.
- A staging release is resume-safe and may rewrite its own day. The current
  active release permits only an atomic append of a wholly absent, completed
  UTC day for the exact five-scope Abbott bundle. Existing active days are
  immutable; corrections and gap repair require a successor release.
- The duplicate `06:10` legacy `/metrika` cron is removed only after the
  candidate is active and post-activation checks pass.
- Revoking or issuing a Yandex token requires the owner’s authenticated Yandex
  session. It cannot be completed from this repository or by this local run.
- Hermes remains deferred. This runbook does not create a Hermes job.

## Operator variables and protected files

Set non-secret identifiers in the reviewed shell. Values shown below are paths
or placeholders, not credentials.

```bash
set -euo pipefail
umask 077

export CANONICAL_ROOT=/root/reportingdash-abbott-canonical
export DASHBOARD_SOURCE_ROOT=/root/reportingdash-rollout/dashboard-next
export DASHBOARD_RUNTIME_ROOT=/var/www/dashboard
export ABBOTT_COUNTER_ID=90602537
export ABBOTT_OWNER_MYSQL_DEFAULTS_FILE=/root/.config/reportingdash/abbott-owner.cnf
export ABBOTT_COLLECTOR_ENV_FILE=/root/reportingdash-private/abbott/runtime/collector.env
export ABBOTT_IMPORT_ENV_FILE=/root/reportingdash-private/abbott/runtime/import.env
export ABBOTT_RELEASE_ENV_FILE=/root/reportingdash-private/abbott/runtime/release-operator.env
export DASHBOARD_OWNER_ENV_FILE=/var/www/www-root/data/.production.env
export LEGACY_RUNTIME_ENV_FILE=/var/www/legacy-reporting/.env
export LEGACY_SERVICE_NAME=<reviewed-systemd-unit>
export LEGACY_METRIKA_URL=<reviewed-loopback-metrika-url>
export METRIKA_TOKEN_FILE=/root/.config/reportingdash/metrika-token
export LEGACY_LAUNCH_SECRET_FILE=/root/.config/reportingdash/legacy-launch-secret
export ABBOTT_PRIVATE_ARCHIVE_DIR=/root/reportingdash-private/abbott/archive
export ABBOTT_PRIVATE_INPUT_DIR=/root/reportingdash-private/abbott/import
export RUNTIME_REVISION=<reviewed-runtime-git-revision>
export CODE_REVISION=<reviewed-release-data-git-revision>
export DASHBOARD_CODE_REVISION=<reviewed-dashboard-git-revision>
export DASHBOARD_PREDECESSOR_REVISION=<checkpoint-dashboard-git-revision>
export PARSER_VERSION=<reviewed-parser-version>
export BACKFILL_TODAY_UTC=<YYYY-MM-DD>
export CANONICAL_RUNTIME_MANIFEST="$CANONICAL_ROOT/ops/abbott-runtime-manifest.sha256"

install -d -m 700 /root/.config/reportingdash
install -d -m 700 "$ABBOTT_PRIVATE_ARCHIVE_DIR" "$ABBOTT_PRIVATE_INPUT_DIR"
install -d -m 700 "$CANONICAL_ROOT/logs"
test "$(git -C "$DASHBOARD_SOURCE_ROOT" rev-parse HEAD)" = "$DASHBOARD_CODE_REVISION"
test "$(git -C "$CANONICAL_ROOT" rev-parse HEAD)" = "$RUNTIME_REVISION"
git -C "$CANONICAL_ROOT" diff --quiet
git -C "$CANONICAL_ROOT" diff --cached --quiet
git -C "$CANONICAL_ROOT" show HEAD:ops/abbott-runtime-manifest.sha256 | \
  cmp - "$CANONICAL_RUNTIME_MANIFEST"
(cd "$CANONICAL_ROOT" && sha256sum -c "$CANONICAL_RUNTIME_MANIFEST")
test "$(stat -c '%a' /root/.config/reportingdash)" = 700
test "$(stat -c '%a' "$ABBOTT_PRIVATE_ARCHIVE_DIR")" = 700
```

Create the canonical Python environment with copied executables. A normal
symlink-based venv is deliberately rejected because its interpreter can point
outside the attested canonical root. The rollout host's Python must support
this command; stop if it does not:

```bash
test ! -e "$CANONICAL_ROOT/venv"
python3 -m venv --copies "$CANONICAL_ROOT/venv"
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
verifies exact pinned installed distribution versions and dependency
consistency; a future hash-locked artifact requires separately reviewed real
package hashes.

The owner MySQL defaults file is created outside shell history and contains a
standard `[client]` section. It must be non-empty and mode `0600`:

```bash
test -s "$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE"
test "$(stat -c '%a' "$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE")" = 600
```

Do not run `cat`, `env`, `set`, `printenv`, or shell tracing in this procedure.
Use a fresh shell with `set +x` if there is any doubt.

## Local MySQL rehearsal checkpoint (before production Checkpoint 0)

This local gate does not alter any production checkpoint. With approximately
32 GiB of free host capacity and an 8.1 GiB MariaDB 10.11 source dump, the
approved default is a streaming schema-only probe. Do not load source rows or
attempt a capacity-sensitive full dump rehearsal. Move the dump to a private
mode-`0600` path outside Git, worktrees, web roots, and release trees without
making a second 8.1 GiB copy, then run:

```bash
ops/local/abbott_mysql_rehearsal.sh schema \
  --dump-sql /tmp/abbott-rollout-rehearsal/abbott-source-dump.sql \
  --evidence /tmp/abbott-rollout-rehearsal/evidence
```

The harness pins the official `mysql:8.4.10` image, records its resolved digest,
uses only container-local MySQL clients, applies all dashboard migrations in
lexical order through `033` once, and repeats only `033` plus the private
schema/role script. Acceptance requires identical sorted schema/index and grant
signatures. The dump filter writes only DDL into a protected temporary file,
loads that file only into `abbott_source_dump_20260529`, and records an aggregate
table count and sanitized SQL error class.

Review only `rehearsal-summary.json`, `schema-signature.sha256`,
`grant-signature.sha256`, and `dump-schema-probe.txt` in the evidence directory.
They contain no credentials, source paths, database rows, or connection values.
The container, volume, generated accounts, credentials, filtered SQL, and raw
client diagnostics are removed on exit. Setting
`ABBOTT_REHEARSAL_PRESERVE_ON_FAILURE=1` preserves only the private local
temporary directory for debugging; the container and volume are still removed.

The copied Bitrix exports used during this rehearsal are exploratory test-only
data, not an approved production source. They intentionally fail the canonical import
contract because they have neither completeness manifests nor the required
page/event grain. Do not manufacture those claims or transform session paths
into inferred events. Define mapping, completeness, incremental extraction and
stable identifiers only when read-only access to the live Bitrix database is
available. Their deferred live contract does not block the Metrika-first
release or change the two-workbook production source set.

Run the read-only rollout preflight after the local evidence exists. Supply only
explicit protected paths; the helper does not search home directories or print
credential values:

```bash
umask 077
python3 abbott_rollout_preflight.py \
  --local-evidence /tmp/abbott-rollout-rehearsal/evidence \
  --collector-env /protected/abbott/collector.env \
  --import-env /protected/abbott/import.env \
  --release-env /protected/abbott/release.env \
  --dashboard-env "$DASHBOARD_OWNER_ENV_FILE" \
  --owner-token /protected/abbott/owner-token \
  > /tmp/abbott-rollout-rehearsal/evidence/external-gates.json
```

Every supplied credential/token file must be a caller-owned regular file with
mode `0600`; symlinks, malformed dotenv data and multiline values fail closed.
Missing files produce a sanitized `blocked` status without contacting Yandex,
MySQL, cron, Telegram or Hermes. A repeat-safe schema rehearsal reports
`local_rehearsal=ready`; deferred live Bitrix is not a partial-readiness reason.
Cron and Hermes always remain `blocked` until their explicit operator/approval
steps.

## Database accounts, roles, and environment ownership

Apply least privilege with five separate MySQL accounts. The schema SQL
creates these roles but intentionally does not create accounts or passwords:

| Process | Role | Runtime environment |
| --- | --- | --- |
| Canonical Metrika collector | `abbott_collector_role` | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB=report_bd`, `METRIKA_TOKEN` in `$ABBOTT_COLLECTOR_ENV_FILE` |
| Private snapshot importer | `abbott_importer_role` | `ABBOTT_IMPORT_DB_HOST`, `ABBOTT_IMPORT_DB_PORT`, `ABBOTT_IMPORT_DB_USER`, `ABBOTT_IMPORT_DB_PASSWORD` in `$ABBOTT_IMPORT_ENV_FILE` |
| Baseline/comparator/release lifecycle operator | `abbott_release_operator_role` | `ABBOTT_RELEASE_DB_HOST`, `ABBOTT_RELEASE_DB_PORT`, `ABBOTT_RELEASE_DB_USER`, `ABBOTT_RELEASE_DB_PASSWORD`, `ABBOTT_RELEASE_DB_NAME=report_bd` in `$ABBOTT_RELEASE_ENV_FILE` |
| Server-side Abbott embed read model | `abbott_embed_reader_role` | `ABBOTT_EMBED_DB_HOST`, `ABBOTT_EMBED_DB_PORT`, `ABBOTT_EMBED_DB_USER`, `ABBOTT_EMBED_DB_PASSWORD`, `ABBOTT_EMBED_DB_NAME=report_bd` in `$DASHBOARD_OWNER_ENV_FILE` |
| Server-side Abbott manager read model | `abbott_runtime_reader_role` | `ABBOTT_PRIVATE_DB_HOST`, `ABBOTT_PRIVATE_DB_PORT`, `ABBOTT_PRIVATE_DB_USER`, `ABBOTT_PRIVATE_DB_PASSWORD`, `ABBOTT_PRIVATE_DB_NAME=report_bd_private` in `$DASHBOARD_OWNER_ENV_FILE` |

The embed account receives only `abbott_embed_reader_role` and no grant in
`report_bd_private`. The manager account receives `abbott_runtime_reader_role`;
the two audiences never share a pool or credential.

The DBA creates accounts and passwords through a mode-`0600` owner-supplied
SQL file, never as command-line arguments. Its non-secret role assignment
template is:

```sql
GRANT 'abbott_collector_role' TO '<collector-account>'@'<host>';
SET DEFAULT ROLE 'abbott_collector_role' TO '<collector-account>'@'<host>';

GRANT 'abbott_importer_role' TO '<importer-account>'@'<host>';
SET DEFAULT ROLE 'abbott_importer_role' TO '<importer-account>'@'<host>';

GRANT 'abbott_release_operator_role' TO '<release-operator-account>'@'<host>';
SET DEFAULT ROLE 'abbott_release_operator_role' TO '<release-operator-account>'@'<host>';

GRANT 'abbott_runtime_reader_role' TO '<reader-account>'@'<host>';
SET DEFAULT ROLE 'abbott_runtime_reader_role' TO '<reader-account>'@'<host>';
```

Execute the completed protected file without displaying it:

```bash
test -s "$ABBOTT_DB_ACCOUNT_SQL_FILE"
test "$(stat -c '%a' "$ABBOTT_DB_ACCOUNT_SQL_FILE")" = 600
mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" \
  < "$ABBOTT_DB_ACCOUNT_SQL_FILE"
```

## Checkpoint 0: freeze runtime state without printing secrets

Create a private checkpoint before any migration or source import:

```bash
export CHECKPOINT_DIR="/root/reportingdash-private/abbott/checkpoints/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$CHECKPOINT_DIR"

crontab -l > "$CHECKPOINT_DIR/root.crontab.before"
chmod 600 "$CHECKPOINT_DIR/root.crontab.before"

install -m 600 "$ABBOTT_COLLECTOR_ENV_FILE" "$CHECKPOINT_DIR/canonical.env.before"
install -m 600 "$DASHBOARD_OWNER_ENV_FILE" "$CHECKPOINT_DIR/dashboard.env.before"

git -C "$CANONICAL_ROOT" rev-parse HEAD > "$CHECKPOINT_DIR/canonical.revision"
git -C "$DASHBOARD_SOURCE_ROOT" rev-parse HEAD > "$CHECKPOINT_DIR/dashboard.revision"
sha256sum "$DASHBOARD_RUNTIME_ROOT/server.js" > "$CHECKPOINT_DIR/dashboard-runtime.sha256"
install -m 600 "$CANONICAL_RUNTIME_MANIFEST" \
  "$CHECKPOINT_DIR/canonical-runtime-manifest.before.sha256"
(cd "$CANONICAL_ROOT" && sha256sum -c "$CANONICAL_RUNTIME_MANIFEST") \
  > "$CHECKPOINT_DIR/runtime-verification.before.txt"

mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" \
  --batch --skip-column-names report_bd \
  --execute="SELECT dataset_key,canonical_release_id,previous_release_id,switched_at FROM portal_active_data_releases WHERE dataset_key='abbott'" \
  > "$CHECKPOINT_DIR/active-release.before.tsv"
chmod 600 "$CHECKPOINT_DIR"/*
```

Record the previous active release ID from the protected checkpoint as a
non-secret numeric operator variable:

```bash
export PREDECESSOR_RELEASE_ID=<positive-integer-from-checkpoint>
case "$PREDECESSOR_RELEASE_ID" in *[!0-9]*|'') exit 1 ;; esac
```

Do not rotate a token or edit cron yet.

## Checkpoint 1: apply reviewed migrations and grants

Run the release-control migration first, then the private schema/role SQL. Both
must be reviewed against the exact deployed revision:

```bash
mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" report_bd \
  < "$DASHBOARD_SOURCE_ROOT/src/db/migrations/033_abbott_canonical_release_control.sql"

mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" report_bd \
  < "$CANONICAL_ROOT/ops/sql/abbott_private_schema_and_grants.sql"
```

Verify table and role names only; do not query private rows:

```bash
mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" \
  --batch --skip-column-names report_bd \
  --execute="SELECT COUNT(*) FROM information_schema.tables WHERE (table_schema='report_bd' AND table_name='portal_data_releases') OR (table_schema='report_bd' AND table_name='portal_active_data_releases') OR (table_schema='report_bd' AND table_name='portal_dataset_snapshots') OR (table_schema='report_bd' AND table_name='portal_release_source_imports') OR (table_schema='report_bd' AND table_name='portal_migration_validation_runs') OR (table_schema='report_bd' AND table_name='portal_bitrix_page_facts') OR (table_schema='report_bd' AND table_name='canonical_fact_metrika_site_analytics_daily') OR (table_schema='report_bd' AND table_name='canonical_fact_metrika_returning_pages_release_daily') OR (table_schema='report_bd' AND table_name='canonical_source_coverage_daily') OR (table_schema='report_bd_private' AND table_name='canonical_fact_metrika_visits') OR (table_schema='report_bd_private' AND table_name='portal_user_directions_private') OR (table_schema='report_bd_private' AND table_name='portal_bitrix_page_facts') OR (table_schema='report_bd_private' AND table_name='portal_bitrix_journeys_private')" \
  > "$CHECKPOINT_DIR/schema-table-count.txt"
export ACTUAL_SCHEMA_TABLE_COUNT="$(cat "$CHECKPOINT_DIR/schema-table-count.txt")"
test "$ACTUAL_SCHEMA_TABLE_COUNT" = 13
```

The exact reviewed query names all 13 schema/table pairs, including the
visit-level private Metrika authority and distinct primary/private
`portal_bitrix_page_facts` contracts. The legacy daily behavior table is not
accepted as visit-level evidence. Any smaller or larger result blocks the
rollout; a cross-product `IN` query is forbidden.

## Checkpoint 2: issue and install owner-controlled secrets

### Yandex Metrika OAuth token

The Yandex account owner must create/authorize a token with the minimum
`metrika:read` scope and confirmed access to counter `90602537`. Repository
tools cannot issue it and must not simulate issuance.

The owner delivers the new value as a protected file. Install it atomically
without echoing it:

```bash
set +x
test -s "$OWNER_DELIVERED_METRIKA_TOKEN_FILE"
install -m 600 "$OWNER_DELIVERED_METRIKA_TOKEN_FILE" "$METRIKA_TOKEN_FILE.new"
mv "$METRIKA_TOKEN_FILE.new" "$METRIKA_TOKEN_FILE"
test -s "$METRIKA_TOKEN_FILE"
test "$(stat -c '%a' "$METRIKA_TOKEN_FILE")" = 600
```

Update `METRIKA_TOKEN` in the canonical env from that file without printing
either file. The helper rejects empty/multiline values and writes atomically:

```bash
python3 - "$ABBOTT_COLLECTOR_ENV_FILE" METRIKA_TOKEN "$METRIKA_TOKEN_FILE" <<'PY'
import os, pathlib, sys, tempfile
env_path, key, value_path = map(pathlib.Path, (sys.argv[1], sys.argv[2], sys.argv[3]))
value = value_path.read_text(encoding="utf-8").rstrip("\n")
if not value or "\n" in value or "\r" in value:
    raise SystemExit("protected value file is invalid")
lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
updated = [line for line in lines if not line.startswith(f"{key}=")]
updated.append(f"{key}={value}")
fd, temporary = tempfile.mkstemp(prefix=f".{env_path.name}.", dir=env_path.parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(updated) + "\n")
        handle.flush(); os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, env_path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY
```

Validate actual read access with the Yandex Management API's read-only counter
endpoint. The probe verifies the returned counter identity and prints no token
or response payload:

```bash
set -a
. "$ABBOTT_COLLECTOR_ENV_FILE"
set +a
"$CANONICAL_ROOT/venv/bin/python" "$CANONICAL_ROOT/probe_yandex_metrika_access.py" \
  > "$CHECKPOINT_DIR/abbott-token-probe.json"
chmod 600 "$CHECKPOINT_DIR/abbott-token-probe.json"
unset METRIKA_TOKEN
```

### Legacy internal launch token

Generate a fresh internal token directly into a protected file without terminal
output, then install it as `LEGACY_LAUNCH_SECRET` in the owner-managed legacy
runtime env using the same atomic helper pattern:

```bash
set +x
umask 077
openssl rand -hex 32 > "$LEGACY_LAUNCH_SECRET_FILE.new"
chmod 600 "$LEGACY_LAUNCH_SECRET_FILE.new"
mv "$LEGACY_LAUNCH_SECRET_FILE.new" "$LEGACY_LAUNCH_SECRET_FILE"
test -s "$LEGACY_LAUNCH_SECRET_FILE"
test "$(stat -c '%a' "$LEGACY_LAUNCH_SECRET_FILE")" = 600
```

Clients send this value only as `x-internal-token`. Never append `secret=` to a
URL. Do not enable or repair the old `/metrika` cron as part of installation.

Install the new value atomically into the owner-managed legacy env by rerunning
the exact protected-file Python helper above with these arguments:

```bash
python3 - "$LEGACY_RUNTIME_ENV_FILE" LEGACY_LAUNCH_SECRET "$LEGACY_LAUNCH_SECRET_FILE" <<'PY'
import os, pathlib, sys, tempfile
env_path, key, value_path = map(pathlib.Path, (sys.argv[1], sys.argv[2], sys.argv[3]))
value = value_path.read_text(encoding="utf-8").rstrip("\n")
if not value or "\n" in value or "\r" in value: raise SystemExit("protected value file is invalid")
lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
updated = [line for line in lines if not line.startswith(f"{key}=")]
updated.append(f"{key}={value}")
fd, temporary = tempfile.mkstemp(prefix=f".{env_path.name}.", dir=env_path.parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(updated) + "\n"); handle.flush(); os.fsync(handle.fileno())
    os.chmod(temporary, 0o600); os.replace(temporary, env_path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY
```

In the reviewed maintenance window, restart the named legacy service and use
protected curl config files to prove missing/wrong headers return `401` or
`403`, while the correct `x-internal-token` returns `2xx`. Create the positive
config from `$LEGACY_LAUNCH_SECRET_FILE` without terminal output, keep all
configs mode `0600`, run `systemctl restart "$LEGACY_SERVICE_NAME"`, record
only HTTP status codes, then delete the configs. Do not put the header value on
the command line or enable the legacy cron.

```bash
python3 - "$LEGACY_METRIKA_URL" "$LEGACY_LAUNCH_SECRET_FILE" "$CHECKPOINT_DIR" <<'PY'
import pathlib, sys
url, secret_file, directory = sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
secret = secret_file.read_text(encoding="utf-8").strip()
common = f'url = "{url}"\nrequest = "POST"\nsilent\nshow-error\noutput = "/dev/null"\nwrite-out = "%{{http_code}}"\n'
configs = {
    "legacy-auth-missing.curl": common,
    "legacy-auth-wrong.curl": common + 'header = "x-internal-token: definitely-wrong"\n',
    "legacy-auth-valid.curl": common + f'header = "x-internal-token: {secret}"\n',
}
for name, content in configs.items():
    path = directory / name; path.write_text(content, encoding="utf-8"); path.chmod(0o600)
PY
systemctl restart "$LEGACY_SERVICE_NAME"
systemctl is-active --quiet "$LEGACY_SERVICE_NAME"
export MISSING_AUTH_STATUS="$(curl --config "$CHECKPOINT_DIR/legacy-auth-missing.curl")"
export WRONG_AUTH_STATUS="$(curl --config "$CHECKPOINT_DIR/legacy-auth-wrong.curl")"
export VALID_AUTH_STATUS="$(curl --config "$CHECKPOINT_DIR/legacy-auth-valid.curl")"
case "$MISSING_AUTH_STATUS" in 401|403) ;; *) exit 1 ;; esac
case "$WRONG_AUTH_STATUS" in 401|403) ;; *) exit 1 ;; esac
case "$VALID_AUTH_STATUS" in 2??) ;; *) exit 1 ;; esac
rm -f "$CHECKPOINT_DIR"/legacy-auth-*.curl
unset MISSING_AUTH_STATUS WRONG_AUTH_STATUS VALID_AUTH_STATUS
```

## Checkpoint 3: freeze the baseline

The baseline covers `2026-01-01` through the last completed UTC day selected
for the reviewed backfill. Private source paths are explicit and outside the
web root. The Metrika-first production baseline declares only the two required
workbook inputs:

```bash
set -a
. "$ABBOTT_RELEASE_ENV_FILE"
set +a
export BASELINE_DATE_FROM=2026-01-01
export BASELINE_DATE_TO=<last-completed-UTC-date>

cd "$CANONICAL_ROOT"
"$CANONICAL_ROOT/venv/bin/python" capture_abbott_canonical_baseline.py \
  --date-from "$BASELINE_DATE_FROM" \
  --date-to "$BASELINE_DATE_TO" \
  --private-archive-dir "$ABBOTT_PRIVATE_ARCHIVE_DIR" \
  --code-revision "$CODE_REVISION" \
  --source-file "abbott_workbook_json:$PARSER_VERSION:$ABBOTT_PRIVATE_INPUT_DIR/abbott-workbook.json" \
  --source-file "abbott_workbook_catalog:$PARSER_VERSION:$ABBOTT_PRIVATE_INPUT_DIR/Abbott-names.xlsx" \
  > "$CHECKPOINT_DIR/baseline-capture.log"
chmod 600 "$CHECKPOINT_DIR/baseline-capture.log"
```

Confirm the frozen snapshot has source kind
`abbott_canonical_control_pack`, counter `90602537`, the expected date range,
and only aggregate/sanitized manifest evidence. Then set:

```bash
export BASELINE_SNAPSHOT_ID=<positive-integer-from-baseline-capture>
case "$BASELINE_SNAPSHOT_ID" in *[!0-9]*|'') exit 1 ;; esac
```

Optionally capture the additional pre-backfill SQL snapshot only after every
required `@abbott_snapshot_*` session variable has been loaded from a protected
owner SQL file. Never place those values on the command line:

```bash
{ cat "$ABBOTT_PREBACKFILL_VARIABLES_SQL_FILE"; \
  cat "$CANONICAL_ROOT/ops/sql/abbott_prebackfill_snapshot.sql"; } | \
mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" report_bd \
  > "$CHECKPOINT_DIR/prebackfill-aggregate-evidence.tsv"
chmod 600 "$CHECKPOINT_DIR/prebackfill-aggregate-evidence.tsv"
```

## Checkpoint 4: create the immutable candidate boundary

Create one staging release that points to the frozen baseline and predecessor.
The command prints only the new numeric release ID and status fields:

```bash
set -a
. "$ABBOTT_RELEASE_ENV_FILE"
set +a
cd "$CANONICAL_ROOT"
export CANDIDATE_RELEASE_RESULT="$($CANONICAL_ROOT/venv/bin/python abbott_release_operator.py create \
  --predecessor-release-id "$PREDECESSOR_RELEASE_ID" \
  --baseline-snapshot-id "$BASELINE_SNAPSHOT_ID" \
  --code-revision "$CODE_REVISION")"
export CANDIDATE_RELEASE_ID="${CANDIDATE_RELEASE_RESULT#release_id=}"
export CANDIDATE_RELEASE_ID="${CANDIDATE_RELEASE_ID%% *}"
case "$CANDIDATE_RELEASE_ID" in *[!0-9]*|'') exit 1 ;; esac
```

The candidate must remain `staging`; no read path points to it yet.

## Checkpoint 5: import private sources into the staging release

Every input and archive path is explicit. Ensure all source files are mode
`0600`, load the importer role env without printing it, and run the transactional
importer:

```bash
find "$ABBOTT_PRIVATE_INPUT_DIR" -type f ! -perm 0600 -print -quit | grep -q . && exit 1 || true
test -s "$ABBOTT_IMPORT_ENV_FILE"
test "$(stat -c '%a' "$ABBOTT_IMPORT_ENV_FILE")" = 600

set -a
. "$ABBOTT_IMPORT_ENV_FILE"
set +a
cd "$DASHBOARD_SOURCE_ROOT"
node --import tsx scripts/import-abbott-private-data.ts \
  --canonical-release-id "$CANDIDATE_RELEASE_ID" \
  --workbook-json "$ABBOTT_PRIVATE_INPUT_DIR/abbott-workbook.json" \
  --workbook-xlsx "$ABBOTT_PRIVATE_INPUT_DIR/Abbott-names.xlsx" \
  --parser-version "$PARSER_VERSION" \
  --code-revision "$CODE_REVISION" \
  --archive-dir "$ABBOTT_PRIVATE_ARCHIVE_DIR" \
  > "$CHECKPOINT_DIR/private-import.log" 2>&1
unset ABBOTT_IMPORT_DB_HOST ABBOTT_IMPORT_DB_PORT ABBOTT_IMPORT_DB_USER ABBOTT_IMPORT_DB_PASSWORD
chmod 600 "$CHECKPOINT_DIR/private-import.log"
```

The importer must either commit all verified fingerprints and attach snapshot
IDs to this staging release, or roll back and leave the previous active release
unchanged. When a checksum reuses an existing imported snapshot, the importer
materializes the freshly parsed source-specific batches into the empty staging
release with the same immutable snapshot ID. It uses parameterized `VALUES`
inserts for the protected source rows and never copies rows from a predecessor
release or another tenant. Counts and complete persisted-row fingerprints must
verify before per-release import execution evidence is written. A partial
candidate batch or any fingerprint mismatch fails the transaction; a fully
identical rerun is allowed.

## Checkpoint 6: fill the known gap, then all completed 2026 dates

`backfill_abbott_metrika_2026.py` is the authority. In one resume-safe run it
orders `2026-03-29..2026-04-07` first, then every remaining day from
`2026-01-01` through `min(BACKFILL_TODAY_UTC - 1 day, 2026-12-31)`.
Each day stages and atomically publishes all five required scopes for counter
`90602537`. A reconciled day is skipped on rerun; partial/failed days are not.

```bash
set -a
. "$ABBOTT_COLLECTOR_ENV_FILE"
set +a
cd "$CANONICAL_ROOT"
"$CANONICAL_ROOT/venv/bin/python" backfill_abbott_metrika_2026.py \
  --canonical-release-id "$CANDIDATE_RELEASE_ID" \
  --code-revision "$CODE_REVISION" \
  --parser-version "$PARSER_VERSION" \
  --today-utc "$BACKFILL_TODAY_UTC" \
  > "$CHECKPOINT_DIR/backfill-2026.log" 2>&1
unset METRIKA_TOKEN MYSQL_PASSWORD
chmod 600 "$CHECKPOINT_DIR/backfill-2026.log"
```

For a mid-2026 cutover, “full 2026” means every completed date through
yesterday. After the year closes, rerun the same resume-safe command with
`BACKFILL_TODAY_UTC=2027-01-01` to prove coverage through `2026-12-31`.

Gate query (aggregate only): every completed date must have exactly five rows,
all complete/unsampled, and the priority gap must have no missing day:

```bash
mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" \
  --batch --skip-column-names report_bd \
  --execute="WITH RECURSIVE calendar(report_date) AS (SELECT DATE('2026-01-01') UNION ALL SELECT DATE_ADD(report_date, INTERVAL 1 DAY) FROM calendar WHERE report_date < DATE('${BASELINE_DATE_TO}')) SELECT calendar.report_date FROM calendar LEFT JOIN canonical_source_coverage_daily AS coverage ON coverage.canonical_release_id=${CANDIDATE_RELEASE_ID} AND coverage.source_key='yandex_metrika' AND coverage.counter_id=90602537 AND coverage.report_date=calendar.report_date AND coverage.collection_status IN ('success','success_empty') AND coverage.pagination_complete=1 AND coverage.is_sampled=0 AND ((coverage.collection_status='success' AND coverage.persisted_rows>0) OR (coverage.collection_status='success_empty' AND coverage.persisted_rows=0 AND coverage.api_total_rows=0 AND coverage.empty_reconciled=1)) GROUP BY calendar.report_date HAVING COUNT(DISTINCT coverage.scope_key)<>5 OR SUM(coverage.scope_key='other')=0 OR SUM(coverage.scope_key='traffic')=0 OR SUM(coverage.scope_key='page')=0 OR SUM(coverage.scope_key='user_behavior')=0 OR SUM(coverage.scope_key='returning')=0" \
  > "$CHECKPOINT_DIR/non-reconciled-days.tsv"
test ! -s "$CHECKPOINT_DIR/non-reconciled-days.tsv"
test "$(date -d '2026-04-07' +%s)" -ge "$(date -d '2026-03-29' +%s)"
```

## Checkpoint 7: compare and validate the candidate

Run the persisted comparator. Exit `0` means every control passed or every
warning already has an explicit reviewer and acceptance timestamp. Any failure,
unreviewed warning, missing coverage row, sampling, or API delta above threshold
blocks cutover:

```bash
cd "$CANONICAL_ROOT"
"$CANONICAL_ROOT/venv/bin/python" compare_abbott_canonical_release.py \
  --baseline-run-id "$BASELINE_SNAPSHOT_ID" \
  --candidate-release-id "$CANDIDATE_RELEASE_ID" \
  > "$CHECKPOINT_DIR/candidate-comparator.log"
chmod 600 "$CHECKPOINT_DIR/candidate-comparator.log"
```

Also require manager/embed contract tests, release-asset scanning, deterministic
Abbott health, and a dashboard smoke test. Warnings are accepted only by a
named human reviewer in the validation table; this runbook does not auto-accept
them.

The release scan keeps path and symlink rejection and also inspects bounded
`.json`, `.jsonl`, `.csv`, `.tsv`, `.xlsx`, and `.xls` candidates for raw User
ID, protected visit/journey, and Bitrix export signatures. Malformed,
unreadable, or over-limit candidates fail closed. Diagnostics contain paths
only and must never echo file content or identifiers.

Before validation, re-attest the canonical runtime and install a deterministic
full dashboard release from the reviewed revision. The installer copies the
complete standalone, static, and public trees into a same-filesystem staging
directory, scans both staging and final trees, writes a sorted SHA-256 manifest,
atomically renames the release, and atomically flips the active symlink:

```bash
test "$(git -C "$CANONICAL_ROOT" rev-parse HEAD)" = "$RUNTIME_REVISION"
git -C "$CANONICAL_ROOT" diff --quiet
git -C "$CANONICAL_ROOT" diff --cached --quiet
git -C "$CANONICAL_ROOT" show HEAD:ops/abbott-runtime-manifest.sha256 | \
  cmp - "$CANONICAL_RUNTIME_MANIFEST"
(cd "$CANONICAL_ROOT" && sha256sum -c "$CANONICAL_RUNTIME_MANIFEST")
test "$(git -C "$DASHBOARD_SOURCE_ROOT" rev-parse HEAD)" = "$DASHBOARD_CODE_REVISION"
test -z "$(git -C "$DASHBOARD_SOURCE_ROOT" status --porcelain=v1 --untracked-files=all)"
cd "$DASHBOARD_SOURCE_ROOT"
npm ci
npm run build
install -d "$DASHBOARD_SOURCE_ROOT/.next/standalone/.next/static"
cp -a "$DASHBOARD_SOURCE_ROOT/.next/static/." \
  "$DASHBOARD_SOURCE_ROOT/.next/standalone/.next/static/"
install -d "$DASHBOARD_SOURCE_ROOT/.next/standalone/public"
cp -a "$DASHBOARD_SOURCE_ROOT/public/." \
  "$DASHBOARD_SOURCE_ROOT/.next/standalone/public/"
install -m 600 "$DASHBOARD_OWNER_ENV_FILE" \
  "$DASHBOARD_SOURCE_ROOT/.next/standalone/.env"
npm run security:public-assets -- --release "$DASHBOARD_SOURCE_ROOT/.next/standalone"
bash scripts/validate-production-release.sh \
  "$DASHBOARD_SOURCE_ROOT/.next/standalone" \
  "$DASHBOARD_SOURCE_ROOT/.next/standalone/.env"
export DASHBOARD_RELEASES_DIR=/var/www/dashboard-releases
if [[ -d "$DASHBOARD_RUNTIME_ROOT" && ! -L "$DASHBOARD_RUNTIME_ROOT" ]]; then
  install -d -m 700 "$CHECKPOINT_DIR/public-quarantine"
  if [[ -e "$DASHBOARD_RUNTIME_ROOT/public/abbott" ]]; then
    test ! -e "$CHECKPOINT_DIR/public-quarantine/abbott"
    mv "$DASHBOARD_RUNTIME_ROOT/public/abbott" \
      "$CHECKPOINT_DIR/public-quarantine/abbott"
    find "$CHECKPOINT_DIR/public-quarantine/abbott" -type d -exec chmod 700 {} +
    find "$CHECKPOINT_DIR/public-quarantine/abbott" -type f -exec chmod 600 {} +
  fi
  test ! -e "$DASHBOARD_RUNTIME_ROOT/public/abbott"
  bash scripts/install-reviewed-release.sh --checkpoint-current \
    "$DASHBOARD_RUNTIME_ROOT" \
    "$DASHBOARD_RELEASES_DIR" \
    "$DASHBOARD_PREDECESSOR_REVISION"
  (cd "$DASHBOARD_RELEASES_DIR/$DASHBOARD_PREDECESSOR_REVISION" && \
    sha256sum -c "$DASHBOARD_RELEASES_DIR/$DASHBOARD_PREDECESSOR_REVISION.sha256")
fi
test ! -e "$DASHBOARD_RUNTIME_ROOT" || test -L "$DASHBOARD_RUNTIME_ROOT"
bash scripts/install-reviewed-release.sh \
  "$DASHBOARD_SOURCE_ROOT/.next/standalone" \
  "$DASHBOARD_RELEASES_DIR" \
  "$DASHBOARD_RUNTIME_ROOT" \
  "$DASHBOARD_CODE_REVISION"
export DEPLOYED_DASHBOARD_RELEASE="$(readlink -f "$DASHBOARD_RUNTIME_ROOT")"
npm run security:public-assets -- --release "$DEPLOYED_DASHBOARD_RELEASE"
(cd "$DEPLOYED_DASHBOARD_RELEASE" && \
  sha256sum -c "$DASHBOARD_RELEASES_DIR/$DASHBOARD_CODE_REVISION.sha256")
pm2 restart dashboard-next --update-env
curl -fsS http://127.0.0.1:3001/api/health >/dev/null
for public_asset in \
  abbott-workbook.json \
  bitrix-analytics.json \
  bitrix-session-journeys.json
do
  public_asset_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:3001/abbott/$public_asset")"
  test "$public_asset_status" = 404
done
```

Never restore the quarantine, including during rollback. A sanitized
predecessor may be reactivated only after the same release scan; the quarantined
PII remains outside every application and public release tree.

Do not validate or activate if any revision, full-tree manifest, deployed-tree
asset scan, restart, or health check fails.

Only after every gate passes, execute the tested validation transition. It
locks only the mutable staging release row, reads immutable source and evidence
rows without locking clauses under the same transaction, and requires persisted comparator evidence bound to the
baseline snapshot and candidate code revision, selects only the latest
completed `validation_run_id`, and accepts exactly the frozen baseline control
names plus five `coverage.*.reconciled_days` controls. An empty aggregate
control mapping is permitted only for the reviewed one-time bootstrap pair:
baseline snapshot `13` and predecessor release `1`. The five coverage controls
and exact calendar gate remain mandatory. Every future empty, missing or
malformed control mapping fails closed. A warn
requires both `reviewed_by` and `accepted_at`. It also requires the exact frozen
source set: both workbook kinds plus either optional Bitrix kind only when the
baseline declares it. Every immutable SHA-256/byte/parser fingerprint must
match the frozen baseline and import manifest, with one matching
candidate-revision execution in `portal_release_source_imports` per source. It
uses a recursive calendar CTE to
detect wholly absent dates, requires the exact five-scope reconciled bundle on
every date, inserts final gate evidence, and CAS-transitions to `validated` in
the same transaction:

```bash
"$CANONICAL_ROOT/venv/bin/python" abbott_release_operator.py validate \
  --release-id "$CANDIDATE_RELEASE_ID" \
  --date-from 2026-01-01 \
  --date-to "$BASELINE_DATE_TO" \
  --code-revision "$CODE_REVISION"
```

## Checkpoint 8: atomic activation

Confirm the active pointer still equals `$PREDECESSOR_RELEASE_ID`, then invoke
the release-store transaction:

```bash
cd "$CANONICAL_ROOT"
"$CANONICAL_ROOT/venv/bin/python" abbott_release_operator.py activate \
  --release-id "$CANDIDATE_RELEASE_ID" \
  --expected-active-release-id "$PREDECESSOR_RELEASE_ID"
```

This operation locks the pointer, activates only a `validated` candidate,
retires only the expected predecessor, swaps the pointer, and commits as one
transaction. A pointer race or status mismatch rolls back.

Immediately capture the new pointer and run release-specific smoke checks for:

- counter `90602537` only;
- all five scopes and the selected date window;
- the `2026-03-29..2026-04-07` gap;
- manager/private and embed/aggregate projections;
- current-month default through yesterday;
- no Abbott private files in public or standalone release paths;
- deterministic health and `07:10` summary rendering without network sends.

Do not edit cron or revoke the old token until these checks pass.

## Checkpoint 9: install the post-cutover cron table

Set the explicit human gate only after Checkpoint 8 smoke tests pass:

```bash
export ACTIVATION_CONFIRMED=yes
test "$ACTIVATION_CONFIRMED" = yes
test "$(git -C "$CANONICAL_ROOT" rev-parse HEAD)" = "$RUNTIME_REVISION"
(cd "$CANONICAL_ROOT" && sha256sum -c "$CANONICAL_RUNTIME_MANIFEST")
test -x /root/reportingdash-canonical/venv/bin/python
test -f /root/reportingdash-canonical/fetch_yandex_metrika_returning_canonical.py
```

Create the new crontab from the protected checkpoint. The helper accepts and
removes zero or one line whose schedule is `06:10` and whose command contains
`/metrika`; it never prints that line. More than one matching legacy line is a
hard failure. It removes prior copies of the managed collection, health, and
summary jobs before appending the reviewed schedule. Every Metrika collector
uses the same blocking lock, so a collision waits rather than silently skipping
a day. The existing shadow monitor is not a managed marker and remains intact:

```bash
python3 - "$CHECKPOINT_DIR/root.crontab.before" "$CHECKPOINT_DIR/root.crontab.after" <<'PY'
import os, pathlib, sys
source, target = map(pathlib.Path, sys.argv[1:])
kept = []
removed_legacy = 0
managed = (
    "fetch_yandex_metrika_canonical.py",
    "fetch_yandex_metrika_returning_canonical.py",
    "run_abbott_metrika_active_release.py",
    "abbott_health_probe.py",
    "send_canonical_telegram_report.py --mode summary",
)
for line in source.read_text(encoding="utf-8").splitlines():
    fields = line.split()
    if len(fields) >= 2 and fields[0:2] == ["10", "6"] and "/metrika" in line:
        removed_legacy += 1
        continue
    if any(marker in line for marker in managed):
        continue
    kept.append(line)
if removed_legacy > 1:
    raise SystemExit("expected zero or one 06:10 legacy /metrika cron")
runtime_revision = os.environ["RUNTIME_REVISION"]
code_revision = os.environ["CODE_REVISION"]
parser_version = os.environ["PARSER_VERSION"]
root = "/root/reportingdash-abbott-canonical"
python = f"{root}/venv/bin/python"
legacy_root = "/root/reportingdash-canonical"
legacy_python = f"{legacy_root}/venv/bin/python"
lock = "/usr/bin/flock /run/lock/reportingdash-metrika.lock"
kept.extend([
    f"12 6 * * * {lock} /bin/bash -lc 'set -a; . /root/reportingdash-canonical/.env; set +a; cd {root}; PYTHONDONTWRITEBYTECODE=1 {python} fetch_yandex_metrika_canonical.py --days-back 2 --run-type cron --exclude-counter-id 90602537 >> {root}/logs/yandex-metrika-generic-cron.log 2>&1'",
    f"12 6 * * * {lock} /bin/bash -lc 'set -a; . /root/reportingdash-private/abbott/runtime/collector.env; set +a; cd {root}; PYTHONDONTWRITEBYTECODE=1 {python} run_abbott_metrika_active_release.py --canonical-root {root} --manifest {root}/ops/abbott-runtime-manifest.sha256 --collector {root}/fetch_yandex_metrika_canonical.py --runtime-revision {runtime_revision} --code-revision {code_revision} --parser-version {parser_version} >> {root}/logs/yandex-metrika-abbott-cron.log 2>&1'",
    f"18 6 * * * {lock} /bin/bash -lc 'set -a; . {legacy_root}/.env; set +a; cd {legacy_root}; PYTHONDONTWRITEBYTECODE=1 {legacy_python} fetch_yandex_metrika_returning_canonical.py --counter-id 66624469 >> {legacy_root}/logs/yandex-metrika-returning-cron.log 2>&1'",
    f"5 7 * * * /bin/bash -lc 'set -a; . /var/www/dashboard/.env; set +a; cd {root}; PYTHONDONTWRITEBYTECODE=1 {python} abbott_health_probe.py --json --counter-id 90602537 >> {root}/logs/abbott-health-cron.log 2>&1'",
    f"10 7 * * * /bin/bash -lc 'set -a; . /var/www/dashboard/.env; set +a; cd {root}; PYTHONDONTWRITEBYTECODE=1 {python} send_canonical_telegram_report.py --mode summary >> {root}/logs/canonical-telegram-summary.log 2>&1'",
])
target.write_text("\n".join(kept) + "\n", encoding="utf-8")
target.chmod(0o600)
PY

crontab "$CHECKPOINT_DIR/root.crontab.after"
crontab -l > "$CHECKPOINT_DIR/root.crontab.installed"
chmod 600 "$CHECKPOINT_DIR/root.crontab.installed"
cmp "$CHECKPOINT_DIR/root.crontab.after" "$CHECKPOINT_DIR/root.crontab.installed"
```

The final order is generic canonical collection excluding Abbott and the
attested Abbott collector at `06:12`, the Zaruku returning collector at `06:18`,
the preserved existing shadow monitor plus deterministic Abbott health at
`07:05`, and exactly one Telegram daily summary at `07:10`. The `07:10` summary
is not an additional duplicate of an older entry; the helper replaces any
existing summary implementation.

The generic collector and Abbott launcher execute from the dedicated, attested
Abbott runtime. The returning job preserves the independently deployed existing
Zaruku collector and venv under `/root/reportingdash-canonical`; Checkpoint 9
verifies both executable paths before changing cron. The shared `flock` has no
timeout, so queued collectors cannot be silently skipped after an arbitrary
wait interval.

The wrapper attests `--runtime-revision` independently, resolves and verifies
the current Abbott active pointer against the immutable `--code-revision` on
every run, then invokes the collector with `--days-back 1`: active publication may
append only the newly completed yesterday UTC bundle. A retry, late correction,
or gap repair for an existing day requires a successor staging release and
activation; it may never overwrite the active release. The removed legacy
`06:10 /metrika` job previously collected a duplicate multi-day window and is
not retained as a `today-2` fallback.

Session-integrity health treats a Reports API segment row omitted at zero
sessions as zero, matching the publication gate. Unknown markers and arithmetic
source mismatches remain `CRITICAL`.

## Checkpoint 10: revoke old Yandex credentials

After the new token has completed an accepted collection, health probe, and
summary cycle, the Yandex account owner revokes every previously exposed or
superseded token in the Yandex OAuth UI. Local code cannot perform or confirm
this owner-session action. Record only the revocation timestamp, owner identity,
OAuth application identifier, and verification status—never a token value.

Do not delete `$METRIKA_TOKEN_FILE`; it is the active owner-provisioned token.
Do not restore a revoked token during rollback.

## Abbott UTM/frequency successor-release rollout

Status: deferred operator work for a separately reviewed maintenance window.
The implementation of UTM Source and period-local visit frequency did not run
these production steps.

1. Take and verify a database backup. Apply migration
   `044_abbott_private_visit_utm_source.sql`, then verify the nullable column
   through `information_schema.COLUMNS` and its release/date/UTM index through
   `information_schema.STATISTICS`.
2. Start a new append-only Abbott successor release. Never update the active
   release in place, including to repair a late or missing visit.
3. Backfill every requested date with the updated Logs visit collector using
   its normal evaluate → create → poll → download all parts → clean in finally
   lifecycle.
4. Before any projection or comparison, require successful run status,
   complete expected-date coverage, and zero bad coverage rows for the
   candidate.
5. Run the return-page direction projection after the candidate backfill is
   complete and before comparison, validation, activation, or dashboard
   deployment. This is a staging-only Abbott counter `90602537` operation on
   the candidate release; it does not run against an active release.

   Freeze this read-only release-8 baseline in the comparison evidence without
   copying raw URLs into logs or Git:

   ```text
   catalog_rows=1769
   catalog_rows_with_direction=1639
   catalog_rows_with_normalized_url=0
   catalog_rows_with_normalized_path=0
   path_lookup_rows=0
   ```

   Record aggregate-only projection evidence for distinct normalized paths seen
   in candidate page facts; matched path projections with non-empty direction;
   unmatched paths; ambiguous paths; and returning-page rows and returning
   visitors with/without page direction. Require zero path rows falsely marked
   resolved when their evidence conflicts. Direction coverage must improve from
   the frozen zero-path baseline; make every remaining unmatched or ambiguous
   count visible for human review, without inventing a percentage threshold
   before the candidate evidence is measured.

   Path resolution is exact-path evidence only: no slug or substring fallback.
   Never rewrite an active release, title projection, or slug projection; the
   candidate path projection is the only permitted write. Stop for review if
   any aggregate gate fails.
6. Compare the active and candidate releases for total visit rows, distinct
   visit hashes, User ID coverage, null client-hash count, direction mapping
   coverage, and UTM populated/null counts. Record only aggregate evidence;
   never print identifiers, URLs, or credentials.
7. Re-run the hard publication gate
   `all.sessions = with_user_id.sessions + without_user_id.sessions` for every
   date/source. Do not publish a candidate with any mismatch.
8. Confirm manager-only UTM/frequency reads and zero embed private queries.
9. After review, perform the pointer cutover and application deployment. Run
   an authenticated manager smoke test and an embed smoke test; rollback if
   either smoke test fails.
10. Do not restore public PII assets during rollback. Database and application
   rollback may restore the reviewed predecessor pointers, but public Abbott
   source artifacts remain quarantined.

The operating schedule does not change: collection `06:12`, health `07:05`,
summary `07:10`. The summary continues to include session integrity and an
integrity mismatch remains `CRITICAL`.

## Rollback

Rollback is a pointer operation, not a data rewrite. Use the candidate as the
expected current pointer and the frozen predecessor as the target:

```bash
cd "$CANONICAL_ROOT"
"$CANONICAL_ROOT/venv/bin/python" abbott_release_operator.py rollback \
  --from-release-id "$CANDIDATE_RELEASE_ID" \
  --to-release-id "$PREDECESSOR_RELEASE_ID"
```

Then:

1. if application rollback is required, atomically reactivate the already
   scanned and hash-verified predecessor tree, restart, and health-check it:

   ```bash
   cd "$DASHBOARD_SOURCE_ROOT"
   bash scripts/install-reviewed-release.sh --activate-existing \
     "$DASHBOARD_RELEASES_DIR" \
     "$DASHBOARD_RUNTIME_ROOT" \
     "$DASHBOARD_PREDECESSOR_REVISION"
   pm2 restart dashboard-next --update-env
   curl -fsS http://127.0.0.1:3001/api/health >/dev/null
   ```

2. verify the active pointer and release-specific aggregate/private smoke tests;
3. preserve candidate facts and validation evidence for incident analysis;
4. restore the protected pre-cutover crontab only after an explicit incident
   decision. If legacy `/metrika` must be temporarily re-enabled, it must use
   `x-internal-token` and the new `LEGACY_LAUNCH_SECRET`, never a query secret;
5. never restore a revoked OAuth token—have the Yandex owner issue a new token.

## Hermes: deliberately deferred

No Hermes automation is created by this rollout. After at least one accepted
deterministic health/Telegram cycle, a separate reviewed task may create a local
Hermes job using only `ops/hermes/abbott_health_prompt_input.py` and sanitized
probe JSON. Before that task, verify timezone `Europe/Vienna`, Mac availability,
allowlist validation, one manual message, and deterministic alert independence.
Hermes must not receive DB/OAuth credentials, raw IDs, URLs/query strings, or
execute remediation. Do not use a permissive/yolo mode.

## Final evidence checklist

- [ ] Protected checkpoint directory exists and is mode `0700`.
- [ ] Predecessor pointer, baseline snapshot ID, candidate ID, code revision,
      parser version, and comparator results are recorded without secrets.
- [ ] Private schema/accounts/roles are least-privilege and env files are mode
      `0600`.
- [ ] Import fingerprints reconcile and public release scans contain no Abbott
      private artifacts.
- [ ] Coverage is complete for five scopes, exact counter `90602537`, the known
      gap, and every completed 2026 date.
- [ ] Comparator and all access/health gates pass; warnings have named approval.
- [ ] Candidate activation used the expected predecessor pointer atomically.
- [ ] Duplicate `06:10` legacy `/metrika` is absent only after cutover.
- [ ] Exactly one `07:10` summary exists.
- [ ] Owner confirmed superseded-token revocation; no value was recorded.
- [ ] Rollback pointer and protected cron checkpoint were retained.
- [ ] Hermes remains absent until its separate approval task.

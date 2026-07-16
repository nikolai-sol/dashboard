# Abbott Canonical/Private Operations Runbook

Status: operator procedure only. No production database, deployment, token,
crontab, or Hermes automation was changed while this runbook was written.

This is the only approved order for moving Abbott counter `90602537` to the
canonical/private release model. Stop at the first failed gate. Commands that
mutate a server are examples for a reviewed maintenance window; do not run
them from an ordinary development session.

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

export CANONICAL_ROOT=/root/reportingdash-canonical
export DASHBOARD_SOURCE_ROOT=/root/reportingdash-rollout/dashboard-next
export DASHBOARD_RUNTIME_ROOT=/var/www/dashboard
export ABBOTT_COUNTER_ID=90602537
export ABBOTT_OWNER_MYSQL_DEFAULTS_FILE=/root/.config/reportingdash/abbott-owner.cnf
export ABBOTT_COLLECTOR_ENV_FILE=/root/reportingdash-canonical/.env
export ABBOTT_IMPORT_ENV_FILE=/root/reportingdash-canonical/.abbott-import.env
export DASHBOARD_OWNER_ENV_FILE=/var/www/www-root/data/.production.env
export METRIKA_TOKEN_FILE=/root/.config/reportingdash/metrika-token
export LEGACY_LAUNCH_SECRET_FILE=/root/.config/reportingdash/legacy-launch-secret
export ABBOTT_PRIVATE_ARCHIVE_DIR=/root/reportingdash-private/abbott/archive
export ABBOTT_PRIVATE_INPUT_DIR=/root/reportingdash-private/abbott/import
export CODE_REVISION=<reviewed-git-revision>
export DASHBOARD_CODE_REVISION=<reviewed-dashboard-git-revision>
export PARSER_VERSION=<reviewed-parser-version>
export BACKFILL_TODAY_UTC=<YYYY-MM-DD>

install -d -m 700 /root/.config/reportingdash
install -d -m 700 "$ABBOTT_PRIVATE_ARCHIVE_DIR" "$ABBOTT_PRIVATE_INPUT_DIR"
test "$(git -C "$DASHBOARD_SOURCE_ROOT" rev-parse HEAD)" = "$DASHBOARD_CODE_REVISION"
test "$(stat -c '%a' /root/.config/reportingdash)" = 700
test "$(stat -c '%a' "$ABBOTT_PRIVATE_ARCHIVE_DIR")" = 700
```

The owner MySQL defaults file is created outside shell history and contains a
standard `[client]` section. It must be non-empty and mode `0600`:

```bash
test -s "$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE"
test "$(stat -c '%a' "$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE")" = 600
```

Do not run `cat`, `env`, `set`, `printenv`, or shell tracing in this procedure.
Use a fresh shell with `set +x` if there is any doubt.

## Database accounts, roles, and environment ownership

Apply least privilege with three separate MySQL accounts. The schema SQL
creates these roles but intentionally does not create accounts or passwords:

| Process | Role | Runtime environment |
| --- | --- | --- |
| Canonical Metrika collector | `reportingdash_abbott_collector_role` | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB=report_bd`, `METRIKA_TOKEN` in `$ABBOTT_COLLECTOR_ENV_FILE` |
| Private snapshot importer | `reportingdash_abbott_importer_role` | `ABBOTT_IMPORT_DB_HOST`, `ABBOTT_IMPORT_DB_PORT`, `ABBOTT_IMPORT_DB_USER`, `ABBOTT_IMPORT_DB_PASSWORD` in `$ABBOTT_IMPORT_ENV_FILE` |
| Server-side Abbott manager read model | `reportingdash_abbott_runtime_reader_role` | `ABBOTT_PRIVATE_DB_HOST`, `ABBOTT_PRIVATE_DB_PORT`, `ABBOTT_PRIVATE_DB_USER`, `ABBOTT_PRIVATE_DB_PASSWORD`, `ABBOTT_PRIVATE_DB_NAME=report_bd_private` in `$DASHBOARD_OWNER_ENV_FILE` |

The general dashboard/embed database account must not receive private-table
grants. Embed output is aggregate-only even when a manager process has the
reader role.

The DBA creates accounts and passwords through a mode-`0600` owner-supplied
SQL file, never as command-line arguments. Its non-secret role assignment
template is:

```sql
GRANT 'reportingdash_abbott_collector_role' TO '<collector-account>'@'<host>';
SET DEFAULT ROLE 'reportingdash_abbott_collector_role' TO '<collector-account>'@'<host>';

GRANT 'reportingdash_abbott_importer_role' TO '<importer-account>'@'<host>';
SET DEFAULT ROLE 'reportingdash_abbott_importer_role' TO '<importer-account>'@'<host>';

GRANT 'reportingdash_abbott_runtime_reader_role' TO '<reader-account>'@'<host>';
SET DEFAULT ROLE 'reportingdash_abbott_runtime_reader_role' TO '<reader-account>'@'<host>';
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
sha256sum \
  "$CANONICAL_ROOT/fetch_yandex_metrika_canonical.py" \
  "$CANONICAL_ROOT/canonical_writer.py" \
  "$CANONICAL_ROOT/canonical_release_store.py" \
  > "$CHECKPOINT_DIR/runtime.sha256"

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
  --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema IN ('report_bd','report_bd_private') AND table_name IN ('portal_data_releases','portal_active_data_releases','portal_dataset_snapshots','portal_migration_validation_runs','canonical_fact_metrika_site_analytics_daily','canonical_fact_metrika_returning_pages_daily','canonical_source_coverage_daily','canonical_fact_metrika_user_behavior_daily','portal_user_directions_private','portal_bitrix_page_facts','portal_bitrix_journeys_private')" \
  > "$CHECKPOINT_DIR/schema-table-count.txt"
```

The count must equal the reviewed expected table set before continuing.

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

Validate access with a counter-filtered, read-only probe approved by the owner.
Redirect all output to a protected log and inspect only status/count fields:

```bash
set -a
. "$ABBOTT_COLLECTOR_ENV_FILE"
set +a
"$CANONICAL_ROOT/venv/bin/python" "$CANONICAL_ROOT/abbott_health_probe.py" \
  --json --counter-id "$ABBOTT_COUNTER_ID" \
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

## Checkpoint 3: freeze the baseline

The baseline covers `2026-01-01` through the last completed UTC day selected
for the reviewed backfill. Private source paths are explicit and outside the
web root. Repeat `--source-file` for every approved input:

```bash
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
mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" report_bd \
  < "$ABBOTT_PREBACKFILL_VARIABLES_SQL_FILE"
mysql --defaults-extra-file="$ABBOTT_OWNER_MYSQL_DEFAULTS_FILE" report_bd \
  < "$CANONICAL_ROOT/ops/sql/abbott_prebackfill_snapshot.sql" \
  > "$CHECKPOINT_DIR/prebackfill-aggregate-evidence.tsv"
chmod 600 "$CHECKPOINT_DIR/prebackfill-aggregate-evidence.tsv"
```

## Checkpoint 4: create the immutable candidate boundary

Create one staging release that points to the frozen baseline and predecessor.
The command prints only the new numeric release ID:

```bash
cd "$CANONICAL_ROOT"
export CANDIDATE_RELEASE_ID="$($CANONICAL_ROOT/venv/bin/python - <<'PY'
import os
from canonical_release_store import create_candidate_release
release_id = create_candidate_release(
    portal_key="abbott",
    predecessor_release_id=int(os.environ["PREDECESSOR_RELEASE_ID"]),
    baseline_validation_run_id=int(os.environ["BASELINE_SNAPSHOT_ID"]),
    code_revision=os.environ["CODE_REVISION"],
)
print(release_id)
PY
)"
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
  --bitrix-pages "$ABBOTT_PRIVATE_INPUT_DIR/bitrix-analytics.json" \
  --bitrix-journeys "$ABBOTT_PRIVATE_INPUT_DIR/bitrix-session-journeys.json" \
  --parser-version "$PARSER_VERSION" \
  --code-revision "$CODE_REVISION" \
  --archive-dir "$ABBOTT_PRIVATE_ARCHIVE_DIR" \
  > "$CHECKPOINT_DIR/private-import.log" 2>&1
unset ABBOTT_IMPORT_DB_HOST ABBOTT_IMPORT_DB_PORT ABBOTT_IMPORT_DB_USER ABBOTT_IMPORT_DB_PASSWORD
chmod 600 "$CHECKPOINT_DIR/private-import.log"
```

The importer must either commit all verified fingerprints and attach snapshot
IDs to this staging release, or roll back and leave the previous active release
unchanged. A repeated checksum is allowed only when it verifies identically.

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
  --execute="SELECT report_date,COUNT(*) AS scopes,SUM(collection_status IN ('success','success_empty') AND pagination_complete=1 AND is_sampled=0 AND (collection_status<>'success_empty' OR empty_reconciled=1)) AS reconciled FROM canonical_source_coverage_daily WHERE canonical_release_id=${CANDIDATE_RELEASE_ID} AND source_key='yandex_metrika' AND counter_id=90602537 AND report_date BETWEEN '2026-01-01' AND '${BASELINE_DATE_TO}' GROUP BY report_date HAVING scopes<>5 OR reconciled<>5" \
  > "$CHECKPOINT_DIR/non-reconciled-days.tsv"
test ! -s "$CHECKPOINT_DIR/non-reconciled-days.tsv"
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

Only after every gate passes, a DBA changes `staging` to `validated` with a
compare-and-set update from a protected SQL file. It must contain the numeric
candidate ID and must fail unless exactly one `abbott` staging row changes.

## Checkpoint 8: atomic activation

Confirm the active pointer still equals `$PREDECESSOR_RELEASE_ID`, then invoke
the release-store transaction:

```bash
cd "$CANONICAL_ROOT"
"$CANONICAL_ROOT/venv/bin/python" - <<'PY'
import os
from canonical_release_store import activate_release
activate_release(
    int(os.environ["CANDIDATE_RELEASE_ID"]),
    expected_active_release_id=int(os.environ["PREDECESSOR_RELEASE_ID"]),
)
PY
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
```

Create the new crontab from the protected checkpoint. The helper removes
exactly one line whose schedule is `06:10` and whose command contains
`/metrika`; it never prints that line. It also removes prior copies of the three
new jobs before appending the reviewed schedule:

```bash
python3 - "$CHECKPOINT_DIR/root.crontab.before" "$CHECKPOINT_DIR/root.crontab.after" <<'PY'
import pathlib, sys
source, target = map(pathlib.Path, sys.argv[1:])
kept = []
removed_legacy = 0
managed = (
    "fetch_yandex_metrika_canonical.py",
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
if removed_legacy != 1:
    raise SystemExit("expected exactly one 06:10 legacy /metrika cron")
kept.extend([
    "12 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python fetch_yandex_metrika_canonical.py --run-type cron --days-back 2 --counter-id 90602537 >> /root/reportingdash-canonical/logs/yandex-metrika-abbott-cron.log 2>&1",
    "5 7 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python abbott_health_probe.py --json --counter-id 90602537 >> /root/reportingdash-canonical/logs/abbott-health-cron.log 2>&1",
    "10 7 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python send_canonical_telegram_report.py --mode summary >> /root/reportingdash-canonical/logs/canonical-telegram-summary.log 2>&1",
])
target.write_text("\n".join(kept) + "\n", encoding="utf-8")
target.chmod(0o600)
PY

crontab "$CHECKPOINT_DIR/root.crontab.after"
crontab -l > "$CHECKPOINT_DIR/root.crontab.installed"
chmod 600 "$CHECKPOINT_DIR/root.crontab.installed"
cmp "$CHECKPOINT_DIR/root.crontab.after" "$CHECKPOINT_DIR/root.crontab.installed"
```

The final Abbott order is canonical collection `06:12`, deterministic health
`07:05`, and Telegram daily summary `07:10`. The `07:10` summary is not an
additional duplicate of the old `06:50` line; the helper replaces any existing
summary entry.

## Checkpoint 10: revoke old Yandex credentials

After the new token has completed an accepted collection, health probe, and
summary cycle, the Yandex account owner revokes every previously exposed or
superseded token in the Yandex OAuth UI. Local code cannot perform or confirm
this owner-session action. Record only the revocation timestamp, owner identity,
OAuth application identifier, and verification status—never a token value.

Do not delete `$METRIKA_TOKEN_FILE`; it is the active owner-provisioned token.
Do not restore a revoked token during rollback.

## Rollback

Rollback is a pointer operation, not a data rewrite. Use the candidate as the
expected current pointer and the frozen predecessor as the target:

```bash
cd "$CANONICAL_ROOT"
"$CANONICAL_ROOT/venv/bin/python" - <<'PY'
import os
from canonical_release_store import rollback_release
rollback_release(
    from_release_id=int(os.environ["CANDIDATE_RELEASE_ID"]),
    to_release_id=int(os.environ["PREDECESSOR_RELEASE_ID"]),
)
PY
```

Then:

1. verify the active pointer and release-specific aggregate/private smoke tests;
2. preserve candidate facts and validation evidence for incident analysis;
3. restore the previous dashboard application release if application rollback
   is needed;
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

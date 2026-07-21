#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

readonly MYSQL_IMAGE="mysql:8.4.10"
readonly SOURCE_DATABASE="abbott_source_dump_20260529"
readonly SOURCE_DUMP_DATABASE="analytics_abbottpro_db"
readonly PRIMARY_DATABASE="report_bd"
readonly PRIVATE_DATABASE="report_bd_private"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

usage() {
  printf '%s\n' "Usage: $0 schema --dump-sql ABSOLUTE_SQL --evidence ABSOLUTE_DIR" >&2
  printf '%s\n' "       $0 import|lifecycle --inputs ABSOLUTE_DIR --evidence ABSOLUTE_DIR" >&2
  exit 2
}

MODE="${1:-}"
case "$MODE" in
  schema) shift ;;
  import|lifecycle)
    printf '%s\n' "Import and lifecycle rehearsals are deferred until the live Bitrix database connector contract is reviewed." >&2
    exit 2
    ;;
  *) usage ;;
esac
DUMP_SOURCE=""
INPUTS=""
EVIDENCE=""
while (( $# )); do
  case "$1" in
    --dump-sql) [[ $# -ge 2 ]] || usage; DUMP_SOURCE="$2"; shift 2 ;;
    --inputs) [[ $# -ge 2 ]] || usage; INPUTS="$2"; shift 2 ;;
    --evidence) [[ $# -ge 2 ]] || usage; EVIDENCE="$2"; shift 2 ;;
    *) usage ;;
  esac
done
if [[ "$MODE" == schema ]]; then
  [[ -n "$DUMP_SOURCE" && -z "$INPUTS" && -n "$EVIDENCE" ]] || usage
  [[ "$DUMP_SOURCE" = /* && "$EVIDENCE" = /* ]] || usage
  [[ -f "$DUMP_SOURCE" ]] || { printf '%s\n' "Required rehearsal dump is unavailable." >&2; exit 2; }
else
  [[ -z "$DUMP_SOURCE" && -n "$INPUTS" && -n "$EVIDENCE" ]] || usage
  [[ "$INPUTS" = /* && "$EVIDENCE" = /* ]] || usage
  [[ -d "$INPUTS" ]] || { printf '%s\n' "Required rehearsal inputs are unavailable." >&2; exit 2; }
fi

reject_unsafe_external_path() {
  local resolved
  local probe
  [[ ! -L "$1" ]] || { printf '%s\n' "Unsafe rehearsal path was rejected." >&2; exit 2; }
  resolved="$(python3 - "$1" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).resolve(strict=False))
PY
)"
  case "$resolved" in
    /var/www|/var/www/*|/private/var/www|/private/var/www/*|/srv/http|/srv/http/*|/private/srv/http|/private/srv/http/*)
      printf '%s\n' "Unsafe rehearsal path was rejected." >&2; exit 2 ;;
  esac
  case "/$resolved/" in
    */public/*|*/.next/*|*/standalone/*|*/static/*|*/build/*|*/dist/*)
      printf '%s\n' "Unsafe rehearsal path was rejected." >&2; exit 2 ;;
  esac
  probe="$resolved"
  [[ -d "$probe" ]] || probe="$(dirname "$probe")"
  if git -C "$probe" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '%s\n' "Unsafe rehearsal path was rejected." >&2
    exit 2
  fi
}
[[ -z "$DUMP_SOURCE" ]] || reject_unsafe_external_path "$DUMP_SOURCE"
[[ -z "$INPUTS" ]] || reject_unsafe_external_path "$INPUTS"
reject_unsafe_external_path "$EVIDENCE"

PRIVATE_BASE_CREATED=0
if [[ -n "${ABBOTT_REHEARSAL_PRIVATE_BASE:-}" ]]; then
  PRIVATE_BASE="$ABBOTT_REHEARSAL_PRIVATE_BASE"
  [[ "$PRIVATE_BASE" = /* && -d "$PRIVATE_BASE" && ! -L "$PRIVATE_BASE" ]] || {
    printf '%s\n' "Protected rehearsal base is invalid." >&2; exit 2;
  }
  reject_unsafe_external_path "$PRIVATE_BASE"
  [[ "$(stat -f '%Lp' "$PRIVATE_BASE")" == 700 && "$(stat -f '%u' "$PRIVATE_BASE")" == "$(id -u)" ]] || {
    printf '%s\n' "Protected rehearsal base permissions are invalid." >&2; exit 2;
  }
else
  PRIVATE_BASE="${TMPDIR:-/tmp}"
  [[ "$PRIVATE_BASE" = /* && -d "$PRIVATE_BASE" && ! -L "$PRIVATE_BASE" ]] || {
    printf '%s\n' "Protected rehearsal base is invalid." >&2; exit 2;
  }
  reject_unsafe_external_path "$PRIVATE_BASE"
  if [[ "$(stat -f '%Lp' "$PRIVATE_BASE")" != 700 || "$(stat -f '%u' "$PRIVATE_BASE")" != "$(id -u)" ]]; then
    PRIVATE_BASE="${PRIVATE_BASE%/}/abbott-rehearsal-private-$(id -u)"
    if [[ ! -e "$PRIVATE_BASE" ]]; then
      install -d -m 700 "$PRIVATE_BASE"
      PRIVATE_BASE_CREATED=1
    fi
    [[ -d "$PRIVATE_BASE" && ! -L "$PRIVATE_BASE" ]] || { printf '%s\n' "Protected rehearsal base is invalid." >&2; exit 2; }
    reject_unsafe_external_path "$PRIVATE_BASE"
    [[ "$(stat -f '%Lp' "$PRIVATE_BASE")" == 700 && "$(stat -f '%u' "$PRIVATE_BASE")" == "$(id -u)" ]] || {
      printf '%s\n' "Protected rehearsal base permissions are invalid." >&2; exit 2;
    }
  fi
fi

INPUT_NAMES=(abbott-workbook.json Abbott-names.xlsx bitrix-analytics.json bitrix-session-journeys.json)
if [[ -n "$INPUTS" ]]; then
  [[ "$(stat -f '%Lp' "$INPUTS")" == 700 ]] || { printf '%s\n' "Rehearsal input directory permissions are invalid." >&2; exit 2; }
  for input_name in "${INPUT_NAMES[@]}"; do
    input_path="$INPUTS/$input_name"
    [[ -f "$input_path" && ! -L "$input_path" ]] || { printf '%s\n' "A required protected rehearsal input is invalid." >&2; exit 2; }
    [[ "$(stat -f '%Lp' "$input_path")" == 600 ]] || { printf '%s\n' "Rehearsal input permissions are invalid." >&2; exit 2; }
  done
fi

assert_clean_tracked_file() {
  local repository=$1
  local relative=$2
  local path="$repository/$relative"
  [[ -f "$path" && ! -L "$path" ]] || { printf '%s\n' "Reviewed DDL authority is invalid." >&2; exit 1; }
  git -C "$repository" ls-files --error-unmatch -- "$relative" >/dev/null 2>&1 || { printf '%s\n' "Reviewed DDL authority is untracked." >&2; exit 1; }
  [[ -z "$(git -C "$repository" status --porcelain=v1 --untracked-files=all -- "$relative")" ]] || { printf '%s\n' "Reviewed DDL authority is not clean." >&2; exit 1; }
  git -C "$repository" show "HEAD:$relative" | cmp - "$path" || { printf '%s\n' "Reviewed DDL authority differs from HEAD." >&2; exit 1; }
}

readonly MIGRATIONS_REPOSITORY="$ROOT_DIR/dashboard-next"
readonly MIGRATIONS_DIRECTORY="src/db/migrations"
readonly PRIVATE_SQL_RELATIVE="ops/sql/abbott_private_schema_and_grants.sql"
readonly IMPORTER_RELATIVE="scripts/import-abbott-private-data.ts"
readonly RUNTIME_DIRECTORY="reportingdash-canonical-bootstrap/runtime"
ROOT_DASHBOARD_REVISION="$(git -C "$ROOT_DIR" rev-parse 'HEAD:dashboard-next')"
DASHBOARD_REVISION="$(git -C "$MIGRATIONS_REPOSITORY" rev-parse HEAD)"
[[ "$ROOT_DASHBOARD_REVISION" == "$DASHBOARD_REVISION" ]] || {
  printf '%s\n' "Reviewed dashboard authority differs from the root gitlink." >&2; exit 1;
}
[[ -z "$(git -C "$MIGRATIONS_REPOSITORY" status --porcelain=v1 --untracked-files=all -- "$MIGRATIONS_DIRECTORY")" ]] || { printf '%s\n' "Reviewed migration authority is not clean." >&2; exit 1; }
MIGRATIONS_THROUGH_033=()
TRACKED_033_FOUND=0
while IFS= read -r authority; do
  [[ "$authority" == *.sql ]] || continue
  assert_clean_tracked_file "$MIGRATIONS_REPOSITORY" "$authority"
  if [[ "$TRACKED_033_FOUND" -eq 0 ]]; then
    MIGRATIONS_THROUGH_033+=("$MIGRATIONS_REPOSITORY/$authority")
    if [[ "$authority" == "$MIGRATIONS_DIRECTORY/033_abbott_canonical_release_control.sql" ]]; then
      TRACKED_033_FOUND=1
    fi
  fi
done < <(git -C "$MIGRATIONS_REPOSITORY" ls-files -- "$MIGRATIONS_DIRECTORY" | LC_ALL=C sort)
[[ "$TRACKED_033_FOUND" -eq 1 ]] || { printf '%s\n' "Tracked migration 033 authority is unavailable." >&2; exit 1; }
assert_clean_tracked_file "$ROOT_DIR" "$PRIVATE_SQL_RELATIVE"
if [[ "$MODE" != schema ]]; then
  assert_clean_tracked_file "$MIGRATIONS_REPOSITORY" "$IMPORTER_RELATIVE"
  for runtime_file in abbott_canonical_controls.py abbott_release_operator.py canonical_release_store.py canonical_writer.py capture_abbott_canonical_baseline.py compare_abbott_canonical_release.py; do
    assert_clean_tracked_file "$MIGRATIONS_REPOSITORY" "$RUNTIME_DIRECTORY/$runtime_file"
  done
fi

install -d -m 700 "$EVIDENCE"
if [[ "$MODE" == schema ]]; then
  EVIDENCE_NAMES=(rehearsal-summary.json schema-signature.sha256 grant-signature.sha256 dump-schema-probe.txt)
elif [[ "$MODE" == import ]]; then
  EVIDENCE_NAMES=(import-summary.json)
else
  EVIDENCE_NAMES=(lifecycle-summary.json)
fi
for evidence_name in "${EVIDENCE_NAMES[@]}"; do
  [[ ! -e "$EVIDENCE/$evidence_name" && ! -L "$EVIDENCE/$evidence_name" ]] || { printf '%s\n' "Existing rehearsal evidence path was rejected." >&2; exit 2; }
done

[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || {
  printf '%s\n' "Ambient Docker authority was rejected." >&2; exit 2;
}
DOCKER_CONTEXT_NAME="$(docker context show)"
DOCKER_ENDPOINT="$(docker context inspect "$DOCKER_CONTEXT_NAME" --format '{{.Endpoints.docker.Host}}')"
case "$DOCKER_ENDPOINT" in
  unix://*) ;;
  *) printf '%s\n' "Non-local Docker authority was rejected." >&2; exit 2 ;;
esac
python3 - "${DOCKER_ENDPOINT#unix://}" <<'PY'
import os
from pathlib import Path
import stat
import sys

path = Path(sys.argv[1])
if path.is_symlink():
    raise SystemExit("Docker socket authority is invalid.")
try:
    metadata = path.stat()
except OSError:
    raise SystemExit("Docker socket authority is invalid.") from None
if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != os.getuid():
    raise SystemExit("Docker socket authority is invalid.")
PY
EVIDENCE_STAGE=""
PRIVATE_ROOT=""
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
CONTAINER_NAME="abbott-mysql-rehearsal-$RUN_ID"
VOLUME_NAME="abbott-mysql-rehearsal-$RUN_ID"
cleanup() {
  local status=$?
  docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker volume rm --force "$VOLUME_NAME" >/dev/null 2>&1 || true
  [[ -z "$EVIDENCE_STAGE" ]] || rm -rf "$EVIDENCE_STAGE"
  if [[ -n "$PRIVATE_ROOT" ]]; then
    if [[ "$status" -eq 0 || "${ABBOTT_REHEARSAL_PRESERVE_ON_FAILURE:-0}" != 1 ]]; then
      rm -rf "$PRIVATE_ROOT"
    else
      printf '%s\n' "Rehearsal failed; protected local diagnostics were preserved." >&2
    fi
  fi
  if [[ "$PRIVATE_BASE_CREATED" -eq 1 ]]; then rmdir "$PRIVATE_BASE" >/dev/null 2>&1 || true; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

PRIVATE_ROOT="$(mktemp -d "$PRIVATE_BASE/abbott-mysql-rehearsal.XXXXXX")"
EVIDENCE_STAGE="$(mktemp -d "$EVIDENCE/.abbott-evidence.XXXXXX")"
chmod 700 "$EVIDENCE_STAGE"

ROOT_PASSWORD="$(openssl rand -hex 32)"
COLLECTOR_PASSWORD="$(openssl rand -hex 32)"
IMPORTER_PASSWORD="$(openssl rand -hex 32)"
OPERATOR_PASSWORD="$(openssl rand -hex 32)"
READER_PASSWORD="$(openssl rand -hex 32)"
printf 'MYSQL_ROOT_PASSWORD=%s\n' "$ROOT_PASSWORD" > "$PRIVATE_ROOT/container.env"
printf '[client]\nuser=root\npassword=%s\n' "$ROOT_PASSWORD" > "$PRIVATE_ROOT/root.cnf"
printf '[client]\nuser=abbott_rehearsal_collector\npassword=%s\n' "$COLLECTOR_PASSWORD" > "$PRIVATE_ROOT/collector.cnf"
printf '[client]\nuser=abbott_rehearsal_importer\npassword=%s\n' "$IMPORTER_PASSWORD" > "$PRIVATE_ROOT/importer.cnf"
printf '[client]\nuser=abbott_rehearsal_operator\npassword=%s\n' "$OPERATOR_PASSWORD" > "$PRIVATE_ROOT/operator.cnf"
printf '[client]\nuser=abbott_rehearsal_reader\npassword=%s\n' "$READER_PASSWORD" > "$PRIVATE_ROOT/reader.cnf"
chmod 600 "$PRIVATE_ROOT/container.env" "$PRIVATE_ROOT"/*.cnf

docker pull "$MYSQL_IMAGE" > "$PRIVATE_ROOT/docker-pull.log" 2>&1
IMAGE_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' "$MYSQL_IMAGE")"
[[ "$IMAGE_DIGEST" == *@sha256:* ]] || { printf '%s\n' "Resolved MySQL image digest is unavailable." >&2; exit 1; }
docker volume create "$VOLUME_NAME" >/dev/null
DOCKER_RUN_ARGS=(--detach --name "$CONTAINER_NAME" --env-file "$PRIVATE_ROOT/container.env"
  --mount "type=volume,source=$VOLUME_NAME,target=/var/lib/mysql")
if [[ "$MODE" == schema ]]; then
  DOCKER_RUN_ARGS+=(--network none)
else
  DOCKER_RUN_ARGS+=(--publish 127.0.0.1::3306)
fi
docker run "${DOCKER_RUN_ARGS[@]}" "$MYSQL_IMAGE" > "$PRIVATE_ROOT/container-id"
docker exec "$CONTAINER_NAME" mkdir -p /run/abbott-rehearsal
docker exec "$CONTAINER_NAME" chmod 700 /run/abbott-rehearsal
for client_config in root collector importer operator reader; do
  docker cp "$PRIVATE_ROOT/$client_config.cnf" "$CONTAINER_NAME:/run/abbott-rehearsal/$client_config.cnf" >/dev/null
  docker exec "$CONTAINER_NAME" chmod 600 "/run/abbott-rehearsal/$client_config.cnf"
done

ready=0
for _attempt in $(seq 1 90); do
  if docker exec "$CONTAINER_NAME" mysqladmin \
      --defaults-extra-file=/run/abbott-rehearsal/root.cnf ping --silent >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" -eq 1 ]] || { printf '%s\n' "Ephemeral MySQL did not become ready." >&2; exit 1; }

mysql_exec() {
  docker exec -i "$CONTAINER_NAME" mysql \
    --defaults-extra-file=/run/abbott-rehearsal/root.cnf \
    --batch --skip-column-names "$@"
}
mysql_exec --execute="CREATE DATABASE $PRIMARY_DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE $PRIVATE_DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE $SOURCE_DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" \
  > "$PRIVATE_ROOT/database-create.log" 2>&1
mysql_exec "$PRIMARY_DATABASE" --execute="
  CREATE TABLE hyb_stats (
    campaign_id VARCHAR(255) NOT NULL,
    creative_id VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    impr BIGINT UNSIGNED DEFAULT NULL,
    clicks BIGINT UNSIGNED DEFAULT NULL,
    views BIGINT UNSIGNED DEFAULT NULL,
    reach BIGINT UNSIGNED DEFAULT NULL,
    frequency DECIMAL(18,6) DEFAULT NULL,
    ctr DECIMAL(18,6) DEFAULT NULL,
    view_25 BIGINT UNSIGNED DEFAULT NULL,
    view_50 BIGINT UNSIGNED DEFAULT NULL,
    view_75 BIGINT UNSIGNED DEFAULT NULL,
    view_100 BIGINT UNSIGNED DEFAULT NULL
  ) ENGINE=InnoDB /*rehearsal:legacy-fixture:hyb_stats*/;
  CREATE TABLE google_ads_negative_keyword_recommendations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    suggested_negative_keyword VARCHAR(255) DEFAULT NULL,
    review_note TEXT DEFAULT NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB /*rehearsal:legacy-fixture:google_ads_negative_keyword_recommendations*/;
  CREATE TABLE yandex_metrika_names (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB /*rehearsal:legacy-fixture:yandex_metrika_names*/;" \
  > "$PRIVATE_ROOT/legacy-fixture.log" 2>&1

MIGRATION_033="$MIGRATIONS_REPOSITORY/$MIGRATIONS_DIRECTORY/033_abbott_canonical_release_control.sql"
PRIVATE_SQL="$ROOT_DIR/$PRIVATE_SQL_RELATIVE"
[[ -f "$MIGRATION_033" && -f "$PRIVATE_SQL" ]] || { printf '%s\n' "Reviewed Abbott DDL is unavailable." >&2; exit 1; }
migration_count=0
found_033=0
for migration in "${MIGRATIONS_THROUGH_033[@]}"; do
  mysql_exec "$PRIMARY_DATABASE" < "$migration" >> "$PRIVATE_ROOT/migrations-fresh.log" 2>&1
  migration_count=$((migration_count + 1))
  if [[ "$(basename "$migration")" == "033_abbott_canonical_release_control.sql" ]]; then
    found_033=1
  fi
done
[[ "$found_033" -eq 1 ]] || { printf '%s\n' "Migration 033 was not reached in lexical order." >&2; exit 1; }
mysql_exec "$PRIMARY_DATABASE" < "$PRIVATE_SQL" > "$PRIVATE_ROOT/private-fresh.log" 2>&1

cat > "$PRIVATE_ROOT/accounts.sql" <<SQL
CREATE USER 'abbott_rehearsal_collector'@'%' IDENTIFIED BY '$COLLECTOR_PASSWORD';
CREATE USER 'abbott_rehearsal_importer'@'%' IDENTIFIED BY '$IMPORTER_PASSWORD';
CREATE USER 'abbott_rehearsal_operator'@'%' IDENTIFIED BY '$OPERATOR_PASSWORD';
CREATE USER 'abbott_rehearsal_reader'@'%' IDENTIFIED BY '$READER_PASSWORD';
GRANT 'abbott_collector_role' TO 'abbott_rehearsal_collector'@'%';
SET DEFAULT ROLE 'abbott_collector_role' TO 'abbott_rehearsal_collector'@'%';
GRANT 'abbott_importer_role' TO 'abbott_rehearsal_importer'@'%';
SET DEFAULT ROLE 'abbott_importer_role' TO 'abbott_rehearsal_importer'@'%';
GRANT 'abbott_release_operator_role' TO 'abbott_rehearsal_operator'@'%';
SET DEFAULT ROLE 'abbott_release_operator_role' TO 'abbott_rehearsal_operator'@'%';
GRANT 'abbott_runtime_reader_role' TO 'abbott_rehearsal_reader'@'%';
SET DEFAULT ROLE 'abbott_runtime_reader_role' TO 'abbott_rehearsal_reader'@'%';
SQL
chmod 600 "$PRIVATE_ROOT/accounts.sql"
mysql_exec < "$PRIVATE_ROOT/accounts.sql" > "$PRIVATE_ROOT/accounts.log" 2>&1

role_mysql() {
  local role=$1
  shift
  docker exec -i "$CONTAINER_NAME" mysql \
    "--defaults-extra-file=/run/abbott-rehearsal/$role.cnf" \
    --batch --skip-column-names "$@"
}
probe_role() {
  local role=$1
  local allow_query=$2
  local deny_query=$3
  if ! role_mysql "$role" --execute="$allow_query" > "$PRIVATE_ROOT/role-$role-allow.log" 2>&1; then
    printf '%s\n' "Expected rehearsal role permission was denied." >&2; exit 1
  fi
  if role_mysql "$role" --execute="$deny_query" > "$PRIVATE_ROOT/role-$role-deny.log" 2>&1; then
    printf '%s\n' "Forbidden rehearsal role permission was accepted." >&2; exit 1
  fi
  if ! grep -Eq 'ERROR (1142|1143)[ (]' "$PRIVATE_ROOT/role-$role-deny.log"; then
    printf '%s\n' "Rehearsal role denial returned an unexpected error class." >&2; exit 1
  fi
}
if [[ "$MODE" != schema ]]; then
  probe_role collector \
    'SELECT COUNT(*) FROM report_bd.portal_data_releases /*rehearsal:allow:collector*/' \
    'SELECT COUNT(*) FROM report_bd_private.portal_bitrix_page_facts /*rehearsal:deny:collector*/'
  probe_role importer \
    'SELECT COUNT(*) FROM report_bd.portal_data_releases /*rehearsal:allow:importer*/' \
    'UPDATE report_bd.portal_active_data_releases SET switched_by=switched_by WHERE 1=0 /*rehearsal:deny:importer*/'
  probe_role operator \
    'SELECT COUNT(*) FROM report_bd.portal_data_releases /*rehearsal:allow:operator*/' \
    'DELETE FROM report_bd.portal_content_catalog WHERE 1=0 /*rehearsal:deny:operator*/'
  probe_role reader \
    'SELECT COUNT(*) FROM report_bd.portal_data_releases /*rehearsal:allow:runtime_reader*/' \
    'UPDATE report_bd.portal_data_releases SET release_status=release_status WHERE 1=0 /*rehearsal:deny:runtime_reader*/'
fi

capture_schema_signature() {
  local output=$1
  mysql_exec --execute="SELECT 'COLUMN',TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('$PRIMARY_DATABASE','$PRIVATE_DATABASE') UNION ALL SELECT 'INDEX',TABLE_SCHEMA,TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,NON_UNIQUE,COALESCE(SUB_PART,'<NULL>'),INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA IN ('$PRIMARY_DATABASE','$PRIVATE_DATABASE') ORDER BY 1,2,3,4,5,6;" > "$output"
}
capture_grant_signature() {
  local output=$1
  mysql_exec --execute="SELECT 'TABLE',GRANTEE,TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE LIKE CONCAT(CHAR(39),'abbott_%_role') UNION ALL SELECT 'SCHEMA',GRANTEE,TABLE_SCHEMA,'',PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE LIKE CONCAT(CHAR(39),'abbott_%_role') UNION ALL SELECT 'COLUMN',GRANTEE,TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,COLUMN_NAME FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE LIKE CONCAT(CHAR(39),'abbott_%_role') UNION ALL SELECT 'ROLE',CONCAT(FROM_USER,'@',FROM_HOST),'mysql',CONCAT(TO_USER,'@',TO_HOST),'GRANT','NO' FROM mysql.role_edges WHERE FROM_USER LIKE 'abbott_%_role' OR TO_USER LIKE 'abbott_rehearsal_%' UNION ALL SELECT 'DEFAULT',CONCAT(USER,'@',HOST),'mysql',CONCAT(DEFAULT_ROLE_USER,'@',DEFAULT_ROLE_HOST),'ROLE','NO' FROM mysql.default_roles WHERE USER LIKE 'abbott_rehearsal_%' ORDER BY 1,2,3,4,5,6;" > "$output"
}
signature() { shasum -a 256 "$1" | awk '{print $1}'; }
capture_schema_signature "$PRIVATE_ROOT/schema.before.tsv"
capture_grant_signature "$PRIVATE_ROOT/grants.before.tsv"
SCHEMA_SIGNATURE="$(signature "$PRIVATE_ROOT/schema.before.tsv")"
GRANT_SIGNATURE="$(signature "$PRIVATE_ROOT/grants.before.tsv")"

mysql_exec "$PRIMARY_DATABASE" --execute="
  SELECT 'correct-named' /*rehearsal:direction-index:correct-named*/;" \
  > "$PRIVATE_ROOT/direction-index-correct.log" 2>&1
mysql_exec "$PRIMARY_DATABASE" < "$MIGRATION_033" > "$PRIVATE_ROOT/migration-033-repeat.log" 2>&1
mysql_exec "$PRIMARY_DATABASE" < "$PRIVATE_SQL" > "$PRIVATE_ROOT/private-repeat.log" 2>&1
capture_schema_signature "$PRIVATE_ROOT/schema.after.tsv"
capture_grant_signature "$PRIVATE_ROOT/grants.after.tsv"
[[ "$SCHEMA_SIGNATURE" == "$(signature "$PRIVATE_ROOT/schema.after.tsv")" ]] || { printf '%s\n' "Repeated Abbott DDL changed the schema signature." >&2; exit 1; }
[[ "$GRANT_SIGNATURE" == "$(signature "$PRIVATE_ROOT/grants.after.tsv")" ]] || { printf '%s\n' "Repeated Abbott DDL changed the grant signature." >&2; exit 1; }

mysql_exec "$PRIMARY_DATABASE" --execute="
  ALTER TABLE report_bd_private.portal_user_directions_private
    DROP INDEX uniq_private_direction_snapshot_user,
    ADD UNIQUE INDEX uniq_private_direction_snapshot_user
      (source_snapshot_id, raw_user_id_hash)
  /*rehearsal:direction-index:wrong-named*/;" \
  > "$PRIVATE_ROOT/direction-index-wrong.log" 2>&1
mysql_exec "$PRIMARY_DATABASE" < "$PRIVATE_SQL" > "$PRIVATE_ROOT/private-upgrade-wrong-index.log" 2>&1
capture_schema_signature "$PRIVATE_ROOT/schema.after-wrong-upgrade.tsv"
[[ "$SCHEMA_SIGNATURE" == "$(signature "$PRIVATE_ROOT/schema.after-wrong-upgrade.tsv")" ]] || { printf '%s\n' "Wrong private direction index was not upgraded." >&2; exit 1; }

mysql_exec "$PRIMARY_DATABASE" --execute="
  ALTER TABLE report_bd_private.portal_user_directions_private
    RENAME INDEX uniq_private_direction_snapshot_user
    TO equivalent_private_direction_release_snapshot_user
  /*rehearsal:direction-index:equivalent-named*/;" \
  > "$PRIVATE_ROOT/direction-index-equivalent.log" 2>&1
mysql_exec "$PRIMARY_DATABASE" < "$PRIVATE_SQL" > "$PRIVATE_ROOT/private-upgrade-equivalent-index.log" 2>&1
capture_schema_signature "$PRIVATE_ROOT/schema.after-equivalent-upgrade.tsv"
[[ "$SCHEMA_SIGNATURE" == "$(signature "$PRIVATE_ROOT/schema.after-equivalent-upgrade.tsv")" ]] || { printf '%s\n' "Equivalent private direction index was not canonicalized." >&2; exit 1; }

if [[ "$MODE" == schema ]]; then
  FILTERED_DUMP="$PRIVATE_ROOT/source-schema.sql"
  python3 "$SCRIPT_DIR/abbott_dump_schema_filter.py" \
    --source-database "$SOURCE_DUMP_DATABASE" < "$DUMP_SOURCE" > "$FILTERED_DUMP"
  chmod 600 "$FILTERED_DUMP"
  DUMP_ERROR_CLASS="none"
  if ! mysql_exec "$SOURCE_DATABASE" < "$FILTERED_DUMP" > "$PRIVATE_ROOT/dump-load.log" 2> "$PRIVATE_ROOT/dump-load.err"; then
    if grep -Eqi 'syntax|parse' "$PRIVATE_ROOT/dump-load.err"; then DUMP_ERROR_CLASS="syntax_error"
    elif grep -Eqi 'collation|character set' "$PRIVATE_ROOT/dump-load.err"; then DUMP_ERROR_CLASS="charset_or_collation"
    elif grep -Eqi 'foreign key|constraint' "$PRIVATE_ROOT/dump-load.err"; then DUMP_ERROR_CLASS="constraint_error"
    elif grep -Eqi 'unknown|unsupported|not supported' "$PRIVATE_ROOT/dump-load.err"; then DUMP_ERROR_CLASS="unsupported_feature"
    else DUMP_ERROR_CLASS="other_sql_error"
    fi
  fi
  DUMP_TABLE_COUNT="$(mysql_exec --execute="SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$SOURCE_DATABASE' AND TABLE_TYPE='BASE TABLE';")"
  MYSQL_VERSION="$(mysql_exec --execute='SELECT VERSION();')"

  printf '%s  schema-and-index-signature\n' "$SCHEMA_SIGNATURE" > "$EVIDENCE_STAGE/schema-signature.sha256"
  printf '%s  grant-signature\n' "$GRANT_SIGNATURE" > "$EVIDENCE_STAGE/grant-signature.sha256"
  printf 'schema_only=true\ntable_count=%s\nsql_error_class=%s\n' "$DUMP_TABLE_COUNT" "$DUMP_ERROR_CLASS" > "$EVIDENCE_STAGE/dump-schema-probe.txt"
  python3 - "$EVIDENCE_STAGE/rehearsal-summary.json" "$MODE" "$IMAGE_DIGEST" "$MYSQL_VERSION" "$migration_count" "$SCHEMA_SIGNATURE" "$GRANT_SIGNATURE" "$DUMP_TABLE_COUNT" "$DUMP_ERROR_CLASS" <<'PY'
import json
import pathlib
import sys

target = pathlib.Path(sys.argv[1])
summary = {
    "mode": sys.argv[2],
    "image_digest": sys.argv[3],
    "mysql_version": sys.argv[4],
    "fresh_migration_count": int(sys.argv[5]),
    "schema_signature_sha256": sys.argv[6],
    "grant_signature_sha256": sys.argv[7],
    "repeat_safe": True,
    "dump_schema_probe": {
        "schema_only": True,
        "table_count": int(sys.argv[8]),
        "sql_error_class": sys.argv[9],
    },
}
target.write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n", encoding="utf-8")
PY
  chmod 600 "$EVIDENCE_STAGE/rehearsal-summary.json" "$EVIDENCE_STAGE/schema-signature.sha256" \
    "$EVIDENCE_STAGE/grant-signature.sha256" "$EVIDENCE_STAGE/dump-schema-probe.txt"
  for evidence_name in "${EVIDENCE_NAMES[@]}"; do
    [[ ! -e "$EVIDENCE/$evidence_name" && ! -L "$EVIDENCE/$evidence_name" ]] || { printf '%s\n' "Existing rehearsal evidence path was rejected." >&2; exit 2; }
    mv "$EVIDENCE_STAGE/$evidence_name" "$EVIDENCE/$evidence_name"
  done
  [[ "$DUMP_ERROR_CLASS" == none ]] || exit 1
  printf '%s\n' "Abbott MySQL rehearsal completed; sanitized evidence was written."
  exit 0
fi

HOST_PORT="$(docker port "$CONTAINER_NAME" 3306/tcp | awk -F: 'NR == 1 {print $NF}')"
[[ "$HOST_PORT" =~ ^[0-9]+$ ]] || { printf '%s\n' "Ephemeral MySQL loopback port is unavailable." >&2; exit 1; }
printf 'ABBOTT_IMPORT_DB_HOST=127.0.0.1\nABBOTT_IMPORT_DB_PORT=%s\nABBOTT_IMPORT_DB_USER=abbott_rehearsal_importer\nABBOTT_IMPORT_DB_PASSWORD=%s\n' \
  "$HOST_PORT" "$IMPORTER_PASSWORD" > "$PRIVATE_ROOT/import.env"
printf 'ABBOTT_RELEASE_DB_HOST=127.0.0.1\nABBOTT_RELEASE_DB_PORT=%s\nABBOTT_RELEASE_DB_USER=abbott_rehearsal_operator\nABBOTT_RELEASE_DB_PASSWORD=%s\nABBOTT_RELEASE_DB_NAME=report_bd\n' \
  "$HOST_PORT" "$OPERATOR_PASSWORD" > "$PRIVATE_ROOT/release.env"
chmod 600 "$PRIVATE_ROOT/import.env" "$PRIVATE_ROOT/release.env"
install -d -m 700 "$PRIVATE_ROOT/source-archive" "$PRIVATE_ROOT/baseline-archive"

readonly FIXTURE_DATE="2026-07-16"
readonly PARSER_VERSION="task4-local-v1"
CODE_REVISION="$(git -C "$ROOT_DIR" rev-parse HEAD)"
RUNTIME_ROOT="$MIGRATIONS_REPOSITORY/$RUNTIME_DIRECTORY"

run_release_python() {
  (
    set -a
    . "$PRIVATE_ROOT/release.env"
    set +a
    cd "$RUNTIME_ROOT"
    python3 "$@"
  )
}

expect_release_failure() {
  local expected_message=$1
  local protected_log=$2
  shift 2
  if "$@" > "$protected_log" 2>&1; then
    printf '%s\n' "Expected local release gate unexpectedly succeeded." >&2
    exit 1
  fi
  if ! grep -Fq -- "$expected_message" "$protected_log"; then
    printf '%s\n' "Local release gate returned an unexpected failure class." >&2
    exit 1
  fi
}

seed_release_aggregates() {
  local release_id=$1
  mysql_exec "$PRIMARY_DATABASE" --execute="
    INSERT INTO canonical_fact_metrika_site_analytics_daily
      (canonical_release_id,source_key,analytics_account_id,counter_id,report_date,analytics_scope,scope_hash,scope_dimensions,sessions,users,pageviews,ingestion_run_id)
    VALUES
      ($release_id,'yandex_metrika','abbott_rehearsal',90602537,'$FIXTURE_DATE','other',REPEAT('1',64),JSON_OBJECT(),0,0,0,1),
      ($release_id,'yandex_metrika','abbott_rehearsal',90602537,'$FIXTURE_DATE','traffic',REPEAT('2',64),JSON_OBJECT(),0,0,0,1),
      ($release_id,'yandex_metrika','abbott_rehearsal',90602537,'$FIXTURE_DATE','page',REPEAT('3',64),JSON_OBJECT(),0,0,0,1);
    INSERT INTO canonical_source_coverage_daily
      (canonical_release_id,source_key,counter_id,scope_key,report_date,request_fingerprint,collection_status,api_total_rows,persisted_rows,pagination_complete,is_sampled,empty_reconciled,collector_run_id)
    VALUES
      ($release_id,'yandex_metrika',90602537,'other','$FIXTURE_DATE',REPEAT('4',64),'success_empty',0,0,1,0,1,1),
      ($release_id,'yandex_metrika',90602537,'traffic','$FIXTURE_DATE',REPEAT('5',64),'success_empty',0,0,1,0,1,1),
      ($release_id,'yandex_metrika',90602537,'page','$FIXTURE_DATE',REPEAT('6',64),'success_empty',0,0,1,0,1,1),
      ($release_id,'yandex_metrika',90602537,'user_behavior','$FIXTURE_DATE',REPEAT('7',64),'success_empty',0,0,1,0,1,1),
      ($release_id,'yandex_metrika',90602537,'returning','$FIXTURE_DATE',REPEAT('8',64),'success_empty',0,0,1,0,1,1);" \
    > "$PRIVATE_ROOT/aggregate-fixture.log" 2>&1
}

PREDECESSOR_RELEASE_ID="$(mysql_exec "$PRIMARY_DATABASE" --execute="
  INSERT INTO portal_data_releases
    (dataset_key,release_key,source_snapshot_ids,canonical_version_id,code_revision,release_status,activated_at,activated_by)
  VALUES ('abbott',CONCAT('local-predecessor-',UUID()),JSON_ARRAY(),'local-predecessor','$CODE_REVISION','active',UTC_TIMESTAMP(),'local-rehearsal');
  SET @predecessor_release_id=LAST_INSERT_ID();
  INSERT INTO portal_active_data_releases
    (dataset_key,canonical_release_id,previous_release_id,switched_at,switched_by,switch_reason)
  VALUES ('abbott',@predecessor_release_id,NULL,UTC_TIMESTAMP(),'local-rehearsal','local predecessor fixture');
  SELECT @predecessor_release_id /*rehearsal:predecessor*/;")"
[[ "$PREDECESSOR_RELEASE_ID" =~ ^[0-9]+$ ]] || { printf '%s\n' "Local predecessor creation failed." >&2; exit 1; }
seed_release_aggregates "$PREDECESSOR_RELEASE_ID"

BASELINE_RESULT="$(run_release_python capture_abbott_canonical_baseline.py \
  --date-from "$FIXTURE_DATE" --date-to "$FIXTURE_DATE" \
  --private-archive-dir "$PRIVATE_ROOT/baseline-archive" --code-revision "$CODE_REVISION" \
  --source-file "abbott_workbook_json:$PARSER_VERSION:$INPUTS/abbott-workbook.json" \
  --source-file "abbott_workbook_catalog:$PARSER_VERSION:$INPUTS/Abbott-names.xlsx" \
  --source-file "abbott_bitrix_pages:$PARSER_VERSION:$INPUTS/bitrix-analytics.json" \
  --source-file "abbott_bitrix_journeys:$PARSER_VERSION:$INPUTS/bitrix-session-journeys.json")"
BASELINE_SNAPSHOT_ID="${BASELINE_RESULT##* }"
[[ "$BASELINE_SNAPSHOT_ID" =~ ^[0-9]+$ ]] || { printf '%s\n' "Local baseline capture failed." >&2; exit 1; }

CANDIDATE_RESULT="$(run_release_python abbott_release_operator.py create \
  --predecessor-release-id "$PREDECESSOR_RELEASE_ID" \
  --baseline-snapshot-id "$BASELINE_SNAPSHOT_ID" --code-revision "$CODE_REVISION")"
CANDIDATE_RELEASE_ID="${CANDIDATE_RESULT#release_id=}"
CANDIDATE_RELEASE_ID="${CANDIDATE_RELEASE_ID%% *}"
[[ "$CANDIDATE_RELEASE_ID" =~ ^[0-9]+$ ]] || { printf '%s\n' "Local candidate creation failed." >&2; exit 1; }

INCOMPLETE_REJECTED=false
if [[ "$MODE" == lifecycle ]]; then
  expect_release_failure 'Canonical release source snapshots are invalid' "$PRIVATE_ROOT/incomplete-validation.log" \
    run_release_python abbott_release_operator.py validate --release-id "$CANDIDATE_RELEASE_ID" \
      --date-from "$FIXTURE_DATE" --date-to "$FIXTURE_DATE" --code-revision "$CODE_REVISION"
  INCOMPLETE_REJECTED=true
fi

run_private_import() {
  local release_id=$1
  local protected_log=$2
  (
  set -a
  . "$PRIVATE_ROOT/import.env"
  set +a
  cd "$MIGRATIONS_REPOSITORY"
  node --import tsx scripts/import-abbott-private-data.ts \
    --canonical-release-id "$release_id" \
    --workbook-json "$INPUTS/abbott-workbook.json" \
    --workbook-xlsx "$INPUTS/Abbott-names.xlsx" \
    --bitrix-pages "$INPUTS/bitrix-analytics.json" \
    --bitrix-journeys "$INPUTS/bitrix-session-journeys.json" \
    --parser-version "$PARSER_VERSION" --code-revision "$CODE_REVISION" \
    --archive-dir "$PRIVATE_ROOT/source-archive"
  ) > "$protected_log" 2>&1
}

run_private_import "$CANDIDATE_RELEASE_ID" "$PRIVATE_ROOT/import.log"

IMPORT_AGGREGATES="$(mysql_exec "$PRIMARY_DATABASE" --execute="
  SELECT COUNT(DISTINCT imports.source_kind),
         COALESCE(MAX(CASE WHEN imports.source_kind='abbott_workbook_catalog' THEN imports.imported_row_count END),0),
         COALESCE(SUM(imports.rejected_row_count),0),COUNT(*)
  FROM portal_release_source_imports AS imports
  WHERE imports.canonical_release_id=$CANDIDATE_RELEASE_ID
  /*rehearsal:import-summary*/;")"
IFS=$'\t' read -r SOURCE_KIND_COUNT CATALOG_COUNT REJECTED_COUNT PROVENANCE_COUNT <<< "$IMPORT_AGGREGATES"
[[ "$SOURCE_KIND_COUNT" == 4 && "$CATALOG_COUNT" == 1769 && "$REJECTED_COUNT" == 0 && "$PROVENANCE_COUNT" == 4 ]] || {
  printf '%s\n' "Local four-source import acceptance failed." >&2; exit 1;
}
mysql_exec "$PRIMARY_DATABASE" --execute="
  SELECT source_kind,imported_row_count,rejected_row_count
  FROM portal_release_source_imports WHERE canonical_release_id=$CANDIDATE_RELEASE_ID ORDER BY source_kind
  /*rehearsal:source-counts*/;" > "$PRIVATE_ROOT/source-counts.tsv"

SUCCESSOR_RESULT="$(run_release_python abbott_release_operator.py create \
  --predecessor-release-id "$PREDECESSOR_RELEASE_ID" \
  --baseline-snapshot-id "$BASELINE_SNAPSHOT_ID" --code-revision "$CODE_REVISION")"
SUCCESSOR_RELEASE_ID="${SUCCESSOR_RESULT#release_id=}"
SUCCESSOR_RELEASE_ID="${SUCCESSOR_RELEASE_ID%% *}"
[[ "$SUCCESSOR_RELEASE_ID" =~ ^[0-9]+$ ]] || { printf '%s\n' "Local successor creation failed." >&2; exit 1; }
run_private_import "$SUCCESSOR_RELEASE_ID" "$PRIVATE_ROOT/successor-import.log"

SUCCESSOR_REUSE="$(mysql_exec "$PRIMARY_DATABASE" --execute="
  SELECT COUNT(*),
         SUM(candidate.source_snapshot_id = successor.source_snapshot_id),
         (SELECT COUNT(*) FROM report_bd_private.portal_user_directions_private
           WHERE canonical_release_id=$CANDIDATE_RELEASE_ID),
         (SELECT COUNT(*) FROM report_bd_private.portal_user_directions_private
           WHERE canonical_release_id=$SUCCESSOR_RELEASE_ID)
  FROM portal_release_source_imports AS candidate
  JOIN portal_release_source_imports AS successor
    ON successor.canonical_release_id=$SUCCESSOR_RELEASE_ID
   AND successor.source_kind=candidate.source_kind
  WHERE candidate.canonical_release_id=$CANDIDATE_RELEASE_ID
  /*rehearsal:successor-snapshot-reuse*/;")"
IFS=$'\t' read -r SUCCESSOR_SOURCE_COUNT SUCCESSOR_REUSED_COUNT CANDIDATE_DIRECTION_COUNT SUCCESSOR_DIRECTION_COUNT <<< "$SUCCESSOR_REUSE"
[[ "$SUCCESSOR_SOURCE_COUNT" == 4 && "$SUCCESSOR_REUSED_COUNT" == 4 \
   && "$CANDIDATE_DIRECTION_COUNT" -gt 0 \
   && "$SUCCESSOR_DIRECTION_COUNT" == "$CANDIDATE_DIRECTION_COUNT" ]] || {
  printf '%s\n' "Successor immutable snapshot reuse failed." >&2; exit 1;
}

if [[ "$MODE" == import ]]; then
  MYSQL_VERSION="$(mysql_exec --execute='SELECT VERSION();')"
  python3 - "$EVIDENCE_STAGE/import-summary.json" "$IMAGE_DIGEST" "$MYSQL_VERSION" \
    "$SCHEMA_SIGNATURE" "$GRANT_SIGNATURE" "$SOURCE_KIND_COUNT" "$CATALOG_COUNT" "$REJECTED_COUNT" "$PROVENANCE_COUNT" \
    "$PRIVATE_ROOT/source-counts.tsv" "$INPUTS" <<'PY'
import hashlib, json, pathlib, sys
target, image, version, schema, grants = sys.argv[1:6]
source_counts = {}
for line in pathlib.Path(sys.argv[10]).read_text(encoding="utf-8").splitlines():
    fields = line.split("\t")
    if len(fields) == 3:
        source_counts[fields[0]] = {"imported": int(fields[1]), "rejected": int(fields[2])}
inputs = pathlib.Path(sys.argv[11])
names = {
    "abbott_workbook_json": "abbott-workbook.json", "abbott_workbook_catalog": "Abbott-names.xlsx",
    "abbott_bitrix_pages": "bitrix-analytics.json", "abbott_bitrix_journeys": "bitrix-session-journeys.json",
}
summary = {
    "mode": "import", "image_digest": image, "mysql_version": version,
    "schema_signature_sha256": schema, "grant_signature_sha256": grants,
    "source_kind_count": int(sys.argv[6]), "catalog_count": int(sys.argv[7]),
    "rejected_count": int(sys.argv[8]), "provenance_count": int(sys.argv[9]),
    "source_imported_counts": source_counts,
    "source_sha256": {kind: hashlib.sha256((inputs / name).read_bytes()).hexdigest() for kind, name in names.items()},
    "role_grant_probes": {"collector": True, "importer": True, "operator": True, "runtime_reader": True},
    "cleanup_default": True,
}
pathlib.Path(target).write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n", encoding="utf-8")
PY
  chmod 600 "$EVIDENCE_STAGE/import-summary.json"
  mv "$EVIDENCE_STAGE/import-summary.json" "$EVIDENCE/import-summary.json"
  printf '%s\n' "Abbott import rehearsal completed; sanitized evidence was written."
  exit 0
fi

seed_release_aggregates "$CANDIDATE_RELEASE_ID"
run_release_python compare_abbott_canonical_release.py --baseline-run-id "$BASELINE_SNAPSHOT_ID" \
  --candidate-release-id "$CANDIDATE_RELEASE_ID" > "$PRIVATE_ROOT/comparison.log" 2>&1
mysql_exec "$PRIMARY_DATABASE" --execute="
  SET @latest_validation=(SELECT validation_run_id FROM portal_migration_validation_runs
    WHERE canonical_release_id=$CANDIDATE_RELEASE_ID AND baseline_snapshot_id=$BASELINE_SNAPSHOT_ID
    ORDER BY id DESC LIMIT 1);
  UPDATE portal_migration_validation_runs SET result_status='warn',diagnostic_json=JSON_OBJECT('reason_code','local_ambiguity_review'),reviewed_by=NULL,accepted_at=NULL
    WHERE canonical_release_id=$CANDIDATE_RELEASE_ID AND baseline_snapshot_id=$BASELINE_SNAPSHOT_ID
      AND validation_run_id=@latest_validation AND control_name='site.other.fact_rows';" \
  > "$PRIVATE_ROOT/warning-fixture.log" 2>&1
UNREVIEWED_REJECTED=false
expect_release_failure 'Canonical validation evidence did not pass review' "$PRIVATE_ROOT/unreviewed-validation.log" \
  run_release_python abbott_release_operator.py validate --release-id "$CANDIDATE_RELEASE_ID" \
    --date-from "$FIXTURE_DATE" --date-to "$FIXTURE_DATE" --code-revision "$CODE_REVISION"
UNREVIEWED_REJECTED=true
mysql_exec "$PRIMARY_DATABASE" --execute="
  UPDATE portal_migration_validation_runs SET reviewed_by='local-rehearsal-reviewer',accepted_at=UTC_TIMESTAMP()
  WHERE canonical_release_id=$CANDIDATE_RELEASE_ID AND baseline_snapshot_id=$BASELINE_SNAPSHOT_ID
    AND result_status='warn' AND reviewed_by IS NULL;" > "$PRIVATE_ROOT/reviewer-acceptance.log" 2>&1
run_release_python abbott_release_operator.py validate --release-id "$CANDIDATE_RELEASE_ID" \
  --date-from "$FIXTURE_DATE" --date-to "$FIXTURE_DATE" --code-revision "$CODE_REVISION" \
  > "$PRIVATE_ROOT/validation.log" 2>&1
run_release_python abbott_release_operator.py activate --release-id "$CANDIDATE_RELEASE_ID" \
  --expected-active-release-id "$PREDECESSOR_RELEASE_ID" > "$PRIVATE_ROOT/activation.log" 2>&1
STALE_CAS_REJECTED=false
expect_release_failure 'Active canonical release pointer changed' "$PRIVATE_ROOT/stale-cas.log" \
  run_release_python abbott_release_operator.py activate --release-id "$CANDIDATE_RELEASE_ID" \
    --expected-active-release-id "$PREDECESSOR_RELEASE_ID"
STALE_CAS_REJECTED=true
run_release_python abbott_release_operator.py rollback --from-release-id "$CANDIDATE_RELEASE_ID" \
  --to-release-id "$PREDECESSOR_RELEASE_ID" > "$PRIVATE_ROOT/rollback.log" 2>&1

LIFECYCLE_STATE="$(mysql_exec "$PRIMARY_DATABASE" --execute="
  SELECT active.canonical_release_id,predecessor.release_status,candidate.id,candidate.release_status
  FROM portal_active_data_releases AS active
  JOIN portal_data_releases AS predecessor ON predecessor.id=$PREDECESSOR_RELEASE_ID
  JOIN portal_data_releases AS candidate ON candidate.id=$CANDIDATE_RELEASE_ID
  WHERE active.dataset_key='abbott' /*rehearsal:lifecycle-summary*/;")"
IFS=$'\t' read -r ACTIVE_RELEASE_ID PREDECESSOR_STATUS FINAL_CANDIDATE_ID CANDIDATE_STATUS <<< "$LIFECYCLE_STATE"
[[ "$ACTIVE_RELEASE_ID" == "$PREDECESSOR_RELEASE_ID" && "$PREDECESSOR_STATUS" == active && "$FINAL_CANDIDATE_ID" == "$CANDIDATE_RELEASE_ID" && "$CANDIDATE_STATUS" == retired ]] || {
  printf '%s\n' "Local rollback did not restore the predecessor." >&2; exit 1;
}
AMBIGUITY_AGGREGATES="$(mysql_exec "$PRIMARY_DATABASE" --execute="
  SELECT COUNT(*),SUM(resolution_status='unique'),SUM(resolution_status='identical_collapsed'),SUM(resolution_status='ambiguous')
  FROM portal_content_lookup_projection WHERE canonical_release_id=$CANDIDATE_RELEASE_ID
  /*rehearsal:ambiguity-summary*/;")"
MYSQL_VERSION="$(mysql_exec --execute='SELECT VERSION();')"
python3 - "$EVIDENCE_STAGE/lifecycle-summary.json" "$IMAGE_DIGEST" "$MYSQL_VERSION" "$SCHEMA_SIGNATURE" "$GRANT_SIGNATURE" \
  "$INCOMPLETE_REJECTED" "$UNREVIEWED_REJECTED" "$STALE_CAS_REJECTED" "$AMBIGUITY_AGGREGATES" <<'PY'
import json, pathlib, sys
ambiguity = [int(value) for value in sys.argv[9].split("\t")]
summary = {
    "mode": "lifecycle", "image_digest": sys.argv[2], "mysql_version": sys.argv[3],
    "schema_signature_sha256": sys.argv[4], "grant_signature_sha256": sys.argv[5],
    "incomplete_candidate_rejected": sys.argv[6] == "true",
    "unreviewed_warning_rejected": sys.argv[7] == "true",
    "warning_reviewed_by": "local-rehearsal-reviewer", "validation_succeeded": True,
    "activation_succeeded": True, "stale_cas_rejected": sys.argv[8] == "true",
    "rollback_restored_predecessor": True,
    "role_grant_probes": {"collector": True, "importer": True, "operator": True, "runtime_reader": True},
    "ambiguity_aggregates": dict(zip(("total", "unique", "identical_collapsed", "ambiguous"), ambiguity)),
    "cleanup_default": True,
}
pathlib.Path(sys.argv[1]).write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n", encoding="utf-8")
PY
chmod 600 "$EVIDENCE_STAGE/lifecycle-summary.json"
mv "$EVIDENCE_STAGE/lifecycle-summary.json" "$EVIDENCE/lifecycle-summary.json"
printf '%s\n' "Abbott lifecycle rehearsal completed; sanitized evidence was written."

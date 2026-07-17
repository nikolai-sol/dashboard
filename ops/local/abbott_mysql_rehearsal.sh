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
  exit 2
}

MODE="${1:-}"
case "$MODE" in schema) shift ;; *) usage ;; esac
DUMP_SOURCE=""
EVIDENCE=""
while (( $# )); do
  case "$1" in
    --dump-sql) [[ $# -ge 2 ]] || usage; DUMP_SOURCE="$2"; shift 2 ;;
    --evidence) [[ $# -ge 2 ]] || usage; EVIDENCE="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$DUMP_SOURCE" && -n "$EVIDENCE" ]] || usage
[[ "$DUMP_SOURCE" = /* && "$EVIDENCE" = /* ]] || usage
[[ -f "$DUMP_SOURCE" ]] || { printf '%s\n' "Required rehearsal dump is unavailable." >&2; exit 2; }

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
reject_unsafe_external_path "$DUMP_SOURCE"
reject_unsafe_external_path "$EVIDENCE"

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
[[ -z "$(git -C "$MIGRATIONS_REPOSITORY" status --porcelain=v1 --untracked-files=all -- "$MIGRATIONS_DIRECTORY")" ]] || { printf '%s\n' "Reviewed migration authority is not clean." >&2; exit 1; }
while IFS= read -r authority; do
  [[ "$authority" == *.sql ]] || continue
  assert_clean_tracked_file "$MIGRATIONS_REPOSITORY" "$authority"
done < <(git -C "$MIGRATIONS_REPOSITORY" ls-files -- "$MIGRATIONS_DIRECTORY" | LC_ALL=C sort)
assert_clean_tracked_file "$ROOT_DIR" "$PRIVATE_SQL_RELATIVE"

install -d -m 700 "$EVIDENCE"
for evidence_name in rehearsal-summary.json schema-signature.sha256 grant-signature.sha256 dump-schema-probe.txt; do
  [[ ! -e "$EVIDENCE/$evidence_name" && ! -L "$EVIDENCE/$evidence_name" ]] || { printf '%s\n' "Existing rehearsal evidence path was rejected." >&2; exit 2; }
done
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
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

PRIVATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/abbott-mysql-rehearsal.XXXXXX")"
EVIDENCE_STAGE="$(mktemp -d "$EVIDENCE/.abbott-evidence.XXXXXX")"
chmod 700 "$EVIDENCE_STAGE"

ROOT_PASSWORD="$(openssl rand -hex 32)"
COLLECTOR_PASSWORD="$(openssl rand -hex 32)"
IMPORTER_PASSWORD="$(openssl rand -hex 32)"
OPERATOR_PASSWORD="$(openssl rand -hex 32)"
READER_PASSWORD="$(openssl rand -hex 32)"
printf 'MYSQL_ROOT_PASSWORD=%s\n' "$ROOT_PASSWORD" > "$PRIVATE_ROOT/container.env"
printf '[client]\nuser=root\npassword=%s\n' "$ROOT_PASSWORD" > "$PRIVATE_ROOT/root.cnf"
chmod 600 "$PRIVATE_ROOT/container.env" "$PRIVATE_ROOT/root.cnf"

docker pull "$MYSQL_IMAGE" > "$PRIVATE_ROOT/docker-pull.log" 2>&1
IMAGE_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' "$MYSQL_IMAGE")"
[[ "$IMAGE_DIGEST" == *@sha256:* ]] || { printf '%s\n' "Resolved MySQL image digest is unavailable." >&2; exit 1; }
docker volume create "$VOLUME_NAME" >/dev/null
docker run --detach --name "$CONTAINER_NAME" \
  --env-file "$PRIVATE_ROOT/container.env" \
  --mount "type=volume,source=$VOLUME_NAME,target=/var/lib/mysql" \
  --mount "type=bind,source=$PRIVATE_ROOT,target=/run/abbott-rehearsal,readonly" \
  --network none "$MYSQL_IMAGE" > "$PRIVATE_ROOT/container-id"

ready=0
for _attempt in $(seq 1 90); do
  if docker exec "$CONTAINER_NAME" mysqladmin ping \
      --defaults-extra-file=/run/abbott-rehearsal/root.cnf --silent >/dev/null 2>&1; then
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

MIGRATION_033="$MIGRATIONS_REPOSITORY/$MIGRATIONS_DIRECTORY/033_abbott_canonical_release_control.sql"
PRIVATE_SQL="$ROOT_DIR/$PRIVATE_SQL_RELATIVE"
[[ -f "$MIGRATION_033" && -f "$PRIVATE_SQL" ]] || { printf '%s\n' "Reviewed Abbott DDL is unavailable." >&2; exit 1; }
migration_count=0
found_033=0
while IFS= read -r migration; do
  mysql_exec "$PRIMARY_DATABASE" < "$migration" >> "$PRIVATE_ROOT/migrations-fresh.log" 2>&1
  migration_count=$((migration_count + 1))
  if [[ "$(basename "$migration")" == "033_abbott_canonical_release_control.sql" ]]; then
    found_033=1
    break
  fi
done < <(find "$MIGRATIONS_REPOSITORY/$MIGRATIONS_DIRECTORY" -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort)
[[ "$found_033" -eq 1 ]] || { printf '%s\n' "Migration 033 was not reached in lexical order." >&2; exit 1; }
mysql_exec "$PRIMARY_DATABASE" < "$PRIVATE_SQL" > "$PRIVATE_ROOT/private-fresh.log" 2>&1

cat > "$PRIVATE_ROOT/accounts.sql" <<SQL
CREATE USER 'abbott_rehearsal_collector'@'%' IDENTIFIED BY '$COLLECTOR_PASSWORD';
CREATE USER 'abbott_rehearsal_importer'@'%' IDENTIFIED BY '$IMPORTER_PASSWORD';
CREATE USER 'abbott_rehearsal_operator'@'%' IDENTIFIED BY '$OPERATOR_PASSWORD';
CREATE USER 'abbott_rehearsal_reader'@'%' IDENTIFIED BY '$READER_PASSWORD';
GRANT 'reportingdash_abbott_collector_role' TO 'abbott_rehearsal_collector'@'%';
SET DEFAULT ROLE 'reportingdash_abbott_collector_role' TO 'abbott_rehearsal_collector'@'%';
GRANT 'reportingdash_abbott_importer_role' TO 'abbott_rehearsal_importer'@'%';
SET DEFAULT ROLE 'reportingdash_abbott_importer_role' TO 'abbott_rehearsal_importer'@'%';
GRANT 'reportingdash_abbott_release_operator_role' TO 'abbott_rehearsal_operator'@'%';
SET DEFAULT ROLE 'reportingdash_abbott_release_operator_role' TO 'abbott_rehearsal_operator'@'%';
GRANT 'reportingdash_abbott_runtime_reader_role' TO 'abbott_rehearsal_reader'@'%';
SET DEFAULT ROLE 'reportingdash_abbott_runtime_reader_role' TO 'abbott_rehearsal_reader'@'%';
SQL
chmod 600 "$PRIVATE_ROOT/accounts.sql"
mysql_exec < "$PRIVATE_ROOT/accounts.sql" > "$PRIVATE_ROOT/accounts.log" 2>&1

capture_schema_signature() {
  local output=$1
  mysql_exec --execute="SELECT 'COLUMN',TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('$PRIMARY_DATABASE','$PRIVATE_DATABASE') UNION ALL SELECT 'INDEX',TABLE_SCHEMA,TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,NON_UNIQUE,COALESCE(SUB_PART,'<NULL>'),INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA IN ('$PRIMARY_DATABASE','$PRIVATE_DATABASE') ORDER BY 1,2,3,4,5,6;" > "$output"
}
capture_grant_signature() {
  local output=$1
  mysql_exec --execute="SELECT 'TABLE',GRANTEE,TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE LIKE CONCAT(CHAR(39),'reportingdash_abbott_%') UNION ALL SELECT 'SCHEMA',GRANTEE,TABLE_SCHEMA,'',PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE LIKE CONCAT(CHAR(39),'reportingdash_abbott_%') UNION ALL SELECT 'COLUMN',GRANTEE,TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,COLUMN_NAME FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE LIKE CONCAT(CHAR(39),'reportingdash_abbott_%') UNION ALL SELECT 'ROLE',CONCAT(FROM_USER,'@',FROM_HOST),'mysql',CONCAT(TO_USER,'@',TO_HOST),'GRANT','NO' FROM mysql.role_edges WHERE FROM_USER LIKE 'reportingdash_abbott_%' OR TO_USER LIKE 'abbott_rehearsal_%' UNION ALL SELECT 'DEFAULT',CONCAT(USER,'@',HOST),'mysql',CONCAT(DEFAULT_ROLE_USER,'@',DEFAULT_ROLE_HOST),'ROLE','NO' FROM mysql.default_roles WHERE USER LIKE 'abbott_rehearsal_%' ORDER BY 1,2,3,4,5,6;" > "$output"
}
signature() { shasum -a 256 "$1" | awk '{print $1}'; }
capture_schema_signature "$PRIVATE_ROOT/schema.before.tsv"
capture_grant_signature "$PRIVATE_ROOT/grants.before.tsv"
SCHEMA_SIGNATURE="$(signature "$PRIVATE_ROOT/schema.before.tsv")"
GRANT_SIGNATURE="$(signature "$PRIVATE_ROOT/grants.before.tsv")"

mysql_exec "$PRIMARY_DATABASE" < "$MIGRATION_033" > "$PRIVATE_ROOT/migration-033-repeat.log" 2>&1
mysql_exec "$PRIMARY_DATABASE" < "$PRIVATE_SQL" > "$PRIVATE_ROOT/private-repeat.log" 2>&1
capture_schema_signature "$PRIVATE_ROOT/schema.after.tsv"
capture_grant_signature "$PRIVATE_ROOT/grants.after.tsv"
[[ "$SCHEMA_SIGNATURE" == "$(signature "$PRIVATE_ROOT/schema.after.tsv")" ]] || { printf '%s\n' "Repeated Abbott DDL changed the schema signature." >&2; exit 1; }
[[ "$GRANT_SIGNATURE" == "$(signature "$PRIVATE_ROOT/grants.after.tsv")" ]] || { printf '%s\n' "Repeated Abbott DDL changed the grant signature." >&2; exit 1; }

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
for evidence_name in rehearsal-summary.json schema-signature.sha256 grant-signature.sha256 dump-schema-probe.txt; do
  [[ ! -e "$EVIDENCE/$evidence_name" && ! -L "$EVIDENCE/$evidence_name" ]] || { printf '%s\n' "Existing rehearsal evidence path was rejected." >&2; exit 2; }
  mv "$EVIDENCE_STAGE/$evidence_name" "$EVIDENCE/$evidence_name"
done
[[ "$DUMP_ERROR_CLASS" == none ]] || exit 1
printf '%s\n' "Abbott MySQL rehearsal completed; sanitized evidence was written."

#!/usr/bin/env bash
set -euo pipefail

container="reportingdash-task3-mysql-$$"
password="task3_local_only"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d --name "$container" \
  -e "MYSQL_ROOT_PASSWORD=$password" \
  -e MYSQL_DATABASE=report_bd \
  -p 127.0.0.1::3306 \
  mysql:8.4 >/dev/null

for _ in $(seq 1 60); do
  if docker exec -e MYSQL_PWD="$password" "$container" mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec -e MYSQL_PWD="$password" "$container" mysqladmin ping -h 127.0.0.1 --silent >/dev/null
port="$(docker port "$container" 3306/tcp | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -n 1)"
test -n "$port"

ABBOTT_MIGRATION_TEST_URL="mysql://root:$password@127.0.0.1:$port/report_bd" \
  npx tsx scripts/verify-abbott-release-source-integrity-mysql.ts

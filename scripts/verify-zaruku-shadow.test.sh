#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-zaruku-shadow.sh"
TMP_DIR="$(mktemp -d)"
SERVER_PIDS=()

cleanup() {
  for pid in ${SERVER_PIDS[@]+"${SERVER_PIDS[@]}"}; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

[[ -x "$VERIFY_SCRIPT" ]] || fail "shadow verifier does not exist or is not executable"

cat > "$TMP_DIR/fixture-server.mjs" <<'JS'
import http from "node:http";
import fs from "node:fs";

const fault = process.env.FIXTURE_FAULT || "";
const role = process.env.FIXTURE_ROLE;
const requestLog = process.env.FIXTURE_REQUEST_LOG;
const mutateSha = process.env.FIXTURE_MUTATE_SHA;
const payload = {
  dashboard: {
    id: 28, client_id: "zaruku", client_name: "Zaruku", dashboard_name: "Dashboard",
    type: "zaruku_bi", period: { from: "2026-01-01", to: "2026-07-31" },
    totals: { visits: 127, users: 91, pageviews: 204 },
  },
  timeseries: [
    { date: "2026-01-15", visits: 17, users: 10, pageviews: 22, provenance: "direct_owner_addition" },
    { date: "2026-01-20", visits: 5, users: 5, pageviews: 9, provenance: "collector" },
  ],
  zaruku_seo: {
    canonical_coverage: { metrika_breakdowns: { expected_days: 212, complete_days: 212, state: "facts" } },
    source_freshness: [
      { source_key: "metrika", status: "connected", data_through: "2026-07-31" },
      { source_key: "yandex_webmaster", status: "failed", data_through: "2026-07-30" },
    ],
    wordstat: {
      status: "connected",
      current: { query_status: "connected", region_status: "connected", coverage: { from: "2026-07-01", to: "2026-07-31", rows: 31 } },
      historical: { status: "connected", coverage: { from: "2026-01-01", to: "2026-07-31", rows: 212 } },
    },
    alice_visibility: { latestMonth: "2026-07", snapshots: [{ period_month: "2026-07", officialSovPct: 43.91 }] },
  },
};

function managerPayload() {
  const value = structuredClone(payload);
  if (role !== "isolated") return value;
  if (fault === "historical-total") value.dashboard.totals.visits += 1;
  if (fault === "direct-addition") value.timeseries = value.timeseries.filter((row) => row.provenance !== "direct_owner_addition");
  if (fault === "alice-month") value.zaruku_seo.alice_visibility.snapshots = [];
  if (fault === "wordstat-coverage") value.zaruku_seo.wordstat.current.coverage.rows -= 1;
  if (fault === "canonical-coverage") value.zaruku_seo.canonical_coverage.metrika_breakdowns.complete_days -= 1;
  if (fault === "source-health") value.zaruku_seo.source_freshness[1].status = "connected";
  return value;
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store", ...headers });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  fs.appendFileSync(requestLog, `${role}\t${req.method}\t${req.url}\n`);
  if (req.method !== "GET") return json(res, 405, { error: "read only" });
  if (req.url === "/api/health") {
    if (role === "combined") return json(res, 200, { status: "ok", timestamp: "2026-09-05T12:00:01Z", database: "connected", db_latency_ms: 7, uptime_seconds: 100 }, { "server-timing": "db;dur=7" });
    return json(res, 200, { ok: true, scope: "zaruku" }, { "server-timing": "total;dur=2", ...(fault === "health-header" ? { "cache-control": "public, max-age=60" } : {}) });
  }
  const url = new URL(req.url, "http://fixture");
  const authorized = req.headers["x-shadow-fixture-auth"] === "manager-secret";
  if (url.pathname === "/api/dashboard/zaruku") {
    if (!authorized) {
      const dashboard = { id: 28, client_id: "zaruku", client_name: "Zaruku", dashboard_name: "Dashboard", auth_mode: "password_only" };
      if (role === "isolated" && fault === "auth") dashboard.auth_mode = "public";
      return json(res, 401, { error: "Authentication required", auth_required: true, dashboard });
    }
    if (mutateSha) {
      const next = fault === "sha-rewrite" ? fs.readFileSync(mutateSha) : `${"e".repeat(40)}\n`;
      fs.writeFileSync(mutateSha, next);
    }
    return json(res, 200, managerPayload(), { "server-timing": role === "combined" ? "total;dur=12" : "total;dur=3" });
  }
  if (url.pathname === "/api/dashboard/zaruku/pdf" || url.pathname === "/api/dashboard/zaruku/excel") {
    if (!authorized) return json(res, 401, { error: "Authentication required" });
    const kind = url.pathname.endsWith("pdf") ? "pdf" : "excel";
    const body = Buffer.from(role === "isolated" && fault === `${kind}-export` ? `${kind}-different` : `${kind}-fixture-identical`);
    res.writeHead(200, {
      "cache-control": "private, no-store",
      "content-type": kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": kind === "pdf" ? 'attachment; filename="dashboard-zaruku-2026-09-05.pdf"' : 'attachment; filename="Zaruku_2026-01-01_2026-07-31.xlsx"',
    });
    return res.end(body);
  }
  json(res, 404, { error: "not found" });
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.env.FIXTURE_PORT_FILE, String(server.address().port)));
JS

start_server() {
  local role="$1"
  local fault="$2"
  local port_file="$3"
  local request_log="$4"
  local mutate_sha="${5:-}"
  FIXTURE_ROLE="$role" FIXTURE_FAULT="$fault" FIXTURE_PORT_FILE="$port_file" \
    FIXTURE_REQUEST_LOG="$request_log" FIXTURE_MUTATE_SHA="$mutate_sha" \
    node "$TMP_DIR/fixture-server.mjs" &
  SERVER_PIDS+=("$!")
  for _ in {1..100}; do
    [[ -s "$port_file" ]] && return
    sleep 0.02
  done
  fail "$role fixture did not start"
}

make_artifact() {
  local root="$1"
  mkdir -p "$root/apps/zaruku/.next-zaruku/server/chunks"
  printf '%s\n' "$(printf 'b%.0s' {1..40})" > "$root/.release-source-sha"
  printf 'zaruku\n' > "$root/.release-runtime-scope"
  cat > "$root/apps/zaruku/.next-zaruku/app-path-routes-manifest.json" <<'JSON'
{"/_not-found/page":"/_not-found","/api/dashboard/zaruku/excel/route":"/api/dashboard/zaruku/excel","/api/dashboard/zaruku/pdf/route":"/api/dashboard/zaruku/pdf","/api/dashboard/zaruku/route":"/api/dashboard/zaruku","/api/health/route":"/api/health","/dashboard/zaruku/page":"/dashboard/zaruku","/_global-error/page":"/_global-error"}
JSON
  printf '%s\n' 'safe Zaruku runtime fixture' > "$root/apps/zaruku/.next-zaruku/server/chunks/safe.js"
}

run_case() {
  local name="$1"
  local fault="$2"
  local expected="$3"
  local case_dir="$TMP_DIR/$name"
  local artifact="$case_dir/artifact"
  local evidence="$case_dir/evidence"
  local request_log="$case_dir/requests.log"
  local combined_sha="$case_dir/combined.sha"
  local abbott_sha="$case_dir/abbott.sha"
  mkdir -p "$case_dir"
  : > "$request_log"
  make_artifact "$artifact"
  printf '%s\n' "$(printf 'c%.0s' {1..40})" > "$combined_sha"
  printf '%s\n' "$(printf 'd%.0s' {1..40})" > "$abbott_sha"
  printf 'combined\t%s\nabbott\t%s\n' "$combined_sha" "$abbott_sha" > "$case_dir/other-runtimes.tsv"
  printf '{"headers":{"x-shadow-fixture-auth":"manager-secret"}}\n' > "$case_dir/auth.json"
  chmod 600 "$case_dir/auth.json"
  if [[ "$fault" == "abbott-artifact" ]]; then
    printf '%s\n' 'compiled marker /dashboard/abbott' > "$artifact/apps/zaruku/.next-zaruku/server/chunks/foreign.js"
  fi
  local mutate_path=""
  [[ "$fault" == "sha-mutation" || "$fault" == "sha-rewrite" ]] && mutate_path="$abbott_sha"
  start_server combined "" "$case_dir/combined.port" "$request_log"
  start_server isolated "$fault" "$case_dir/isolated.port" "$request_log" "$mutate_path"
  local combined_url="http://127.0.0.1:$(<"$case_dir/combined.port")"
  local isolated_url="http://127.0.0.1:$(<"$case_dir/isolated.port")"
  set +e
  ZARUKU_SHADOW_AUTH_FD=9 \
    ZARUKU_SHADOW_ARTIFACT_ROOT="$artifact" \
    ZARUKU_SHADOW_OTHER_RUNTIME_SHAS_FILE="$case_dir/other-runtimes.tsv" \
    ZARUKU_SHADOW_CANONICAL_SNAPSHOT="fixture-2026-07" \
    ZARUKU_SHADOW_FROM="2026-01-01" ZARUKU_SHADOW_TO="2026-07-31" \
    bash "$VERIFY_SCRIPT" "$combined_url" "$isolated_url" "$evidence" \
    9<"$case_dir/auth.json" >"$case_dir/output.log" 2>&1
  local status=$?
  set -e
  if [[ "$expected" == "pass" && $status -ne 0 ]]; then
    cat "$case_dir/output.log" >&2
    fail "$name unexpectedly failed"
  fi
  if [[ "$expected" == "fail" && $status -eq 0 ]]; then
    fail "$name unexpectedly passed"
  fi
  if [[ "$expected" == "pass" ]]; then
    for filename in summary.json endpoint-parity.json artifact-attestation.json zaruku-routes.txt runtime-shas.before.tsv runtime-shas.after.tsv; do
      [[ -s "$evidence/$filename" ]] || fail "$name omitted $filename"
    done
    node - "$evidence/summary.json" <<'NODE'
const summary = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8"));
if (summary.result !== "pass" || summary.readOnly !== true || summary.endpointsPassed !== 5 || summary.sourceSnapshot !== "fixture-2026-07") process.exit(1);
NODE
    grep -Fqx '/api/dashboard/zaruku' "$evidence/zaruku-routes.txt" || fail "$name omitted route inventory"
    if grep -R -Fq 'manager-secret' "$evidence"; then fail "$name leaked auth material into evidence"; fi
    if grep -Ev $'^([^\t]+)\tGET\t/' "$request_log" | grep -q .; then fail "$name issued a non-GET request"; fi
  fi
}

run_case matching "" pass
for fault in historical-total direct-addition alice-month wordstat-coverage canonical-coverage source-health auth pdf-export excel-export health-header sha-mutation sha-rewrite abbott-artifact; do
  run_case "$fault" "$fault" fail
done

echo "zaruku shadow verification fixture tests passed (1 positive, 13 negative)"

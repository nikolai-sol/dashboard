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

EXPORT_FIXTURES="$TMP_DIR/export-fixtures"
mkdir -p "$EXPORT_FIXTURES"
node - "$EXPORT_FIXTURES" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const root = process.argv[2];

function pdfBytes(created, text, pageCreation = "VISIBLE-CONTENT-ONE") {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /CreationDate (${pageCreation}) /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Producer (Zaruku fixture) /CreationDate (${created}) /ModDate (${created}) >>`,
  ];
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 18 Tf 40 72 Td (${escaped}) Tj ET`;
  objects[3] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  let output = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  const generatedId = created.endsWith("01Z") ? "a".repeat(32) : "b".repeat(32);
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R /ID [<0123456789abcdef0123456789abcdef> <${generatedId}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

async function workbookBytes(created, value) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Zaruku fixture";
  workbook.created = created;
  workbook.modified = created;
  const sheet = workbook.addWorksheet("Итоги");
  sheet.addRow(["Показатель", "Значение"]);
  sheet.addRow(["Визиты", value]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

(async () => {
  fs.writeFileSync(path.join(root, "combined.pdf"), pdfBytes("D:20260905120001Z", "Zaruku visits 127"));
  fs.writeFileSync(path.join(root, "isolated.pdf"), pdfBytes("D:20260905120059Z", "Zaruku visits 127"));
  fs.writeFileSync(path.join(root, "different.pdf"), pdfBytes("D:20260905120059Z", "Zaruku visits 128"));
  fs.writeFileSync(path.join(root, "noninfo-metadata.pdf"), pdfBytes("D:20260905120059Z", "Zaruku visits 127", "VISIBLE-CONTENT-TWO"));
  fs.writeFileSync(path.join(root, "combined.xlsx"), await workbookBytes(new Date("2026-09-05T12:00:01Z"), 127));
  fs.writeFileSync(path.join(root, "isolated.xlsx"), await workbookBytes(new Date("2026-09-05T12:00:59Z"), 127));
  fs.writeFileSync(path.join(root, "different.xlsx"), await workbookBytes(new Date("2026-09-05T12:00:59Z"), 128));
  if (fs.readFileSync(path.join(root, "combined.pdf")).equals(fs.readFileSync(path.join(root, "isolated.pdf")))) throw new Error("PDF timestamps did not change raw fixture bytes");
  if (fs.readFileSync(path.join(root, "combined.xlsx")).equals(fs.readFileSync(path.join(root, "isolated.xlsx")))) throw new Error("XLSX timestamps did not change raw fixture bytes");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

cat > "$TMP_DIR/fixture-server.mjs" <<'JS'
import http from "node:http";
import fs from "node:fs";

const fault = process.env.FIXTURE_FAULT || "";
const role = process.env.FIXTURE_ROLE;
const requestLog = process.env.FIXTURE_REQUEST_LOG;
const mutateSha = process.env.FIXTURE_MUTATE_SHA;
const exportFixtures = process.env.FIXTURE_EXPORTS;
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
  if (fault === "private-json") value.private_diagnostic = "PRIVATE_JSON_SENTINEL";
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
    if (role === "isolated" && fault === "slow-body") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.flushHeaders();
      return setTimeout(() => res.end(JSON.stringify(managerPayload())), 3000);
    }
    return json(res, 200, managerPayload(), {
      "server-timing": role === "combined" ? "total;dur=12" : "total;dur=3",
      ...(role === "isolated" && fault === "private-header" ? { "x-private-diagnostic": "PRIVATE_HEADER_SENTINEL" } : {}),
    });
  }
  if (url.pathname === "/api/dashboard/zaruku/pdf" || url.pathname === "/api/dashboard/zaruku/excel") {
    if (!authorized) return json(res, 401, { error: "Authentication required" });
    const kind = url.pathname.endsWith("pdf") ? "pdf" : "excel";
    const suffix = kind === "excel" ? "xlsx" : "pdf";
    const fixture = role === "combined"
      ? `combined.${suffix}`
      : fault === `${kind}-export`
        ? `different.${suffix}`
        : kind === "pdf" && fault === "pdf-non-generation-metadata"
          ? "noninfo-metadata.pdf"
          : `isolated.${suffix}`;
    const body = fs.readFileSync(`${exportFixtures}/${fixture}`);
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
    FIXTURE_REQUEST_LOG="$request_log" FIXTURE_MUTATE_SHA="$mutate_sha" FIXTURE_EXPORTS="$EXPORT_FIXTURES" \
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
  if [[ "$fault" == "malformed-auth" ]]; then
    printf 'DESCRIPTOR_SECRET_SENTINEL\n' > "$case_dir/auth.json"
  else
    printf '{"headers":{"x-shadow-fixture-auth":"manager-secret"}}\n' > "$case_dir/auth.json"
  fi
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
  local request_timeout=""
  [[ "$fault" == "slow-body" ]] && request_timeout="200"
  local started_seconds=$SECONDS
  set +e
  ZARUKU_SHADOW_AUTH_FD=9 \
    ZARUKU_SHADOW_HTTP_TIMEOUT_MS="$request_timeout" \
    ZARUKU_SHADOW_ARTIFACT_ROOT="$artifact" \
    ZARUKU_SHADOW_OTHER_RUNTIME_SHAS_FILE="$case_dir/other-runtimes.tsv" \
    ZARUKU_SHADOW_CANONICAL_SNAPSHOT="fixture-2026-07" \
    ZARUKU_SHADOW_FROM="2026-01-01" ZARUKU_SHADOW_TO="2026-07-31" \
    bash "$VERIFY_SCRIPT" "$combined_url" "$isolated_url" "$evidence" \
    9<"$case_dir/auth.json" >"$case_dir/stdout.log" 2>"$case_dir/stderr.log"
  local status=$?
  set -e
  local elapsed_seconds=$((SECONDS - started_seconds))
  if [[ "$fault" == "slow-body" && $elapsed_seconds -ge 2 ]]; then
    fail "$name exceeded the bounded request-and-body deadline"
  fi
  if [[ "$expected" == "pass" && $status -ne 0 ]]; then
    cat "$case_dir/stdout.log" "$case_dir/stderr.log" >&2
    fail "$name unexpectedly failed"
  fi
  if [[ "$expected" == "fail" && $status -eq 0 ]]; then
    fail "$name unexpectedly passed"
  fi
  for marker in manager-secret PRIVATE_JSON_SENTINEL PRIVATE_HEADER_SENTINEL DESCRIPTOR_SECRET_SENTINEL; do
    if grep -Fq "$marker" "$case_dir/stdout.log" "$case_dir/stderr.log"; then
      fail "$name leaked sensitive material into process output"
    fi
    if [[ -d "$evidence" ]] && grep -R -Fq "$marker" "$evidence"; then
      fail "$name leaked sensitive material into evidence"
    fi
  done
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
for fault in historical-total direct-addition alice-month wordstat-coverage canonical-coverage source-health auth pdf-export excel-export pdf-non-generation-metadata health-header sha-mutation sha-rewrite abbott-artifact private-json private-header malformed-auth slow-body; do
  run_case "$fault" "$fault" fail
done

echo "zaruku shadow verification fixture tests passed (1 positive, 18 negative)"

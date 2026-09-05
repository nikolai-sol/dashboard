#!/bin/bash
set -euo pipefail
umask 077

fail() {
  echo "Zaruku shadow verification failed: $1" >&2
  exit 1
}

[[ $# -eq 3 ]] || fail "usage: verify-zaruku-shadow.sh <combined-loopback-url> <isolated-loopback-url> <new-evidence-dir>"

COMBINED_URL="$1"
ISOLATED_URL="$2"
EVIDENCE_DIR="$3"
AUTH_FD="${ZARUKU_SHADOW_AUTH_FD:-}"
ARTIFACT_ROOT="${ZARUKU_SHADOW_ARTIFACT_ROOT:-}"
OTHER_SHAS_FILE="${ZARUKU_SHADOW_OTHER_RUNTIME_SHAS_FILE:-}"
SNAPSHOT="${ZARUKU_SHADOW_CANONICAL_SNAPSHOT:-}"
FROM_DATE="${ZARUKU_SHADOW_FROM:-}"
TO_DATE="${ZARUKU_SHADOW_TO:-}"

[[ "$AUTH_FD" =~ ^[0-9]+$ ]] || fail "ZARUKU_SHADOW_AUTH_FD must name an open descriptor containing auth JSON"
[[ -n "$ARTIFACT_ROOT" ]] || fail "ZARUKU_SHADOW_ARTIFACT_ROOT is required"
[[ -n "$OTHER_SHAS_FILE" ]] || fail "ZARUKU_SHADOW_OTHER_RUNTIME_SHAS_FILE is required"
[[ "$SNAPSHOT" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] || fail "invalid or missing canonical snapshot label"
[[ "$FROM_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "ZARUKU_SHADOW_FROM must be YYYY-MM-DD"
[[ "$TO_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "ZARUKU_SHADOW_TO must be YYYY-MM-DD"

if [[ -e "$EVIDENCE_DIR" ]]; then
  [[ -d "$EVIDENCE_DIR" && -z "$(find "$EVIDENCE_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] \
    || fail "evidence directory must be new or empty"
else
  mkdir -p "$EVIDENCE_DIR"
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

AUTH_FILE="$TMP_DIR/auth.json"
if ! cat <&"$AUTH_FD" > "$AUTH_FILE"; then
  fail "could not read auth descriptor"
fi
chmod 600 "$AUTH_FILE"

node --input-type=module - \
  "$COMBINED_URL" "$ISOLATED_URL" "$EVIDENCE_DIR" "$AUTH_FILE" "$ARTIFACT_ROOT" \
  "$OTHER_SHAS_FILE" "$SNAPSHOT" "$FROM_DATE" "$TO_DATE" <<'NODE'
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [combinedArgument, isolatedArgument, evidenceArgument, authFile, artifactArgument, shaListArgument, snapshot, from, to] = process.argv.slice(2);
const EXPECTED_ROUTES = [
  "/_not-found",
  "/api/dashboard/zaruku",
  "/api/dashboard/zaruku/excel",
  "/api/dashboard/zaruku/pdf",
  "/api/health",
  "/dashboard/zaruku",
];
const VOLATILE_HEADERS = new Set(["connection", "content-length", "date", "keep-alive", "server-timing", "transfer-encoding", "x-response-time"]);
const VOLATILE_COMBINED_HEALTH_FIELDS = new Set(["db_latency_ms", "timestamp", "uptime_seconds"]);
const FORBIDDEN_ARTIFACT_MARKERS = ["/dashboard/abbott", "/api/dashboard/abbott", "abbott-private", "abbott_private", "report_bd_private"];

function fail(message) {
  throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function digest(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function regularFile(filename, label) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.nlink !== 1) fail(`${label} must be a regular single-link file`);
  return stat;
}

function readExactSha(filename, label) {
  regularFile(filename, label);
  const value = fs.readFileSync(filename, "utf8");
  if (!/^[a-f0-9]{40}\n$/.test(value)) fail(`${label} is not an exact full source SHA`);
  return value.trim();
}

function resolveLoopback(value, label) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    fail(`${label} must be a credential-free HTTP loopback base URL`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function loadAuth() {
  regularFile(authFile, "auth descriptor copy");
  const parsed = JSON.parse(fs.readFileSync(authFile, "utf8"));
  if (!parsed || Object.keys(parsed).join(",") !== "headers" || !parsed.headers || Array.isArray(parsed.headers)) fail("auth descriptor must contain only a headers object");
  const entries = Object.entries(parsed.headers);
  if (entries.length === 0 || entries.length > 8) fail("auth descriptor must contain 1..8 headers");
  const result = {};
  for (const [name, value] of entries) {
    if (!/^[a-z0-9-]{1,64}$/.test(name) || typeof value !== "string" || value.length === 0 || value.length > 4096 || /[\r\n\0]/.test(value)) fail("invalid auth header descriptor");
    if (["connection", "content-length", "host", "transfer-encoding"].includes(name)) fail("forbidden auth header descriptor");
    result[name] = value;
  }
  return result;
}

function loadShaInventory() {
  regularFile(shaListArgument, "other runtime SHA inventory");
  const lines = fs.readFileSync(shaListArgument, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) fail("other runtime SHA inventory is empty");
  const seen = new Set();
  return lines.map((line) => {
    const fields = line.split("\t");
    if (fields.length !== 2 || !/^[a-z][a-z0-9_-]{0,31}$/.test(fields[0]) || seen.has(fields[0]) || !path.isAbsolute(fields[1])) fail("invalid other runtime SHA inventory row");
    seen.add(fields[0]);
    return { name: fields[0], filename: fields[1] };
  });
}

function snapshotShas(inventory) {
  return inventory.map(({ name, filename }) => {
    const sha = readExactSha(filename, `${name} runtime SHA`);
    const stat = fs.lstatSync(filename, { bigint: true });
    return {
      name,
      sha,
      identity: [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].map(String),
    };
  });
}

function writeTsv(filename, rows) {
  fs.writeFileSync(filename, `${rows.map(({ name, sha }) => `${name}\t${sha}`).join("\n")}\n`, { mode: 0o600 });
}

function attestArtifact() {
  const root = fs.realpathSync(artifactArgument);
  const rootStat = fs.lstatSync(artifactArgument);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("artifact root must be a directory, not a symlink");
  const sourceSha = readExactSha(path.join(root, ".release-source-sha"), "Zaruku artifact source SHA");
  regularFile(path.join(root, ".release-runtime-scope"), "Zaruku artifact scope");
  const scopeBytes = fs.readFileSync(path.join(root, ".release-runtime-scope"), "utf8");
  if (scopeBytes !== "zaruku\n") fail("Zaruku artifact scope differs from zaruku");
  const routeManifest = path.join(root, "apps/zaruku/.next-zaruku/app-path-routes-manifest.json");
  regularFile(routeManifest, "Zaruku route manifest");
  const routeObject = JSON.parse(fs.readFileSync(routeManifest, "utf8"));
  const routes = [...new Set(Object.values(routeObject).filter((value) => typeof value === "string" && value !== "/_global-error"))].sort();
  assert.deepEqual(routes, EXPECTED_ROUTES, "Zaruku route inventory differs from the reviewed six-route surface");

  let files = 0;
  let bytes = 0;
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) fail(`artifact contains a symlink: ${path.relative(root, filename)}`);
      if (stat.isDirectory()) { queue.push(filename); continue; }
      if (!stat.isFile() || stat.nlink !== 1) fail(`artifact contains an unsupported entry: ${path.relative(root, filename)}`);
      files += 1;
      bytes += stat.size;
      if (files > 20000 || bytes > 268435456 || stat.size > 33554432) fail("artifact exceeds shadow scan bounds");
      const lower = fs.readFileSync(filename).toString("utf8").toLowerCase();
      for (const marker of FORBIDDEN_ARTIFACT_MARKERS) {
        if (lower.includes(marker)) fail(`Zaruku artifact contains forbidden cross-runtime marker ${marker} in ${path.relative(root, filename)}`);
      }
    }
  }
  return { sourceSha, scope: "zaruku", routes, scannedFiles: files, scannedBytes: bytes, forbiddenMarkers: "none" };
}

function normalizedHeaders(headers) {
  return [...headers.entries()].filter(([name]) => !VOLATILE_HEADERS.has(name)).sort(([a], [b]) => a.localeCompare(b, "en"));
}

async function request(base, pathname, headers = {}) {
  const relative = new URL(pathname, "http://loopback.invalid");
  const url = new URL(base);
  url.pathname = `${base.pathname}${relative.pathname}`.replace(/\/{2,}/g, "/");
  url.search = relative.search;
  const response = await fetch(url, { method: "GET", headers, redirect: "manual", cache: "no-store" });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: normalizedHeaders(response.headers), body };
}

function parseJson(response, label) {
  try { return JSON.parse(response.body.toString("utf8")); }
  catch { fail(`${label} did not return JSON`); }
}

function compareResponses(left, right, label, bodyType) {
  assert.equal(right.status, left.status, `${label} status differs`);
  assert.deepEqual(right.headers, left.headers, `${label} semantic headers differ`);
  if (bodyType === "json") assert.equal(stableJson(parseJson(right, label)), stableJson(parseJson(left, label)), `${label} JSON semantics differ`);
  else assert.equal(digest(right.body), digest(left.body), `${label} body differs`);
}

function summarize(left, right, bodyType) {
  const normalizedLeft = bodyType === "json" ? Buffer.from(stableJson(parseJson(left, "evidence"))) : left.body;
  const normalizedRight = bodyType === "json" ? Buffer.from(stableJson(parseJson(right, "evidence"))) : right.body;
  return {
    status: left.status,
    semanticHeadersSha256: digest(stableJson(left.headers)),
    combinedBodySha256: digest(normalizedLeft),
    isolatedBodySha256: digest(normalizedRight),
    bodyBytes: left.body.length,
  };
}

const combined = resolveLoopback(combinedArgument, "combined URL");
const isolated = resolveLoopback(isolatedArgument, "isolated URL");
const evidence = path.resolve(evidenceArgument);
const authHeaders = loadAuth();
const inventory = loadShaInventory();
const before = snapshotShas(inventory);
writeTsv(path.join(evidence, "runtime-shas.before.tsv"), before);
const artifact = attestArtifact();
fs.writeFileSync(path.join(evidence, "artifact-attestation.json"), `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(evidence, "zaruku-routes.txt"), `${artifact.routes.join("\n")}\n`, { mode: 0o600 });

const query = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
const endpoints = {};

const [combinedHealth, isolatedHealth] = await Promise.all([request(combined, "/api/health"), request(isolated, "/api/health")]);
assert.equal(combinedHealth.status, 200, "combined health is not HTTP 200");
assert.equal(isolatedHealth.status, 200, "isolated health is not HTTP 200");
const combinedHealthHeaders = Object.fromEntries(combinedHealth.headers);
const isolatedHealthHeaders = Object.fromEntries(isolatedHealth.headers);
assert.match(combinedHealthHeaders["content-type"] ?? "", /^application\/json(?:;|$)/, "combined health content type is not JSON");
assert.match(isolatedHealthHeaders["content-type"] ?? "", /^application\/json(?:;|$)/, "isolated health content type is not JSON");
assert.equal(isolatedHealthHeaders["cache-control"], "private, no-store", "isolated health cache policy differs");
const combinedHealthBody = parseJson(combinedHealth, "combined health");
const isolatedHealthBody = parseJson(isolatedHealth, "isolated health");
assert.equal(combinedHealthBody.status, "ok", "combined runtime is not healthy");
assert.equal(combinedHealthBody.database, "connected", "combined canonical database is not connected");
assert.deepEqual(isolatedHealthBody, { ok: true, scope: "zaruku" }, "isolated runtime health/scope differs");
const stableCombinedHealth = Object.fromEntries(Object.entries(combinedHealthBody).filter(([key]) => !VOLATILE_COMBINED_HEALTH_FIELDS.has(key)));
endpoints.health = { combined: stableCombinedHealth, isolated: isolatedHealthBody, result: "pass" };

const [combinedUnauthorized, isolatedUnauthorized] = await Promise.all([request(combined, `/api/dashboard/zaruku${query}`), request(isolated, `/api/dashboard/zaruku${query}`)]);
compareResponses(combinedUnauthorized, isolatedUnauthorized, "unauthorized metadata", "json");
const unauthorized = parseJson(combinedUnauthorized, "unauthorized metadata");
assert.equal(combinedUnauthorized.status, 401, "unauthorized request did not return 401");
assert.equal(unauthorized.auth_required, true, "unauthorized response omitted auth_required");
assert.equal(unauthorized.dashboard?.client_id, "zaruku", "unauthorized response omitted Zaruku metadata");
endpoints.unauthorized = summarize(combinedUnauthorized, isolatedUnauthorized, "json");

const [combinedManager, isolatedManager] = await Promise.all([request(combined, `/api/dashboard/zaruku${query}`, authHeaders), request(isolated, `/api/dashboard/zaruku${query}`, authHeaders)]);
compareResponses(combinedManager, isolatedManager, "manager canonical payload", "json");
assert.equal(combinedManager.status, 200, "manager request did not return 200");
endpoints.manager = summarize(combinedManager, isolatedManager, "json");

for (const kind of ["pdf", "excel"]) {
  const [left, right] = await Promise.all([request(combined, `/api/dashboard/zaruku/${kind}${query}`, authHeaders), request(isolated, `/api/dashboard/zaruku/${kind}${query}`, authHeaders)]);
  compareResponses(left, right, `${kind.toUpperCase()} export`, "binary");
  assert.equal(left.status, 200, `${kind.toUpperCase()} export did not return 200`);
  endpoints[kind] = summarize(left, right, "binary");
}

const after = snapshotShas(inventory);
writeTsv(path.join(evidence, "runtime-shas.after.tsv"), after);
assert.deepEqual(after, before, "another runtime source SHA changed during shadow verification");

fs.writeFileSync(path.join(evidence, "endpoint-parity.json"), `${JSON.stringify(endpoints, null, 2)}\n`, { mode: 0o600 });
const summary = {
  result: "pass",
  readOnly: true,
  sourceSnapshot: snapshot,
  period: { from, to },
  endpointsPassed: 5,
  isolatedSourceSha: artifact.sourceSha,
  isolatedScope: artifact.scope,
  otherRuntimeShasUnchanged: true,
  normalizedVolatileValues: {
    headers: [...VOLATILE_HEADERS].sort(),
    combinedHealthFields: [...VOLATILE_COMBINED_HEALTH_FIELDS].sort(),
  },
};
fs.writeFileSync(path.join(evidence, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Zaruku shadow parity passed: snapshot=${snapshot} period=${from}..${to} endpoints=5\n`);
NODE

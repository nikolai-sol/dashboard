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
HTTP_TIMEOUT_MS="${ZARUKU_SHADOW_HTTP_TIMEOUT_MS:-15000}"

[[ "$AUTH_FD" =~ ^[0-9]+$ ]] || fail "ZARUKU_SHADOW_AUTH_FD must name an open descriptor containing auth JSON"
[[ -n "$ARTIFACT_ROOT" ]] || fail "ZARUKU_SHADOW_ARTIFACT_ROOT is required"
[[ -n "$OTHER_SHAS_FILE" ]] || fail "ZARUKU_SHADOW_OTHER_RUNTIME_SHAS_FILE is required"
[[ "$SNAPSHOT" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] || fail "invalid or missing canonical snapshot label"
[[ "$FROM_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "ZARUKU_SHADOW_FROM must be YYYY-MM-DD"
[[ "$TO_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "ZARUKU_SHADOW_TO must be YYYY-MM-DD"
[[ "$HTTP_TIMEOUT_MS" =~ ^[0-9]+$ && "$HTTP_TIMEOUT_MS" -ge 100 && "$HTTP_TIMEOUT_MS" -le 30000 ]] \
  || fail "ZARUKU_SHADOW_HTTP_TIMEOUT_MS must be an integer from 100 through 30000"

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
  "$OTHER_SHAS_FILE" "$SNAPSHOT" "$FROM_DATE" "$TO_DATE" "$HTTP_TIMEOUT_MS" <<'NODE'
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

let failureReported = false;
function reportSanitizedFailure() {
  if (!failureReported) process.stderr.write("Zaruku shadow verification failed: inputs, runtime response, or parity check did not pass\n");
  failureReported = true;
  process.exit(1);
}
process.on("uncaughtException", reportSanitizedFailure);
process.on("unhandledRejection", reportSanitizedFailure);

const [combinedArgument, isolatedArgument, evidenceArgument, authFile, artifactArgument, shaListArgument, snapshot, from, to, httpTimeoutArgument] = process.argv.slice(2);
const httpTimeoutMs = Number(httpTimeoutArgument);
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
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 4096;

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

function pdfDelimiter(character) {
  return character === "(" || character === ")" || character === "<" || character === ">" ||
    character === "[" || character === "]" || character === "{" || character === "}" ||
    character === "/" || character === "%";
}

function pdfWhitespace(character) {
  return character === "\0" || character === "\t" || character === "\n" ||
    character === "\f" || character === "\r" || character === " ";
}

function matchingPdfToken(tokens, start, openKind, closeKind, label) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].kind === openKind) depth += 1;
    if (tokens[index].kind === closeKind) depth -= 1;
    if (depth === 0) return index;
  }
  fail(`${label} contains an unterminated PDF container`);
}

function skipPdfValue(tokens, start, limit, label) {
  const token = tokens[start];
  if (!token || start >= limit) fail(`${label} contains a PDF dictionary key without a value`);
  if (token.kind === "dict-start") return matchingPdfToken(tokens, start, "dict-start", "dict-end", label) + 1;
  if (token.kind === "array-start") return matchingPdfToken(tokens, start, "array-start", "array-end", label) + 1;
  if (
    token.kind === "number" && tokens[start + 1]?.kind === "number" &&
    tokens[start + 2]?.kind === "keyword" && tokens[start + 2]?.value === "R" && start + 2 < limit
  ) return start + 3;
  return start + 1;
}

function pdfDictionaryEntries(tokens, dictionaryStart, dictionaryEnd, label) {
  const entries = [];
  let index = dictionaryStart + 1;
  while (index < dictionaryEnd) {
    const key = tokens[index];
    if (key.kind !== "name") fail(`${label} contains a malformed PDF dictionary`);
    const valueStart = index + 1;
    const valueEnd = skipPdfValue(tokens, valueStart, dictionaryEnd, label);
    entries.push({ name: key.value, valueStart, valueEnd });
    index = valueEnd;
  }
  return entries;
}

function decodePdfName(value) {
  return value.replace(/#([A-Fa-f0-9]{2})/g, (_match, pair) => String.fromCharCode(Number.parseInt(pair, 16)));
}

function scanPdfTokens(source, label) {
  const tokens = [];
  let index = 0;
  let insideObject = false;
  let objectTokenStart = -1;
  const push = (kind, start, end, value = "") => tokens.push({ kind, start, end, value, insideObject });

  while (index < source.length) {
    const character = source[index];
    if (pdfWhitespace(character)) { index += 1; continue; }
    if (character === "%") {
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
      continue;
    }
    if (character === "(") {
      const start = index;
      let depth = 1;
      index += 1;
      while (index < source.length && depth > 0) {
        if (source[index] === "\\") {
          index += source[index + 1] === "\r" && source[index + 2] === "\n" ? 3 : 2;
        } else {
          if (source[index] === "(") depth += 1;
          if (source[index] === ")") depth -= 1;
          index += 1;
        }
      }
      if (depth !== 0) fail(`${label} contains an unterminated PDF literal string`);
      push("literal", start, index);
      continue;
    }
    if (character === "<") {
      const start = index;
      if (source[index + 1] === "<") {
        index += 2;
        push("dict-start", start, index);
      } else {
        index += 1;
        while (index < source.length && source[index] !== ">") index += 1;
        if (index >= source.length) fail(`${label} contains an unterminated PDF hexadecimal string`);
        index += 1;
        push("hex", start, index);
      }
      continue;
    }
    if (character === ">" && source[index + 1] === ">") {
      push("dict-end", index, index + 2);
      index += 2;
      continue;
    }
    if (character === "[") { push("array-start", index, index + 1); index += 1; continue; }
    if (character === "]") { push("array-end", index, index + 1); index += 1; continue; }
    if (character === "/") {
      const start = index;
      index += 1;
      const valueStart = index;
      while (index < source.length && !pdfWhitespace(source[index]) && !pdfDelimiter(source[index])) index += 1;
      push("name", start, index, decodePdfName(source.slice(valueStart, index)));
      continue;
    }
    if (pdfDelimiter(character)) {
      push("delimiter", index, index + 1, character);
      index += 1;
      continue;
    }

    const start = index;
    while (index < source.length && !pdfWhitespace(source[index]) && !pdfDelimiter(source[index])) index += 1;
    const value = source.slice(start, index);
    const kind = /^[+-]?\d+$/.test(value) ? "number" : "keyword";
    push(kind, start, index, value);

    if (kind === "keyword" && value === "obj") {
      if (insideObject || tokens.length < 3 || tokens[tokens.length - 2].kind !== "number" || tokens[tokens.length - 3].kind !== "number") fail(`${label} contains malformed PDF object boundaries`);
      insideObject = true;
      objectTokenStart = tokens.length - 1;
      continue;
    }
    if (kind === "keyword" && value === "endobj") {
      if (!insideObject) fail(`${label} contains an unmatched PDF endobj`);
      insideObject = false;
      objectTokenStart = -1;
      continue;
    }
    if (kind === "keyword" && value === "stream") {
      if (!insideObject || objectTokenStart < 0) fail(`${label} contains a PDF stream outside an object`);
      let dictionaryStart = -1;
      for (let tokenIndex = objectTokenStart + 1; tokenIndex < tokens.length; tokenIndex += 1) {
        if (tokens[tokenIndex].kind === "dict-start") { dictionaryStart = tokenIndex; break; }
      }
      if (dictionaryStart < 0) fail(`${label} contains a PDF stream without a dictionary`);
      const dictionaryEnd = matchingPdfToken(tokens, dictionaryStart, "dict-start", "dict-end", label);
      const lengths = pdfDictionaryEntries(tokens, dictionaryStart, dictionaryEnd, label).filter((entry) => entry.name === "Length");
      const lengthToken = lengths.length === 1 && lengths[0].valueEnd === lengths[0].valueStart + 1 ? tokens[lengths[0].valueStart] : null;
      if (!lengthToken || lengthToken.kind !== "number") fail(`${label} uses an unsupported indirect PDF stream length`);
      const streamLength = Number(lengthToken.value);
      if (!Number.isSafeInteger(streamLength) || streamLength < 0) fail(`${label} contains an invalid PDF stream length`);
      if (source[index] === "\r" && source[index + 1] === "\n") index += 2;
      else if (source[index] === "\n" || source[index] === "\r") index += 1;
      else fail(`${label} contains a PDF stream without an EOL marker`);
      const streamEnd = index + streamLength;
      if (streamEnd > source.length) fail(`${label} contains a truncated PDF stream`);
      index = streamEnd;
      while (source[index] === "\r" || source[index] === "\n") index += 1;
      if (source.slice(index, index + 9) !== "endstream" || (!pdfWhitespace(source[index + 9]) && !pdfDelimiter(source[index + 9]))) fail(`${label} contains a PDF stream with an invalid boundary`);
      push("keyword", index, index + 9, "endstream");
      index += 9;
    }
  }
  if (insideObject) fail(`${label} contains an unterminated PDF object`);
  return tokens;
}

function normalizePdf(data, label) {
  if (data.length === 0 || data.length > MAX_EXPORT_BYTES) fail(`${label} is outside PDF size bounds`);
  const source = data.toString("latin1");
  if (!source.startsWith("%PDF-") || !/%%EOF\s*$/.test(source)) fail(`${label} is not a structurally recognizable PDF`);
  const tokens = scanPdfTokens(source, label);
  const objects = new Map();
  const structuralDictionaries = [];

  for (let index = 2; index < tokens.length; index += 1) {
    if (tokens[index].kind !== "keyword" || tokens[index].value !== "obj") continue;
    const number = tokens[index - 2];
    const generation = tokens[index - 1];
    if (number.kind !== "number" || generation.kind !== "number") fail(`${label} contains malformed PDF object identity`);
    let end = index + 1;
    while (end < tokens.length && !(tokens[end].kind === "keyword" && tokens[end].value === "endobj")) end += 1;
    if (end >= tokens.length) fail(`${label} contains an unterminated PDF object`);
    let dictionaryStart = -1;
    for (let tokenIndex = index + 1; tokenIndex < end; tokenIndex += 1) {
      if (tokens[tokenIndex].kind === "dict-start") { dictionaryStart = tokenIndex; break; }
    }
    if (dictionaryStart >= 0) {
      const dictionaryEnd = matchingPdfToken(tokens, dictionaryStart, "dict-start", "dict-end", label);
      if (dictionaryEnd >= end) fail(`${label} contains a PDF dictionary beyond its object`);
      objects.set(`${number.value} ${generation.value}`, { dictionaryStart, dictionaryEnd });
    }
    index = end;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].insideObject || tokens[index].kind !== "keyword" || tokens[index].value !== "trailer") continue;
    const dictionaryStart = index + 1;
    if (tokens[dictionaryStart]?.kind !== "dict-start") fail(`${label} contains a trailer without a dictionary`);
    structuralDictionaries.push({
      dictionaryStart,
      dictionaryEnd: matchingPdfToken(tokens, dictionaryStart, "dict-start", "dict-end", label),
    });
  }

  for (const object of objects.values()) {
    const entries = pdfDictionaryEntries(tokens, object.dictionaryStart, object.dictionaryEnd, label);
    const type = entries.find((entry) => entry.name === "Type");
    if (type && type.valueEnd === type.valueStart + 1 && tokens[type.valueStart].kind === "name" && tokens[type.valueStart].value === "XRef") structuralDictionaries.push(object);
  }
  if (objects.size === 0 || structuralDictionaries.length === 0) fail(`${label} has no structural PDF objects or trailer/XRef dictionary`);

  const normalized = Buffer.from(data);
  const maskedTokens = new Set();
  const maskString = (token) => {
    if (!token || (token.kind !== "literal" && token.kind !== "hex")) fail(`${label} contains generation metadata in an unsupported PDF value`);
    const key = `${token.start}:${token.end}`;
    if (maskedTokens.has(key)) return;
    maskedTokens.add(key);
    for (let offset = token.start + 1; offset < token.end - 1; offset += 1) {
      if (token.kind === "literal" || !pdfWhitespace(source[offset])) normalized[offset] = 0x30;
    }
  };
  const infoReferences = new Set();

  for (const dictionary of structuralDictionaries) {
    const entries = pdfDictionaryEntries(tokens, dictionary.dictionaryStart, dictionary.dictionaryEnd, label);
    for (const entry of entries) {
      if (entry.name === "Info") {
        const value = tokens.slice(entry.valueStart, entry.valueEnd);
        if (value.length !== 3 || value[0].kind !== "number" || value[1].kind !== "number" || value[2].kind !== "keyword" || value[2].value !== "R") fail(`${label} contains an invalid structural PDF Info reference`);
        infoReferences.add(`${value[0].value} ${value[1].value}`);
      }
      if (entry.name === "ID") {
        const value = tokens.slice(entry.valueStart, entry.valueEnd);
        if (value.length !== 4 || value[0].kind !== "array-start" || value[3].kind !== "array-end") fail(`${label} contains an invalid structural PDF ID`);
        maskString(value[1]);
        maskString(value[2]);
      }
    }
  }

  for (const reference of infoReferences) {
    const object = objects.get(reference);
    if (!object) fail(`${label} references a missing PDF Info object`);
    for (const entry of pdfDictionaryEntries(tokens, object.dictionaryStart, object.dictionaryEnd, label)) {
      if (entry.name !== "CreationDate" && entry.name !== "ModDate") continue;
      if (entry.valueEnd !== entry.valueStart + 1) fail(`${label} contains an invalid PDF Info date`);
      maskString(tokens[entry.valueStart]);
    }
  }
  return normalized;
}

function normalizeCoreProperties(data) {
  const source = data.toString("utf8");
  const normalizeElement = (name, input) => input.replace(
    new RegExp(`(<(?:[A-Za-z_][\\w.-]*:)?${name}\\b[^>]*>)[\\s\\S]*?(</(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>)`, "g"),
    "$1__GENERATION_TIMESTAMP__$2",
  );
  return Buffer.from(normalizeElement("modified", normalizeElement("created", source)), "utf8");
}

async function normalizeXlsx(data, label) {
  if (data.length === 0 || data.length > MAX_EXPORT_BYTES || data[0] !== 0x50 || data[1] !== 0x4b) fail(`${label} is outside XLSX package bounds`);
  let archive;
  try {
    archive = await JSZip.loadAsync(data, { checkCRC32: true, createFolders: false });
  } catch {
    fail(`${label} is not a valid XLSX ZIP package`);
  }
  const names = Object.keys(archive.files).filter((name) => !archive.files[name].dir).sort((a, b) => a.localeCompare(b, "en"));
  if (names.length === 0 || names.length > MAX_XLSX_ENTRIES || !names.includes("[Content_Types].xml") || !names.includes("xl/workbook.xml")) fail(`${label} does not have the required XLSX package surface`);
  let expandedBytes = 0;
  const entries = [];
  for (const name of names) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) fail(`${label} contains an invalid XLSX entry name`);
    const original = await archive.files[name].async("nodebuffer");
    expandedBytes += original.length;
    if (expandedBytes > MAX_EXPORT_BYTES) fail(`${label} exceeds expanded XLSX bounds`);
    const normalized = name === "docProps/core.xml" ? normalizeCoreProperties(original) : original;
    entries.push({ name, bytes: normalized.length, sha256: digest(normalized) });
  }
  return Buffer.from(stableJson(entries));
}

async function normalizedBody(response, label, bodyType) {
  if (bodyType === "json") return Buffer.from(stableJson(parseJson(response, label)));
  if (bodyType === "pdf") return normalizePdf(response.body, label);
  if (bodyType === "xlsx") return normalizeXlsx(response.body, label);
  fail(`unsupported response body type for ${label}`);
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
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), httpTimeoutMs);
  try {
    const response = await fetch(url, { method: "GET", headers, redirect: "manual", cache: "no-store", signal: controller.signal });
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: normalizedHeaders(response.headers), body };
  } finally {
    clearTimeout(deadline);
  }
}

function parseJson(response, label) {
  try { return JSON.parse(response.body.toString("utf8")); }
  catch { fail(`${label} did not return JSON`); }
}

async function compareResponses(left, right, label, bodyType) {
  assert.equal(right.status, left.status, `${label} status differs`);
  assert.deepEqual(right.headers, left.headers, `${label} semantic headers differ`);
  const [normalizedLeft, normalizedRight] = await Promise.all([
    normalizedBody(left, label, bodyType),
    normalizedBody(right, label, bodyType),
  ]);
  assert.equal(digest(normalizedRight), digest(normalizedLeft), `${label} body semantics differ`);
}

async function summarize(left, right, bodyType) {
  const [normalizedLeft, normalizedRight] = await Promise.all([
    normalizedBody(left, "evidence", bodyType),
    normalizedBody(right, "evidence", bodyType),
  ]);
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
await compareResponses(combinedUnauthorized, isolatedUnauthorized, "unauthorized metadata", "json");
const unauthorized = parseJson(combinedUnauthorized, "unauthorized metadata");
assert.equal(combinedUnauthorized.status, 401, "unauthorized request did not return 401");
assert.equal(unauthorized.auth_required, true, "unauthorized response omitted auth_required");
assert.equal(unauthorized.dashboard?.client_id, "zaruku", "unauthorized response omitted Zaruku metadata");
endpoints.unauthorized = await summarize(combinedUnauthorized, isolatedUnauthorized, "json");

const [combinedManager, isolatedManager] = await Promise.all([request(combined, `/api/dashboard/zaruku${query}`, authHeaders), request(isolated, `/api/dashboard/zaruku${query}`, authHeaders)]);
await compareResponses(combinedManager, isolatedManager, "manager canonical payload", "json");
assert.equal(combinedManager.status, 200, "manager request did not return 200");
endpoints.manager = await summarize(combinedManager, isolatedManager, "json");

for (const kind of ["pdf", "excel"]) {
  const [left, right] = await Promise.all([request(combined, `/api/dashboard/zaruku/${kind}${query}`, authHeaders), request(isolated, `/api/dashboard/zaruku/${kind}${query}`, authHeaders)]);
  const bodyType = kind === "pdf" ? "pdf" : "xlsx";
  await compareResponses(left, right, `${kind.toUpperCase()} export`, bodyType);
  assert.equal(left.status, 200, `${kind.toUpperCase()} export did not return 200`);
  endpoints[kind] = await summarize(left, right, bodyType);
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
  requestAndBodyDeadlineMs: httpTimeoutMs,
  normalizedVolatileValues: {
    headers: [...VOLATILE_HEADERS].sort(),
    combinedHealthFields: [...VOLATILE_COMBINED_HEALTH_FIELDS].sort(),
    pdfGenerationMetadata: ["Info.CreationDate", "Info.ModDate", "trailerOrXref.ID"],
    xlsxGenerationMetadata: ["ZIP entry order/compression/timestamps", "docProps/core.xml:created", "docProps/core.xml:modified"],
  },
};
fs.writeFileSync(path.join(evidence, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Zaruku shadow parity passed: snapshot=${snapshot} period=${from}..${to} endpoints=5\n`);
NODE

#!/usr/bin/env node

import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ExcelJS from "exceljs";

export const ABBOTT_PARITY_PERIOD = Object.freeze({ from: "2026-09-01", to: "2026-09-13" });

const MAX_CREDENTIAL_BYTES = 64 * 1024;
const REPORT_NAME = "abbott-runtime-parity.json";
const FORBIDDEN_REPORT_TEXT = /access_token|embed_key|cookie|raw_user_id|visit_id|start_url|end_url|https?:\/\//i;
const VOLATILE_METADATA_KEYS = new Set(["generated_at", "generatedAt", "created_at", "updated_at"]);
const METADATA_KEYS = [
  "client_name",
  "dashboard_name",
  "type",
  "currency",
  "language",
  "show_spend",
  "filter_scope",
  "section_order",
];
const VISIBLE_TAB_ORDER = [
  "users_summary",
  "user_actions",
  "page_stats",
  "bitrix_pages",
  "session_journeys",
  "external_events",
  "returning",
  "general_materials",
  "time_buckets",
];
const PRIVATE_OR_URL_KEY = /(?:^|_)(?:access_token|embed_key|cookie|raw_user_id|user_id|visit_id|session_id|start_url|end_url|url|path)(?:_|$)/i;
const NUMERIC_IDENTIFIER_KEY = /(?:^|_)(?:id|identifier|ordinal)(?:_|$)/i;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function metadataSummary(dashboard) {
  const source = isRecord(dashboard) ? dashboard : {};
  return Object.fromEntries(
    METADATA_KEYS
      .filter((key) => !VOLATILE_METADATA_KEYS.has(key) && source[key] !== undefined)
      .map((key) => [key, canonicalize(source[key])]),
  );
}

function numericObject(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => typeof nested === "number" && Number.isFinite(nested))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function dataQualitySummary(value) {
  if (!isRecord(value)) return null;
  const gaps = Array.isArray(value.blocking_gaps)
    ? value.blocking_gaps.map((gap) => {
      const row = isRecord(gap) ? gap : {};
      return Object.fromEntries(
        ["counter_id", "report_date", "scope", "status"]
          .filter((key) => row[key] !== undefined)
          .map((key) => [key, row[key]]),
      );
    })
    : [];
  gaps.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return canonicalize({
    status: value.status ?? null,
    release_id: typeof value.release_id === "number" ? value.release_id : null,
    requested_scopes: Array.isArray(value.requested_scopes) ? [...value.requested_scopes].sort() : [],
    requested_from: value.requested_from ?? null,
    requested_to: value.requested_to ?? null,
    blocking_gaps: gaps,
    content_lookup: numericObject(value.content_lookup),
  });
}

function rowsAt(data, tab) {
  if (tab === "session_journeys") return Array.isArray(data.session_journeys?.rows) ? data.session_journeys.rows : [];
  if (tab === "external_events") {
    return [
      ...(Array.isArray(data.external_events) ? data.external_events.map((row) => ({ ...row, row_kind: "event" })) : []),
      ...(Array.isArray(data.external_clicks) ? data.external_clicks.map((row) => ({ ...row, row_kind: "click" })) : []),
    ];
  }
  if (tab === "time_buckets") {
    const buckets = isRecord(data.time_buckets) ? data.time_buckets : {};
    return [
      ...(Array.isArray(buckets.overall) ? buckets.overall.map((row) => ({ ...row, row_kind: "overall" })) : []),
      ...(Array.isArray(buckets.materials) ? buckets.materials.map((row) => ({ ...row, row_kind: "materials" })) : []),
      ...(Array.isArray(buckets.by_page) ? buckets.by_page.map((row) => ({ ...row, row_kind: "by_page" })) : []),
    ];
  }
  return Array.isArray(data[tab]) ? data[tab] : [];
}

function identifierProjection(row) {
  if (!isRecord(row)) return row;
  const identifiers = Object.fromEntries(
    Object.entries(row)
      .filter(([key, value]) => PRIVATE_OR_URL_KEY.test(key) || typeof value === "string" || typeof value === "boolean" || value === null)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return Object.keys(identifiers).length > 0 ? identifiers : row;
}

function addNumericAggregates(value, target = {}, keyPath = "") {
  if (Array.isArray(value)) {
    for (const nested of value) addNumericAggregates(nested, target, keyPath);
    return target;
  }
  if (!isRecord(value)) return target;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = keyPath ? `${keyPath}.${key}` : key;
    if (typeof nested === "number" && Number.isFinite(nested) && !NUMERIC_IDENTIFIER_KEY.test(key)) {
      target[nextPath] = (target[nextPath] ?? 0) + nested;
    } else if (Array.isArray(nested) || isRecord(nested)) {
      addNumericAggregates(nested, target, nextPath);
    }
  }
  return target;
}

function summarizeRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    count: safeRows.length,
    stable_identifier_hashes: safeRows.map((row) => sha256(canonicalJson(identifierProjection(row)))).sort(),
    numeric_aggregates: Object.fromEntries(
      Object.entries(addNumericAggregates(safeRows)).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function visibleTabs(data) {
  const has = (key) => Array.isArray(data[key]);
  const rowCount = (key) => Array.isArray(data[key]) ? data[key].length : 0;
  const time = isRecord(data.time_buckets) ? data.time_buckets : {};
  const predicates = {
    users_summary: has("users_summary") || has("traffic_summary"),
    user_actions: has("user_actions"),
    page_stats: has("page_stats"),
    bitrix_pages: rowCount("bitrix_pages") > 0,
    session_journeys: Array.isArray(data.session_journeys?.rows) && data.session_journeys.rows.length > 0,
    external_events: rowCount("external_events") > 0 || rowCount("external_clicks") > 0,
    returning: has("returning"),
    general_materials: rowCount("general_materials") > 0,
    time_buckets: (Array.isArray(time.overall) && time.overall.some((row) => Number(row?.users) > 0))
      || (Array.isArray(time.materials) && time.materials.some((row) => Number(row?.users) > 0))
      || (Array.isArray(time.by_page) && time.by_page.length > 0),
  };
  return VISIBLE_TAB_ORDER.filter((tab) => predicates[tab]);
}

function supplementaryDatasetRows(data) {
  const frequency = isRecord(data.return_frequency) ? data.return_frequency : {};
  return {
    users_summary_without_admins: Array.isArray(data.users_summary_without_admins) ? data.users_summary_without_admins : [],
    traffic_summary: Array.isArray(data.traffic_summary) ? data.traffic_summary : [],
    return_frequency_groups: Array.isArray(frequency.groups) ? frequency.groups : [],
    return_frequency_user_directions: Array.isArray(frequency.user_directions) ? frequency.user_directions : [],
    return_frequency_pages: Array.isArray(frequency.return_pages) ? frequency.return_pages : [],
  };
}

export function summarizeAbbottPayload(payload, options = {}) {
  const dashboard = isRecord(payload?.dashboard) ? payload.dashboard : {};
  const data = isRecord(payload?.abbott_bi) ? payload.abbott_bi : {};
  const period = isRecord(dashboard.period)
    ? { from: dashboard.period.from ?? null, to: dashboard.period.to ?? null }
    : { from: null, to: null };
  const tabRows = Object.fromEntries(VISIBLE_TAB_ORDER.map((tab) => [tab, summarizeRows(rowsAt(data, tab))]));
  const supplementalRows = Object.fromEntries(
    Object.entries(supplementaryDatasetRows(data)).map(([key, rows]) => [key, summarizeRows(rows)]),
  );
  const summary = canonicalize({
    dashboard: metadataSummary(dashboard),
    period,
    kpi_totals: numericObject(payload?.kpi),
    data_quality: dataQualitySummary(data.data_quality),
    tabs: visibleTabs(data),
    tab_rows: tabRows,
    supplemental_rows: supplementalRows,
    administrator_exclusion_count: Number.isSafeInteger(options.administratorExclusionCount)
      ? options.administratorExclusionCount
      : null,
  });
  const text = JSON.stringify(summary);
  if (FORBIDDEN_REPORT_TEXT.test(text)) throw new Error("Redacted payload summary contains a forbidden field");
  return summary;
}

export function compareRedactedValues(left, right, prefix = "") {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return [prefix || "root"];
    return left.flatMap((value, index) => compareRedactedValues(value, right[index], `${prefix}[${index}]`));
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.flatMap((key) => compareRedactedValues(left[key], right[key], prefix ? `${prefix}.${key}` : key));
  }
  return [prefix || "root"];
}

function cellTypeName(cell) {
  if (cell.formula) return "formula";
  const names = {
    [ExcelJS.ValueType.Null]: "null",
    [ExcelJS.ValueType.Merge]: "merge",
    [ExcelJS.ValueType.Number]: "number",
    [ExcelJS.ValueType.String]: "string",
    [ExcelJS.ValueType.Date]: "date",
    [ExcelJS.ValueType.Hyperlink]: "hyperlink",
    [ExcelJS.ValueType.RichText]: "rich_text",
    [ExcelJS.ValueType.Boolean]: "boolean",
    [ExcelJS.ValueType.Error]: "error",
  };
  return names[cell.type] ?? "unknown";
}

export async function summarizeWorkbook(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  const sheets = workbook.worksheets.map((worksheet) => {
    const types = {};
    const formulas = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const name = cellTypeName(cell);
        types[name] = (types[name] ?? 0) + 1;
        if (cell.formula) formulas.push(sha256(String(cell.formula)));
      });
    });
    return {
      name: worksheet.name,
      row_count: worksheet.actualRowCount,
      cell_types: Object.fromEntries(Object.entries(types).sort(([left], [right]) => left.localeCompare(right))),
      formula_hashes: formulas.sort(),
    };
  });
  const summary = { sheets };
  return { ...summary, semantic_sha256: sha256(canonicalJson(summary)) };
}

export function parseCredentialLines(text) {
  if (Buffer.byteLength(text) > MAX_CREDENTIAL_BYTES) throw new Error("Credential input is too large");
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.at(-1) === "") lines.pop();
  if (lines.length !== 2 || lines.some((line) => line.length === 0)) {
    throw new Error("Credential input must contain exactly two non-empty lines");
  }
  return { managerPassword: lines[0], embedKey: lines[1] };
}

export async function readCredentialFd(fd = 0) {
  const chunks = [];
  let total = 0;
  const stream = createReadStream(null, { fd, autoClose: false });
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > MAX_CREDENTIAL_BYTES) {
      stream.destroy();
      throw new Error("Credential input is too large");
    }
    chunks.push(chunk);
  }
  return parseCredentialLines(Buffer.concat(chunks).toString("utf8"));
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function createPrivateReportDirectory(outputParent, repositoryRoot = process.cwd()) {
  const parent = path.resolve(outputParent);
  const root = path.resolve(repositoryRoot);
  if (isWithin(root, parent)) throw new Error("Parity output must be outside Git");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const directory = await mkdtemp(path.join(parent, "abbott-runtime-parity-"));
  await chmod(directory, 0o700);
  return directory;
}

export async function writeParityReport(directory, report) {
  const text = `${JSON.stringify(canonicalize(report), null, 2)}\n`;
  if (FORBIDDEN_REPORT_TEXT.test(text)) throw new Error("Parity report contains forbidden content");
  const destination = path.join(directory, REPORT_NAME);
  await writeFile(destination, text, { mode: 0o600, flag: "wx" });
  await chmod(destination, 0o600);
  return destination;
}

export function assertRuntimeBaseUrl(value, expectedPort) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
    || url.port !== String(expectedPort)) {
    throw new Error(`Runtime URL must be an origin on port ${expectedPort} without credentials or a path`);
  }
  return url.origin;
}

export function buildAuthorizedRequest(base, endpoint, credential) {
  const url = new URL(endpoint, `${base}/`);
  url.searchParams.set("from", ABBOTT_PARITY_PERIOD.from);
  url.searchParams.set("to", ABBOTT_PARITY_PERIOD.to);
  if (credential.kind === "embed") url.searchParams.set("embed_key", credential.value);
  return {
    url,
    options: credential.kind === "manager"
      ? { headers: { cookie: `dashboard_viewer_18=${credential.value}` } }
      : {},
  };
}

async function fetchChecked(url, options, label) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error(`${label} request failed`);
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response;
}

export async function obtainManagerToken(referenceBase, password) {
  const response = await fetchChecked(new URL("/api/dashboard-auth/login", `${referenceBase}/`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dashboard_id: "18", password }),
  }, "Manager authorization");
  const body = await response.json().catch(() => null);
  if (!body || typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Manager authorization returned no token");
  }
  return body.access_token;
}

async function fetchAudienceSummary(base, audience, credential) {
  const payloadRequest = buildAuthorizedRequest(base, "/api/dashboard/18", credential);
  const payloadResponse = await fetchChecked(
    payloadRequest.url,
    { ...payloadRequest.options, cache: "no-store" },
    `${audience} dashboard`,
  );
  const payload = await payloadResponse.json();
  let administratorExclusionCount = null;
  if (audience === "manager") {
    const adminRequest = buildAuthorizedRequest(base, "/api/dashboard/18/abbott-admin-users", credential);
    const adminResponse = await fetchChecked(
      adminRequest.url,
      { ...adminRequest.options, cache: "no-store" },
      "Manager exclusion count",
    );
    const body = await adminResponse.json().catch(() => null);
    if (!body || !Array.isArray(body.user_ids)) throw new Error("Manager exclusion count response is invalid");
    administratorExclusionCount = body.user_ids.length;
  }
  const workbookRequest = buildAuthorizedRequest(base, "/api/dashboard/18/excel", credential);
  const workbookResponse = await fetchChecked(
    workbookRequest.url,
    { ...workbookRequest.options, cache: "no-store" },
    `${audience} workbook`,
  );
  return {
    payload: summarizeAbbottPayload(payload, { administratorExclusionCount }),
    workbook: await summarizeWorkbook(Buffer.from(await workbookResponse.arrayBuffer())),
  };
}

export async function runParityComparison({ referenceBase, candidateBase, managerPassword, embedKey }) {
  const managerToken = await obtainManagerToken(referenceBase, managerPassword);
  const credentials = {
    manager: { kind: "manager", value: managerToken },
    embed: { kind: "embed", value: embedKey },
  };
  const audiences = {};
  for (const audience of ["manager", "embed"]) {
    const [reference, candidate] = await Promise.all([
      fetchAudienceSummary(referenceBase, audience, credentials[audience]),
      fetchAudienceSummary(candidateBase, audience, credentials[audience]),
    ]);
    audiences[audience] = {
      reference,
      candidate,
      mismatch_paths: compareRedactedValues(reference, candidate),
    };
  }
  const mismatchCount = Object.values(audiences).reduce((count, result) => count + result.mismatch_paths.length, 0);
  return {
    status: mismatchCount === 0 ? "match" : "mismatch",
    period: ABBOTT_PARITY_PERIOD,
    mismatch_count: mismatchCount,
    audiences,
  };
}

function parseArgs(argv) {
  const options = { credentialsFd: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === "--reference" && next) { options.reference = next; index += 1; }
    else if (value === "--candidate" && next) { options.candidate = next; index += 1; }
    else if (value === "--output-parent" && next) { options.outputParent = next; index += 1; }
    else if (value === "--credentials-fd" && next && /^\d+$/.test(next)) { options.credentialsFd = Number(next); index += 1; }
    else throw new Error("Usage: compare-abbott-runtime.mjs --reference ORIGIN:3001 --candidate ORIGIN:3004 --output-parent PATH [--credentials-fd N]");
  }
  if (!options.reference || !options.candidate || !options.outputParent) {
    throw new Error("Usage: compare-abbott-runtime.mjs --reference ORIGIN:3001 --candidate ORIGIN:3004 --output-parent PATH [--credentials-fd N]");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const referenceBase = assertRuntimeBaseUrl(options.reference, 3001);
  const candidateBase = assertRuntimeBaseUrl(options.candidate, 3004);
  const credentials = await readCredentialFd(options.credentialsFd);
  const report = await runParityComparison({ referenceBase, candidateBase, ...credentials });
  const directory = await createPrivateReportDirectory(options.outputParent);
  const reportPath = await writeParityReport(directory, report);
  process.stdout.write(`status=${report.status} mismatches=${report.mismatch_count} report=${reportPath}\n`);
  if (report.status !== "match") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`Abbott parity failed: ${message.replace(/https?:\/\/\S+/g, "[redacted-url]")}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
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
const DECIMAL_SCALE = 1_000_000n;
const REQUIRED_COMMON_ARRAYS = [
  "counters",
  "traffic_summary",
  "page_stats",
  "bitrix_pages",
  "external_events",
  "external_clicks",
  "returning",
  "general_materials",
];
const REQUIRED_MANAGER_ARRAYS = ["users_summary", "users_summary_without_admins", "user_actions"];

const SAFE_STAGE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PRIVATE_OUTPUT_STATE = new WeakMap();
const PYTHON_MKDIR_AT = `
import os, sys
name = sys.argv[1]
os.mkdir(name, 0o700, dir_fd=3)
fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=3)
try:
    os.fchmod(fd, 0o700)
finally:
    os.close(fd)
entry = os.stat(name, dir_fd=3, follow_symlinks=False)
sys.stdout.write(f"{entry.st_dev} {entry.st_ino}")
`;
const PYTHON_WRITE_AT = `
import os, sys
name = sys.argv[1]
fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=3)
try:
    os.fchmod(fd, 0o600)
    while True:
        chunk = sys.stdin.buffer.read(65536)
        if not chunk:
            break
        os.write(fd, chunk)
    os.fsync(fd)
finally:
    os.close(fd)
`;
const PYTHON_CLEAN_OUTPUT = `
import os, stat, sys, time
expected_dev, expected_ino = sys.argv[1], sys.argv[2]
def clear(directory_fd):
    for name in os.listdir(directory_fd):
        entry = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if stat.S_ISDIR(entry.st_mode):
            nested = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
            try:
                clear(nested)
            finally:
                os.close(nested)
            os.rmdir(name, dir_fd=directory_fd)
        else:
            os.unlink(name, dir_fd=directory_fd)
removed = False
for attempt in range(100):
    clear(4)
    for name in os.listdir(3):
        entry = os.stat(name, dir_fd=3, follow_symlinks=False)
        if str(entry.st_dev) == expected_dev and str(entry.st_ino) == expected_ino and stat.S_ISDIR(entry.st_mode):
            try:
                os.rmdir(name, dir_fd=3)
                removed = True
            except OSError:
                pass
            break
    if removed:
        break
    time.sleep(0.05)
if not removed:
    raise SystemExit(3)
`;
const PYTHON_REMOVE_CREATED = `
import os, stat, sys
expected_dev, expected_ino = sys.argv[1], sys.argv[2]
def clear(directory_fd):
    for name in os.listdir(directory_fd):
        entry = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if stat.S_ISDIR(entry.st_mode):
            nested = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
            try:
                clear(nested)
            finally:
                os.close(nested)
            os.rmdir(name, dir_fd=directory_fd)
        else:
            os.unlink(name, dir_fd=directory_fd)
for name in os.listdir(3):
    entry = os.stat(name, dir_fd=3, follow_symlinks=False)
    if str(entry.st_dev) == expected_dev and str(entry.st_ino) == expected_ino and stat.S_ISDIR(entry.st_mode):
        nested = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=3)
        try:
            clear(nested)
        finally:
            os.close(nested)
        os.rmdir(name, dir_fd=3)
        break
`;

export class SafeStageError extends Error {
  constructor(code) {
    super(code);
    this.name = "SafeStageError";
    this.code = SAFE_STAGE_CODE.test(code) ? code : "UNEXPECTED";
  }
}

export async function runSafeStage(code, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SafeStageError) throw error;
    throw new SafeStageError(code);
  }
}

export function formatSafeCliFailure(error, tool) {
  const code = error instanceof SafeStageError ? error.code : "UNEXPECTED";
  const prefix = SAFE_STAGE_CODE.test(tool) ? tool : "ABBOTT_TOOL";
  return `${prefix}_FAILED stage=${code}\n`;
}

export async function fetchNoRedirect(url, options, stageCode, fetchImpl = fetch) {
  return runSafeStage(stageCode, async () => {
    assertLoopbackUrl(url);
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: options?.signal ?? AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error("HTTP response rejected");
    return response;
  });
}

function assertLoopbackUrl(value, expectedPort) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new Error("LOOPBACK_ORIGIN");
  }
  const hostname = url.hostname.toLowerCase();
  const portAllowed = expectedPort === undefined
    ? ["3001", "3004"].includes(url.port)
    : url.port === String(expectedPort);
  if (url.protocol !== "http:"
    || !["127.0.0.1", "[::1]"].includes(hostname)
    || !portAllowed
    || url.username || url.password) {
    throw new Error("LOOPBACK_ORIGIN");
  }
  return url;
}

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

function assertAbbottPayloadContract(payload, audience) {
  if (!isRecord(payload) || !isRecord(payload.dashboard) || !isRecord(payload.abbott_bi)
    || !isRecord(payload.kpi) || !isRecord(payload.dashboard.period)) {
    throw new Error("PAYLOAD_CONTRACT");
  }
  if (payload.dashboard.period.from !== ABBOTT_PARITY_PERIOD.from
    || payload.dashboard.period.to !== ABBOTT_PARITY_PERIOD.to
    || payload.dashboard.type !== "abbott_bi") {
    throw new Error("PAYLOAD_CONTRACT");
  }
  const data = payload.abbott_bi;
  const kpiValues = Object.values(payload.kpi);
  const requiredArrays = audience === "embed"
    ? REQUIRED_COMMON_ARRAYS
    : [...REQUIRED_COMMON_ARRAYS, ...REQUIRED_MANAGER_ARRAYS];
  if (kpiValues.length === 0 || kpiValues.some((value) => typeof value !== "number" || !Number.isFinite(value))
    || requiredArrays.some((key) => !Array.isArray(data[key]))
    || !isRecord(data.data_quality)
    || !isRecord(data.time_buckets)
    || !Array.isArray(data.time_buckets.overall)
    || !Array.isArray(data.time_buckets.materials)
    || !Array.isArray(data.time_buckets.by_page)
    || !isRecord(data.return_frequency)
    || !Array.isArray(data.return_frequency.groups)
    || !Array.isArray(data.return_frequency.user_directions)
    || !Array.isArray(data.return_frequency.return_pages)
    || !Number.isSafeInteger(data.return_frequency.identified_visitors)
    || data.return_frequency.identified_visitors < 0
    || !Number.isSafeInteger(data.return_frequency.unidentified_visits)
    || data.return_frequency.unidentified_visits < 0
    || typeof data.return_frequency.available !== "boolean"
    || typeof data.return_frequency.period_local !== "boolean") {
    throw new Error("PAYLOAD_CONTRACT");
  }
  if (audience !== "embed" && (!isRecord(data.session_journeys) || !Array.isArray(data.session_journeys.rows)
    || !isRecord(data.admin_user_filter))) {
    throw new Error("PAYLOAD_CONTRACT");
  }
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
      const state = target[nextPath] ?? { integer: 0n, scaled: 0n, fractional: false };
      if (Number.isInteger(nested) && Number.isSafeInteger(nested)) {
        state.integer += BigInt(nested);
        state.scaled += BigInt(nested) * DECIMAL_SCALE;
      } else {
        state.fractional = true;
        state.scaled += BigInt(Math.round(nested * Number(DECIMAL_SCALE)));
      }
      target[nextPath] = state;
    } else if (Array.isArray(nested) || isRecord(nested)) {
      addNumericAggregates(nested, target, nextPath);
    }
  }
  return target;
}

function formatScaled(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / DECIMAL_SCALE;
  const fraction = String(absolute % DECIMAL_SCALE).padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function finalizeNumericAggregates(states) {
  return Object.fromEntries(Object.entries(states).sort(([left], [right]) => left.localeCompare(right)).map(([key, state]) => {
    if (state.fractional) return [key, formatScaled(state.scaled)];
    const numeric = Number(state.integer);
    return [key, Number.isSafeInteger(numeric) ? numeric : state.integer.toString()];
  }));
}

function summarizeRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    count: safeRows.length,
    stable_identifier_hashes: safeRows.map((row) => sha256(canonicalJson(identifierProjection(row)))).sort(),
    numeric_aggregates: finalizeNumericAggregates(addNumericAggregates(safeRows)),
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
  const audience = options.audience ?? "manager";
  if (audience !== "manager" && audience !== "embed") throw new Error("PAYLOAD_CONTRACT");
  assertAbbottPayloadContract(payload, audience);
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
    supplemental_totals: {
      available: data.return_frequency.available,
      identified_visitors: data.return_frequency.identified_visitors,
      period_local: data.return_frequency.period_local,
      unidentified_visits: data.return_frequency.unidentified_visits,
    },
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

function normalizeCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return { date: value.toISOString() };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid workbook number");
    return { number: Number.isInteger(value) ? String(value) : value.toString() };
  }
  if (["string", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(normalizeCellValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeCellValue(value[key])]));
  }
  return String(value);
}

export async function summarizeWorkbook(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  const sheets = workbook.worksheets.map((worksheet) => {
    const types = {};
    const formulas = [];
    const cells = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const name = cellTypeName(cell);
        types[name] = (types[name] ?? 0) + 1;
        if (cell.formula) formulas.push(sha256(String(cell.formula)));
        const semanticValue = cell.formula
          ? { formula: String(cell.formula), result: normalizeCellValue(cell.result) }
          : normalizeCellValue(cell.value);
        cells.push({
          coordinate: cell.address,
          type: name,
          content_sha256: sha256(canonicalJson(semanticValue)),
        });
      });
    });
    return {
      name: worksheet.name,
      row_count: worksheet.actualRowCount,
      cell_types: Object.fromEntries(Object.entries(types).sort(([left], [right]) => left.localeCompare(right))),
      formula_hashes: formulas.sort(),
      cells,
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

export async function createPrivateReportDirectory(outputParent, repositoryRoot = process.cwd(), options = {}) {
  return createPrivateOutputDirectory(outputParent, "abbott-runtime-parity-", repositoryRoot, options);
}

async function directoryIdentity(directory) {
  const resolved = await realpath(path.resolve(directory));
  const entry = await stat(resolved, { bigint: true });
  if (!entry.isDirectory()) throw new SafeStageError("OUTPUT_CONTAINMENT");
  return { resolved, dev: entry.dev.toString(), ino: entry.ino.toString() };
}

async function matchesDirectoryIdentity(directory, expected) {
  try {
    const current = await directoryIdentity(directory);
    return current.resolved === expected.resolved && current.dev === expected.dev && current.ino === expected.ino;
  } catch {
    return false;
  }
}

async function assertExistingAncestorsOutsideRepository(outputParent, repositoryRoot) {
  const namedParent = path.resolve(outputParent);
  const root = await realpath(path.resolve(repositoryRoot));
  const parsed = path.parse(namedParent);
  let cursor = parsed.root;
  const parts = namedParent.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const entry = await lstat(cursor).catch(() => null);
    if (!entry) throw new SafeStageError("OUTPUT_CONTAINMENT");
    const resolvedAncestor = await realpath(cursor);
    if (isWithin(root, resolvedAncestor)) throw new SafeStageError("OUTPUT_CONTAINMENT");
  }
  const identity = await directoryIdentity(namedParent);
  if (isWithin(root, identity.resolved)) throw new SafeStageError("OUTPUT_CONTAINMENT");
  return { namedParent, identity };
}

export async function createPrivateOutputDirectory(outputParent, prefix, repositoryRoot = process.cwd(), options = {}) {
  const state = await assertExistingAncestorsOutsideRepository(outputParent, repositoryRoot);
  let parentHandle = null;
  let directoryHandle = null;
  let createdIdentity = null;
  try {
    parentHandle = await open(state.identity.resolved, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const openedParent = await parentHandle.stat({ bigint: true });
    if (openedParent.dev.toString() !== state.identity.dev || openedParent.ino.toString() !== state.identity.ino) {
      throw new SafeStageError("OUTPUT_CONTAINMENT");
    }
    await options.afterValidation?.();
    const name = `${prefix}${crypto.randomBytes(12).toString("hex")}`;
    const created = await runPythonHelper(PYTHON_MKDIR_AT, [name], [parentHandle.fd]);
    const [dev, ino] = created.trim().split(" ");
    if (!/^\d+$/.test(dev) || !/^\d+$/.test(ino)) throw new SafeStageError("OUTPUT_CONTAINMENT");
    createdIdentity = { dev, ino };
    const directoryPath = path.join(state.identity.resolved, name);
    directoryHandle = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const openedDirectory = await directoryHandle.stat({ bigint: true });
    if (openedDirectory.dev.toString() !== dev || openedDirectory.ino.toString() !== ino
      || !await matchesDirectoryIdentity(state.namedParent, state.identity)) {
      throw new SafeStageError("OUTPUT_CONTAINMENT");
    }
    const outputHandle = Object.freeze({
      path: directoryPath,
      identity: Object.freeze({ realpath: directoryPath, dev, ino }),
    });
    PRIVATE_OUTPUT_STATE.set(outputHandle, {
      name,
      parentHandle,
      directoryHandle,
      parentIdentity: state.identity,
      lexicalParent: state.namedParent,
      released: false,
    });
    parentHandle = null;
    directoryHandle = null;
    return outputHandle;
  } catch (error) {
    if (createdIdentity && parentHandle) {
      await runPythonHelper(PYTHON_REMOVE_CREATED, [createdIdentity.dev, createdIdentity.ino], [parentHandle.fd]).catch(() => undefined);
    }
    await Promise.allSettled([directoryHandle?.close(), parentHandle?.close()]);
    if (error instanceof SafeStageError) throw error;
    throw new SafeStageError("OUTPUT_CONTAINMENT");
  }
}

function outputState(outputHandle) {
  const state = PRIVATE_OUTPUT_STATE.get(outputHandle);
  if (!state || state.released) throw new SafeStageError("OUTPUT_CONTAINMENT");
  return state;
}

async function retainedOutputStillNamed(outputHandle, state) {
  try {
    if (!await matchesDirectoryIdentity(state.lexicalParent, state.parentIdentity)) return false;
    const named = await stat(outputHandle.path, { bigint: true });
    return named.isDirectory()
      && named.dev.toString() === outputHandle.identity.dev
      && named.ino.toString() === outputHandle.identity.ino;
  } catch {
    return false;
  }
}

async function runPythonHelper(script, args, inheritedFds, input = Buffer.alloc(0), timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", script, ...args], {
      stdio: ["pipe", "pipe", "ignore", ...inheritedFds],
    });
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new SafeStageError("OUTPUT_HELPER"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 256) chunks.push(chunk);
      else child.kill("SIGKILL");
    });
    child.stdin.on("error", () => undefined);
    child.on("error", () => finish(new SafeStageError("OUTPUT_HELPER")));
    child.on("close", (code) => finish(code === 0 ? null : new SafeStageError("OUTPUT_HELPER"), Buffer.concat(chunks).toString("utf8")));
    child.stdin.end(input);
  });
}

export async function writePrivateExclusiveFile(outputHandle, filename, contents, options = {}) {
  if (typeof filename !== "string" || filename !== path.basename(filename) || filename === "." || filename === "..") {
    throw new SafeStageError("OUTPUT_WRITE");
  }
  const state = outputState(outputHandle);
  try {
    if (!await retainedOutputStillNamed(outputHandle, state)) throw new SafeStageError("OUTPUT_CONTAINMENT");
    await options.beforeOpen?.();
    await runPythonHelper(PYTHON_WRITE_AT, [filename], [state.directoryHandle.fd], Buffer.from(contents));
    if (!await retainedOutputStillNamed(outputHandle, state)) throw new SafeStageError("OUTPUT_CONTAINMENT");
    return path.join(outputHandle.path, filename);
  } catch (error) {
    if (error instanceof SafeStageError && error.code === "OUTPUT_CONTAINMENT") throw error;
    throw new SafeStageError("OUTPUT_WRITE");
  }
}

export async function releasePrivateOutputDirectory(outputHandle) {
  const state = outputState(outputHandle);
  state.released = true;
  const results = await Promise.allSettled([state.directoryHandle.close(), state.parentHandle.close()]);
  if (results.some((result) => result.status === "rejected")) throw new SafeStageError("OUTPUT_RELEASE");
}

export async function cleanupPrivateOutputDirectory(outputHandle) {
  const state = outputState(outputHandle);
  state.released = true;
  const cleanup = runPythonHelper(
    PYTHON_CLEAN_OUTPUT,
    [outputHandle.identity.dev, outputHandle.identity.ino],
    [state.parentHandle.fd, state.directoryHandle.fd],
    Buffer.alloc(0),
    6_000,
  );
  const results = await Promise.allSettled([cleanup, state.directoryHandle.close(), state.parentHandle.close()]);
  if (results.some((result) => result.status === "rejected")) throw new SafeStageError("OUTPUT_CLEANUP");
}

export async function writeParityReport(directory, report, options = {}) {
  return runSafeStage("OUTPUT_WRITE", async () => {
    const text = `${JSON.stringify(canonicalize(report), null, 2)}\n`;
    if (FORBIDDEN_REPORT_TEXT.test(text)) throw new Error("forbidden");
    return writePrivateExclusiveFile(directory, REPORT_NAME, text, options);
  });
}

export function assertRuntimeBaseUrl(value, expectedPort) {
  const url = assertLoopbackUrl(value, expectedPort);
  if (url.search || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("LOOPBACK_ORIGIN");
  }
  return url.origin;
}

export function buildAuthorizedRequest(base, endpoint, credential) {
  const baseUrl = assertLoopbackUrl(base);
  const url = new URL(endpoint, `${baseUrl.origin}/`);
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

export async function obtainManagerToken(referenceBase, password) {
  const origin = assertRuntimeBaseUrl(referenceBase, 3001);
  const response = await fetchNoRedirect(new URL("/api/dashboard-auth/login", `${origin}/`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dashboard_id: "18", password }),
  }, "MANAGER_AUTHORIZATION");
  const body = await runSafeStage("MANAGER_AUTHORIZATION_JSON", () => response.json());
  if (!body || typeof body.access_token !== "string" || !body.access_token) {
    throw new SafeStageError("MANAGER_AUTHORIZATION_RESPONSE");
  }
  return body.access_token;
}

async function fetchAudienceSummary(base, audience, credential) {
  const payloadRequest = buildAuthorizedRequest(base, "/api/dashboard/18", credential);
  const payloadResponse = await fetchNoRedirect(
    payloadRequest.url,
    { ...payloadRequest.options, cache: "no-store" },
    `${audience.toUpperCase()}_PAYLOAD_FETCH`,
  );
  const payload = await runSafeStage(`${audience.toUpperCase()}_PAYLOAD_JSON`, () => payloadResponse.json());
  let administratorExclusionCount = null;
  if (audience === "manager") {
    const adminRequest = buildAuthorizedRequest(base, "/api/dashboard/18/abbott-admin-users", credential);
    const adminResponse = await fetchNoRedirect(
      adminRequest.url,
      { ...adminRequest.options, cache: "no-store" },
      "MANAGER_ADMIN_FETCH",
    );
    const body = await runSafeStage("MANAGER_ADMIN_JSON", () => adminResponse.json());
    if (!body || !Array.isArray(body.user_ids)) throw new SafeStageError("MANAGER_ADMIN_RESPONSE");
    administratorExclusionCount = body.user_ids.length;
  }
  const workbookRequest = buildAuthorizedRequest(base, "/api/dashboard/18/excel", credential);
  const workbookResponse = await fetchNoRedirect(
    workbookRequest.url,
    { ...workbookRequest.options, cache: "no-store" },
    `${audience.toUpperCase()}_WORKBOOK_FETCH`,
  );
  return {
    payload: await runSafeStage(`${audience.toUpperCase()}_PAYLOAD_CONTRACT`, () => summarizeAbbottPayload(payload, { administratorExclusionCount, audience })),
    workbook: await runSafeStage(`${audience.toUpperCase()}_WORKBOOK_PARSE`, async () => summarizeWorkbook(Buffer.from(await workbookResponse.arrayBuffer()))),
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
  const options = await runSafeStage("ARGUMENTS", () => parseArgs(process.argv.slice(2)));
  const { referenceBase, candidateBase } = await runSafeStage("ORIGIN_VALIDATION", () => ({
    referenceBase: assertRuntimeBaseUrl(options.reference, 3001),
    candidateBase: assertRuntimeBaseUrl(options.candidate, 3004),
  }));
  const credentials = await runSafeStage("CREDENTIAL_INPUT", () => readCredentialFd(options.credentialsFd));
  const report = await runSafeStage("PARITY_EXECUTION", () => runParityComparison({ referenceBase, candidateBase, ...credentials }));
  const directory = await runSafeStage("OUTPUT_CREATE", () => createPrivateReportDirectory(options.outputParent));
  try {
    await writeParityReport(directory, report);
    await releasePrivateOutputDirectory(directory);
  } catch (error) {
    await cleanupPrivateOutputDirectory(directory).catch(() => undefined);
    throw error;
  }
  process.stdout.write(`status=${report.status} mismatches=${report.mismatch_count} report=created\n`);
  if (report.status !== "match") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(formatSafeCliFailure(error, "ABBOTT_PARITY"));
    process.exitCode = 1;
  });
}

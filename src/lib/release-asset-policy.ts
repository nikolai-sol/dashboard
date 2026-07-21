import { lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const PROHIBITED_SOURCE_SUFFIXES = [
  ".json",
  ".xlsx",
  ".xls",
  ".csv",
  ".sql",
  ".zip",
  ".tar",
  ".tar.gz",
  ".tgz",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
] as const;

const SAFE_ABBOTT_MIGRATIONS = new Set([
  "src/db/migrations/019_dashboard_abbott_bi_type.sql",
  "src/db/migrations/033_abbott_canonical_release_control.sql",
]);

const INSPECTED_DATA_SUFFIXES = [".json", ".jsonl", ".csv", ".tsv", ".xlsx", ".xls"] as const;
const MAX_INSPECTED_DATA_BYTES = 8 * 1024 * 1024;
const PRIVATE_KEYS = new Set([
  "raw_user_id",
  "protected_visit_id",
  "visit_id",
  "source_event_id",
]);
const BITRIX_EXPORT_KEY_SETS = [
  ["session_id", "user_id", "page_url"],
  ["protected_visit_id", "event_sequence", "normalized_path"],
] as const;
const METRIKA_LOGS_VISIT_KEYS = ["visit_id", "client_id", "start_url", "end_url"] as const;

function isProhibitedAbbottAsset(relativePath: string) {
  const normalized = relativePath.split(path.sep).join("/").toLowerCase();
  return normalized.includes("abbott") && PROHIBITED_SOURCE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function normalizedRelativePath(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function normalizedKey(value: string): string {
  const trimmed = value.trim();
  const metrikaField = /^ym:s:(.+)$/i.exec(trimmed)?.[1];
  const unprefixed = metrikaField
    ? metrikaField.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    : trimmed;
  return unprefixed.toLowerCase().replace(/[\s-]+/g, "_");
}

function hasPrivateKeys(keys: Iterable<string>): boolean {
  const normalized = new Set(Array.from(keys, normalizedKey));
  if ([...PRIVATE_KEYS].some((key) => normalized.has(key))) return true;
  if (METRIKA_LOGS_VISIT_KEYS.every((key) => normalized.has(key))) return true;
  return BITRIX_EXPORT_KEY_SETS.some((required) => required.every((key) => normalized.has(key)));
}

function jsonHasPrivateStructure(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current && typeof current === "object") {
      const entries = Object.entries(current as Record<string, unknown>);
      if (hasPrivateKeys(entries.map(([key]) => key))) return true;
      pending.push(...entries.map(([, nested]) => nested));
    }
  }
  return false;
}

function isAbbottUserDirectionMapping(value: unknown): boolean {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const rows = (value as Record<string, unknown>).id;
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((row) => {
    if (!row || Array.isArray(row) || typeof row !== "object") return false;
    const record = row as Record<string, unknown>;
    const rawUserId = record.id;
    if (rawUserId === null || rawUserId === undefined || String(rawUserId).trim() === "") return false;
    if (typeof rawUserId === "number" && !Number.isSafeInteger(rawUserId)) return false;
    return record.direction !== null
      && record.direction !== undefined
      && String(record.direction).trim() !== "";
  });
}

function inspectTextData(extension: string, bytes: Buffer): boolean {
  const text = bytes.toString("utf8");
  if (extension === ".json") {
    const parsed = JSON.parse(text);
    return isAbbottUserDirectionMapping(parsed) || jsonHasPrivateStructure(parsed);
  }
  if (extension === ".jsonl") {
    return text.split(/\r?\n/).filter((line) => line.trim()).some((line) => jsonHasPrivateStructure(JSON.parse(line)));
  }
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    delimiter: extension === ".tsv" ? "\t" : ",",
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0 || !parsed.meta.fields) throw new Error("malformed delimited data");
  return hasPrivateKeys(parsed.meta.fields);
}

function inspectSpreadsheet(extension: string, bytes: Buffer): boolean {
  if (extension === ".xlsx" && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new Error("malformed workbook");
  }
  if (extension === ".xls" && !bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new Error("malformed workbook");
  }
  const workbook = XLSX.read(bytes, { type: "buffer", sheetRows: 10_000 });
  if (workbook.SheetNames.length === 0) throw new Error("workbook has no sheets");
  return workbook.SheetNames.some((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("workbook sheet is missing");
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    return rows.some((row) => hasPrivateKeys(Object.keys(row)));
  });
}

function hasPrivateDataSignature(absolutePath: string, relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const extension = INSPECTED_DATA_SUFFIXES.find((suffix) => lower.endsWith(suffix));
  if (!extension) return false;
  const size = statSync(absolutePath).size;
  if (size > MAX_INSPECTED_DATA_BYTES) throw new Error("candidate data exceeds inspection bound");
  const bytes = readFileSync(absolutePath);
  return extension === ".xlsx" || extension === ".xls"
    ? inspectSpreadsheet(extension, bytes)
    : inspectTextData(extension, bytes);
}

function isAllowedGeneratedReleaseSymlink(root: string, absolutePath: string, relativePath: string) {
  const match = /^\.next\/node_modules\/(rimraf|puppeteer)-[a-f0-9]+$/.exec(relativePath);
  if (!match) return false;
  const target = path.resolve(path.dirname(absolutePath), readlinkSync(absolutePath));
  return normalizedRelativePath(root, target) === `node_modules/${match[1]}`;
}

function scanTree(
  root: string,
  isProhibited: (absolutePath: string, relativePath: string) => boolean,
  isAllowedSymlink: (absolutePath: string, relativePath: string) => boolean = () => false,
): string[] {
  const matches: string[] = [];

  try {
    if (lstatSync(root).isSymbolicLink()) return ["."];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  function visit(directory: string) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizedRelativePath(root, absolutePath);
      if (entry.isSymbolicLink()) {
        if (!isAllowedSymlink(absolutePath, relativePath)) matches.push(relativePath);
      } else if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        try {
          if (isProhibited(absolutePath, relativePath)) matches.push(relativePath);
        } catch {
          matches.push(relativePath);
        }
      }
    }
  }

  visit(root);
  return matches.sort();
}

export function findForbiddenPublicAssets(publicRoot: string): string[] {
  return scanTree(publicRoot, (_absolutePath, relativePath) => isProhibitedAbbottAsset(relativePath));
}

export function findPrivateReleaseAssets(releaseRoot: string): string[] {
  return scanTree(
    releaseRoot,
    (absolutePath, relativePath) => {
      if (SAFE_ABBOTT_MIGRATIONS.has(relativePath)) return false;
      return isProhibitedAbbottAsset(relativePath) || hasPrivateDataSignature(absolutePath, relativePath);
    },
    (absolutePath, relativePath) => isAllowedGeneratedReleaseSymlink(releaseRoot, absolutePath, relativePath),
  );
}

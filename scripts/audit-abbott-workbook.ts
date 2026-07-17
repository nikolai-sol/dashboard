#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { buildAbbottCatalogAudit, parseAbbottWorkbookCatalog } from "../src/lib/abbott-workbook-catalog";

interface AuditCliOptions {
  workbookXlsxPath: string;
  outputPath: string;
}

const FORBIDDEN_ROOT_SEGMENTS = new Set([
  ".next",
  "build",
  "dashboard-releases",
  "dist",
  "htdocs",
  "public",
  "public_html",
  "releases",
  "standalone",
  "static",
  "www",
  "wwwroot",
]);

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function assertOutsideGitRoots(resolvedPath: string): void {
  let directory = path.dirname(resolvedPath);
  while (true) {
    try {
      lstatSync(path.join(directory, ".git"));
      throw new Error("Audit path must be outside Git roots");
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

function privatePath(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} requires an explicit path`);
  let existingAncestor = path.resolve(value);
  const missingSegments: string[] = [];
  while (true) {
    try {
      lstatSync(existingAncestor);
      break;
    } catch (error) {
      if (!isMissingPathError(error)) throw new Error(`${label} could not be verified`);
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw new Error(`${label} could not be verified`);
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
  const resolved = path.join(realpathSync.native(existingAncestor), ...missingSegments);
  if (resolved.split(path.sep).some((segment) => FORBIDDEN_ROOT_SEGMENTS.has(segment.toLowerCase()))) {
    throw new Error(`${label} must not be under a web or release root`);
  }
  assertOutsideGitRoots(resolved);
  return resolved;
}

function parseArgs(argv: readonly string[]): AuditCliOptions {
  if (argv.length !== 4) throw new Error("Audit requires exactly two options");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !["--workbook-xlsx", "--output"].includes(flag) || value.startsWith("--")) {
      throw new Error("Audit option is invalid");
    }
    if (values.has(flag)) throw new Error("Audit option is duplicated");
    values.set(flag, value);
  }
  const workbookXlsxPath = values.get("--workbook-xlsx");
  const outputPath = values.get("--output");
  if (!workbookXlsxPath || !outputPath) throw new Error("Audit options are incomplete");
  return {
    workbookXlsxPath: privatePath(workbookXlsxPath, "workbook XLSX"),
    outputPath: privatePath(outputPath, "audit output"),
  };
}

async function writeAuditAtomically(outputPath: string, value: unknown): Promise<void> {
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(outputDir, `.${path.basename(outputPath)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const sourceStat = await stat(options.workbookXlsxPath);
    if (!sourceStat.isFile()) throw new Error("Workbook source must be a file");
    const workbook = await readFile(options.workbookXlsxPath);
    const parsed = parseAbbottWorkbookCatalog(workbook);
    await writeAuditAtomically(options.outputPath, buildAbbottCatalogAudit(parsed.rows));
    process.stdout.write("Abbott workbook audit complete\n");
  } catch {
    process.stderr.write("Abbott workbook audit failed\n");
    process.exitCode = 1;
  }
}

void main();

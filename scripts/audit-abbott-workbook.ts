#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { buildAbbottCatalogAudit, parseAbbottWorkbookCatalog } from "../src/lib/abbott-workbook-catalog";

interface AuditCliOptions {
  workbookXlsxPath: string;
  outputPath: string;
}

function privatePath(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} requires an explicit path`);
  let existingAncestor = path.resolve(value);
  const missingSegments: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const resolved = path.join(realpathSync.native(existingAncestor), ...missingSegments);
  if (resolved.split(path.sep).some((segment) => segment.toLowerCase() === "public")) {
    throw new Error(`${label} must not be under a web root`);
  }
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

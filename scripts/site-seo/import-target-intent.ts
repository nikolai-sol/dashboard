import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TargetIntentRule } from "@reportingdash/site-seo-contract";
import { normalizeIntentKey } from "../../apps/site-seo/src/lib/target-intent.ts";

type JsonRecord = Record<string, unknown>;

export type TargetIntentImportArgs = Readonly<{
  profilePath: string;
  seedPath: string;
  extensionsPath: string;
  action: "preview" | "apply";
  intentManifestPath?: string;
}>;

export type MedRocheTargetIntentPreview = Readonly<{
  schemaVersion: 1;
  kind: "site_seo_target_intent_publication_preview";
  previewOnly: true;
  scope: Readonly<{ siteId: string; dashboardId: number }>;
  label: string;
  ruleCount: number;
  rulesSha256: string;
  provenance: Readonly<{
    historicalWorkbookFilename: string;
    historicalWorkbookSheet: string;
    historicalWorkbookSha256: string;
    historicalExpertRowCount: number;
    historicalExpertGroupCount: number;
    seedFixtureSha256: string;
    extensionsFixtureSha256: string;
    reviewReference: string;
  }>;
  rules: readonly TargetIntentRule[];
}>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be non-empty text`);
  return value.trim();
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseTargetIntentImportArgs(args: readonly string[]): TargetIntentImportArgs {
  const parsed: Partial<TargetIntentImportArgs> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--profile") parsed.profilePath = requiredValue(args, index++, flag);
    else if (flag === "--seed") parsed.seedPath = requiredValue(args, index++, flag);
    else if (flag === "--extensions") parsed.extensionsPath = requiredValue(args, index++, flag);
    else if (flag === "--intent-manifest") parsed.intentManifestPath = requiredValue(args, index++, flag);
    else if (flag === "--preview") parsed.action = "preview";
    else if (flag === "--apply") parsed.action = "apply";
    else throw new Error(`unexpected argument: ${flag}`);
  }
  if (!parsed.profilePath || !parsed.seedPath || !parsed.extensionsPath || !parsed.action) {
    throw new Error("--profile, --seed, --extensions and exactly one of --preview/--apply are required");
  }
  if (parsed.action === "apply" && !parsed.intentManifestPath) {
    throw new Error("--apply requires an explicit --intent-manifest");
  }
  return parsed as TargetIntentImportArgs;
}

export function buildMedRocheTargetIntentPreview(input: Readonly<{
  profile: unknown;
  seed: unknown;
  extensions: unknown;
}>): MedRocheTargetIntentPreview {
  const profile = record(input.profile, "profile");
  const seed = record(input.seed, "seed");
  const extensions = record(input.extensions, "extensions");
  const siteId = text(profile.siteId, "profile.siteId");
  const dashboardId = Number(profile.dashboardId);
  if (siteId !== "site-medroche" || !Number.isInteger(dashboardId) || dashboardId <= 0) {
    throw new Error("MedRoche migration preview requires the registered MedRoche scope");
  }
  if (!Array.isArray(seed.queries) || seed.queries.length !== 802) throw new Error("historical expert seed must contain exactly 802 rows");
  if (!Array.isArray(extensions.rules) || !Array.isArray(extensions.exactSeedKeys)) throw new Error("reviewed extension fixture is invalid");

  const exactSeedKeys = new Set(extensions.exactSeedKeys.map((value, index) => normalizeIntentKey(text(value, `exactSeedKeys[${index}]`))));
  const rules: TargetIntentRule[] = seed.queries.map((value, index) => {
    const row = record(value, `seed.queries[${index}]`);
    const key = text(row.query, `seed.queries[${index}].query`);
    const normalizedKey = normalizeIntentKey(key);
    return {
      key,
      normalizedKey,
      group: text(row.group, `seed.queries[${index}].group`),
      matchType: exactSeedKeys.has(normalizedKey) ? "exact" : "phrase",
    };
  });
  for (const [index, value] of extensions.rules.entries()) {
    const row = record(value, `extensions.rules[${index}]`);
    const key = text(row.key, `extensions.rules[${index}].key`);
    const matchType = text(row.matchType, `extensions.rules[${index}].matchType`);
    if (matchType !== "exact" && matchType !== "phrase") throw new Error(`extensions.rules[${index}].matchType is invalid`);
    rules.push({ key, normalizedKey: normalizeIntentKey(key), group: text(row.group, `extensions.rules[${index}].group`), matchType });
  }
  const identities = new Set<string>();
  for (const rule of rules) {
    if (!rule.normalizedKey || identities.has(rule.normalizedKey)) throw new Error(`duplicate normalized target-intent rule: ${rule.normalizedKey}`);
    identities.add(rule.normalizedKey);
  }
  const groups = new Set(seed.queries.map((value, index) => text(record(value, `seed.queries[${index}]`).group, `seed.queries[${index}].group`)));
  const historicalSha = text(seed.sourceSha256, "seed.sourceSha256");
  if (!/^[a-f0-9]{64}$/i.test(historicalSha)) throw new Error("historical workbook SHA-256 is invalid");
  return {
    schemaVersion: 1,
    kind: "site_seo_target_intent_publication_preview",
    previewOnly: true,
    scope: { siteId, dashboardId },
    label: text(extensions.label, "extensions.label"),
    ruleCount: rules.length,
    rulesSha256: sha256(rules),
    provenance: {
      historicalWorkbookFilename: text(seed.sourceFilename, "seed.sourceFilename"),
      historicalWorkbookSheet: text(seed.sourceSheet, "seed.sourceSheet"),
      historicalWorkbookSha256: historicalSha,
      historicalExpertRowCount: seed.queries.length,
      historicalExpertGroupCount: groups.size,
      seedFixtureSha256: sha256(seed),
      extensionsFixtureSha256: sha256(extensions),
      reviewReference: text(extensions.reviewReference, "extensions.reviewReference"),
    },
    rules,
  };
}

export type TargetIntentImportDependencies = Readonly<{
  readJson(filename: string): Promise<unknown>;
  write(value: string): void;
}>;

export async function runTargetIntentImportCli(
  argv: readonly string[],
  dependencies: TargetIntentImportDependencies,
): Promise<Readonly<{ status: "preview"; manifest: MedRocheTargetIntentPreview }>> {
  const args = parseTargetIntentImportArgs(argv);
  const [profile, seed, extensions] = await Promise.all([
    dependencies.readJson(args.profilePath),
    dependencies.readJson(args.seedPath),
    dependencies.readJson(args.extensionsPath),
  ]);
  const manifest = buildMedRocheTargetIntentPreview({ profile, seed, extensions });
  if (args.action === "apply") {
    const intent = record(await dependencies.readJson(args.intentManifestPath!), "intent manifest");
    if (intent.kind !== "initial" && intent.kind !== "correction") throw new Error("intent manifest kind must be initial or correction");
    throw new Error("applying target intent is outside this preview-only command; use the reviewed administrator publication workflow");
  }
  dependencies.write(`${JSON.stringify({ status: "preview", ...manifest })}\n`);
  return { status: "preview", manifest };
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(path.resolve(filename), "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTargetIntentImportCli(process.argv.slice(2), { readJson, write: (value) => process.stdout.write(value) })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "target-intent preview failed"}\n`);
      process.exitCode = 1;
    });
}

#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

import {
  assertImportManifest,
  assertSiteRegistry,
  type ImportManifest,
  type SiteRegistration,
} from "../../packages/site-seo-contract/src/index";
import {
  parseAliceVisibilityWorkbookFile,
  type ParsedAliceVisibilitySnapshot,
} from "../../src/lib/zaruku-alice-visibility-import";
import {
  persistAliceVisibilitySnapshot,
  resolveAliceVisibilityDbConfig,
  type AliceVisibilityImportConnection,
  type AliceVisibilityPersistResult,
} from "../import-zaruku-alice-visibility";

type AdapterArgs = {
  manifestPath: string;
  accountId: string;
  domain: string;
  action: "preview" | "publish";
  previewId?: string;
  intentPath?: string;
};

type AliceAdapterManifest = {
  registry: readonly SiteRegistration[];
  importManifest: ImportManifest;
  alice: {
    xlsxPath: string;
    officialSovPct: number;
    capturedAt: string;
    featuredSites: string[];
  };
};

export type AliceImportPreview = {
  previewId: string;
  accountId: string;
  domain: string;
  period: string;
  officialSovPct: number;
  samplePresencePct: number;
  exportedQueryCount: number;
  portalPresentQueryCount: number;
  citationCount: number;
  sourceSha256: string;
};

export type AliceAdapterDependencies = {
  readManifest(path: string): Promise<unknown>;
  parseWorkbook(
    path: string,
    input: Parameters<typeof parseAliceVisibilityWorkbookFile>[1],
  ): Promise<ParsedAliceVisibilitySnapshot>;
  connect(): Promise<unknown>;
  persist(
    connection: unknown,
    snapshot: ParsedAliceVisibilitySnapshot,
    options: Parameters<typeof persistAliceVisibilitySnapshot>[2],
  ): Promise<AliceVisibilityPersistResult>;
  write(value: string): void;
};

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseAliceAdapterArgs(args: string[]): AdapterArgs {
  const parsed: Partial<AdapterArgs> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--manifest") {
      parsed.manifestPath = requiredValue(args, index, flag);
      index += 1;
    } else if (flag === "--account-id") {
      parsed.accountId = requiredValue(args, index, flag);
      index += 1;
    } else if (flag === "--domain") {
      parsed.domain = requiredValue(args, index, flag);
      index += 1;
    } else if (flag === "--preview") parsed.action = "preview";
    else if (flag === "--publish") parsed.action = "publish";
    else if (flag === "--preview-id") {
      parsed.previewId = requiredValue(args, index, flag);
      index += 1;
    } else if (flag === "--intent") {
      parsed.intentPath = requiredValue(args, index, flag);
      index += 1;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!parsed.manifestPath || !parsed.accountId || !parsed.domain || !parsed.action) {
    throw new Error("--manifest, --account-id, --domain and one action are required");
  }
  if (parsed.action === "publish" && (!parsed.previewId || !parsed.intentPath)) {
    throw new Error("--publish requires --preview-id and --intent");
  }
  return parsed as AdapterArgs;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizedDomain(value: string): string {
  const text = value.trim().toLowerCase().replace(/\.$/, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))+$/.test(text)) {
    throw new Error("domain must be a hostname without a URL path");
  }
  return text;
}

function parseAdapterManifest(value: unknown): AliceAdapterManifest {
  const input = record(value, "manifest");
  const registry = assertSiteRegistry(input.registry);
  const importManifest = assertImportManifest(input.importManifest);
  const alice = record(input.alice, "alice");
  const xlsxPath = String(alice.xlsxPath ?? "").trim();
  const capturedAt = String(alice.capturedAt ?? "").trim();
  const officialSovPct = Number(alice.officialSovPct);
  if (!path.isAbsolute(xlsxPath)) throw new Error("alice.xlsxPath must be absolute");
  if (!capturedAt) throw new Error("alice.capturedAt is required");
  if (!Number.isFinite(officialSovPct) || officialSovPct < 0 || officialSovPct > 100) {
    throw new Error("alice.officialSovPct must be between 0 and 100");
  }
  if (!Array.isArray(alice.featuredSites)) throw new Error("alice.featuredSites must be an array");
  return {
    registry,
    importManifest,
    alice: {
      xlsxPath,
      capturedAt,
      officialSovPct,
      featuredSites: alice.featuredSites.map(String),
    },
  };
}

export function assertAliceManifestBinding(
  value: unknown,
  accountId: string,
  domain: string,
): AliceAdapterManifest {
  const input = parseAdapterManifest(value);
  const scope = input.importManifest.scope;
  const expectedDomain = normalizedDomain(domain);
  if (scope.sourceKey !== "yandex_webmaster_alice_manual") {
    throw new Error("manifest source binding is not Alice manual visibility");
  }
  if (scope.analyticsAccountId !== accountId) {
    throw new Error("account-id does not match the server binding");
  }
  const registration = input.registry.find(
    ({ profile }) =>
      profile.clientId === scope.clientId &&
      profile.siteId === scope.siteId &&
      profile.dashboardId === scope.dashboardId,
  );
  if (!registration || normalizedDomain(registration.profile.domain) !== expectedDomain) {
    throw new Error("domain does not match the server binding");
  }
  const source = registration.profile.sources.find(
    (candidate) => candidate.sourceKey === scope.sourceKey,
  );
  const binding = registration.bindings.find(
    (candidate) =>
      candidate.sourceKey === scope.sourceKey &&
      candidate.clientId === scope.clientId &&
      candidate.siteId === scope.siteId &&
      candidate.dashboardId === scope.dashboardId &&
      candidate.analyticsAccountId === scope.analyticsAccountId &&
      candidate.resourceId === scope.resourceId &&
      candidate.bindingId === source?.bindingId,
  );
  if (!source || source.mode !== "manual" || !binding) {
    throw new Error("Alice source does not match the server binding");
  }
  const accountDomains = new Set<string>();
  for (const candidate of input.registry) {
    if (
      candidate.bindings.some(
        (item) =>
          item.sourceKey === "yandex_webmaster_alice_manual" &&
          item.analyticsAccountId === accountId,
      )
    ) {
      accountDomains.add(normalizedDomain(candidate.profile.domain));
    }
  }
  if (accountDomains.size !== 1) {
    throw new Error(
      "account-month storage supports one portal domain; expand the key before binding more",
    );
  }
  return input;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createAlicePreview(
  value: unknown,
  snapshot: ParsedAliceVisibilitySnapshot,
): AliceImportPreview {
  const input = assertAliceManifestBinding(value, snapshot.accountId, snapshot.portalDomain);
  const manifest = input.importManifest;
  if (manifest.period.kind !== "calendar_month" || manifest.period.key !== snapshot.period) {
    throw new Error("Alice snapshot month does not match the manifest period");
  }
  if (snapshot.officialSovPct !== input.alice.officialSovPct) {
    throw new Error("official SOV does not match the manifest");
  }
  if (
    manifest.sourceFiles.length !== 1 ||
    manifest.sourceFiles[0]!.sha256 !== snapshot.sourceSha256 ||
    manifest.sourceFiles[0]!.name !== snapshot.sourceFilename
  ) {
    throw new Error("Alice source file does not match the manifest bytes");
  }
  const previewId = createHash("sha256")
    .update(
      stableJson({
        scope: manifest.scope,
        period: manifest.period,
        filters: manifest.filters,
        adapterVersion: manifest.adapterVersion,
        sourceSha256: snapshot.sourceSha256,
      }),
    )
    .digest("hex");
  return {
    previewId,
    accountId: snapshot.accountId,
    domain: snapshot.portalDomain,
    period: snapshot.period,
    officialSovPct: snapshot.officialSovPct,
    samplePresencePct: snapshot.samplePresencePct,
    exportedQueryCount: snapshot.exportedQueryCount,
    portalPresentQueryCount: snapshot.portalPresentQueryCount,
    citationCount: snapshot.sources.length,
    sourceSha256: snapshot.sourceSha256,
  };
}

async function defaultReadManifest(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function defaultConnect(): Promise<unknown> {
  const config = resolveAliceVisibilityDbConfig(process.env);
  return mysql.createConnection({ ...config, charset: "utf8mb4", dateStrings: true });
}

const defaultDependencies: AliceAdapterDependencies = {
  readManifest: defaultReadManifest,
  parseWorkbook: parseAliceVisibilityWorkbookFile,
  connect: defaultConnect,
  persist: (connection, snapshot, options) =>
    persistAliceVisibilitySnapshot(
      connection as AliceVisibilityImportConnection,
      snapshot,
      options,
    ),
  write: (value) => process.stdout.write(value),
};

export async function runAliceImportAdapterCli(
  argv: string[] = process.argv.slice(2),
  dependencies: AliceAdapterDependencies = defaultDependencies,
): Promise<{ status: string; preview: AliceImportPreview }> {
  const args = parseAliceAdapterArgs(argv);
  const rawManifest = await dependencies.readManifest(args.manifestPath);
  const input = assertAliceManifestBinding(rawManifest, args.accountId, args.domain);
  const snapshot = await dependencies.parseWorkbook(input.alice.xlsxPath, {
    accountId: args.accountId,
    portalDomain: normalizedDomain(args.domain),
    period: input.importManifest.period.key,
    officialSovPct: input.alice.officialSovPct,
    capturedAt: input.alice.capturedAt,
    sourceFilename: path.basename(input.alice.xlsxPath),
    featuredSites: input.alice.featuredSites,
  });
  const preview = createAlicePreview(rawManifest, snapshot);
  if (args.action === "preview") {
    dependencies.write(`${JSON.stringify({ status: "preview", ...preview })}\n`);
    return { status: "preview", preview };
  }
  if (args.previewId !== preview.previewId) {
    throw new Error("preview-id does not match the manifest and workbook bytes");
  }
  const intent = record(await dependencies.readManifest(args.intentPath!), "intent");
  if (intent.kind !== "initial" && intent.kind !== "correction") {
    throw new Error("intent.kind must be initial or correction");
  }
  let supersedeSnapshotId: number | undefined;
  let ownerDecisionId: string | undefined;
  if (intent.kind === "correction") {
    supersedeSnapshotId = Number(intent.predecessorImportId);
    ownerDecisionId = String(intent.ownerDecisionId ?? "").trim();
    if (!Number.isSafeInteger(supersedeSnapshotId) || supersedeSnapshotId <= 0 || !ownerDecisionId) {
      throw new Error("correction requires predecessorImportId and ownerDecisionId");
    }
  }
  const connection = await dependencies.connect();
  try {
    const status = await dependencies.persist(connection, snapshot, {
      sourceKey: "yandex_webmaster_alice_manual",
      supersedeSnapshotId,
      sourcePayloadJson: {
        manual_import: {
          preview_id: preview.previewId,
          owner_decision_id: ownerDecisionId ?? null,
          scope: input.importManifest.scope,
        },
      },
    });
    dependencies.write(`${JSON.stringify({ status, ...preview })}\n`);
    return { status, preview };
  } finally {
    const closable = connection as { end?: () => Promise<unknown> };
    if (closable.end) await closable.end();
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  runAliceImportAdapterCli().catch((error) => {
    process.stderr.write(
      `Alice import adapter failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}

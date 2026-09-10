import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedAliceVisibilitySnapshot } from "../../src/lib/zaruku-alice-visibility-import";
import { parseCliArgs as parseZarukuCliArgs } from "../import-zaruku-alice-visibility";
import {
  assertAliceManifestBinding,
  createAlicePreview,
  parseAliceAdapterArgs,
  runAliceImportAdapterCli,
  type AliceAdapterDependencies,
} from "./import-alice";

const sha = "a".repeat(64);

function manifest(options: { clientId?: string; accountId?: string; month?: string } = {}) {
  const clientId = options.clientId ?? "fixture-client";
  const accountId = options.accountId ?? "fixture-alice-account";
  const month = options.month ?? "2026-08";
  const monthEnd = month.endsWith("-09") ? "30" : "31";
  const scope = {
    clientId,
    siteId: `${clientId}-site`,
    dashboardId: clientId === "fixture-client" ? 9001 : 9002,
    sourceKey: "yandex_webmaster_alice_manual" as const,
    analyticsAccountId: accountId,
    resourceId: "fixture.example",
  };
  return {
    registry: [
      {
        profile: {
          schemaVersion: 1 as const,
          profileVersion: "fixture.v1",
          siteId: scope.siteId,
          clientId,
          dashboardId: scope.dashboardId,
          slug: scope.siteId,
          domain: "fixture.example",
          allowedDomains: ["fixture.example"],
          title: "Fixture",
          logoAsset: null,
          locale: "en",
          businessTimezone: "Europe/Vienna",
          templateVersion: "fixture.v1",
          sources: [
            {
              sourceKey: "yandex_webmaster_alice_manual" as const,
              mode: "manual" as const,
              bindingId: `${clientId}-alice-binding`,
              importCadence: ["previous_month" as const],
            },
          ],
          taxonomyVersion: "fixture.v1",
          seoRulesVersion: "fixture.v1",
          authPolicyRef: "fixture",
          runtime: {
            route: "/fixture",
            assetPrefix: "/fixture",
            buildOutputDir: ".next-fixture",
            processName: "fixture",
            port: scope.dashboardId,
            deployPath: "/var/www/fixture",
            releaseBranch: "release/fixture",
            deployLockPath: "/var/www/fixture.lock",
          },
        },
        bindings: [{ ...scope, bindingId: `${clientId}-alice-binding` }],
      },
    ],
    importManifest: {
      scope,
      period: {
        kind: "calendar_month" as const,
        from: `${month}-01`,
        to: `${month}-${monthEnd}`,
        key: month,
        sourceTimezone: "Europe/Vienna",
      },
      filters: {},
      sourceFiles: [{ name: "alice.xlsx", sha256: sha }],
      adapterVersion: "alice-adapter.v1",
      exportedAt: null,
    },
    alice: {
      xlsxPath: "/tmp/alice.xlsx",
      officialSovPct: 17.5,
      capturedAt: `${month}-${monthEnd}T12:00:00+02:00`,
      featuredSites: [],
    },
  };
}

function snapshot(overrides: Record<string, unknown> = {}): ParsedAliceVisibilitySnapshot {
  return {
    accountId: "fixture-alice-account",
    portalDomain: "fixture.example",
    period: "2026-08",
    officialSovPct: 17.5,
    capturedAt: "2026-08-31T12:00:00+02:00",
    sourceFilename: "alice.xlsx",
    featuredSites: [],
    sourceSha256: sha,
    exportedQueryCount: 0,
    portalPresentQueryCount: 0,
    samplePresencePct: 0,
    queries: [],
    sources: [],
    featured: [],
    ...overrides,
  } as ParsedAliceVisibilitySnapshot;
}

test("adapter requires explicit account and domain while Zaruku defaults stay unchanged", () => {
  assert.throws(
    () => parseAliceAdapterArgs(["--manifest", "/tmp/m.json", "--preview"]),
    /account-id|domain/,
  );
  const legacy = parseZarukuCliArgs([
    "--xlsx", "/tmp/alice.xlsx", "--period", "2026-08",
    "--official-sov", "1", "--captured-at", "2026-08-31T00:00:00Z", "--dry-run",
  ]);
  assert.equal(legacy.accountId, "66624469");
  assert.equal(legacy.domain, "zaruku.ru");
});

test("binding must match the server registry and exact domain", () => {
  assert.doesNotThrow(() =>
    assertAliceManifestBinding(manifest(), "fixture-alice-account", "fixture.example"),
  );
  assert.throws(
    () => assertAliceManifestBinding(manifest(), "fixture-alice-account", "other.example"),
    /domain|binding/,
  );
});

test("account-month writer guard rejects one account bound to two portal domains", () => {
  const input = manifest();
  const other = structuredClone(input.registry[0]);
  other.profile.clientId = "other-client";
  other.profile.siteId = "other-site";
  other.profile.dashboardId = 9002;
  other.profile.slug = "other-site";
  other.profile.domain = "other.example";
  other.profile.allowedDomains = ["other.example"];
  other.profile.runtime = {
    route: "/other",
    assetPrefix: "/other",
    buildOutputDir: ".next-other",
    processName: "other",
    port: 9002,
    deployPath: "/var/www/fixture-other",
    releaseBranch: "release/fixture-other",
    deployLockPath: "/var/www/fixture-other.lock",
  };
  other.bindings[0].clientId = "other-client";
  other.bindings[0].siteId = "other-site";
  other.bindings[0].dashboardId = 9002;
  other.bindings[0].resourceId = "other.example";
  other.bindings[0].bindingId = "other-binding";
  other.profile.sources[0].bindingId = "other-binding";
  input.registry.push(other);
  assert.throws(
    () => assertAliceManifestBinding(input, "fixture-alice-account", "fixture.example"),
    /one portal domain|account-month/,
  );
});

test("preview keeps official SOV separate from computed sample and accepts zero mentions", () => {
  const preview = createAlicePreview(manifest(), snapshot());
  assert.equal(preview.officialSovPct, 17.5);
  assert.equal(preview.samplePresencePct, 0);
  assert.equal(preview.portalPresentQueryCount, 0);
  assert.equal(preview.citationCount, 0);
  assert.match(preview.previewId, /^[a-f0-9]{64}$/);
});

test("preview IDs keep clients and months independent", () => {
  const first = createAlicePreview(manifest(), snapshot());
  const secondManifest = manifest({ clientId: "fixture-two", accountId: "fixture-two-account", month: "2026-09" });
  const second = createAlicePreview(
    secondManifest,
    snapshot({ accountId: "fixture-two-account", period: "2026-09", capturedAt: "2026-09-30T12:00:00+02:00" }),
  );
  assert.notEqual(first.previewId, second.previewId);
});

test("publish uses the existing writer once for the whole package and is idempotent", async () => {
  const calls: unknown[] = [];
  const input = manifest();
  const prepared = snapshot();
  const preview = createAlicePreview(input, prepared);
  const dependencies: AliceAdapterDependencies = {
    readManifest: async (_path: string) => input,
    parseWorkbook: async () => prepared,
    connect: async () => ({ end: async () => undefined }),
    persist: async (_connection: unknown, value: unknown) => {
      calls.push(value);
      return calls.length === 1 ? "inserted" : "already_exists";
    },
    write: () => undefined,
  };
  const args = [
    "--manifest", "/tmp/manifest.json", "--account-id", "fixture-alice-account",
    "--domain", "fixture.example", "--publish", "--preview-id", preview.previewId,
    "--intent", "/tmp/intent.json",
  ];
  const intent = { kind: "initial" };
  dependencies.readManifest = async (path: string) => path.endsWith("intent.json") ? intent : input;

  const first = await runAliceImportAdapterCli(args, dependencies);
  const second = await runAliceImportAdapterCli(args, dependencies);

  assert.equal(first.status, "inserted");
  assert.equal(second.status, "already_exists");
  assert.equal(calls.length, 2);
});

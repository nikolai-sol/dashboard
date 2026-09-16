import assert from "node:assert/strict";
import test from "node:test";

import {
  assertImportManifest,
  assertSourceScope,
  type ImportManifest,
  type SourceScope,
} from "./index.ts";

const scope: SourceScope = {
  clientId: "client-a",
  siteId: "site-a",
  dashboardId: 41,
  sourceKey: "google_search_console",
  analyticsAccountId: "gsc-account-a",
  resourceId: "sc-domain:example.test",
};

test("source scope accepts a complete server-resolved identity", () => {
  const validated = assertSourceScope(scope);
  assert.deepEqual(validated, scope);
});

test("source scope rejects mismatched or empty resource identities", () => {
  assert.throws(
    () =>
      assertSourceScope({ ...scope, analyticsAccountId: "", resourceId: "" }),
    /analyticsAccountId|resourceId/,
  );
});

test("manual import manifest preserves an ISO week crossing a year boundary", () => {
  const manifest: ImportManifest = {
    scope,
    period: {
      kind: "iso_week",
      from: "2026-12-28",
      to: "2027-01-03",
      key: "2026-W53",
      sourceTimezone: "Europe/Moscow",
    },
    filters: { searchType: "web" },
    sourceFiles: [{ name: "performance.xlsx", sha256: "a".repeat(64) }],
    adapterVersion: "gsc-manual-v1",
    exportedAt: "2027-01-04T10:00:00Z",
  };

  assert.deepEqual(assertImportManifest(manifest), manifest);
});

test("manual import rows without a period are rejected", () => {
  assert.throws(
    () =>
      assertImportManifest({
        scope,
        filters: {},
        sourceFiles: [],
        adapterVersion: "v1",
        exportedAt: null,
      }),
    /period/,
  );
});

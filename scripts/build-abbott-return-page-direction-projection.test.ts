import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildAbbottReturnPageDirectionProjection,
  materializeAbbottReturnPageDirectionProjection,
  type AbbottPathProjectionInput,
} from "./build-abbott-return-page-direction-projection";

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
const catalog = (fingerprintValue: string, path: string, title = "Guide", direction = "Cardiology") => ({
  sourceRowFingerprint: fingerprintValue,
  normalizedPath: path,
  pageTitle: title,
  direction,
});
const title = (value: string, selectedSourceRowFingerprint: string | null, resolutionStatus: "unique" | "identical_collapsed" | "ambiguous" = "unique") => ({
  pageTitle: value,
  selectedSourceRowFingerprint,
  resolutionStatus,
});
const page = (pageUrl: string, pageTitle: string) => ({ pageUrl, pageTitle });

function input(overrides: Partial<AbbottPathProjectionInput> = {}): AbbottPathProjectionInput {
  return {
    datasetKey: "abbott",
    counterId: "90602537",
    releaseStatus: "staging",
    catalogRows: [catalog(fingerprint("catalog-a"), "/guide")],
    titleProjections: [title("Guide", fingerprint("catalog-a"))],
    pageFacts: [page("https://abbott.example//guide/?utm=x", "Guide")],
    ...overrides,
  };
}

test("collapses repeated normalized URL and title evidence to one path fingerprint", () => {
  const result = buildAbbottReturnPageDirectionProjection(input({
    pageFacts: [page("https://a.example//guide/?x=1", "Guide"), page("/guide#two", "Guide")],
  }));
  assert.deepEqual(result.rows, [{
    lookupKind: "path", lookupKeyHash: fingerprint("/guide"), candidateCount: 2,
    metadataSignatureCount: 1, resolutionStatus: "identical_collapsed",
    selectedSourceRowFingerprint: fingerprint("catalog-a"), groupFingerprint: result.rows[0]!.groupFingerprint,
  }]);
  assert.equal(result.counts.matchedPaths, 1);
});

test("selects only unique and identical-collapsed title resolutions", () => {
  for (const resolutionStatus of ["unique", "identical_collapsed"] as const) {
    const result = buildAbbottReturnPageDirectionProjection(input({ titleProjections: [title("Guide", fingerprint("catalog-a"), resolutionStatus)] }));
    assert.equal(result.rows[0]!.selectedSourceRowFingerprint, fingerprint("catalog-a"));
  }
});

test("marks conflicting selected fingerprints for one normalized path ambiguous", () => {
  const result = buildAbbottReturnPageDirectionProjection(input({
    catalogRows: [catalog(fingerprint("a"), "/guide", "Guide A"), catalog(fingerprint("b"), "/guide", "Guide B")],
    titleProjections: [title("Guide A", fingerprint("a")), title("Guide B", fingerprint("b"))],
    pageFacts: [page("/guide", "Guide A"), page("https://example.test/guide", "Guide B")],
  }));
  assert.equal(result.rows[0]!.resolutionStatus, "ambiguous");
  assert.equal(result.rows[0]!.selectedSourceRowFingerprint, null);
});

test("keeps missing title and slug-only evidence unmatched without guessing", () => {
  const result = buildAbbottReturnPageDirectionProjection(input({
    titleProjections: [], pageFacts: [page("/guide", "missing"), page("/slug-only", "")],
  }));
  assert.deepEqual(result.rows.map((row) => row.lookupKeyHash), [fingerprint("/guide")]);
  assert.equal(result.counts.unmatchedPaths, 1);
});

test("preserves authoritative workbook paths and marks conflicts ambiguous", () => {
  const result = buildAbbottReturnPageDirectionProjection(input({
    catalogRows: [catalog(fingerprint("a"), "/workbook", "Workbook"), catalog(fingerprint("b"), "/workbook", "Metrika")],
    titleProjections: [title("Metrika", fingerprint("b"))], pageFacts: [page("/workbook", "Metrika")],
  }));
  assert.equal(result.rows[0]!.resolutionStatus, "ambiguous");
  assert.equal(result.rows[0]!.selectedSourceRowFingerprint, null);
});

test("rejects non-Abbott counters and non-staging releases", () => {
  assert.throws(() => buildAbbottReturnPageDirectionProjection(input({ counterId: "1" })));
  assert.throws(() => buildAbbottReturnPageDirectionProjection(input({ releaseStatus: "active" })));
});

test("is deterministic across repeated executions", () => {
  const value = input();
  assert.deepEqual(buildAbbottReturnPageDirectionProjection(value), buildAbbottReturnPageDirectionProjection(value));
});

test("counts Metrika paths at path grain and never collapses workbook-only rows", () => {
  const result = buildAbbottReturnPageDirectionProjection(input({
    catalogRows: [catalog(fingerprint("a"), "/", "Root"), catalog(fingerprint("b"), "/workbook", "Workbook")],
    titleProjections: [title("Root", fingerprint("a"))],
    pageFacts: [page("https://abbott.example/", "Root"), page("/missing", "Missing"), page("/missing?again", "Missing")],
  }));
  assert.equal(result.rows.find((row) => row.lookupKeyHash === fingerprint("/workbook"))!.resolutionStatus, "unique");
  assert.deepEqual(result.counts, { distinctMetrikaPaths: 2, matchedPaths: 1, unmatchedPaths: 1, ambiguousPaths: 0 });
});

type Call = { sql: string; params: readonly unknown[] };
function materializerConnection(sourceSnapshotIds: unknown, options: { malformedHash?: boolean; failInsert?: boolean } = {}) {
  const calls: Call[] = []; let committed = 0; let rolledBack = 0;
  return {
    calls, get committed() { return committed; }, get rolledBack() { return rolledBack; },
    async beginTransaction() {}, async commit() { committed += 1; }, async rollback() { rolledBack += 1; },
    async execute(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("portal_data_releases")) return [[{ dataset_key: "abbott", release_status: "staging", source_snapshot_ids: sourceSnapshotIds }], []] as never;
      if (sql.includes("portal_dataset_snapshots")) return [[{ id: 12 }], []] as never;
      if (sql.includes("FROM report_bd.portal_content_catalog")) return [[{ sourceRowFingerprint: fingerprint("a"), normalizedPath: "/workbook", pageTitle: "Guide", direction: "Cardiology" }], []] as never;
      if (sql.includes("lookup_kind = 'title'")) return [[{ pageTitle: "Guide", lookupKeyHash: options.malformedHash ? "bad" : fingerprint("Guide"), resolutionStatus: "unique", selectedSourceRowFingerprint: fingerprint("a") }], []] as never;
      if (sql.includes("canonical_fact_metrika")) return [[{ pageUrl: "/", pageTitle: "Guide" }], []] as never;
      if (sql.startsWith("INSERT") && options.failInsert) throw new Error("insert failure");
      if (sql.includes("COUNT(*) AS row_count")) return [[{ row_count: 2 }], []] as never;
      return [[], []] as never;
    },
  };
}

test("materializer accepts decoded snapshot JSON and scopes catalog to the workbook snapshot", async () => {
  const connection = materializerConnection([12, 99]);
  await materializeAbbottReturnPageDirectionProjection(connection as never, 10);
  const catalog = connection.calls.find((call) => call.sql.includes("FROM report_bd.portal_content_catalog"))!;
  assert.deepEqual(catalog.params, [10, 12]);
  assert.equal(connection.committed, 1);
  assert.equal(connection.rolledBack, 0);
  const writes = connection.calls.filter((call) => /^(?:DELETE|INSERT)/.test(call.sql));
  assert.ok(writes.every((call) => call.sql.includes("lookup_kind = 'path'") || call.sql.includes("'path'")));
});

test("materializer rolls back malformed title hashes before path replacement", async () => {
  const connection = materializerConnection("[12]", { malformedHash: true });
  await assert.rejects(() => materializeAbbottReturnPageDirectionProjection(connection as never, 10), /lookup hash/i);
  assert.equal(connection.committed, 0);
  assert.equal(connection.rolledBack, 1);
  assert.equal(connection.calls.some((call) => call.sql.startsWith("DELETE")), false);
});

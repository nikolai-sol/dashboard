import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildAbbottReturnPageDirectionProjection,
  type AbbottPathProjectionInput,
} from "./build-abbott-return-page-direction-projection";

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
const catalog = (fingerprintValue: string, path: string, title = "Guide") => ({
  sourceRowFingerprint: fingerprintValue,
  normalizedPath: path,
  pageTitle: title,
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
  assert.equal(result.counts.unmatchedEvidence, 2);
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

#!/usr/bin/env node
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";

import { normalizeAbbottPagePath } from "../src/lib/abbott-page-url";

const DATASET_KEY = "abbott";
const COUNTER_ID = "90602537";
const SHA256 = /^[a-f0-9]{64}$/;

export interface AbbottCatalogPathCandidate {
  sourceRowFingerprint: string;
  normalizedPath: string | null;
  pageTitle: string | null;
  direction?: string | null;
}
export interface AbbottTitleProjection {
  pageTitle: string;
  lookupKeyHash?: string;
  resolutionStatus: "unique" | "identical_collapsed" | "ambiguous";
  selectedSourceRowFingerprint: string | null;
}
export interface AbbottPageFactCandidate { pageUrl: string; pageTitle: string | null }
export interface AbbottPathProjectionInput {
  datasetKey: string;
  counterId: string;
  releaseStatus: string;
  catalogRows: readonly AbbottCatalogPathCandidate[];
  titleProjections: readonly AbbottTitleProjection[];
  pageFacts: readonly AbbottPageFactCandidate[];
}
export interface AbbottPathProjectionRow {
  lookupKind: "path";
  lookupKeyHash: string;
  candidateCount: number;
  metadataSignatureCount: number;
  resolutionStatus: "unique" | "identical_collapsed" | "ambiguous";
  selectedSourceRowFingerprint: string | null;
  groupFingerprint: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
function groupFingerprint(path: string, candidates: readonly string[], status: string): string {
  return hash(["path", path, status, ...candidates.slice().sort()].join("\u001f"));
}

/** Pure, aggregate-safe construction used by the staging transaction and its tests. */
export function buildAbbottReturnPageDirectionProjection(input: AbbottPathProjectionInput): {
  rows: AbbottPathProjectionRow[];
  counts: { distinctMetrikaPaths: number; matchedPaths: number; unmatchedPaths: number; ambiguousPaths: number };
} {
  if (input.datasetKey !== DATASET_KEY || input.counterId !== COUNTER_ID || input.releaseStatus !== "staging") {
    throw new Error("Abbott return-page projection requires the fixed staging release and counter");
  }
  const catalogByFingerprint = new Map<string, AbbottCatalogPathCandidate>();
  const candidates = new Map<string, Set<string>>();
  for (const row of input.catalogRows) {
    if (!SHA256.test(row.sourceRowFingerprint)) throw new Error("Invalid catalog fingerprint");
    catalogByFingerprint.set(row.sourceRowFingerprint, row);
    const path = normalizeAbbottPagePath(text(row.normalizedPath));
    if (path) (candidates.get(path) ?? candidates.set(path, new Set()).get(path)!).add(row.sourceRowFingerprint);
  }
  const titleSelection = new Map<string, string>();
  for (const row of input.titleProjections) {
    if (row.lookupKeyHash !== undefined && !SHA256.test(row.lookupKeyHash)) throw new Error("Invalid title lookup hash");
    if (row.selectedSourceRowFingerprint !== null && !SHA256.test(row.selectedSourceRowFingerprint)) throw new Error("Invalid selected catalog fingerprint");
    if (!["unique", "identical_collapsed"].includes(row.resolutionStatus)) continue;
    if (!row.pageTitle || !row.selectedSourceRowFingerprint || !catalogByFingerprint.has(row.selectedSourceRowFingerprint)) {
      throw new Error("Selected catalog fingerprint is absent from workbook catalog");
    }
    titleSelection.set(row.pageTitle, row.selectedSourceRowFingerprint);
  }
  const metrikaPaths = new Set<string>();
  const evidenceByPath = new Map<string, string[]>();
  for (const fact of input.pageFacts) {
    const path = normalizeAbbottPagePath(fact.pageUrl);
    if (!path) continue;
    metrikaPaths.add(path);
    const selected = titleSelection.get(text(fact.pageTitle));
    if (!selected) continue;
    (candidates.get(path) ?? candidates.set(path, new Set()).get(path)!).add(selected);
    const evidence = evidenceByPath.get(path) ?? [];
    evidence.push(selected);
    evidenceByPath.set(path, evidence);
  }
  const rows = [...candidates.entries()].map(([path, fingerprints]) => {
    const selected = [...fingerprints].sort();
    const resolutionStatus: AbbottPathProjectionRow["resolutionStatus"] = selected.length === 1
      ? ((evidenceByPath.get(path)?.filter((fingerprint) => fingerprint === selected[0]).length ?? 0) > 1 ? "identical_collapsed" : "unique")
      : "ambiguous";
    return {
      lookupKind: "path" as const,
      lookupKeyHash: hash(path),
      candidateCount: selected.length === 1
        ? Math.max(1, evidenceByPath.get(path)?.length ?? 0)
        : selected.length,
      metadataSignatureCount: selected.length,
      resolutionStatus,
      selectedSourceRowFingerprint: resolutionStatus === "ambiguous" ? null : selected[0]!,
      groupFingerprint: groupFingerprint(path, selected, resolutionStatus),
    };
  }).sort((left, right) => left.lookupKeyHash.localeCompare(right.lookupKeyHash));
  const byPath = new Map(rows.map((row) => [row.lookupKeyHash, row]));
  const directionFor = (row: AbbottPathProjectionRow | undefined) => row?.selectedSourceRowFingerprint
    ? text(catalogByFingerprint.get(row.selectedSourceRowFingerprint)?.direction)
    : "";
  const metrikaRows = [...metrikaPaths].map((path) => byPath.get(hash(path)));
  return {
    rows,
    counts: {
      distinctMetrikaPaths: metrikaPaths.size,
      matchedPaths: metrikaRows.filter((row) => row?.resolutionStatus !== "ambiguous" && directionFor(row)).length,
      unmatchedPaths: metrikaRows.filter((row) => row?.resolutionStatus === "ambiguous" || !directionFor(row)).length,
      ambiguousPaths: metrikaRows.filter((row) => row?.resolutionStatus === "ambiguous").length,
    },
  };
}

type SqlConnection = Pick<mysql.PoolConnection, "beginTransaction" | "commit" | "rollback" | "execute">;
function rows(result: unknown): Record<string, unknown>[] { return Array.isArray(result) && Array.isArray(result[0]) ? result[0] as Record<string, unknown>[] : []; }
function snapshotIds(value: unknown): number[] {
  let parsed = value;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Candidate release snapshots are invalid");
  return parsed as number[];
}

/** Replaces only candidate-release path rows; callers must explicitly invoke this staging-only action. */
export async function materializeAbbottReturnPageDirectionProjection(connection: SqlConnection, releaseId: number) {
  await connection.beginTransaction();
  try {
    const release = rows(await connection.execute(
      "SELECT dataset_key, release_status, source_snapshot_ids FROM report_bd.portal_data_releases WHERE id = ? FOR UPDATE", [releaseId],
    ));
    if (release.length !== 1 || release[0]?.dataset_key !== DATASET_KEY || release[0]?.release_status !== "staging") throw new Error("Candidate release is not Abbott staging");
    const candidateSnapshotIds = snapshotIds(release[0]?.source_snapshot_ids);
    const workbookSnapshot = rows(await connection.execute(
      "SELECT id FROM report_bd.portal_dataset_snapshots WHERE id IN (" + candidateSnapshotIds.map(() => "?").join(",") + ") AND source_kind = 'abbott_workbook_catalog'", candidateSnapshotIds,
    ));
    if (workbookSnapshot.length !== 1) throw new Error("Candidate workbook snapshot is invalid");
    const workbookSnapshotId = Number(workbookSnapshot[0]?.id);
    if (!Number.isSafeInteger(workbookSnapshotId) || workbookSnapshotId <= 0) throw new Error("Candidate workbook snapshot is invalid");
    const sourceRows = rows(await connection.execute(
      `SELECT c.source_row_fingerprint AS sourceRowFingerprint, c.normalized_path AS normalizedPath, c.page_title AS pageTitle, c.direction_key AS direction
       FROM report_bd.portal_content_catalog c
       WHERE c.canonical_release_id = ? AND c.source_snapshot_id = ?`, [releaseId, workbookSnapshotId],
    ));
    const titleRows = rows(await connection.execute(
      `SELECT c.page_title AS pageTitle, p.lookup_key_hash AS lookupKeyHash, p.resolution_status AS resolutionStatus, p.selected_source_row_fingerprint AS selectedSourceRowFingerprint
       FROM report_bd.portal_content_lookup_projection p
       LEFT JOIN report_bd.portal_content_catalog c ON c.canonical_release_id = p.canonical_release_id AND c.source_snapshot_id = p.source_snapshot_id AND c.source_row_fingerprint = p.selected_source_row_fingerprint
       WHERE p.canonical_release_id = ? AND p.source_snapshot_id = ? AND p.lookup_kind = 'title'`, [releaseId, workbookSnapshotId],
    ));
    const factRows = rows(await connection.execute(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.page_url')) AS pageUrl, JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.page_title')) AS pageTitle
       FROM report_bd.canonical_fact_metrika_site_analytics_daily
       WHERE canonical_release_id = ? AND analytics_scope = 'page' AND counter_id = ?`, [releaseId, COUNTER_ID],
    ));
    const result = buildAbbottReturnPageDirectionProjection({ datasetKey: DATASET_KEY, counterId: COUNTER_ID, releaseStatus: "staging", catalogRows: sourceRows as unknown as AbbottCatalogPathCandidate[], titleProjections: titleRows as unknown as AbbottTitleProjection[], pageFacts: factRows as unknown as AbbottPageFactCandidate[] });
    const workbookPaths = new Set((sourceRows as unknown as AbbottCatalogPathCandidate[])
      .map((row) => normalizeAbbottPagePath(text(row.normalizedPath)))
      .filter(Boolean)
      .map(hash));
    const publishedPaths = new Set(result.rows.map((row) => row.lookupKeyHash));
    if ([...workbookPaths].some((pathHash) => !publishedPaths.has(pathHash))) throw new Error("Workbook path key would be lost");
    await connection.execute("DELETE FROM report_bd.portal_content_lookup_projection WHERE canonical_release_id = ? AND source_snapshot_id = ? AND lookup_kind = 'path'", [releaseId, workbookSnapshotId]);
    for (const row of result.rows) await connection.execute(
      `INSERT INTO report_bd.portal_content_lookup_projection (canonical_release_id, source_snapshot_id, lookup_kind, lookup_key_hash, candidate_count, metadata_signature_count, resolution_status, selected_source_row_fingerprint, group_fingerprint)
       VALUES (?, ?, 'path', ?, ?, ?, ?, ?, ?)`,
      [releaseId, workbookSnapshotId, row.lookupKeyHash, row.candidateCount, row.metadataSignatureCount, row.resolutionStatus, row.selectedSourceRowFingerprint, row.groupFingerprint],
    );
    const persisted = rows(await connection.execute(
      "SELECT COUNT(*) AS row_count FROM report_bd.portal_content_lookup_projection WHERE canonical_release_id = ? AND source_snapshot_id = ? AND lookup_kind = 'path'", [releaseId, workbookSnapshotId],
    ));
    if (Number(persisted[0]?.row_count) !== result.rows.length) throw new Error("Path projection row count mismatch");
    await connection.commit();
    return result;
  } catch (error) { await connection.rollback(); throw error; }
}

async function main() {
  const releaseId = Number(process.argv[2]);
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error("Usage: build-abbott-return-page-direction-projection <staging-release-id>");
  const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME ?? "report_bd" });
  const connection = await pool.getConnection();
  try { await materializeAbbottReturnPageDirectionProjection(connection, releaseId); } finally { connection.release(); await pool.end(); }
}
if (require.main === module) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Projection failed"); process.exitCode = 1; });

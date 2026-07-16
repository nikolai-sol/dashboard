import assert from "node:assert/strict";
import test from "node:test";

import {
  AbbottPrivateStoreError,
  loadActiveAbbottAggregateDataWithExecutor,
  loadActiveAbbottBitrixAnalyticsWithExecutor,
  loadActiveAbbottWorkbookDataWithExecutor,
  resolveActiveAbbottRelease,
  type AbbottPrivateQueryExecutor,
} from "./abbott-private-store";

type RecordedQuery = { sql: string; params: readonly unknown[] };

function fakeExecutor(
  handler: (query: RecordedQuery) => readonly Record<string, unknown>[],
): AbbottPrivateQueryExecutor & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    async query(sql, params) {
      const query = { sql, params };
      queries.push(query);
      return handler(query);
    },
  };
}

const releaseRow = {
  canonical_release_id: "41",
  release_status: "active",
  source_snapshot_ids: JSON.stringify([11, 12, 13, 14]),
};

const snapshotRows = [
  { id: "11", source_kind: "abbott_workbook_json", import_status: "imported", source_generated_at: null, period_min_date: null, period_max_date: null },
  { id: "12", source_kind: "abbott_workbook_catalog", import_status: "imported", source_generated_at: null, period_min_date: null, period_max_date: null },
  { id: "13", source_kind: "abbott_bitrix_pages", import_status: "imported", source_generated_at: "2026-07-01 00:00:00", period_min_date: "2026-06-01", period_max_date: "2026-06-30" },
  { id: "14", source_kind: "abbott_bitrix_journeys", import_status: "imported", source_generated_at: "2026-07-01 00:00:00", period_min_date: "2026-06-30", period_max_date: "2026-06-30" },
];

test("resolves only the active Abbott release and its referenced imported snapshots", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    return [];
  });

  const release = await resolveActiveAbbottRelease(executor);

  assert.equal(release.id, 41);
  assert.equal(release.snapshots.workbookJson.id, 11);
  assert.equal(release.snapshots.workbookCatalog.id, 12);
  assert.equal(release.snapshots.bitrixPages?.id, 13);
  assert.deepEqual(executor.queries[0]?.params, ["abbott", "abbott"]);
  assert.deepEqual(executor.queries[1]?.params, ["abbott", 11, 12, 13, 14]);
  assert.match(executor.queries[0]?.sql ?? "", /`report_bd`\.`portal_active_data_releases`/);
  assert.doesNotMatch(executor.queries.map((query) => query.sql).join("\n"), /source_locator|private_archive_locator/i);
});

test("fails closed when a required workbook snapshot is missing or not imported", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) {
      return snapshotRows.filter((row) => row.source_kind !== "abbott_workbook_catalog");
    }
    return [];
  });

  await assert.rejects(
    resolveActiveAbbottRelease(executor),
    (error: unknown) => error instanceof AbbottPrivateStoreError && error.code === "INVALID_ACTIVE_RELEASE",
  );
});

test("missing optional Bitrix pages returns an explicitly labeled empty test dump", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [{ ...releaseRow, source_snapshot_ids: JSON.stringify([11, 12]) }];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows.slice(0, 2);
    return [];
  });

  const result = await loadActiveAbbottBitrixAnalyticsWithExecutor(executor, 7);

  assert.deepEqual(result, {
    source: { source_status: "missing", test_dump: true, snapshot_id: null, generated_at: null, period_from: null, period_to: null },
    summary: null,
    rows: [],
  });
});

test("manager workbook loading preserves raw identifiers byte-for-byte", async () => {
  const rawIds = ["000123", "900719925474099312345", "doctor-A"];
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    if (sql.includes("portal_user_directions_private")) {
      return rawIds.map((raw_user_id) => ({ raw_user_id, normalized_direction: "cardiology" }));
    }
    return [];
  });

  const result = await loadActiveAbbottWorkbookDataWithExecutor(executor, 7);

  assert.deepEqual([...result.userDirections.keys()], rawIds);
  const allSql = executor.queries.map((query) => query.sql).join("\n");
  assert.match(allSql, /`report_bd_private`\.`portal_user_directions_private`/);
  assert.match(allSql, /`report_bd`\.`portal_event_catalog`/);
  assert.doesNotMatch(allSql, /`report_bd`\.`portal_external_events`/);
  assert.doesNotMatch(allSql, /CAST\s*\(|UNSIGNED|raw_user_id\s*\+/i);
});

test("aggregate/embed loading performs zero private-schema queries", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    return [];
  });

  const result = await loadActiveAbbottAggregateDataWithExecutor(executor, 7);

  assert.equal("userDirections" in result.workbook, false);
  assert.equal(result.bitrixPages.source.test_dump, true);
  const allSql = executor.queries.map(({ sql }) => sql).join("\n");
  assert.match(allSql, /`report_bd`\.`portal_bitrix_page_facts`/);
  assert.match(allSql, /`report_bd`\.`portal_bitrix_journey_transitions`/);
  assert.doesNotMatch(allSql, /report_bd_private/);
});

test("manager Bitrix loading uses the private snapshot-bound page table", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    if (sql.includes("`report_bd_private`.`portal_bitrix_page_facts`")) {
      return [{
        report_date: "2026-06-30",
        normalized_path: "/materials/example",
        material_id: "material-1",
        pageviews: "4",
        visits: "3",
        unique_visitors: "2",
      }];
    }
    return [];
  });

  const result = await loadActiveAbbottBitrixAnalyticsWithExecutor(executor, 7);

  assert.deepEqual(result.rows[0], {
    report_date: "2026-06-30",
    url: "/materials/example",
    path: "/materials/example",
    material_id: "material-1",
    pageviews: 4,
    sessions: 3,
    users: 2,
  });
  assert.equal(
    executor.queries.some(({ sql }) => sql.includes("`report_bd_private`.`portal_bitrix_page_facts`")),
    true,
  );
});

test("database errors are sanitized and never expose SQL parameters", async () => {
  const executor: AbbottPrivateQueryExecutor = {
    async query() {
      throw new Error("password=pw raw_user_id=000123 /private/path?token=secret");
    },
  };

  await assert.rejects(
    resolveActiveAbbottRelease(executor),
    (error: unknown) =>
      error instanceof AbbottPrivateStoreError &&
      error.message === "Abbott private data is unavailable" &&
      !String(error).includes("000123"),
  );
});

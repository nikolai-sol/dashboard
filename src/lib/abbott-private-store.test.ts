import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  AbbottPrivateStoreError,
  loadActiveAbbottReleaseBundleWithExecutor,
  loadActiveAbbottAggregateDataWithExecutor,
  loadActiveAbbottBitrixAnalyticsWithExecutor,
  loadActiveAbbottSessionJourneysWithExecutor,
  loadActiveAbbottWorkbookDataWithExecutor,
  resolveActiveAbbottRelease,
  type AbbottPrivateQueryExecutor,
} from "./abbott-private-store";
import { ABBOTT_PRIVATE_SOURCE_KINDS } from "./abbott-private-types";

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

test("release bundle pins one active release for all manager snapshot reads", async () => {
  let pointerReads = 0;
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) {
      pointerReads += 1;
      return [pointerReads === 1 ? releaseRow : { ...releaseRow, canonical_release_id: "99" }];
    }
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    if (sql.includes("portal_user_directions_private")) {
      return [{ raw_user_id: "000123", normalized_direction: "cardiology" }];
    }
    if (sql.includes("portal_bitrix_journeys_private")) {
      return [{
        report_date: "2026-06-30",
        raw_user_id: "000123",
        protected_visit_id: "visit-A",
        event_sequence: "0",
        event_at: "2026-06-30 10:00:00",
        normalized_path: "/one",
        event_kind: "pageview",
      }];
    }
    return [];
  });

  const result = await loadActiveAbbottReleaseBundleWithExecutor(
    executor,
    7,
    "manager",
    "2026-06-30",
    "2026-06-30",
  );

  assert.equal(result.releaseId, 41);
  assert.equal(result.audience, "manager");
  assert.equal(pointerReads, 1);
  const releaseScopedQueries = executor.queries.filter(({ sql }) =>
    /portal_(?:content_catalog|general_materials|event_catalog|user_directions_private|bitrix_page_facts|bitrix_journeys_private)/.test(sql),
  );
  assert.equal(releaseScopedQueries.length > 0, true);
  releaseScopedQueries.forEach(({ params }) => assert.equal(params[0], 41));
  const bitrixPageQuery = executor.queries.find(({ sql }) =>
    sql.includes("`report_bd_private`.`portal_bitrix_page_facts`"));
  const journeyQuery = executor.queries.find(({ sql }) => sql.includes("portal_bitrix_journeys_private"));
  assert.deepEqual(bitrixPageQuery?.params, [41, 13, "2026-06-30", "2026-06-30"]);
  assert.deepEqual(journeyQuery?.params, [41, 14, "2026-06-30", "2026-06-30"]);
});

test("embed bundle filters aggregate Bitrix data to the requested subrange", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    return [];
  });

  await loadActiveAbbottReleaseBundleWithExecutor(
    executor,
    7,
    "embed",
    "2026-06-30",
    "2026-06-30",
  );

  const bitrixPageQuery = executor.queries.find(({ sql }) =>
    sql.includes("`report_bd`.`portal_bitrix_page_facts`"));
  const transitionQuery = executor.queries.find(({ sql }) =>
    sql.includes("portal_bitrix_journey_transitions"));
  assert.match(bitrixPageQuery?.sql ?? "", /report_date >= \? AND report_date <= \?/);
  assert.match(transitionQuery?.sql ?? "", /report_date >= \? AND report_date <= \?/);
  assert.deepEqual(bitrixPageQuery?.params, [41, 13, "2026-06-30", "2026-06-30"]);
  assert.deepEqual(transitionQuery?.params, [41, 14, "2026-06-30", "2026-06-30"]);
});

test("out-of-period optional Bitrix snapshots are labeled without querying facts", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    return [];
  });

  const result = await loadActiveAbbottReleaseBundleWithExecutor(
    executor,
    7,
    "embed",
    "2026-07-10",
    "2026-07-12",
  );

  if (result.audience !== "embed") assert.fail("expected embed release bundle");
  assert.equal(result.bitrixPages.source.source_status, "out_of_period");
  assert.equal(result.bitrixPages.summary, null);
  assert.equal(result.journeyTransitions.source.source_status, "out_of_period");
  assert.equal(
    executor.queries.some(({ sql }) =>
      sql.includes("portal_bitrix_page_facts") || sql.includes("portal_bitrix_journey_transitions")),
    false,
  );
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

test("dashboard validation requires client_id normalized exactly to abbott", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    return [];
  });

  await loadActiveAbbottAggregateDataWithExecutor(executor, 7);

  const dashboardQuery = executor.queries[0];
  assert.match(dashboardQuery?.sql ?? "", /LOWER\(TRIM\(client_id\)\) = \?/);
  assert.deepEqual(dashboardQuery?.params, [7, "abbott", "abbott_bi"]);
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
        material_type_hint: "article",
        pageviews: "4",
        sessions: "3",
        users: "2",
        guests: "1",
        logged_in_hits: "5",
        anonymous_hits: "2",
        logged_in_sessions: "2",
        anonymous_sessions: "1",
        entry_sessions: "3",
        exit_sessions: "2",
        avg_session_duration_seconds: "42.75",
        top_utm_source: "email",
        top_utm_medium: "newsletter",
        top_utm_campaign: "launch",
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
    material_type_hint: "article",
    pageviews: 4,
    sessions: 3,
    users: 2,
    guests: 1,
    logged_in_hits: 5,
    anonymous_hits: 2,
    logged_in_sessions: 2,
    anonymous_sessions: 1,
    entry_sessions: 3,
    exit_sessions: 2,
    avg_session_duration_seconds: 42.75,
    top_utm_source: "email",
    top_utm_medium: "newsletter",
    top_utm_campaign: "launch",
  });
  assert.equal(
    executor.queries.some(({ sql }) => sql.includes("`report_bd_private`.`portal_bitrix_page_facts`")),
    true,
  );
});

test("workbook loading uses normalized general-material URLs", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    if (sql.includes("portal_general_materials")) {
      return [{ material_title: "Guide", normalized_url: "https://abbott.example/guide" }];
    }
    return [];
  });

  const result = await loadActiveAbbottWorkbookDataWithExecutor(executor, 7);
  const materialQuery = executor.queries.find(({ sql }) => sql.includes("portal_general_materials"));

  assert.match(materialQuery?.sql ?? "", /SELECT material_title, normalized_url/);
  assert.deepEqual(result.generalMaterials, [{ name: "Guide", url: "https://abbott.example/guide" }]);
});

test("workbook loading uses only resolved hashed projections and reports aggregate ambiguity", async () => {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const resolvedRows = [
    { lookup_kind: "title", lookup_key_hash: hash("Shared"), resolution_status: "identical_collapsed", direction_key: "Cardiology", material_type: "article", access_label: "Врачи", is_active: 1 },
    { lookup_kind: "slug", lookup_key_hash: hash("shared"), resolution_status: "unique", direction_key: "Cardiology", material_type: "article", access_label: "Врачи", is_active: 1 },
    { lookup_kind: "path", lookup_key_hash: hash("/shared"), resolution_status: "unique", direction_key: "Cardiology", material_type: "article", access_label: "Врачи", is_active: 1 },
  ];
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    if (sql.includes("portal_content_lookup_projection") && sql.includes("SUM(")) {
      return [{ ambiguous_groups: "2", collapsed_groups: "1" }];
    }
    if (sql.includes("portal_content_lookup_projection")) return resolvedRows;
    return [];
  });

  const result = await loadActiveAbbottWorkbookDataWithExecutor(executor, 7);

  assert.deepEqual(result.contentByTitle.get(hash("Shared")), {
    direction: "Cardiology",
    material_type: "article",
    access: "Врачи",
    is_active: true,
  });
  assert.equal(result.contentBySlug.has("shared"), false);
  assert.equal(result.contentBySlug.has(hash("shared")), true);
  assert.equal(result.urlReturnDirections.get(hash("/shared")), "Cardiology");
  assert.deepEqual(result.lookupQuality, { ambiguousGroups: 2, collapsedGroups: 1 });
  const projectionSql = executor.queries
    .filter(({ sql }) => sql.includes("portal_content_lookup_projection"))
    .map(({ sql }) => sql)
    .join("\n");
  assert.match(projectionSql, /resolution_status IN \('unique', 'identical_collapsed'\)/);
  assert.doesNotMatch(projectionSql, /page_title\s*=\s*\?|source_slug\s*=\s*\?|normalized_path\s*=\s*\?/);
});

test("manager journey loading groups ordered events and preserves protected identifiers", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    if (sql.includes("portal_bitrix_journeys_private")) {
      return [
        { report_date: "2026-06-30", protected_visit_id: "00009007199254740993", raw_user_id: "000123", event_sequence: "0", event_at: "2026-06-30 10:00:00", normalized_path: "/one", event_kind: "pageview" },
        { report_date: "2026-06-30", protected_visit_id: "00009007199254740993", raw_user_id: "000123", event_sequence: "1", event_at: "2026-06-30 10:01:00", normalized_path: "/two", event_kind: "pageview" },
      ];
    }
    return [];
  });

  const result = await loadActiveAbbottSessionJourneysWithExecutor(executor, 7);

  assert.equal(result.source.snapshot_id, 14);
  assert.deepEqual(result.rows, [{
    protected_visit_id: "00009007199254740993",
    raw_user_id: "000123",
    report_date: "2026-06-30",
    events: [
      { sequence: 0, event_at: "2026-06-30 10:00:00", normalized_path: "/one", event_kind: "pageview" },
      { sequence: 1, event_at: "2026-06-30 10:01:00", normalized_path: "/two", event_kind: "pageview" },
    ],
  }]);
  assert.deepEqual(ABBOTT_PRIVATE_SOURCE_KINDS, {
    workbookJson: "abbott_workbook_json",
    workbookCatalog: "abbott_workbook_catalog",
    bitrixPages: "abbott_bitrix_pages",
    bitrixJourneys: "abbott_bitrix_journeys",
  });
  assert.deepEqual(executor.queries.at(-1)?.params, [41, 14]);
});

test("store queries match the rollout-safe aggregate schema columns", async () => {
  const executor = fakeExecutor(({ sql }) => {
    if (sql.includes("FROM `report_bd`.`dashboards`")) return [{ id: 7 }];
    if (sql.includes("portal_active_data_releases")) return [releaseRow];
    if (sql.includes("portal_dataset_snapshots")) return snapshotRows;
    if (sql.includes("portal_bitrix_journey_transitions")) {
      return [{ report_date: "2026-06-30", from_path: "/one", to_path: "/two", transition_count: "4" }];
    }
    return [];
  });

  const result = await loadActiveAbbottAggregateDataWithExecutor(executor, 7);
  const sql = executor.queries.map((query) => query.sql).join("\n");

  assert.match(sql, /projection\.lookup_kind, projection\.lookup_key_hash, projection\.resolution_status/);
  assert.match(sql, /catalog\.source_row_fingerprint = projection\.selected_source_row_fingerprint/);
  assert.doesNotMatch(sql, /SELECT page_title|SELECT source_slug|SELECT normalized_path/);
  assert.match(sql, /material_type_hint,\s+pageviews, sessions, users, guests/);
  assert.match(sql, /logged_in_hits, anonymous_hits, logged_in_sessions, anonymous_sessions/);
  assert.match(sql, /entry_sessions, exit_sessions, avg_session_duration_seconds/);
  assert.match(sql, /top_utm_source, top_utm_medium, top_utm_campaign/);
  assert.doesNotMatch(sql, /\bvisits\b|unique_visitors/);
  assert.match(sql, /SELECT report_date, from_path, to_path, transition_count/);
  assert.deepEqual(result.journeyTransitions.rows, [{
    report_date: "2026-06-30",
    from_path: "/one",
    to_path: "/two",
    transitions: 4,
  }]);
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

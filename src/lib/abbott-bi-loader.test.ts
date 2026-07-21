import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type {
  AbbottAggregatePrivateData,
  AbbottPrivateSessionJourneysData,
  ParsedAbbottWorkbook,
  ParsedBitrixAnalytics,
} from "./abbott-private-types";
import {
  loadAbbottBiDataWithDependencies,
  type AbbottBiLoaderDependencies,
  type AbbottBiQueryExecutor,
} from "./abbott-bi";

const completeCoverage = ["other", "traffic", "page", "user_behavior", "returning"].map((scope_key) => ({
  counter_id: "90602537",
  report_date: "2026-01-01",
  scope_key,
  collection_status: "success",
  pagination_complete: 1,
  is_sampled: 0,
  empty_reconciled: 0,
}));

const lookupHash = (value: string) => createHash("sha256").update(value).digest("hex");

const aggregateWorkbook: AbbottAggregatePrivateData["workbook"] = {
  generalMaterials: [],
  externalEvents: [],
  contentByTitle: new Map(),
  contentBySlug: new Map(),
  urlReturnDirections: new Map([[lookupHash("/page"), {
    direction: "Cardiology",
    material_type: null,
    access: null,
    is_active: true,
  }]]),
  lookupQuality: { ambiguousGroups: 0, collapsedGroups: 0 },
  ymUrlReturn: [],
};

const managerWorkbook: ParsedAbbottWorkbook = {
  ...aggregateWorkbook,
  userDirections: new Map([["000123", "Cardiology"]]),
};

const missingBitrix: ParsedBitrixAnalytics = {
  source: {
    source_status: "missing",
    test_dump: true,
    snapshot_id: null,
    generated_at: null,
    period_from: null,
    period_to: null,
  },
  summary: null,
  rows: [],
};

const missingJourneys: AbbottPrivateSessionJourneysData = {
  source: missingBitrix.source,
  rows: [],
};

function executor(
  handler: (sql: string, params: readonly unknown[]) => readonly Record<string, unknown>[],
): AbbottBiQueryExecutor & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async query(sql, params) {
      queries.push(sql);
      return handler(sql, params);
    },
  };
}

function aggregateRows(sql: string): readonly Record<string, unknown>[] {
  if (sql.includes("portal_active_data_releases")) {
    return [{ canonical_release_id: "41", release_status: "active" }];
  }
  if (sql.includes("canonical_source_coverage_daily")) return completeCoverage;
  if (sql.includes("canonical_fact_metrika_site_analytics_daily")) {
    return [
      {
        analytics_scope: "other",
        traffic_source: "Direct traffic",
        utm_source: null,
        page_url: null,
        page_title: null,
        sessions: "7",
        users: "5",
        pageviews: "9",
        bounce_rate: "10.5",
        average_session_seconds: "30",
      },
      {
        analytics_scope: "page",
        traffic_source: null,
        utm_source: null,
        page_url: "https://example.test/page?private=1",
        page_title: "Example",
        sessions: "0",
        users: "2",
        pageviews: "4",
        bounce_rate: null,
        average_session_seconds: null,
      },
    ];
  }
  if (sql.includes("canonical_fact_metrika_returning_pages_release_daily")) {
    return [
      { report_date: "2026-01-01", raw_page_value: "raw-a", normalized_page: "https://example.test/page", return_bucket_code: "next_day", source_percentage: "50.0000000000", source_denominator: "1" },
      { report_date: "2026-01-01", raw_page_value: "raw-a", normalized_page: "https://example.test/page", return_bucket_code: "days_2_7", source_percentage: "25.0000000000", source_denominator: "1" },
      { report_date: "2026-01-01", raw_page_value: "raw-a", normalized_page: "https://example.test/page", return_bucket_code: "days_8_31", source_percentage: "25.0000000000", source_denominator: "1" },
    ];
  }
  if (sql.includes("portal_external_events")) return [];
  throw new Error(`Unexpected aggregate query: ${sql}`);
}

function dependencies(
  aggregateExecutor: AbbottBiQueryExecutor,
  privateExecutor: AbbottBiQueryExecutor,
): AbbottBiLoaderDependencies {
  return {
    aggregateExecutor,
    privateExecutor,
    async loadReleaseBundle(_dashboardId, audience) {
      return audience === "manager"
        ? {
            releaseId: 41,
            audience,
            workbook: managerWorkbook,
            bitrixPages: missingBitrix,
            journeys: missingJourneys,
          }
        : {
            releaseId: 41,
            audience,
            workbook: aggregateWorkbook,
            bitrixPages: missingBitrix,
            journeyTransitions: { source: missingBitrix.source, rows: [] },
          };
    },
  };
}

test("incomplete canonical coverage fails closed without querying facts or private data", async () => {
  const aggregate = executor((sql) => {
    if (sql.includes("portal_active_data_releases")) {
      return [{ canonical_release_id: "41", release_status: "active" }];
    }
    if (sql.includes("canonical_source_coverage_daily")) {
      return completeCoverage.map((row) =>
        row.scope_key === "returning" ? { ...row, collection_status: "partial" } : row,
      );
    }
    throw new Error("facts must not be queried for incomplete coverage");
  });
  const privateDb = executor(() => {
    throw new Error("private data must not be queried for incomplete coverage");
  });
  let storeCalls = 0;
  const deps = dependencies(aggregate, privateDb);
  deps.loadReleaseBundle = async () => {
    storeCalls += 1;
    return {
      releaseId: 41,
      audience: "embed" as const,
      workbook: aggregateWorkbook,
      bitrixPages: missingBitrix,
      journeyTransitions: { source: missingBitrix.source, rows: [] },
    };
  };

  const result = await loadAbbottBiDataWithDependencies(
    7,
    ["90602537"],
    "2026-01-01",
    "2026-01-01",
    "embed",
    deps,
  );

  assert.equal(result.source, "canonical");
  assert.equal(result.data_quality.status, "incomplete");
  assert.deepEqual(result.data_quality.blocking_gaps, [
    { counter_id: "90602537", report_date: "2026-01-01", scope: "returning", status: "partial" },
  ]);
  assert.equal(result.page_stats.length, 0);
  assert.equal(storeCalls, 1);
  assert.equal(privateDb.queries.length, 0);
  assert.equal(aggregate.queries.some((sql) => sql.includes("canonical_fact_metrika_site_analytics_daily")), false);
});

test("embed uses aggregate store only and derives returning counts with decimal half-up", async () => {
  const aggregate = executor(aggregateRows);
  const privateDb = executor(() => {
    throw new Error("embed must perform zero private queries");
  });
  const deps = dependencies(aggregate, privateDb);
  let aggregateStoreCalls = 0;
  deps.loadReleaseBundle = async () => {
    aggregateStoreCalls += 1;
    return {
      releaseId: 41,
      audience: "embed" as const,
      workbook: aggregateWorkbook,
      bitrixPages: missingBitrix,
      journeyTransitions: { source: missingBitrix.source, rows: [] },
    };
  };

  const result = await loadAbbottBiDataWithDependencies(
    7,
    ["90602537"],
    "2026-01-01",
    "2026-01-01",
    "embed",
    deps,
  );

  assert.equal(result.access_level, "embed");
  assert.equal(result.data_quality.status, "complete");
  assert.equal(aggregateStoreCalls, 1);
  assert.equal(privateDb.queries.length, 0);
  assert.equal(result.users_summary.length, 0);
  assert.equal(result.user_actions.length, 0);
  assert.equal(result.session_journeys.rows.length, 0);
  assert.deepEqual(result.bitrix_sources, {
    pages: missingBitrix.source,
    journeys: missingBitrix.source,
  });
  assert.deepEqual(result.returning[0], {
    url: "https://example.test/page",
    direction: "Cardiology",
    visits: 1,
    returning_1_day: 1,
    returning_2_7_days: 0,
    returning_8_31_days: 0,
    is_derived: true,
    normalization_collision: false,
  });
});

test("aggregate traffic keeps exact User ID partitions with weighted metrics", async () => {
  const siteRows = [
    { analytics_scope: "other", user_id_presence: "all", traffic_source: "Direct", sessions: "10", users: "8", pageviews: "20", bounce_rate: "10", average_session_seconds: "100" },
    { analytics_scope: "other", user_id_presence: "all", traffic_source: "Direct", sessions: "30", users: "20", pageviews: "60", bounce_rate: "30", average_session_seconds: "200" },
    { analytics_scope: "other", user_id_presence: "with_user_id", traffic_source: "Direct", sessions: "4", users: "3", pageviews: "12", bounce_rate: "50", average_session_seconds: "90" },
    { analytics_scope: "other", user_id_presence: "without_user_id", traffic_source: "Direct", sessions: "6", users: "5", pageviews: "6", bounce_rate: "0", average_session_seconds: "30" },
  ];
  const aggregate = executor((sql) => {
    if (sql.includes("canonical_fact_metrika_site_analytics_daily")) {
      assert.match(sql, /JSON_EXTRACT\(scope_dimensions, '\$\.user_id_presence'\)\) AS user_id_presence/);
      return siteRows;
    }
    return aggregateRows(sql);
  });

  const result = await loadAbbottBiDataWithDependencies(
    7, ["90602537"], "2026-01-01", "2026-01-01", "embed",
    dependencies(aggregate, executor(() => [])),
  );

  const bySegment = new Map(result.traffic_summary?.map((row) => [row.traffic_segment, row]));
  assert.deepEqual(bySegment.get("all"), {
    user_id: "",
    has_user_id: false,
    traffic_segment: "all",
    traffic_source: "Direct",
    direction: null,
    visits: 40,
    users: 28,
    new_users: 0,
    page_depth: 2,
    avg_duration: 175,
    bounce_rate: 25,
  });
  assert.deepEqual(bySegment.get("with_user_id"), {
    user_id: "",
    has_user_id: true,
    traffic_segment: "with_user_id",
    traffic_source: "Direct",
    direction: null,
    visits: 4,
    users: 3,
    new_users: 0,
    page_depth: 3,
    avg_duration: 90,
    bounce_rate: 50,
  });
  assert.deepEqual(bySegment.get("without_user_id"), {
    user_id: "",
    has_user_id: false,
    traffic_segment: "without_user_id",
    traffic_source: "Direct",
    direction: null,
    visits: 6,
    users: 5,
    new_users: 0,
    page_depth: 1,
    avg_duration: 30,
    bounce_rate: 0,
  });
});

test("historic missing traffic marker maps only to all and unknown markers fail closed", async () => {
  const historic = await loadAbbottBiDataWithDependencies(
    7, ["90602537"], "2026-01-01", "2026-01-01", "embed",
    dependencies(executor(aggregateRows), executor(() => [])),
  );
  assert.deepEqual(historic.traffic_summary?.map((row) => row.traffic_segment), ["all"]);

  const invalidAggregate = executor((sql) => {
    if (sql.includes("canonical_fact_metrika_site_analytics_daily")) {
      return [{
        analytics_scope: "other",
        user_id_presence: "combined_guess",
        traffic_source: "Direct",
        sessions: "7",
        users: "5",
        pageviews: "9",
        bounce_rate: "10",
        average_session_seconds: "30",
      }];
    }
    return aggregateRows(sql);
  });
  const invalid = await loadAbbottBiDataWithDependencies(
    7, ["90602537"], "2026-01-01", "2026-01-01", "embed",
    dependencies(invalidAggregate, executor(() => [])),
  );
  assert.equal(invalid.data_quality.status, "incomplete");
  assert.equal(invalid.traffic_summary?.length, 0);
});

test("ambiguous path lookup keeps canonical page metrics visible with null enrichment", async () => {
  const aggregate = executor(aggregateRows);
  const deps = dependencies(aggregate, executor(() => []));
  deps.loadReleaseBundle = async () => ({
    releaseId: 41,
    audience: "embed" as const,
    workbook: {
      ...aggregateWorkbook,
      urlReturnDirections: new Map(),
      lookupQuality: { ambiguousGroups: 3, collapsedGroups: 1 },
    },
    bitrixPages: missingBitrix,
    journeyTransitions: { source: missingBitrix.source, rows: [] },
  });

  const result = await loadAbbottBiDataWithDependencies(
    7,
    ["90602537"],
    "2026-01-01",
    "2026-01-01",
    "embed",
    deps,
  );

  assert.equal(result.page_stats.length, 1);
  assert.deepEqual(
    {
      pageviews: result.page_stats[0]?.pageviews,
      users: result.page_stats[0]?.users,
      direction: result.page_stats[0]?.direction,
      material_type: result.page_stats[0]?.material_type,
      access: result.page_stats[0]?.access,
    },
    { pageviews: 4, users: 2, direction: null, material_type: null, access: null },
  );
  assert.deepEqual(result.data_quality.content_lookup, {
    ambiguous_groups: 3,
    collapsed_groups: 1,
  });
});

test("path-only lookup applies full metadata and hides inactive canonical pages", async () => {
  const pathMetadata = {
    direction: "Neurology",
    material_type: "guide",
    access: "Врачи",
    is_active: true,
  };
  const activeDeps = dependencies(executor(aggregateRows), executor(() => []));
  activeDeps.loadReleaseBundle = async () => ({
    releaseId: 41,
    audience: "embed" as const,
    workbook: {
      ...aggregateWorkbook,
      contentByTitle: new Map(),
      contentBySlug: new Map(),
      urlReturnDirections: new Map([[lookupHash("/page"), pathMetadata]]),
    },
    bitrixPages: missingBitrix,
    journeyTransitions: { source: missingBitrix.source, rows: [] },
  });

  const active = await loadAbbottBiDataWithDependencies(
    7, ["90602537"], "2026-01-01", "2026-01-01", "embed", activeDeps,
  );
  assert.deepEqual({
    direction: active.page_stats[0]?.direction,
    material_type: active.page_stats[0]?.material_type,
    access: active.page_stats[0]?.access,
  }, { direction: "Neurology", material_type: "guide", access: "Врачи" });

  const inactiveDeps = dependencies(executor(aggregateRows), executor(() => []));
  inactiveDeps.loadReleaseBundle = async () => ({
    releaseId: 41,
    audience: "embed" as const,
    workbook: {
      ...aggregateWorkbook,
      contentByTitle: new Map(),
      contentBySlug: new Map(),
      urlReturnDirections: new Map([[lookupHash("/page"), { ...pathMetadata, is_active: false }]]),
    },
    bitrixPages: missingBitrix,
    journeyTransitions: { source: missingBitrix.source, rows: [] },
  });
  const inactive = await loadAbbottBiDataWithDependencies(
    7, ["90602537"], "2026-01-01", "2026-01-01", "embed", inactiveDeps,
  );
  assert.equal(inactive.page_stats.length, 0);
});

test("loader pins every canonical fact query to the store bundle release when the pointer changes", async () => {
  const aggregate = executor((sql, params) => {
    assert.doesNotMatch(sql, /portal_active_data_releases/);
    if (sql.includes("canonical_source_coverage_daily")) {
      assert.equal(params[0], 41);
      return completeCoverage;
    }
    if (sql.includes("canonical_fact_metrika_site_analytics_daily")) {
      assert.equal(params[0], 41);
      return [];
    }
    if (sql.includes("canonical_fact_metrika_returning_pages_release_daily")) {
      assert.equal(params[0], 41);
      return [];
    }
    if (sql.includes("portal_external_events")) {
      assert.equal(params[0], 41);
      return [];
    }
    throw new Error(`Unexpected aggregate query: ${sql}`);
  });
  const deps = dependencies(aggregate, executor(() => []));
  let bundleReads = 0;
  deps.loadReleaseBundle = async () => {
    bundleReads += 1;
    return {
      releaseId: 41,
      audience: "embed" as const,
      workbook: aggregateWorkbook,
      bitrixPages: missingBitrix,
      journeyTransitions: { source: missingBitrix.source, rows: [] },
    };
  };

  const result = await loadAbbottBiDataWithDependencies(
    7,
    ["90602537"],
    "2026-01-01",
    "2026-01-01",
    "embed",
    deps,
  );

  assert.equal(result.data_quality.release_id, 41);
  assert.equal(result.data_quality.status, "complete");
  assert.equal(bundleReads, 1);
});

test("loader maps every Bitrix metric and exposes snapshot metadata", async () => {
  const aggregate = executor(aggregateRows);
  const privateDb = executor(() => []);
  const deps = dependencies(aggregate, privateDb);
  const source = {
    source_status: "test_dump" as const,
    test_dump: true as const,
    snapshot_id: 13,
    generated_at: "2026-07-01 00:00:00",
    period_from: "2026-01-01",
    period_to: "2026-01-31",
  };
  deps.loadReleaseBundle = async () => ({
    releaseId: 41,
    audience: "embed" as const,
    workbook: aggregateWorkbook,
    bitrixPages: {
      source,
      summary: { date_from: "2026-01-01", date_to: "2026-01-31", page_rows: 1 },
      rows: [{
        report_date: "2026-01-01",
        url: "/page",
        path: "/page",
        material_id: "m-1",
        material_type_hint: "article",
        pageviews: 11,
        sessions: 10,
        users: 9,
        guests: 8,
        logged_in_hits: 7,
        anonymous_hits: 6,
        logged_in_sessions: 5,
        anonymous_sessions: 4,
        entry_sessions: 3,
        exit_sessions: 2,
        avg_session_duration_seconds: 42.75,
        top_utm_source: "email",
        top_utm_medium: "newsletter",
        top_utm_campaign: "launch",
      }],
    },
    journeyTransitions: { source, rows: [] },
  });

  const result = await loadAbbottBiDataWithDependencies(
    7,
    ["90602537"],
    "2026-01-01",
    "2026-01-01",
    "embed",
    deps,
  );

  assert.deepEqual(result.bitrix_pages[0], {
    url: "/page",
    path: "/page",
    direction: "Cardiology",
    material_type: "article",
    access: null,
    pageviews: 11,
    sessions: 10,
    users: 9,
    guests: 8,
    logged_in_hits: 7,
    anonymous_hits: 6,
    logged_in_sessions: 5,
    anonymous_sessions: 4,
    entry_sessions: 3,
    exit_sessions: 2,
    avg_session_duration: 42.75,
    top_utm_source: "email",
    top_utm_medium: "newsletter",
    top_utm_campaign: "launch",
  });
  assert.deepEqual(result.bitrix_sources?.pages, source);
  assert.deepEqual(result.bitrix_sources?.journeys, source);
});

test("loader aggregates multi-day Bitrix rows without last-row overwrite", async () => {
  const aggregate = executor((sql) => {
    if (sql.includes("canonical_source_coverage_daily")) {
      return [
        ...completeCoverage,
        ...completeCoverage.map((row) => ({ ...row, report_date: "2026-01-02" })),
      ];
    }
    return aggregateRows(sql);
  });
  const deps = dependencies(aggregate, executor(() => []));
  const source = {
    source_status: "test_dump" as const,
    test_dump: true as const,
    snapshot_id: 13,
    generated_at: "2026-02-01 00:00:00",
    period_from: "2026-01-01",
    period_to: "2026-01-31",
  };
  deps.loadReleaseBundle = async (_dashboardId, audience, from, to) => {
    assert.equal(from, "2026-01-01");
    assert.equal(to, "2026-01-02");
    return {
      releaseId: 41,
      audience: "embed" as const,
      workbook: aggregateWorkbook,
      bitrixPages: {
        source,
        summary: { date_from: "2026-01-01", date_to: "2026-01-01", page_rows: 2 },
        rows: [
          {
            report_date: "2026-01-01",
            url: "/same",
            path: "/same",
            material_id: "m-1",
            material_type_hint: "article",
            pageviews: 100,
            sessions: 30,
            users: 20,
            guests: 10,
            logged_in_hits: 60,
            anonymous_hits: 40,
            logged_in_sessions: 20,
            anonymous_sessions: 10,
            entry_sessions: 12,
            exit_sessions: 11,
            avg_session_duration_seconds: 10,
            top_utm_source: null,
            top_utm_medium: null,
            top_utm_campaign: null,
          },
          {
            report_date: "2026-01-02",
            url: "/same",
            path: "/same",
            material_id: "m-1",
            material_type_hint: "article",
            pageviews: 50,
            sessions: 10,
            users: 8,
            guests: 4,
            logged_in_hits: 30,
            anonymous_hits: 20,
            logged_in_sessions: 6,
            anonymous_sessions: 4,
            entry_sessions: 5,
            exit_sessions: 4,
            avg_session_duration_seconds: 30,
            top_utm_source: "social",
            top_utm_medium: "post",
            top_utm_campaign: "secondary",
          },
        ],
      },
      journeyTransitions: { source, rows: [] },
    };
  };

  const result = await loadAbbottBiDataWithDependencies(
    7,
    ["90602537"],
    "2026-01-01",
    "2026-01-02",
    "embed",
    deps,
  );

  assert.deepEqual(result.bitrix_pages, [{
    url: "/same",
    path: "/same",
    direction: null,
    material_type: "article",
    access: null,
    pageviews: 150,
    sessions: 40,
    users: 28,
    guests: 14,
    logged_in_hits: 90,
    anonymous_hits: 60,
    logged_in_sessions: 26,
    anonymous_sessions: 14,
    entry_sessions: 17,
    exit_sessions: 15,
    avg_session_duration: 15,
    top_utm_source: "social",
    top_utm_medium: "post",
    top_utm_campaign: "secondary",
  }]);
});

test("manager summarizes exact private visits by raw user and source", async () => {
  const aggregate = executor(aggregateRows);
  const privateDb = executor((sql, params) => {
    assert.match(sql, /`report_bd_private`\.`canonical_fact_metrika_visits`/);
    assert.doesNotMatch(sql, /canonical_fact_metrika_user_behavior_daily/);
    assert.match(sql, /SELECT raw_user_id, client_id_hash, traffic_source, start_url, end_url,/);
    assert.match(sql, /pageviews, duration_seconds, is_bounce/);
    assert.doesNotMatch(sql, /CAST\s*\(|UNSIGNED|CONVERT\s*\(/i);
    assert.deepEqual(params, [41, "90602537", "2026-01-01", "2026-01-01"]);
    return [
      { raw_user_id: "000123", client_id_hash: "client-a", traffic_source: "Direct", start_url: "/start-1", end_url: "/end-1", pageviews: "3", duration_seconds: "10", is_bounce: "1" },
      { raw_user_id: "000123", client_id_hash: "client-a", traffic_source: "Direct", start_url: "/start-2", end_url: "/end-2", pageviews: "5", duration_seconds: "30", is_bounce: "0" },
      { raw_user_id: "000123", client_id_hash: "client-b", traffic_source: "Organic", start_url: "/start-3", end_url: "/end-3", pageviews: "2", duration_seconds: "20", is_bounce: "0" },
      { raw_user_id: null, client_id_hash: "anon-a", traffic_source: "Direct", start_url: "/anon-1", end_url: "/anon-end-1", pageviews: "1", duration_seconds: "5", is_bounce: "1" },
      { raw_user_id: null, client_id_hash: "", traffic_source: "Direct", start_url: "/anon-2", end_url: "/anon-end-2", pageviews: "3", duration_seconds: "15", is_bounce: "0" },
    ];
  });

  const result = await loadAbbottBiDataWithDependencies(
    7,
    ["90602537"],
    "2026-01-01",
    "2026-01-01",
    "manager",
    dependencies(aggregate, privateDb),
  );

  assert.equal(result.access_level, "manager");
  assert.deepEqual(result.users_summary, [
    {
      user_id: "",
      has_user_id: false,
      traffic_segment: null,
      traffic_source: "Direct",
      direction: null,
      visits: 2,
      users: 1,
      new_users: 0,
      page_depth: 2,
      avg_duration: 10,
      bounce_rate: 50,
    },
    {
      user_id: "000123",
      has_user_id: true,
      traffic_segment: null,
      traffic_source: "Direct",
      direction: "Cardiology",
      visits: 2,
      users: 1,
      new_users: 0,
      page_depth: 4,
      avg_duration: 20,
      bounce_rate: 50,
    },
    {
      user_id: "000123",
      has_user_id: true,
      traffic_segment: null,
      traffic_source: "Organic",
      direction: "Cardiology",
      visits: 1,
      users: 1,
      new_users: 0,
      page_depth: 2,
      avg_duration: 20,
      bounce_rate: 0,
    },
  ]);
  assert.deepEqual(result.user_actions[0], {
    user_id: "000123",
    has_user_id: true,
    traffic_source: "Direct",
    direction: "Cardiology",
    start_url: "/start-1",
    end_url: "/end-1",
    visits: 1,
    page_depth: 3,
    avg_duration: 10,
  });
  assert.deepEqual(result.user_actions[3], {
    user_id: "",
    has_user_id: false,
    traffic_source: "Direct",
    direction: null,
    start_url: "/anon-1",
    end_url: "/anon-end-1",
    visits: 1,
    page_depth: 1,
    avg_duration: 5,
  });
  assert.equal(result.user_actions.length, 5);
  assert.equal(privateDb.queries.length, 1);
});

test("Abbott calls without a trusted audience fail closed before any query", async () => {
  const aggregate = executor(() => {
    throw new Error("must not query");
  });
  const privateDb = executor(() => {
    throw new Error("must not query");
  });

  await assert.rejects(
    loadAbbottBiDataWithDependencies(
      7,
      ["90602537"],
      "2026-01-01",
      "2026-01-01",
      undefined,
      dependencies(aggregate, privateDb),
    ),
    /trusted audience is required/i,
  );
  assert.equal(aggregate.queries.length, 0);
  assert.equal(privateDb.queries.length, 0);
});

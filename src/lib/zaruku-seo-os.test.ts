import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrafficVisibility,
  buildSeoOsAccountQueries,
  buildSeoOsTrafficQuery,
  buildRhythmWeeks,
  buildSectionPositionTrend,
  calculateApproveRate,
  isoWeekDateRange,
  loadZarukuSeoOsData,
  matchSectionPattern,
  normalizeSeoClusterRow,
  normalizeSeoOpportunityRow,
  previousAvailableWeek,
  sortIsoWeeks,
} from "@/lib/zaruku-seo-os";

const patterns = [
  { section: "/content/", url_pattern: "/", priority: 99 },
  { section: "/map/", url_pattern: "/map/", priority: 1 },
  { section: "/map/clinics/", url_pattern: "/map/clinics/", priority: 5 },
  { section: "/priority-a/", url_pattern: "/priority/", priority: 10 },
  { section: "/priority-b/", url_pattern: "/priority/", priority: 1 },
];

test("sortIsoWeeks orders ISO weeks across year boundaries", () => {
  assert.deepEqual(sortIsoWeeks(["2026-W02", "2025-W52", "2026-W01"]), ["2025-W52", "2026-W01", "2026-W02"]);
});

test("previousAvailableWeek selects the preceding available week", () => {
  assert.equal(previousAvailableWeek(["2026-W28", "2026-W30"], "2026-W30"), "2026-W28");
  assert.equal(previousAvailableWeek(["2026-W28"], "2026-W28"), null);
});

test("matchSectionPattern selects the longest matching pattern before priority", () => {
  assert.equal(matchSectionPattern("https://zaruku.ru/map/clinics/42", patterns)?.section, "/map/clinics/");
  assert.equal(matchSectionPattern("https://zaruku.ru/map/moscow/1", patterns)?.section, "/map/");
  assert.equal(matchSectionPattern("https://zaruku.ru/priority/test", patterns)?.section, "/priority-b/");
});

test("matchSectionPattern uses the configured root pattern as fallback", () => {
  assert.equal(matchSectionPattern("https://zaruku.ru/unknown", patterns)?.section, "/content/");
});

test("buildSectionPositionTrend excludes null positions from averages and includes no-data rows in coverage", () => {
  assert.deepEqual(
    buildSectionPositionTrend([
      { week: "2026-W28", section: "/map/", serp_position: 4, status: "found" },
      { week: "2026-W28", section: "/map/", serp_position: null, status: "no_data" },
      { week: "2026-W28", section: "/map/", serp_position: 8, status: "found" },
    ]),
    [
      {
        week: "2026-W28",
        section: "/map/",
        average_position: 6,
        coverage: 2 / 3,
        found_rows: 2,
        tracked_rows: 3,
      },
    ],
  );
});

test("calculateApproveRate excludes undecided opportunities from its denominator", () => {
  assert.equal(calculateApproveRate([{ decision: "approved" }, { decision: "rejected" }, { decision: "pending" }]), 50);
  assert.equal(calculateApproveRate([{ decision: "pending" }, { decision: "carried_over" }]), null);
});

test("buildRhythmWeeks inserts missing ISO weeks between available runs", () => {
  assert.deepEqual(
    buildRhythmWeeks([
      { week: "2026-W28", status: "completed", serp_requests: 50, llm_tokens: 0, digest_count: 1 },
      { week: "2026-W30", status: "noop", serp_requests: 0, llm_tokens: 0, digest_count: 0 },
    ]),
    [
      { week: "2026-W28", status: "completed", serp_requests: 50, llm_tokens: 0, digest_count: 1 },
      { week: "2026-W29", status: "missing", serp_requests: null, llm_tokens: null, digest_count: null },
      { week: "2026-W30", status: "noop", serp_requests: 0, llm_tokens: 0, digest_count: 0 },
    ],
  );
});

test("buildRhythmWeeks accepts and preserves a zero-padded early ISO week 53", () => {
  assert.deepEqual(
    buildRhythmWeeks([{ week: "0004-W53", status: "completed", serp_requests: 1, llm_tokens: 0, digest_count: 0 }]),
    [{ week: "0004-W53", status: "completed", serp_requests: 1, llm_tokens: 0, digest_count: 0 }],
  );
});

test("buildRhythmWeeks iterates through a 53-week ISO year boundary", () => {
  assert.deepEqual(
    buildRhythmWeeks([
      { week: "2020-W52", status: "completed", serp_requests: 1, llm_tokens: 0, digest_count: 0 },
      { week: "2021-W02", status: "completed", serp_requests: 1, llm_tokens: 0, digest_count: 0 },
    ]).map(({ week, status }) => ({ week, status })),
    [
      { week: "2020-W52", status: "completed" },
      { week: "2020-W53", status: "missing" },
      { week: "2021-W01", status: "missing" },
      { week: "2021-W02", status: "completed" },
    ],
  );
});

test("SEO OS row normalizers convert decimal strings while preserving nullable fields", () => {
  assert.deepEqual(
    normalizeSeoClusterRow({
      week: "2026-W28",
      section: "/map/",
      cluster_id: "cluster-1",
      query: "clinic",
      serp_position: null,
      delta_prev: "-2.50",
      matched_url: null,
      status: "no_data",
    }),
    {
      week: "2026-W28",
      section: "/map/",
      cluster_id: "cluster-1",
      query: "clinic",
      serp_position: null,
      delta_prev: -2.5,
      matched_url: null,
      status: "no_data",
    },
  );
  assert.deepEqual(
    normalizeSeoOpportunityRow({
      week: "2026-W28",
      opportunity_id: "opportunity-1",
      section: null,
      opportunity_type: "content",
      title: "Add clinic page",
      target_url: null,
      decision: "pending",
      reject_reason: null,
      confidence: "0.75",
      priority: "high",
    }),
    {
      week: "2026-W28",
      opportunity_id: "opportunity-1",
      section: null,
      opportunity_type: "content",
      title: "Add clinic page",
      target_url: null,
      decision: "pending",
      reject_reason: null,
      confidence: 0.75,
      priority: "high",
    },
  );
});

test("SEO OS account scope query builders bind account IDs as parameters", () => {
  const accountIds = ["66624469", "other-account"];
  const queries = [...Object.values(buildSeoOsAccountQueries(accountIds)), buildSeoOsTrafficQuery(accountIds, "2026-07-06", "2026-07-12")];

  for (const query of queries) {
    assert.match(query.sql, /analytics_account_id\s+IN\s*\(\?, \?\)/i);
    assert.deepEqual(query.params.slice(0, accountIds.length), accountIds);
  }
  assert.match(queries.at(-1)?.sql ?? "", /source_key\s*=\s*'yandex_metrika'/i);
  assert.match(queries.at(-1)?.sql ?? "", /analytics_scope\s*=\s*'page'/i);
  assert.match(queries.at(-1)?.sql ?? "", /report_date\s+BETWEEN\s+\?\s+AND\s+\?/i);
});

test("buildRhythmWeeks represents SEO weeks without run telemetry as missing", () => {
  assert.deepEqual(
    buildRhythmWeeks([], ["2026-W28"]),
    [{ week: "2026-W28", status: "missing", serp_requests: null, llm_tokens: null, digest_count: null }],
  );
});

test("isoWeekDateRange returns deterministic Monday through Sunday boundaries", () => {
  assert.deepEqual(isoWeekDateRange("2026-W28"), { from: "2026-07-06", to: "2026-07-12" });
  assert.deepEqual(isoWeekDateRange("2026-W01"), { from: "2025-12-29", to: "2026-01-04" });
});

test("buildTrafficVisibility aggregates every traffic metric with authoritative pattern precedence", () => {
  assert.deepEqual(
    buildTrafficVisibility(
      [
        { report_date: "2026-07-06", page_url: "https://zaruku.ru/map/clinics/42", visits: "3", users: "2", pageviews: "5" },
        { report_date: "2026-07-12", page_url: "https://zaruku.ru/map/clinics/99", visits: 4, users: 3, pageviews: 6 },
        { report_date: "2026-07-12", page_url: "https://zaruku.ru/priority/test", visits: 7, users: 6, pageviews: 8 },
        { report_date: "2026-07-13", page_url: "https://zaruku.ru/unknown", visits: 11, users: 10, pageviews: 12 },
      ],
      patterns,
      [],
    ),
    [
      { week: "2026-W28", section: "/map/clinics/", visits: 7, users: 5, pageviews: 11, average_position: null, coverage: null },
      { week: "2026-W28", section: "/priority-b/", visits: 7, users: 6, pageviews: 8, average_position: null, coverage: null },
      { week: "2026-W29", section: "/content/", visits: 11, users: 10, pageviews: 12, average_position: null, coverage: null },
    ],
  );
});

test("loadZarukuSeoOsData normalizes an empty account scope to the Zaruku fallback", async () => {
  const queries: Array<{ sql: string; params: string[] }> = [];
  const data = await loadZarukuSeoOsData([], async (query) => {
    queries.push(query);
    return [];
  });

  assert.equal(data.available, true);
  assert.equal(data.status, "available");
  assert.equal(queries.length, 5);
  for (const query of queries) {
    assert.doesNotMatch(query.sql, /IN\s*\(\s*\)/i);
    assert.deepEqual(query.params, ["66624469"]);
  }
});

test("loadZarukuSeoOsData preserves successful patterns when positions fail", async () => {
  const data = await loadZarukuSeoOsData(["66624469"], async (query) => {
    if (/FROM seo_section_patterns/i.test(query.sql)) {
      return [{ section: "/map/", url_pattern: "/map/", priority: 1 }];
    }
    if (/FROM seo_positions_weekly/i.test(query.sql)) throw new Error("positions unavailable");
    return [];
  });

  assert.equal(data.available, true);
  assert.equal(data.status, "partial");
  assert.equal(data.data_availability.section_patterns, true);
  assert.equal(data.data_availability.positions, false);
  assert.deepEqual(data.section_patterns, [{ section: "/map/", url_pattern: "/map/", priority: 1 }]);
  assert.match(data.error ?? "", /positions: positions unavailable/);
});

test("loadZarukuSeoOsData preserves other successful tables after a partial failure", async () => {
  const data = await loadZarukuSeoOsData(["66624469"], async (query) => {
    if (/FROM seo_section_patterns/i.test(query.sql)) return [{ section: "/map/", url_pattern: "/map/", priority: 1 }];
    if (/FROM seo_positions_weekly/i.test(query.sql)) {
      return [{ week: "2026-W28", section: "/map/", cluster_id: "map", query: "clinic", serp_position: 4, delta_prev: null, matched_url: null, status: "found" }];
    }
    if (/FROM seo_opportunities/i.test(query.sql)) throw new Error("opportunities unavailable");
    return [];
  });

  assert.equal(data.status, "partial");
  assert.equal(data.data_availability.positions, true);
  assert.equal(data.data_availability.opportunities, false);
  assert.equal(data.data_availability.traffic_visibility, true);
  assert.equal(data.clusters.length, 1);
  assert.deepEqual(data.position_trend, [
    { week: "2026-W28", section: "/map/", average_position: 4, coverage: 1, found_rows: 1, tracked_rows: 1 },
  ]);
});

test("loadZarukuSeoOsData marks total SEO database failure unavailable", async () => {
  const data = await loadZarukuSeoOsData(["66624469"], async () => {
    throw new Error("seo database unavailable");
  });

  assert.equal(data.available, false);
  assert.equal(data.status, "unavailable");
  assert.deepEqual(data.data_availability, {
    section_patterns: false,
    positions: false,
    opportunities: false,
    tasks: false,
    runs: false,
    traffic_visibility: false,
  });
  assert.deepEqual(data.section_patterns, []);
  assert.deepEqual(data.clusters, []);
  assert.match(data.error ?? "", /positions: seo database unavailable/);
});

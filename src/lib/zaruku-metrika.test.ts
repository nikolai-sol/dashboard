import assert from "node:assert/strict";
import test from "node:test";
import {
  ZARUKU_METRIKA_BREAKDOWN_REPORTS,
  buildZarukuMetrikaOrganicLandingWeekQueries,
  buildZarukuMetrikaBreakdownQueries,
  loadZarukuMetrikaBreakdowns,
  loadZarukuMetrikaOrganicLandingWeeks,
} from "@/lib/zaruku-metrika";

const accountIds = ["66624469", "secondary"];
const range = { from: "2026-07-20", to: "2026-07-21" };

test("detail SQL keeps trusted presentation limits out of mysql2 execute bindings", () => {
  const queries = buildZarukuMetrikaBreakdownQueries(accountIds, range);

  assert.equal(ZARUKU_METRIKA_BREAKDOWN_REPORTS.length, 12);
  for (const report of ZARUKU_METRIKA_BREAKDOWN_REPORTS) {
    const marker = `/* report_key: ${report.key} */`;
    const start = queries.detail.sql.indexOf(marker);
    assert.notEqual(start, -1, `${report.key} query marker must exist`);
    const next = queries.detail.sql.indexOf("/* report_key:", start + marker.length);
    const sql = queries.detail.sql.slice(start, next === -1 ? undefined : next);

    assert.match(sql, /source_key\s*=\s*'yandex_metrika'/i);
    assert.match(sql, /analytics_account_id\s+IN\s*\(\s*\?\s*,\s*\?\s*\)/i);
    assert.match(sql, /report_key\s*=\s*\?/i);
    assert.match(sql, /segment_key\s*=\s*'russia'/i);
    assert.match(sql, /report_date\s+BETWEEN\s+\?\s+AND\s+\?/i);
    assert.match(sql, /row_kind\s+IN\s*\(\s*'detail'\s*,\s*'total'\s*\)/i);
    assert.match(
      sql,
      new RegExp(`GROUP\\s+BY[\\s\\S]*LIMIT\\s+${report.limit + 1}\\b`, "i"),
    );
    assert.doesNotMatch(sql, /LIMIT\s+\?/i);
    assert.ok(
      sql.search(/GROUP\s+BY/i) < sql.search(/LIMIT\s+\d+/i),
      `${report.key} must apply its presentation limit after GROUP BY`,
    );
  }

  assert.equal(
    queries.detail.params.filter((value) => value === "2026-07-20").length,
    12,
  );
  assert.equal(
    queries.detail.params.filter((value) => value === "2026-07-21").length,
    12,
  );
  assert.equal(
    queries.detail.params.filter((value) => typeof value === "number").length,
    0,
  );
});

test("detail SQL aggregates additive metrics and visit-weights rates before calculating share", () => {
  const { sql } = buildZarukuMetrikaBreakdownQueries(["66624469"], range).detail;

  assert.match(sql, /SUM\(COALESCE\(visits,\s*0\)\)\s+AS\s+visits/i);
  assert.match(sql, /SUM\(COALESCE\(pageviews,\s*0\)\)\s+AS\s+pageviews/i);
  for (const metric of [
    "bounce_rate",
    "avg_visit_duration_seconds",
    "page_depth",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `SUM\\(COALESCE\\(${metric},\\s*0\\)\\s*\\*\\s*COALESCE\\(visits,\\s*0\\)\\)\\s*\\/\\s*NULLIF\\(SUM\\(COALESCE\\(visits,\\s*0\\)\\),\\s*0\\)`,
        "i",
      ),
    );
  }
  assert.match(
    sql,
    /visits\s*\/\s*NULLIF\(SUM\(visits\)\s+OVER\s*\(\s*PARTITION\s+BY\s+row_kind\s*\),\s*0\)\s*\*\s*100\s+AS\s+share/i,
  );
});

test("coverage SQL uses one bounded query with the same account, report, segment, and date scope", () => {
  const query = buildZarukuMetrikaBreakdownQueries(accountIds, range).coverage;

  assert.match(query.sql, /canonical_metrika_breakdown_coverage_daily/i);
  assert.match(query.sql, /source_key\s*=\s*'yandex_metrika'/i);
  assert.match(query.sql, /analytics_account_id\s+IN\s*\(\s*\?\s*,\s*\?\s*\)/i);
  assert.match(query.sql, /segment_key\s*=\s*'russia'/i);
  assert.match(query.sql, /report_date\s+BETWEEN\s+\?\s+AND\s+\?/i);
  assert.equal(
    query.params.filter((value) =>
      ZARUKU_METRIKA_BREAKDOWN_REPORTS.some((report) => report.key === value)
    ).length,
    12,
  );
});

test("loader executes one detail and one coverage query and fails closed per report", async () => {
  const calls: string[] = [];
  const readModel = await loadZarukuMetrikaBreakdowns(
    ["66624469"],
    { from: "2026-07-20", to: "2026-07-20" },
    async (query) => {
      calls.push(query.sql);
      if (query.sql.includes("canonical_metrika_breakdown_coverage_daily")) {
        return ZARUKU_METRIKA_BREAKDOWN_REPORTS.map((report) => ({
          report_key: report.key,
          coverage_rows: report.key === "interests" ? 0 : 1,
          complete_rows: report.key === "interests" ? 0 : 1,
        }));
      }
      return [
        {
          report_key: "devices",
          row_kind: "detail",
          dimension_1_id: "mobile",
          dimension_1_value: "Smartphones",
          dimension_2_id: null,
          dimension_2_value: null,
          page_url: null,
          visits: "60",
          users: "50",
          pageviews: "90",
          bounce_rate: "20",
          avg_visit_duration_seconds: "120",
          page_depth: "2.5",
          share: "75",
        },
        {
          report_key: "devices",
          row_kind: "total",
          dimension_1_id: null,
          dimension_1_value: null,
          dimension_2_id: null,
          dimension_2_value: null,
          page_url: null,
          visits: "80",
          users: "70",
          pageviews: "110",
          bounce_rate: "25",
          avg_visit_duration_seconds: "100",
          page_depth: "2",
          share: "100",
        },
        {
          report_key: "interests",
          row_kind: "detail",
          dimension_1_id: "health",
          dimension_1_value: "Health",
          dimension_2_id: null,
          dimension_2_value: null,
          page_url: null,
          visits: "10",
          users: "9",
          pageviews: "12",
          bounce_rate: "30",
          avg_visit_duration_seconds: "80",
          page_depth: "1.5",
          share: "100",
        },
      ];
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(readModel.reports.devices.available, true);
  assert.deepEqual(readModel.reports.devices.rows, [
    {
      id: "mobile",
      label: "Смартфоны",
      secondary_label: null,
      url: null,
      visits: 60,
      users: 50,
      users_available: true,
      pageviews: 90,
      bounce_rate: 20,
      avg_duration_seconds: 120,
      page_depth: 2.5,
      share: 75,
      source: "metrika",
      layer: "onsite",
    },
  ]);
  assert.equal(readModel.period_users, 70);
  assert.equal(readModel.reports.interests.available, false);
  assert.deepEqual(readModel.reports.interests.rows, []);
});

test("multi-day breakdowns never expose summed daily users as exact period users", async () => {
  const detailSql = buildZarukuMetrikaBreakdownQueries(
    ["66624469"],
    range,
  ).detail.sql;
  assert.doesNotMatch(detailSql, /SUM\(COALESCE\(users,\s*0\)\)/i);
  assert.match(detailSql, /\b0\s+AS\s+users\b/i);

  const readModel = await loadZarukuMetrikaBreakdowns(
    ["66624469"],
    range,
    async (query) => {
      if (query.sql.includes("canonical_metrika_breakdown_coverage_daily")) {
        return ZARUKU_METRIKA_BREAKDOWN_REPORTS.map((report) => ({
          report_key: report.key,
          coverage_rows: 2,
          complete_rows: 2,
        }));
      }
      return [
        {
          report_key: "devices",
          row_kind: "detail",
          dimension_1_id: "mobile",
          dimension_1_value: "Smartphones",
          dimension_2_id: null,
          dimension_2_value: null,
          page_url: null,
          visits: 60,
          users: 100,
          pageviews: 90,
          bounce_rate: 20,
          avg_visit_duration_seconds: 120,
          page_depth: 2.5,
          share: 75,
        },
        {
          report_key: "devices",
          row_kind: "total",
          dimension_1_id: null,
          dimension_1_value: null,
          dimension_2_id: null,
          dimension_2_value: null,
          page_url: null,
          visits: 80,
          users: 140,
          pageviews: 110,
          bounce_rate: 25,
          avg_visit_duration_seconds: 100,
          page_depth: 2,
          share: 100,
        },
      ];
    },
  );

  assert.equal(readModel.period_users, null);
  assert.equal(readModel.reports.devices.rows[0].users_available, false);
});

test("presentation limits do not truncate canonical report totals", async () => {
  const detailRows = Array.from({ length: 30 }, (_, index) => ({
    report_key: "search_phrases",
    row_kind: "detail",
    dimension_1_id: `phrase-${index}`,
    dimension_1_value: `Phrase ${index}`,
    dimension_2_id: null,
    dimension_2_value: null,
    page_url: null,
    visits: 10,
    users: 0,
    pageviews: 10,
    bounce_rate: 20,
    avg_visit_duration_seconds: 30,
    page_depth: 1,
    share: 1,
  }));
  const readModel = await loadZarukuMetrikaBreakdowns(
    ["66624469"],
    range,
    async (query) => {
      if (query.sql.includes("canonical_metrika_breakdown_coverage_daily")) {
        return ZARUKU_METRIKA_BREAKDOWN_REPORTS.map((report) => ({
          report_key: report.key,
          coverage_rows: 2,
          complete_rows: 2,
        }));
      }
      return [
        {
          report_key: "search_phrases",
          row_kind: "total",
          dimension_1_id: null,
          dimension_1_value: null,
          dimension_2_id: null,
          dimension_2_value: null,
          page_url: null,
          visits: 1_000,
          users: 0,
          pageviews: 1_000,
          bounce_rate: 20,
          avg_visit_duration_seconds: 30,
          page_depth: 1,
          share: 100,
        },
        ...detailRows,
      ];
    },
  );

  assert.equal(readModel.reports.search_phrases.rows.length, 30);
  assert.equal(readModel.reports.search_phrases.total_visits, 1_000);
});

test("weekly organic landing queries span complete ISO week boundaries", () => {
  const queries = buildZarukuMetrikaOrganicLandingWeekQueries(
    ["66624469"],
    ["2026-W30", "2026-W31"],
  );

  assert.ok(queries);
  assert.match(queries.detail.sql, /canonical_fact_metrika_breakdowns_daily/i);
  assert.match(queries.detail.sql, /report_key\s*=\s*'organic_landing'/i);
  assert.match(queries.detail.sql, /GROUP BY\s+week_key/i);
  assert.match(queries.coverage.sql, /canonical_metrika_breakdown_coverage_daily/i);
  assert.deepEqual(queries.detail.params.slice(-2), ["2026-07-20", "2026-08-02"]);
  assert.deepEqual(queries.coverage.params.slice(-2), ["2026-07-20", "2026-08-02"]);
});

test("weekly organic landing loader publishes only fully covered ISO weeks", async () => {
  const model = await loadZarukuMetrikaOrganicLandingWeeks(
    ["66624469"],
    ["2026-W30", "2026-W31"],
    async (query) => {
      if (query.sql.includes("canonical_metrika_breakdown_coverage_daily")) {
        return [
          { week_key: "2026-W30", coverage_rows: 7, complete_rows: 7 },
          { week_key: "2026-W31", coverage_rows: 3, complete_rows: 3 },
        ];
      }
      return [
        {
          week_key: "2026-W30",
          report_key: "organic_landing",
          row_kind: "detail",
          dimension_1_id: "google",
          dimension_1_value: "Google, search results",
          dimension_2_id: null,
          dimension_2_value: null,
          page_url: "https://zaruku.ru/example/",
          visits: 10,
          users: 0,
          pageviews: 12,
          bounce_rate: 20,
          avg_visit_duration_seconds: 60,
          page_depth: 2,
          share: 100,
        },
        {
          week_key: "2026-W31",
          report_key: "organic_landing",
          row_kind: "detail",
          dimension_1_id: "yandex",
          dimension_1_value: "Yandex, search results",
          dimension_2_id: null,
          dimension_2_value: null,
          page_url: "https://zaruku.ru/partial/",
          visits: 5,
          users: 0,
          pageviews: 6,
          bounce_rate: 10,
          avg_visit_duration_seconds: 30,
          page_depth: 1,
          share: 100,
        },
      ];
    },
  );

  assert.deepEqual(model.weeks, ["2026-W30"]);
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].week, "2026-W30");
  assert.equal(model.rows[0].url, "https://zaruku.ru/example/");
  assert.equal(model.rows[0].users_available, false);
});

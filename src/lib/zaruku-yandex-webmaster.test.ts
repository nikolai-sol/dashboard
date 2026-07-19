import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebmasterAccountQueries,
  loadZarukuYandexWebmasterData,
  normalizeWebmasterPageRow,
  normalizeWebmasterQueryRow,
  normalizeWebmasterSummaryRow,
} from "@/lib/zaruku-yandex-webmaster";

test("buildWebmasterAccountQueries scopes daily canonical rows by account and optional weeks", () => {
  const queries = buildWebmasterAccountQueries(["66624469"], ["2026-W28"]);

  assert.match(queries.queries.sql, /canonical_fact_webmaster_queries_daily/);
  assert.match(queries.queries.sql, /YEARWEEK\(report_date, 3\)[\s\S]*IN \(\?\)/);
  assert.deepEqual(queries.queries.params, ["66624469", "2026-W28"]);
  assert.match(queries.summary.sql, /canonical_fact_webmaster_summary_daily/);
  assert.deepEqual(queries.summary.params, ["66624469", "2026-W28"]);
  assert.match(queries.pages.sql, /canonical_fact_webmaster_pages_daily/);
  assert.deepEqual(queries.pages.params, ["66624469", "2026-W28"]);
  assert.doesNotMatch(queries.queries.sql, /seo_webmaster_queries_weekly/);
});

test("normalizeWebmasterQueryRow keeps CTR and position as percentages and decimals", () => {
  assert.deepEqual(
    normalizeWebmasterQueryRow({
      week_key: "2026-W28",
      query_id: "q:1",
      query_text: "рак молочной железы помощь",
      device_type: "ALL",
      impressions: "1000",
      clicks: "120",
      ctr: "12.000000",
      average_position: "4.6",
      week_from: "2026-07-06",
      week_to: "2026-07-12",
    }),
    {
      week: "2026-W28",
      query_id: "q:1",
      query: "рак молочной железы помощь",
      device: "ALL",
      impressions: 1000,
      clicks: 120,
      ctr: 12,
      average_position: 4.6,
      week_from: "2026-07-06",
      week_to: "2026-07-12",
      is_partial_week: false,
    },
  );
});

test("normalizeWebmasterSummaryRow preserves daily summary week coverage", () => {
  assert.deepEqual(
    normalizeWebmasterSummaryRow({
      week_key: "2026-W28",
      device_type: "ALL",
      impressions: "90",
      clicks: "9",
      ctr: "10",
      average_position: "3.25",
      week_from: "2026-07-06",
      week_to: "2026-07-10",
      is_partial_week: 1,
    }),
    {
      week: "2026-W28",
      device: "ALL",
      impressions: 90,
      clicks: 9,
      ctr: 10,
      average_position: 3.25,
      week_from: "2026-07-06",
      week_to: "2026-07-10",
      is_partial_week: true,
    },
  );
});

test("normalizeWebmasterPageRow keeps URL page metrics", () => {
  assert.deepEqual(
    normalizeWebmasterPageRow({
      week_key: "2026-W29",
      page_url: "/rak-molochnoj-zhelezy/reabilitaciya/",
      device_type: "ALL",
      impressions: "54",
      clicks: "5",
      ctr: "9.259259",
      average_position: "18.4",
      week_from: "2026-07-13",
      week_to: "2026-07-15",
      is_partial_week: 1,
    }),
    {
      week: "2026-W29",
      url: "/rak-molochnoj-zhelezy/reabilitaciya/",
      device: "ALL",
      impressions: 54,
      clicks: 5,
      ctr: 9.259259,
      average_position: 18.4,
      week_from: "2026-07-13",
      week_to: "2026-07-15",
      is_partial_week: true,
    },
  );
});

test("loadZarukuYandexWebmasterData is partial when one table is unavailable", async () => {
  const data = await loadZarukuYandexWebmasterData(["66624469"], ["2026-W28"], async (query) => {
    if (query.sql.includes("canonical_fact_webmaster_summary_daily")) throw new Error("missing table");
    if (query.sql.includes("canonical_fact_webmaster_pages_daily")) return [];
    return [
      {
        week_key: "2026-W28",
        query_id: "q:1",
        query_text: "за руку",
        device_type: "ALL",
        impressions: 10,
        clicks: 1,
        ctr: 10,
        average_position: 2,
        week_from: "2026-07-06",
        week_to: "2026-07-12",
      },
    ];
  });

  assert.equal(data.status, "partial");
  assert.equal(data.queries.length, 1);
  assert.equal(data.summary.length, 0);
  assert.equal(data.pages.length, 0);
  assert.match(data.error ?? "", /summary/);
});

test("loadZarukuYandexWebmasterData includes page facts when canonical table is present", async () => {
  const data = await loadZarukuYandexWebmasterData(["66624469"], ["2026-W29"], async (query) => {
    if (query.sql.includes("canonical_fact_webmaster_queries_daily")) return [];
    if (query.sql.includes("canonical_fact_webmaster_summary_daily")) return [];
    if (query.sql.includes("canonical_fact_webmaster_pages_daily")) {
      return [
        {
          week_key: "2026-W29",
          page_url: "/rak-molochnoj-zhelezy/reabilitaciya/",
          device_type: "ALL",
          impressions: 54,
          clicks: 5,
          ctr: 9.259259,
          average_position: 18.4,
          week_from: "2026-07-13",
          week_to: "2026-07-15",
          is_partial_week: 1,
        },
      ];
    }
    return [];
  });

  assert.equal(data.status, "available");
  assert.equal(data.data_availability.pages, true);
  assert.equal(data.latest_week, "2026-W29");
  assert.deepEqual(data.pages.map((row) => row.url), ["/rak-molochnoj-zhelezy/reabilitaciya/"]);
});

test("loadZarukuYandexWebmasterData does not fallback to latest week when selected week is empty", async () => {
  const data = await loadZarukuYandexWebmasterData(["66624469"], ["2026-W28"], async (query) => {
    assert.doesNotMatch(query.sql, /MAX\(week_key\)|seo_webmaster_/);
    return [];
  });

  assert.deepEqual(data.weeks, []);
  assert.equal(data.latest_week, null);
  assert.deepEqual(data.queries, []);
  assert.deepEqual(data.summary, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleSearchConsoleAccountQueries,
  loadZarukuGoogleSearchConsoleData,
  normalizeGscCountryRow,
  normalizeGscPageRow,
  normalizeGscQueryRow,
  normalizeGscSummaryRow,
} from "@/lib/zaruku-google-search-console";

test("buildGoogleSearchConsoleAccountQueries scopes canonical GSC rows by property and optional weeks", () => {
  const queries = buildGoogleSearchConsoleAccountQueries(["https://zaruku.ru/"], ["2026-W28"]);

  assert.match(queries.queries.sql, /canonical_fact_gsc_queries_daily/);
  assert.match(queries.pages.sql, /canonical_fact_gsc_pages_daily/);
  assert.match(queries.countries.sql, /canonical_fact_gsc_countries_daily/);
  assert.match(queries.summary.sql, /canonical_fact_gsc_summary_daily/);
  assert.match(queries.queries.sql, /YEARWEEK\(report_date, 3\)[\s\S]*IN \(\?\)/);
  assert.deepEqual(queries.queries.params, ["https://zaruku.ru/", "2026-W28"]);
  assert.deepEqual(queries.pages.params, ["https://zaruku.ru/", "2026-W28"]);
  assert.deepEqual(queries.countries.params, ["https://zaruku.ru/", "2026-W28"]);
  assert.deepEqual(queries.summary.params, ["https://zaruku.ru/", "2026-W28"]);
});

test("normalizeGscQueryRow keeps CTR as percent and preserves weighted average position", () => {
  assert.deepEqual(
    normalizeGscQueryRow({
      week_key: "2026-W28",
      query_id: "hash",
      query_text: "за руку",
      device_type: "DESKTOP",
      impressions: "1000",
      clicks: "123",
      ctr: "12.300000",
      average_position: "4.25",
      week_from: "2026-07-06",
      week_to: "2026-07-12",
      is_partial_week: 0,
    }),
    {
      week: "2026-W28",
      query_id: "hash",
      query: "за руку",
      device: "DESKTOP",
      impressions: 1000,
      clicks: 123,
      ctr: 12.3,
      average_position: 4.25,
      week_from: "2026-07-06",
      week_to: "2026-07-12",
      is_partial_week: false,
    },
  );
});

test("normalizeGscPageRow preserves URL facts", () => {
  assert.deepEqual(
    normalizeGscPageRow({
      week_key: "2026-W28",
      page_id: "pagehash",
      page_url: "https://zaruku.ru/rak-molochnoj-zhelezy/",
      device_type: "MOBILE",
      impressions: 90,
      clicks: 9,
      ctr: 10,
      average_position: 3.5,
      week_from: "2026-07-06",
      week_to: "2026-07-10",
      is_partial_week: 1,
    }),
    {
      week: "2026-W28",
      page_id: "pagehash",
      url: "https://zaruku.ru/rak-molochnoj-zhelezy/",
      device: "MOBILE",
      impressions: 90,
      clicks: 9,
      ctr: 10,
      average_position: 3.5,
      week_from: "2026-07-06",
      week_to: "2026-07-10",
      is_partial_week: true,
    },
  );
});

test("normalizeGscSummaryRow preserves daily summary week coverage", () => {
  assert.deepEqual(
    normalizeGscSummaryRow({
      week_key: "2026-W28",
      device_type: "ALL",
      impressions: 900,
      clicks: 45,
      ctr: 5,
      average_position: 7.1,
      week_from: "2026-07-06",
      week_to: "2026-07-12",
      is_partial_week: false,
    }),
    {
      week: "2026-W28",
      device: "ALL",
      impressions: 900,
      clicks: 45,
      ctr: 5,
      average_position: 7.1,
      week_from: "2026-07-06",
      week_to: "2026-07-12",
      is_partial_week: false,
    },
  );
});

test("normalizeGscCountryRow preserves country split facts", () => {
  assert.deepEqual(
    normalizeGscCountryRow({
      week_key: "2026-W28",
      country_code: "RUS",
      device_type: "MOBILE",
      impressions: "220",
      clicks: "11",
      ctr: "5.000000",
      average_position: "6.75",
      week_from: "2026-07-06",
      week_to: "2026-07-12",
      is_partial_week: 0,
    }),
    {
      week: "2026-W28",
      country_code: "RUS",
      device: "MOBILE",
      impressions: 220,
      clicks: 11,
      ctr: 5,
      average_position: 6.75,
      week_from: "2026-07-06",
      week_to: "2026-07-12",
      is_partial_week: false,
    },
  );
});

test("loadZarukuGoogleSearchConsoleData is partial when one canonical table is unavailable", async () => {
  const data = await loadZarukuGoogleSearchConsoleData(["https://zaruku.ru/"], ["2026-W28"], async (query) => {
    if (query.sql.includes("canonical_fact_gsc_pages_daily")) throw new Error("missing table");
    if (query.sql.includes("canonical_fact_gsc_countries_daily")) return [];
    if (query.sql.includes("canonical_fact_gsc_summary_daily")) {
      return [
        {
          week_key: "2026-W28",
          device_type: "ALL",
          impressions: 100,
          clicks: 5,
          ctr: 5,
          average_position: 3,
          week_from: "2026-07-06",
          week_to: "2026-07-12",
        },
      ];
    }
    return [
      {
        week_key: "2026-W28",
        query_id: "q",
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
  assert.equal(data.pages.length, 0);
  assert.equal(data.countries.length, 0);
  assert.equal(data.summary.length, 1);
  assert.match(data.error ?? "", /pages/);
});

test("loadZarukuGoogleSearchConsoleData does not fallback to latest week when selected week is empty", async () => {
  const data = await loadZarukuGoogleSearchConsoleData(["https://zaruku.ru/"], ["2026-W28"], async (query) => {
    assert.doesNotMatch(query.sql, /MAX\(week_key\)|seo_webmaster_/);
    return [];
  });

  assert.equal(data.status, "unavailable");
  assert.deepEqual(data.weeks, []);
  assert.equal(data.latest_week, null);
  assert.deepEqual(data.queries, []);
  assert.deepEqual(data.pages, []);
  assert.deepEqual(data.countries, []);
  assert.deepEqual(data.summary, []);
});

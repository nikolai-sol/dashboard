import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGscAccountQueries,
  loadGoogleSearchConsoleFacts,
  normalizeGscBrandSplitRow,
  normalizeGscCountrySummaryRow,
  normalizeGscLandingPageRow,
  normalizeGscSearchAppearanceRow,
  normalizeGscSearchTypeRow,
  normalizeGscQueryRow,
  normalizeGscSummaryRow,
} from "@/lib/zaruku-gsc";
import { buildPendingRequirements } from "@/lib/zaruku-seo";
import type { ZarukuYandexWebmasterData } from "@/lib/types";

const dateRange = { from: "2026-07-13", to: "2026-07-19" };

test("buildGscAccountQueries bounds every canonical GSC query by account and daily dates", () => {
  const queries = buildGscAccountQueries(["66624469"], dateRange);

  assert.match(queries.queries.sql, /canonical_fact_gsc_queries_daily/);
  for (const query of Object.values(queries)) {
    assert.match(
      query.sql,
      /analytics_account_id IN \(\?\)\s+AND report_date BETWEEN \? AND \?/,
    );
    assert.match(query.sql, /AND country = 'rus'/);
    assert.doesNotMatch(query.sql.slice(query.sql.indexOf("WHERE")), /YEARWEEK\(report_date/);
    assert.deepEqual(query.params, ["66624469", "2026-07-13", "2026-07-19"]);
  }
  assert.match(queries.search_appearance.sql, /canonical_fact_gsc_search_appearance_daily/);
  assert.match(queries.search_type_summary.sql, /canonical_fact_gsc_search_type_daily/);
});

test("normalizeGscSummaryRow preserves partial week coverage", () => {
  assert.deepEqual(
    normalizeGscSummaryRow({
      week_key: "2026-W29",
      device: "ALL",
      impressions: "900",
      clicks: "90",
      ctr: "10",
      average_position: "4.5",
      week_from: "2026-07-13",
      week_to: "2026-07-15",
      is_partial_week: 1,
    }),
    {
      week: "2026-W29",
      device: "ALL",
      impressions: 900,
      clicks: 90,
      ctr: 10,
      average_position: 4.5,
      week_from: "2026-07-13",
      week_to: "2026-07-15",
      is_partial_week: true,
    },
  );
});

test("normalizeGscQueryRow keeps canonical query page country and device facts", () => {
  assert.deepEqual(
    normalizeGscQueryRow({
      week_key: "2026-W29",
      query_id: "hash-1",
      query: "заруку",
      page: "https://zaruku.ru/",
      country: "rus",
      device: "MOBILE",
      impressions: "100",
      clicks: "7",
      ctr: "7",
      average_position: "3.25",
      week_from: "2026-07-13",
      week_to: "2026-07-15",
      is_partial_week: "1",
    }),
    {
      week: "2026-W29",
      query_id: "hash-1",
      query: "заруку",
      page: "https://zaruku.ru/",
      country: "rus",
      device: "MOBILE",
      impressions: 100,
      clicks: 7,
      ctr: 7,
      average_position: 3.25,
      week_from: "2026-07-13",
      week_to: "2026-07-15",
      is_partial_week: true,
    },
  );
});

test("normalizeGscCountrySummaryRow preserves country-level search facts", () => {
  assert.deepEqual(
    normalizeGscCountrySummaryRow({
      week_key: "2026-W29",
      country: "rus",
      impressions: "900",
      clicks: "90",
      ctr: "10",
      average_position: "4.5",
      week_from: "2026-07-13",
      week_to: "2026-07-15",
      is_partial_week: 1,
    }),
    {
      week: "2026-W29",
      country: "rus",
      impressions: 900,
      clicks: 90,
      ctr: 10,
      average_position: 4.5,
      week_from: "2026-07-13",
      week_to: "2026-07-15",
      is_partial_week: true,
    },
  );
});

test("normalizeGscLandingPageRow aggregates canonical pages", () => {
  assert.deepEqual(
    normalizeGscLandingPageRow({
      week_key: "2026-W29",
      page: "https://zaruku.ru/rak-molochnoj-zhelezy/",
      impressions: "100",
      clicks: "10",
      ctr: "10",
      average_position: "4.2",
      week_from: "2026-07-13",
      week_to: "2026-07-17",
      is_partial_week: 1,
    }),
    {
      week: "2026-W29",
      page: "https://zaruku.ru/rak-molochnoj-zhelezy/",
      impressions: 100,
      clicks: 10,
      ctr: 10,
      average_position: 4.2,
      week_from: "2026-07-13",
      week_to: "2026-07-17",
      is_partial_week: true,
    },
  );
});

test("normalizeGscBrandSplitRow keeps brand bucket facts", () => {
  assert.deepEqual(
    normalizeGscBrandSplitRow({
      week_key: "2026-W29",
      brand_bucket: "non_brand",
      impressions: "100",
      clicks: "10",
      ctr: "10",
      average_position: "4.2",
      week_from: "2026-07-13",
      week_to: "2026-07-17",
      is_partial_week: 1,
    }),
    {
      week: "2026-W29",
      bucket: "non_brand",
      impressions: 100,
      clicks: 10,
      ctr: 10,
      average_position: 4.2,
      week_from: "2026-07-13",
      week_to: "2026-07-17",
      is_partial_week: true,
    },
  );
});

test("normalizeGscSearchAppearanceRow keeps SERP feature facts", () => {
  assert.deepEqual(
    normalizeGscSearchAppearanceRow({
      week_key: "2026-W29",
      search_type: "web",
      search_appearance: "RICH_RESULTS",
      impressions: "200",
      clicks: "20",
      ctr: "10",
      average_position: "3.1",
      week_from: "2026-07-13",
      week_to: "2026-07-17",
      is_partial_week: 1,
    }),
    {
      week: "2026-W29",
      search_type: "web",
      search_appearance: "RICH_RESULTS",
      impressions: 200,
      clicks: 20,
      ctr: 10,
      average_position: 3.1,
      week_from: "2026-07-13",
      week_to: "2026-07-17",
      is_partial_week: true,
    },
  );
});

test("normalizeGscSearchTypeRow keeps Google result type facts", () => {
  assert.deepEqual(
    normalizeGscSearchTypeRow({
      week_key: "2026-W29",
      search_type: "image",
      impressions: "80",
      clicks: "4",
      ctr: "5",
      average_position: "6.1",
      week_from: "2026-07-13",
      week_to: "2026-07-17",
      is_partial_week: 1,
    }),
    {
      week: "2026-W29",
      search_type: "image",
      impressions: 80,
      clicks: 4,
      ctr: 5,
      average_position: 6.1,
      week_from: "2026-07-13",
      week_to: "2026-07-17",
      is_partial_week: true,
    },
  );
});

test("loadGoogleSearchConsoleFacts marks Search Console available when canonical rows exist", async () => {
  const data = await loadGoogleSearchConsoleFacts(["66624469"], dateRange, async (query) => {
    if (query.sql.includes("GROUP BY week_key, device")) {
      return [
        {
          week_key: "2026-W29",
          device: "ALL",
          impressions: 900,
          clicks: 90,
          ctr: 10,
          average_position: 4.5,
          week_from: "2026-07-13",
          week_to: "2026-07-15",
          is_partial_week: 1,
        },
      ];
    }
    if (query.sql.includes("GROUP BY week_key, country")) {
      return [
        {
          week_key: "2026-W29",
          country: "rus",
          impressions: 700,
          clicks: 70,
          ctr: 10,
          average_position: 4.7,
          week_from: "2026-07-13",
          week_to: "2026-07-15",
          is_partial_week: 1,
        },
      ];
    }
    if (query.sql.includes("GROUP BY week_key, page")) {
      return [
        {
          week_key: "2026-W29",
          page: "https://zaruku.ru/rak-molochnoj-zhelezy/",
          impressions: 100,
          clicks: 10,
          ctr: 10,
          average_position: 4.2,
          week_from: "2026-07-13",
          week_to: "2026-07-17",
          is_partial_week: 1,
        },
      ];
    }
    if (query.sql.includes("brand_bucket")) {
      return [
        {
          week_key: "2026-W29",
          brand_bucket: "non_brand",
          impressions: 800,
          clicks: 80,
          ctr: 10,
          average_position: 5.1,
          week_from: "2026-07-13",
          week_to: "2026-07-17",
          is_partial_week: 1,
        },
      ];
    }
    if (query.sql.includes("canonical_fact_gsc_search_appearance_daily")) {
      return [
        {
          week_key: "2026-W29",
          search_type: "web",
          search_appearance: "RICH_RESULTS",
          impressions: 200,
          clicks: 20,
          ctr: 10,
          average_position: 3.1,
          week_from: "2026-07-13",
          week_to: "2026-07-17",
          is_partial_week: 1,
        },
      ];
    }
    if (query.sql.includes("canonical_fact_gsc_search_type_daily")) {
      return [
        {
          week_key: "2026-W29",
          search_type: "image",
          impressions: 80,
          clicks: 4,
          ctr: 5,
          average_position: 6.1,
          week_from: "2026-07-13",
          week_to: "2026-07-17",
          is_partial_week: 1,
        },
      ];
    }
    return [
      {
        week_key: "2026-W29",
        query_id: "hash-1",
        query: "заруку",
        page: "https://zaruku.ru/",
        country: "rus",
        device: "MOBILE",
        impressions: 100,
        clicks: 7,
        ctr: 7,
        average_position: 3.25,
        week_from: "2026-07-13",
        week_to: "2026-07-15",
        is_partial_week: 1,
      },
    ];
  });

  assert.equal(data.status, "available");
  assert.equal(data.latest_week, "2026-W29");
  assert.equal(data.data_availability.queries, true);
  assert.equal(data.data_availability.summary, true);
  assert.equal(data.data_availability.country_summary, true);
  assert.equal(data.data_availability.landing_pages, true);
  assert.equal(data.data_availability.brand_split, true);
  assert.equal(data.data_availability.search_appearance, true);
  assert.equal(data.data_availability.search_type_summary, true);
  assert.equal(data.summary.length, 1);
  assert.equal(data.country_summary.length, 1);
  assert.equal(data.country_summary[0].country, "rus");
  assert.equal(data.queries.length, 1);
  assert.equal(data.landing_pages.length, 1);
  assert.equal(data.landing_pages[0].page, "https://zaruku.ru/rak-molochnoj-zhelezy/");
  assert.equal(data.brand_split.length, 1);
  assert.equal(data.brand_split[0].bucket, "non_brand");
  assert.equal(data.search_appearance.length, 1);
  assert.equal(data.search_appearance[0].search_appearance, "RICH_RESULTS");
  assert.equal(data.search_type_summary.length, 1);
  assert.equal(data.search_type_summary[0].search_type, "image");
});

test("loadGoogleSearchConsoleFacts is unavailable when the requested date range has zero core rows", async () => {
  const data = await loadGoogleSearchConsoleFacts(
    ["66624469"],
    dateRange,
    async () => [],
  );

  assert.equal(data.available, false);
  assert.equal(data.status, "unavailable");
  assert.deepEqual(data.weeks, []);
  assert.equal(data.latest_week, null);
  assert.deepEqual(data.data_availability, {
    queries: false,
    summary: false,
    country_summary: false,
    landing_pages: false,
    brand_split: false,
    search_appearance: false,
    search_type_summary: false,
  });
});

test("optional GSC rows cannot supply a latest-week fallback when core rows are empty", async () => {
  const data = await loadGoogleSearchConsoleFacts(["66624469"], dateRange, async (query) => {
    if (query.sql.includes("canonical_fact_gsc_search_type_daily")) {
      return [
        {
          week_key: "2026-W29",
          search_type: "image",
          impressions: 80,
          clicks: 4,
          ctr: 5,
          average_position: 6.1,
          week_from: "2026-07-13",
          week_to: "2026-07-17",
          is_partial_week: 1,
        },
      ];
    }
    return [];
  });

  assert.equal(data.available, false);
  assert.equal(data.status, "unavailable");
  assert.deepEqual(data.weeks, []);
  assert.equal(data.latest_week, null);
  assert.equal(data.data_availability.search_type_summary, true);
});

test("empty optional enrichment does not block available core GSC facts", async () => {
  const data = await loadGoogleSearchConsoleFacts(["66624469"], dateRange, async (query) => {
    if (query.sql.includes("GROUP BY week_key, device")) {
      return [
        {
          week_key: "2026-W29",
          device: "ALL",
          impressions: 900,
          clicks: 90,
          ctr: 10,
          average_position: 4.5,
          week_from: "2026-07-13",
          week_to: "2026-07-15",
          is_partial_week: 1,
        },
      ];
    }
    return [];
  });

  assert.equal(data.available, true);
  assert.equal(data.status, "available");
  assert.equal(data.latest_week, "2026-W29");
  assert.equal(data.data_availability.search_appearance, false);
  assert.equal(data.data_availability.search_type_summary, false);
});

test("zero-row GSC facts flow through to the dashboard pending requirement", async () => {
  const gsc = await loadGoogleSearchConsoleFacts(["66624469"], dateRange, async () => []);
  const webmaster: ZarukuYandexWebmasterData = {
    available: true,
    status: "available",
    error: null,
    data_availability: { queries: true, pages: true },
    weeks: ["2026-W29"],
    latest_week: "2026-W29",
    summary: [],
    queries: [],
    pages: [],
  };

  assert.deepEqual(
    buildPendingRequirements(webmaster, gsc).map((requirement) => requirement.source),
    ["gsc"],
  );
});

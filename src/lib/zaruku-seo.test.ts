import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as zarukuSeoModule from "@/lib/zaruku-seo";
import {
  buildCanonicalPageRowsQuery,
  buildBestEngagementPages,
  buildContentSections,
  buildHighBouncePages,
  buildKpis,
  buildMapCityDemand,
  buildPageCollections,
  buildSources,
  deriveSourceDataThrough,
  buildReturningPagesQuery,
  buildSourceFreshnessQuery,
  filterSearchEngineRows,
  enrichRowsWithPageTitles,
  mergeTopPagesWithVisitMetrics,
  normalizeSourceFreshnessRow,
  readableTrafficSource,
} from "@/lib/zaruku-seo";
import type {
  ZarukuGscData,
  ZarukuSeoIntelligenceData,
  ZarukuSeoMetricRow,
  ZarukuSeoSectionPattern,
  ZarukuYandexWebmasterData,
} from "@/lib/types";

function page(url: string, visits: number, users: number, pageviews: number): ZarukuSeoMetricRow {
  return {
    label: url,
    url,
    visits,
    users,
    pageviews,
    share: 0,
    source: "metrika",
    layer: "onsite",
  };
}

function pageWithBehavior(
  url: string,
  visits: number,
  users: number,
  pageviews: number,
  bounceRate: number,
  avgDurationSeconds: number,
  pageDepth: number,
): ZarukuSeoMetricRow {
  return {
    ...page(url, visits, users, pageviews),
    bounce_rate: bounceRate,
    avg_duration_seconds: avgDurationSeconds,
    page_depth: pageDepth,
  };
}

const patterns: ZarukuSeoSectionPattern[] = [
  { section: "Root", url_pattern: "/", priority: 99 },
  { section: "Map", url_pattern: "/map/", priority: 1 },
  { section: "Clinics", url_pattern: "/map/clinics/", priority: 5 },
  { section: "Priority A", url_pattern: "/priority/", priority: 10 },
  { section: "Priority B", url_pattern: "/priority/", priority: 1 },
];

test("buildSources exposes collection provenance and preserves explicit data-through values", () => {
  const gsc: ZarukuGscData = {
    available: true,
    status: "available",
    error: null,
    data_availability: {
      queries: true,
      summary: true,
      country_summary: true,
      landing_pages: true,
      brand_split: true,
      search_appearance: true,
      search_type_summary: true,
    },
    weeks: ["2026-W28"],
    latest_week: "2026-W28",
    summary: [],
    country_summary: [],
    queries: [],
    landing_pages: [],
    brand_split: [],
    search_appearance: [],
    search_type_summary: [],
  };
  const webmaster: ZarukuYandexWebmasterData = {
    available: true,
    status: "available",
    error: null,
    data_availability: { queries: true, pages: false },
    weeks: ["2026-W28"],
    latest_week: "2026-W28",
    summary: [],
    queries: [],
    pages: [],
  };
  const seoIntelligence: ZarukuSeoIntelligenceData = {
    available: true,
    status: "available",
    error: null,
    sov: { available: true, weeks: [], latest_week: null, rows: [] },
    ai: {
      available: true,
      periods: ["2026-07"],
      latest_period: "2026-07",
      rows: [
        {
          engine: "alisa_ai",
          period: "2026-07",
          presence_rate: 44,
          mentions: 89,
          citations: 155,
          provenance: "wm_alisa_manual",
          captured_at: "2026-07-13 14:30:00",
          ingestion_run_id: "seo_os_ai_visibility_2026-07_alisa_ai",
        },
      ],
    },
  };
  const dataThrough = {
    metrika: null,
    gsc: "2026-07-12",
    webmaster: "2026-07-12",
    seo_os: "2026-W28",
    yandex_gen_search: "2026-07-13 14:30:00",
  } as const;

  const sources = buildSources({
    seoOsStatus: "available",
    gsc,
    webmaster,
    seoIntelligence,
    dataThrough,
  });
  const source = (id: (typeof sources)[number]["id"]) => sources.find((item) => item.id === id)!;

  assert.equal(source("metrika").collection_mode, "automated");
  assert.equal(source("gsc").collection_mode, "automated");
  assert.equal(source("webmaster").collection_mode, "automated");
  assert.equal(source("seo_os").collection_mode, "external");
  assert.equal(source("yandex_gen_search").collection_mode, "manual");
  assert.equal(source("gsc").status, "connected");
  assert.equal(source("yandex_gen_search").status, "connected");
  assert.deepEqual(
    Object.fromEntries(sources.map((item) => [item.id, item.data_through])),
    dataThrough,
  );
});

test("deriveSourceDataThrough uses only loaded Webmaster, SEO OS, and AI freshness facts", () => {
  assert.deepEqual(
    deriveSourceDataThrough({
      gscSummary: [{ week_to: "2026-07-11" }, { week_to: "2026-07-12" }],
      webmasterSummary: [
        { week_to: "2026-07-05" },
        { week_to: "2026-07-12" },
        { week_to: "2026-07-10" },
      ],
      seoOsLatestWeek: "2026-W28",
      aiLatestPeriod: "2026-07",
      aiRows: [
        { period: "2026-06", captured_at: "2026-07-15 10:00:00" },
        { period: "2026-07", captured_at: "2026-07-13 14:30:00" },
      ],
    }),
    {
      metrika: null,
      gsc: "2026-07-12",
      webmaster: "2026-07-12",
      seo_os: "2026-W28",
      yandex_gen_search: "2026-07-13 14:30:00",
    },
  );
});

test("deriveSourceDataThrough falls back to AI period when capture time is absent", () => {
  const dataThrough = deriveSourceDataThrough({
    gscSummary: [],
    webmasterSummary: [],
    seoOsLatestWeek: null,
    aiLatestPeriod: "2026-07",
    aiRows: [{ period: "2026-07", captured_at: null }],
  });

  assert.equal(dataThrough.yandex_gen_search, "2026-07");
});

const loaderSource = readFileSync(new URL("./zaruku-seo.ts", import.meta.url), "utf8");
const accountReadModelsSource = readFileSync(new URL("./account-read-models.ts", import.meta.url), "utf8");

test("Zaruku applies one effective daily period to every daily loader while SEO OS and AI remain independent", () => {
  assert.match(
    loaderSource,
    /const dailyPeriod = resolveZarukuDailyPeriod\([\s\S]*?const \{ from: effectiveFrom, to: effectiveTo \} = dailyPeriod\.effective;/,
  );
  for (const loader of [
    "queryTrafficRows",
    "queryCanonicalPageRows",
    "queryOrganicTrend",
    "queryReturningPages",
    "fetchMetrikaReportsSequential",
  ]) {
    assert.ok(loaderSource.includes(`${loader}(normalizedCounterIds, effectiveFrom, effectiveTo`));
  }
  assert.match(loaderSource, /loadAccountFacts\(accountId, dailyPeriod\.effective\)/);
  assert.doesNotMatch(loaderSource, /loadAccountFacts\([^)]*seoOs\.weeks/);
  assert.match(loaderSource, /loadSeoProcess\(accountId\)/);
  assert.match(loaderSource, /loadSeoIntelligence\(accountId\)/);
});

test("account facts pass the same daily date range directly to GSC and Webmaster", () => {
  assert.match(accountReadModelsSource, /loadYandexWebmasterFacts\(normalizedAccountId, dateRange\)/);
  assert.match(accountReadModelsSource, /loadGoogleSearchConsoleFacts\(\[normalizedAccountId\], dateRange\)/);
  assert.doesNotMatch(accountReadModelsSource, /weeks/);
});

test("Zaruku read model does not request redundant general country or city reports", () => {
  assert.doesNotMatch(loaderSource, /key: "countries"|key: "cities"/);
  assert.doesNotMatch(loaderSource, /dimensions: "ym:s:regionCountry"/);
});

test("Metrika report parameters support the Zaruku Russia filter", () => {
  const seoModule = zarukuSeoModule as typeof zarukuSeoModule & {
    ZARUKU_RUSSIA_FILTER?: string;
    buildMetrikaReportParams?: (request: {
      counterId: string;
      from: string;
      to: string;
      dimensions: string;
      limit: number;
      filters?: string;
    }) => URLSearchParams;
  };

  assert.equal(typeof seoModule.buildMetrikaReportParams, "function");
  assert.equal(seoModule.ZARUKU_RUSSIA_FILTER, "ym:s:regionCountry=='Russia'");

  const params = seoModule.buildMetrikaReportParams!({
    counterId: "66624469",
    from: "2026-07-13",
    to: "2026-07-19",
    dimensions: "ym:s:searchPhrase",
    limit: 30,
    filters: seoModule.ZARUKU_RUSSIA_FILTER,
  });

  assert.equal(params.get("filters"), "ym:s:regionCountry=='Russia'");
  assert.equal(params.get("ids"), "66624469");
  assert.equal(params.get("dimensions"), "ym:s:searchPhrase");
});

test("buildContentSections uses SEO patterns and aggregates visits, users, and pageviews", () => {
  assert.deepEqual(
    buildContentSections(
      [
        page("https://zaruku.ru/map/clinics/42", 3, 2, 5),
        page("https://zaruku.ru/map/clinics/99", 4, 3, 6),
        page("https://zaruku.ru/priority/test", 7, 6, 8),
        page("https://zaruku.ru/unmatched", 11, 10, 12),
      ],
      patterns,
    ),
    [
      { label: "Root", visits: 11, users: 10, pageviews: 12, share: 12 / 31 * 100, source: "metrika", layer: "onsite" },
      { label: "Clinics", visits: 7, users: 5, pageviews: 11, share: 11 / 31 * 100, source: "metrika", layer: "onsite" },
      { label: "Priority B", visits: 7, users: 6, pageviews: 8, share: 8 / 31 * 100, source: "metrika", layer: "onsite" },
    ],
  );
});

test("buildContentSections aggregates behavior metrics by visit weight", () => {
  const sections = buildContentSections(
    [
      pageWithBehavior("https://zaruku.ru/map/clinics/42", 3, 2, 5, 10, 60, 1),
      pageWithBehavior("https://zaruku.ru/map/clinics/99", 7, 6, 9, 30, 120, 3),
    ],
    patterns,
  );

  assert.deepEqual(sections, [
    {
      label: "Clinics",
      visits: 10,
      users: 8,
      pageviews: 14,
      bounce_rate: 24,
      avg_duration_seconds: 102,
      page_depth: 2.4,
      share: 100,
      source: "metrika",
      layer: "onsite",
    },
  ]);
});

test("buildContentSections never converts users into visits", () => {
  assert.deepEqual(
    buildContentSections(
      [
        pageWithBehavior("https://zaruku.ru/map/", 0, 42, 48, 25, 90, 2),
        pageWithBehavior("https://zaruku.ru/map/clinics/42", 0, 11, 14, 15, 150, 4),
      ],
      patterns,
    ),
    [
      { label: "Map", visits: 0, users: 42, pageviews: 48, share: 48 / 62 * 100, source: "metrika", layer: "onsite" },
      { label: "Clinics", visits: 0, users: 11, pageviews: 14, share: 14 / 62 * 100, source: "metrika", layer: "onsite" },
    ],
  );
});

test("buildContentSections does not invent URL-derived sections without configured patterns", () => {
  assert.deepEqual(buildContentSections([page("https://zaruku.ru/map/clinics/42", 3, 2, 5)], []), []);
});

test("complete page rows feed section aggregates while top pages remain display-limited", () => {
  const rows = Array.from({ length: 201 }, (_, index) =>
    page(`https://zaruku.ru/map/page-${index + 1}`, 1, 1, 1),
  );
  rows[200] = page("https://zaruku.ru/map/clinics/beyond-display-limit", 7, 6, 5);

  const result = buildPageCollections(rows, patterns, 200);

  assert.equal(result.topPages.length, 200);
  assert.equal(result.topPages.some((row) => row.url?.includes("beyond-display-limit")), false);
  assert.deepEqual(result.contentSections, [
    { label: "Map", visits: 200, users: 200, pageviews: 200, share: 200 / 205 * 100, source: "metrika", layer: "onsite" },
    { label: "Clinics", visits: 7, users: 6, pageviews: 5, share: 5 / 205 * 100, source: "metrika", layer: "onsite" },
  ]);
});

test("visit-level section rows can feed content sections without changing top pages", () => {
  const pageRows = [
    page("https://zaruku.ru/map/page", 0, 10, 20),
    page("https://zaruku.ru/map/clinics/page", 0, 5, 8),
  ];
  const visitRows = [
    pageWithBehavior("https://zaruku.ru/map/landing", 4, 4, 12, 25, 90, 3),
    pageWithBehavior("https://zaruku.ru/map/clinics/landing", 6, 5, 18, 15, 150, 4),
  ];

  const result = buildPageCollections(pageRows, patterns, 1, visitRows);

  assert.deepEqual(result.topPages, [pageRows[0]]);
  assert.deepEqual(result.contentSections, [
    {
      label: "Clinics",
      visits: 6,
      users: 5,
      pageviews: 18,
      bounce_rate: 15,
      avg_duration_seconds: 150,
      page_depth: 4,
      share: 60,
      source: "metrika",
      layer: "onsite",
    },
    {
      label: "Map",
      visits: 4,
      users: 4,
      pageviews: 12,
      bounce_rate: 25,
      avg_duration_seconds: 90,
      page_depth: 3,
      share: 40,
      source: "metrika",
      layer: "onsite",
    },
  ]);
});

test("top pages keep pageview ranking while visit metrics are merged by URL", () => {
  const pageRows = [
    page("https://zaruku.ru/rak-molochnoj-zhelezy/?utm_source=test", 0, 42, 120),
    page("https://zaruku.ru/map/#clinics", 0, 30, 90),
  ];
  const visitRows = [
    pageWithBehavior("https://zaruku.ru/map/", 12, 11, 18, 40, 75, 1.5),
    pageWithBehavior("https://zaruku.ru/rak-molochnoj-zhelezy/", 7, 6, 10, 20, 150, 2.2),
  ];

  assert.deepEqual(mergeTopPagesWithVisitMetrics(pageRows, visitRows), [
    {
      ...pageRows[0],
      visits: 7,
      users: 6,
      bounce_rate: 20,
      avg_duration_seconds: 150,
      page_depth: 2.2,
    },
    {
      ...pageRows[1],
      visits: 12,
      users: 11,
      bounce_rate: 40,
      avg_duration_seconds: 75,
      page_depth: 1.5,
    },
  ]);
});

test("enrichRowsWithPageTitles keeps entry URL and replaces URL-like labels with page titles", () => {
  const entryRows = [
    pageWithBehavior("https://zaruku.ru/rak-molochnoj-zhelezy/?utm_source=test", 10, 9, 12, 15, 120, 1.2),
    pageWithBehavior("https://zaruku.ru/unknown/", 5, 4, 6, 20, 60, 1.1),
    pageWithBehavior("https://zaruku.ru/", 7, 6, 8, 30, 90, 1.4),
  ];
  const pageRows = [
    {
      ...page("https://zaruku.ru/rak-molochnoj-zhelezy/", 0, 20, 30),
      label: "Рак молочной железы: основной раздел",
    },
    {
      ...page("https://zaruku.ru/", 0, 12, 18),
      label: "Unknown",
    },
  ];

  assert.deepEqual(enrichRowsWithPageTitles(entryRows, pageRows), [
    {
      ...entryRows[0],
      label: "Рак молочной железы: основной раздел",
      url: "https://zaruku.ru/rak-molochnoj-zhelezy/?utm_source=test",
    },
    entryRows[1],
    {
      ...entryRows[2],
      label: "Главная страница",
      url: "https://zaruku.ru/",
    },
  ]);
});

test("filterSearchEngineRows keeps only Yandex and Google organic engines", () => {
  const rows = [
    page("Yandex: search results", 100, 90, 120),
    page("Google: search results", 80, 70, 100),
    page("Bing, search results", 6, 5, 8),
    page("Yahoo, search results", 3, 2, 4),
  ];

  assert.deepEqual(filterSearchEngineRows(rows).map((row) => row.label), [
    "Yandex: search results",
    "Google: search results",
  ]);
});

test("readableTrafficSource localizes Metrika traffic source labels for Zaruku UI", () => {
  assert.equal(readableTrafficSource("Search engine traffic"), "Поиск");
  assert.equal(readableTrafficSource("Direct traffic"), "Прямые заходы");
  assert.equal(readableTrafficSource("Cached page traffic"), "Кешированные страницы");
  assert.equal(readableTrafficSource("Unknown"), "Неизвестно");
});

test("buildMapCityDemand aggregates only map entry pages by city", () => {
  const rows: ZarukuSeoMetricRow[] = [
    {
      ...pageWithBehavior("https://zaruku.ru/map/", 10, 9, 14, 20, 90, 1.4),
      label: "Москва",
      secondary_label: "https://zaruku.ru/map/",
    },
    {
      ...pageWithBehavior("https://zaruku.ru/map/clinics/42/", 5, 4, 7, 40, 150, 2),
      label: "Москва",
      secondary_label: "https://zaruku.ru/map/clinics/42/",
    },
    {
      ...pageWithBehavior("https://zaruku.ru/rak-molochnoj-zhelezy/", 20, 18, 25, 50, 60, 1.2),
      label: "Москва",
      secondary_label: "https://zaruku.ru/rak-molochnoj-zhelezy/",
    },
    {
      ...pageWithBehavior("https://zaruku.ru/map/", 3, 3, 4, 10, 30, 1),
      label: "Санкт-Петербург",
      secondary_label: "https://zaruku.ru/map/",
    },
  ];

  assert.deepEqual(buildMapCityDemand(rows), [
    {
      label: "Москва",
      secondary_label: "https://zaruku.ru/map/",
      visits: 15,
      users: 13,
      pageviews: 21,
      bounce_rate: 26.666666666666668,
      avg_duration_seconds: 110,
      page_depth: 1.6,
      share: 83.33333333333334,
      source: "metrika",
      layer: "onsite",
    },
    {
      label: "Санкт-Петербург",
      secondary_label: "https://zaruku.ru/map/",
      visits: 3,
      users: 3,
      pageviews: 4,
      bounce_rate: 10,
      avg_duration_seconds: 30,
      page_depth: 1,
      share: 16.666666666666664,
      source: "metrika",
      layer: "onsite",
    },
  ]);
});

test("buildHighBouncePages ranks entry pages by estimated bounced visits", () => {
  const rows = [
    pageWithBehavior("https://zaruku.ru/high-volume-problem/", 100, 95, 120, 70, 20, 1),
    pageWithBehavior("https://zaruku.ru/small-problem/", 5, 5, 6, 100, 5, 1),
    pageWithBehavior("https://zaruku.ru/medium-problem/", 40, 38, 45, 80, 15, 1.1),
    pageWithBehavior("https://zaruku.ru/healthy/", 90, 86, 110, 20, 160, 1.8),
  ];

  assert.deepEqual(buildHighBouncePages(rows).map((row) => row.url), [
    "https://zaruku.ru/high-volume-problem/",
    "https://zaruku.ru/medium-problem/",
  ]);
});

test("buildBestEngagementPages ranks entry pages by retained visits and engagement", () => {
  const rows = [
    pageWithBehavior("https://zaruku.ru/short-clean/", 100, 90, 110, 20, 20, 1),
    pageWithBehavior("https://zaruku.ru/deep-long/", 45, 40, 90, 15, 180, 2.2),
    pageWithBehavior("https://zaruku.ru/longer/", 70, 65, 100, 25, 120, 1.6),
    pageWithBehavior("https://zaruku.ru/bouncy/", 80, 75, 85, 80, 240, 1.1),
  ];

  assert.deepEqual(buildBestEngagementPages(rows).map((row) => row.url), [
    "https://zaruku.ru/deep-long/",
    "https://zaruku.ru/longer/",
    "https://zaruku.ru/short-clean/",
  ]);
});

test("canonical page rows query has no display LIMIT", () => {
  const query = buildCanonicalPageRowsQuery(["66624469"], "2026-07-01", "2026-07-31");

  assert.doesNotMatch(query.sql, /\bLIMIT\b/i);
  assert.deepEqual(query.params, ["yandex_metrika", "66624469", "2026-07-01", "2026-07-31"]);
});

test("buildKpis uses the unique users total for the selected period", () => {
  const usersKpi = buildKpis({
    trafficChannels: [
      page("Search engine traffic", 1_100, 1_000, 1_300),
      page("Direct traffic", 1_000, 900, 1_200),
    ],
    technicalTail: [],
    devices: [],
    periodUsers: 1_250,
  }).find((kpi) => kpi.key === "users");

  assert.equal(usersKpi?.value, (1_250).toLocaleString("ru-RU"));
  assert.equal(usersKpi?.raw_value, 1_250);
});

test("buildKpis marks period users unavailable without an authoritative total", () => {
  const usersKpi = buildKpis({
    trafficChannels: [page("Search engine traffic", 1_100, 1_000, 1_300)],
    technicalTail: [page("Internal traffic", 1_000, 900, 1_200)],
    devices: [],
    periodUsers: null,
  }).find((kpi) => kpi.key === "users");

  assert.equal(usersKpi?.value, "—");
  assert.equal(usersKpi?.raw_value, null);
});

test("returning pages query reads canonical returning-content facts", () => {
  const query = buildReturningPagesQuery(["66624469"], "2026-07-01", "2026-07-13");

  assert.match(query.sql, /canonical_fact_metrika_returning_pages_daily/);
  assert.doesNotMatch(query.sql, /yandex_metrika_returned/);
  assert.match(query.sql, /returning_1_day_users/);
  assert.match(query.sql, /returning_2_7_days_users/);
  assert.match(query.sql, /returning_8_31_days_users/);
  assert.deepEqual(query.params, ["66624469", "2026-07-01", "2026-07-13"]);
});

test("buildSourceFreshnessQuery scopes canonical collectors by source keys", () => {
  const query = buildSourceFreshnessQuery(["yandex_metrika", "yandex_webmaster"]);

  assert.match(query.sql, /canonical_collector_runs/);
  assert.match(query.sql, /run_type = 'cron'/);
  assert.deepEqual(query.params, ["yandex_metrika", "yandex_webmaster"]);
});

test("default source freshness query includes the returning-content collector", () => {
  const query = buildSourceFreshnessQuery();

  assert.equal(query.params.includes("yandex_metrika_returning"), true);
});

test("normalizeSourceFreshnessRow marks recent successful cron collector healthy", () => {
  assert.deepEqual(
    normalizeSourceFreshnessRow(
      {
        source_key: "yandex_webmaster",
        source_label: "Яндекс Вебмастер",
        collector: "fetch_yandex_webmaster_canonical.py",
        expected_frequency_hours: 24,
        last_status: "success",
        last_finished_at: "2026-07-17 06:50:08",
        last_success_at: "2026-07-17 06:50:08",
        success_date_from: "2026-07-13",
        success_date_to: "2026-07-16",
        success_rows_read: "2121",
        success_rows_written: "2125",
        last_error_at: null,
        last_error_summary: null,
      },
      new Date("2026-07-17T19:00:00Z"),
    ),
    {
      source_key: "yandex_webmaster",
      label: "Яндекс Вебмастер",
      collector: "fetch_yandex_webmaster_canonical.py",
      expected_frequency_hours: 24,
      freshness_status: "healthy",
      freshness_label: "healthy",
      last_status: "success",
      last_finished_at: "2026-07-17 06:50:08",
      last_success_at: "2026-07-17 06:50:08",
      date_from: "2026-07-13",
      date_to: "2026-07-16",
      rows_read: 2121,
      rows_written: 2125,
      last_error_at: null,
      last_error_summary: null,
      note: "Последний successful cron collector записал 2,125 rows.",
    },
  );
});

test("normalizeSourceFreshnessRow hides older collector errors after a newer success", () => {
  const row = normalizeSourceFreshnessRow(
    {
      source_key: "yandex_metrika",
      source_label: "Яндекс Метрика",
      collector: "fetch_yandex_metrika_canonical.py",
      expected_frequency_hours: 24,
      last_status: "success",
      last_finished_at: "2026-07-19 06:12:26",
      last_success_at: "2026-07-19 06:12:26",
      success_date_from: "2026-07-17",
      success_date_to: "2026-07-18",
      success_rows_read: 30,
      success_rows_written: 3081,
      last_error_at: "2026-06-24 06:12:01",
      last_error_summary: "old frozen counter error",
    },
    new Date("2026-07-19T13:00:00Z"),
  );

  assert.equal(row.freshness_status, "healthy");
  assert.equal(row.last_error_at, null);
  assert.equal(row.last_error_summary, null);
  assert.equal(row.note, "Последний successful cron collector записал 3,081 rows.");
});

test("normalizeSourceFreshnessRow marks newer failed cron after success as failed", () => {
  const row = normalizeSourceFreshnessRow(
      {
        source_key: "google_search_console",
        source_label: "Google Search Console",
        collector: "fetch_gsc_canonical.py",
      expected_frequency_hours: 24,
      last_status: "failed",
      last_finished_at: "2026-07-17 17:15:18",
      last_success_at: "2026-07-16 17:15:18",
      success_date_from: "2026-07-10",
      success_date_to: "2026-07-13",
      success_rows_read: 9000,
      success_rows_written: 9000,
      last_error_at: "2026-07-17 17:15:18",
      last_error_summary: "HTTP 401",
    },
    new Date("2026-07-17T19:00:00Z"),
  );

  assert.equal(row.freshness_status, "failed");
  assert.equal(row.freshness_label, "failed");
  assert.match(row.note, /Последний cron collector упал/);
  assert.equal(row.last_error_summary, "HTTP 401");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSeoExecutiveSnapshot,
  buildUnifiedSeoPageRows,
  buildUnifiedSeoQueryRows,
  filterUnifiedSeoQueryRows,
  normalizeSeoQueryKey,
  normalizeSeoUrlKey,
  sortUnifiedSeoQueryRows,
} from "@/components/zaruku-seo-workspace";
import type {
  ZarukuGscLandingPageRow,
  ZarukuGscQueryRow,
  ZarukuSeoClusterRow,
  ZarukuSeoMetricRow,
  ZarukuSeoPositionTrendPoint,
  ZarukuYandexWebmasterPageRow,
  ZarukuYandexWebmasterQueryRow,
} from "@/lib/types";

function gscQuery(overrides: Partial<ZarukuGscQueryRow> = {}): ZarukuGscQueryRow {
  return {
    week: "2026-W29",
    query_id: "gsc-query",
    query: "инвалидность при онкологии",
    page: "https://zaruku.ru/article/",
    country: "rus",
    device: "MOBILE",
    impressions: 100,
    clicks: 10,
    ctr: 10,
    average_position: 2,
    week_from: "2026-07-13",
    week_to: "2026-07-19",
    is_partial_week: false,
    ...overrides,
  };
}

function webmasterQuery(overrides: Partial<ZarukuYandexWebmasterQueryRow> = {}): ZarukuYandexWebmasterQueryRow {
  return {
    week: "2026-W29",
    query_id: "webmaster-query",
    query: "инвалидность при онкологии",
    device: "ALL",
    impressions: 200,
    clicks: 20,
    ctr: 10,
    average_position: 8,
    week_from: "2026-07-13",
    week_to: "2026-07-19",
    is_partial_week: false,
    ...overrides,
  };
}

function seoOsQuery(overrides: Partial<ZarukuSeoClusterRow> = {}): ZarukuSeoClusterRow {
  return {
    week: "2026-W29",
    section: "/map/",
    cluster_id: "cluster-1",
    query: "инвалидность при онкологии",
    serp_position: 4,
    delta_prev: -2,
    matched_url: "https://zaruku.ru/map/",
    status: "found",
    ...overrides,
  };
}

function gscPage(overrides: Partial<ZarukuGscLandingPageRow> = {}): ZarukuGscLandingPageRow {
  return {
    week: "2026-W29",
    page: "https://zaruku.ru/map/",
    impressions: 120,
    clicks: 12,
    ctr: 10,
    average_position: 3,
    week_from: "2026-07-13",
    week_to: "2026-07-19",
    is_partial_week: false,
    ...overrides,
  };
}

function webmasterPage(overrides: Partial<ZarukuYandexWebmasterPageRow> = {}): ZarukuYandexWebmasterPageRow {
  return {
    week: "2026-W29",
    url: "https://zaruku.ru/map/",
    device: "ALL",
    impressions: 220,
    clicks: 22,
    ctr: 10,
    average_position: 7,
    week_from: "2026-07-13",
    week_to: "2026-07-19",
    is_partial_week: false,
    ...overrides,
  };
}

function metrikaPage(overrides: Partial<ZarukuSeoMetricRow> = {}): ZarukuSeoMetricRow {
  return {
    label: "Карта онкоцентров",
    url: "https://zaruku.ru/map/",
    visits: 50,
    users: 40,
    pageviews: 60,
    bounce_rate: 20,
    avg_duration_seconds: 90,
    page_depth: 1.5,
    source: "metrika",
    layer: "onsite",
    ...overrides,
  };
}

test("normalizes exact Russian phrases without fuzzy matching", () => {
  assert.equal(normalizeSeoQueryKey("  Инвалидность   при ОНКОЛОГИИ "), "инвалидность при онкологии");

  const rows = buildUnifiedSeoQueryRows({
    gscRows: [gscQuery({ query: "  Инвалидность   при онкологии " })],
    webmasterRows: [webmasterQuery({ query: "инвалидность при онкологии" })],
    seoOsRows: [seoOsQuery({ query: "инвалидность после онкологии" })],
  });

  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.google && row.webmaster && !row.seo_os));
  assert.ok(rows.some((row) => !row.google && !row.webmaster && row.seo_os));
});

test("aggregates repeated Google facts with weighted position", () => {
  const [row] = buildUnifiedSeoQueryRows({
    gscRows: [
      gscQuery({ query_id: "a", page: "/a/", impressions: 100, clicks: 10, average_position: 2 }),
      gscQuery({ query_id: "b", page: "/b/", impressions: 300, clicks: 15, average_position: 6 }),
    ],
    webmasterRows: [],
    seoOsRows: [],
  });

  assert.deepEqual(row.google, {
    impressions: 400,
    clicks: 25,
    ctr: 6.25,
    average_position: 5,
  });
  assert.deepEqual(row.google_pages, ["/a/", "/b/"]);
});

test("keeps Webmaster average position separate from SEO OS tracked position", () => {
  const [row] = buildUnifiedSeoQueryRows({
    gscRows: [],
    webmasterRows: [webmasterQuery({ average_position: 8 })],
    seoOsRows: [seoOsQuery({ serp_position: 4, delta_prev: -2 })],
  });

  assert.equal(row.webmaster?.average_position, 8);
  assert.deepEqual(row.seo_os, {
    tracked_position: 4,
    delta_prev: -2,
    status: "found",
    matched_url: "https://zaruku.ru/map/",
  });
  assert.equal(row.section, "/map/");
});

test("sorts positions with nulls last in both directions", () => {
  const rows = buildUnifiedSeoQueryRows({
    gscRows: [
      gscQuery({ query_id: "one", query: "позиция один", average_position: 1 }),
      gscQuery({ query_id: "ten", query: "позиция десять", average_position: 10 }),
      gscQuery({ query_id: "none", query: "нет позиции", average_position: null }),
    ],
    webmasterRows: [],
    seoOsRows: [],
  });

  assert.deepEqual(
    sortUnifiedSeoQueryRows(rows, { key: "google_position", direction: "asc" }).map((row) => row.query),
    ["позиция один", "позиция десять", "нет позиции"],
  );
  assert.deepEqual(
    sortUnifiedSeoQueryRows(rows, { key: "google_position", direction: "desc" }).map((row) => row.query),
    ["позиция десять", "позиция один", "нет позиции"],
  );
});

test("filters SEO OS movement and not-found rows without inventing zero positions", () => {
  const rows = buildUnifiedSeoQueryRows({
    gscRows: [],
    webmasterRows: [],
    seoOsRows: [
      seoOsQuery({ cluster_id: "up", query: "рост", delta_prev: -3 }),
      seoOsQuery({ cluster_id: "down", query: "падение", delta_prev: 2 }),
      seoOsQuery({ cluster_id: "none", query: "нет данных", serp_position: null, delta_prev: null, status: "no_data" }),
    ],
  });

  assert.deepEqual(filterUnifiedSeoQueryRows(rows, "improved").map((row) => row.query), ["рост"]);
  assert.deepEqual(filterUnifiedSeoQueryRows(rows, "declined").map((row) => row.query), ["падение"]);
  assert.deepEqual(filterUnifiedSeoQueryRows(rows, "not_found").map((row) => row.query), ["нет данных"]);
  assert.equal(filterUnifiedSeoQueryRows(rows, "not_found")[0].seo_os?.tracked_position, null);
});

test("normalizes exact URLs while preserving different paths", () => {
  assert.equal(normalizeSeoUrlKey("https://www.zaruku.ru/map/?utm_source=test#top"), "zaruku.ru/map/");
  assert.equal(normalizeSeoUrlKey("/map/"), "zaruku.ru/map/");
  assert.notEqual(normalizeSeoUrlKey("/map/"), normalizeSeoUrlKey("/map/moskva/"));
});

test("builds page rows from exact URLs and preserves source metric groups", () => {
  const rows = buildUnifiedSeoPageRows({
    gscRows: [gscPage({ page: "https://zaruku.ru/map/?utm_source=test" })],
    webmasterRows: [webmasterPage({ url: "/map/" })],
    metrikaRows: [metrikaPage({ url: "https://www.zaruku.ru/map/#top" })],
    seoOsRows: [seoOsQuery({ matched_url: "https://zaruku.ru/map/" })],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].google?.average_position, 3);
  assert.equal(rows[0].webmaster?.average_position, 7);
  assert.equal(rows[0].post_click?.visits, 50);
  assert.equal(rows[0].post_click?.users_available, true);
  assert.equal(rows[0].seo_os_tracked_queries, 1);
});

test("preserves unavailable post-click users instead of presenting a factual zero", () => {
  const rows = buildUnifiedSeoPageRows({
    gscRows: [],
    webmasterRows: [],
    metrikaRows: [metrikaPage({ users: 0, users_available: false })],
    seoOsRows: [],
  });

  assert.equal(rows[0].post_click?.users_available, false);
});

test("builds an executive snapshot without mixing tracked and average positions", () => {
  const positionTrend: ZarukuSeoPositionTrendPoint[] = [
    { week: "2026-W29", section: "/map/", average_position: 4, coverage: 0.5, found_rows: 1, tracked_rows: 2 },
  ];
  const snapshot = buildSeoExecutiveSnapshot({
    gscRows: [gscQuery()],
    webmasterRows: [webmasterQuery()],
    positionTrend,
    aiRows: [{
      engine: "alisa_ai",
      period: "2026-07",
      presence_rate: 44,
      mentions: 89,
      citations: 155,
      provenance: "wm_alisa_manual",
      captured_at: "2026-07-13T14:30:00.000Z",
      ingestion_run_id: "ai-1",
    }],
    postClickRows: [metrikaPage()],
  });

  assert.equal(snapshot.google?.average_position, 2);
  assert.equal(snapshot.webmaster?.average_position, 8);
  assert.deepEqual(snapshot.seo_os, { average_position: 4, coverage: 0.5 });
  assert.deepEqual(snapshot.ai, { presence_rate: 44, mentions: 89, citations: 155 });
  assert.deepEqual(snapshot.post_click, { visits: 50, users: 40, users_available: true });
});

test("executive snapshot marks multi-day post-click users unavailable", () => {
  const snapshot = buildSeoExecutiveSnapshot({
    gscRows: [],
    webmasterRows: [],
    positionTrend: [],
    aiRows: [],
    postClickRows: [metrikaPage({ users: 0, users_available: false })],
  });

  assert.deepEqual(snapshot.post_click, { visits: 50, users: 0, users_available: false });
});

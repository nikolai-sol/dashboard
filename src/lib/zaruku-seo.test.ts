import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalPageRowsQuery,
  buildContentSections,
  buildMapCityDemand,
  buildPageCollections,
  mergeTopPagesWithVisitMetrics,
} from "@/lib/zaruku-seo";
import type { ZarukuSeoMetricRow, ZarukuSeoSectionPattern } from "@/lib/types";

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

test("canonical page rows query has no display LIMIT", () => {
  const query = buildCanonicalPageRowsQuery(["66624469"], "2026-07-01", "2026-07-31");

  assert.doesNotMatch(query.sql, /\bLIMIT\b/i);
  assert.deepEqual(query.params, ["yandex_metrika", "66624469", "2026-07-01", "2026-07-31"]);
});

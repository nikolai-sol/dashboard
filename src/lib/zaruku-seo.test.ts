import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalPageRowsQuery, buildContentSections, buildPageCollections } from "@/lib/zaruku-seo";
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

test("canonical page rows query has no display LIMIT", () => {
  const query = buildCanonicalPageRowsQuery(["66624469"], "2026-07-01", "2026-07-31");

  assert.doesNotMatch(query.sql, /\bLIMIT\b/i);
  assert.deepEqual(query.params, ["yandex_metrika", "66624469", "2026-07-01", "2026-07-31"]);
});

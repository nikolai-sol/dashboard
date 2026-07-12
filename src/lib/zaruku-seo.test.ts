import assert from "node:assert/strict";
import test from "node:test";
import { buildContentSections } from "@/lib/zaruku-seo";
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

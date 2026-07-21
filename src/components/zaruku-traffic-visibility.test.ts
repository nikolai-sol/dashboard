import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ZarukuSeoSectionPattern, ZarukuSeoTrafficVisibilityRow } from "@/lib/types";
import { buildTrafficVisibilityRows } from "@/components/zaruku-traffic-visibility";

const componentSource = readFileSync(new URL("./ZarukuTrafficVisibility.tsx", import.meta.url), "utf8");

const patterns: ZarukuSeoSectionPattern[] = [
  { section: "/articles/", url_pattern: "/articles/", priority: 1 },
  { section: "/map/", url_pattern: "/map/", priority: 2 },
];

const traffic: ZarukuSeoTrafficVisibilityRow[] = [
  { week: "2026-W27", section: "/articles/", visits: 80, users: 60, pageviews: 100, average_position: 10, coverage: 0.5 },
  { week: "2026-W28", section: "/articles/", visits: 120, users: 90, pageviews: 160, average_position: 8, coverage: 1 },
  { week: "2026-W28", section: "/map/", visits: 30, users: 24, pageviews: 35, average_position: null, coverage: 0 },
  { week: "2026-W28", section: "/invented/", visits: 999, users: 999, pageviews: 999, average_position: 1, coverage: 1 },
];

test("buildTrafficVisibilityRows filters to dictionary sections and calculates A/B pageview deltas", () => {
  assert.deepEqual(buildTrafficVisibilityRows(traffic, patterns, "2026-W28", "2026-W27"), [
    {
      section: "/articles/",
      primary: { visits: 120, users: 90, pageviews: 160, average_position: 8, coverage: 1 },
      comparison: { visits: 80, users: 60, pageviews: 100, average_position: 10, coverage: 0.5 },
      pageviews_delta: 60,
      position_delta: -2,
    },
    {
      section: "/map/",
      primary: { visits: 30, users: 24, pageviews: 35, average_position: null, coverage: 0 },
      comparison: null,
      pageviews_delta: null,
      position_delta: null,
    },
  ]);
});

test("buildTrafficVisibilityRows keeps pageview metric available when page-scope visits are zero", () => {
  const rows = buildTrafficVisibilityRows(
    [
      { week: "2026-W28", section: "/articles/", visits: 0, users: 90, pageviews: 160, average_position: 8, coverage: 1 },
      { week: "2026-W27", section: "/articles/", visits: 0, users: 60, pageviews: 100, average_position: 10, coverage: 0.5 },
    ],
    patterns,
    "2026-W28",
    "2026-W27",
  );

  assert.equal(rows[0].primary.visits, 0);
  assert.equal(rows[0].primary.pageviews, 160);
  assert.equal(rows[0].pageviews_delta, 60);
});

test("buildTrafficVisibilityRows keeps exact primary values available without a comparison week", () => {
  const rows = buildTrafficVisibilityRows(traffic, patterns, "2026-W28", null);

  assert.equal(rows[0].primary.visits, 120);
  assert.equal(rows[0].comparison, null);
  assert.equal(rows[0].pageviews_delta, null);
});

test("traffic visibility UI labels page-scope bars as pageviews instead of visits", () => {
  assert.ok(componentSource.includes('A ${primaryWeek ?? ""} просмотры'));
  assert.match(componentSource, /A просмотры/);
  assert.equal(componentSource.includes('A ${primaryWeek ?? ""} визиты'), false);
  assert.doesNotMatch(componentSource, /A визиты/);
});

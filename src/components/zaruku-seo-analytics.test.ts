import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuSeoClusterRow, ZarukuSeoPositionTrendPoint } from "@/lib/types";
import {
  buildPositionComparisonRows,
  filterClusterRows,
  formatPositionDelta,
  resolveSafeExternalUrl,
} from "@/components/zaruku-seo-analytics";

const trends: ZarukuSeoPositionTrendPoint[] = [
  { week: "2026-W27", section: "/map/", average_position: 7, coverage: 0.5, found_rows: 1, tracked_rows: 2 },
  { week: "2026-W28", section: "/map/", average_position: 4, coverage: 1, found_rows: 2, tracked_rows: 2 },
  { week: "2026-W27", section: "/articles/", average_position: 12, coverage: 1, found_rows: 3, tracked_rows: 3 },
  { week: "2026-W28", section: "/articles/", average_position: null, coverage: 0, found_rows: 0, tracked_rows: 3 },
];

const clusters: ZarukuSeoClusterRow[] = [
  {
    week: "2026-W28",
    section: "/map/",
    cluster_id: "map-clinic",
    query: "clinic near me",
    serp_position: 4,
    delta_prev: -3,
    matched_url: "https://zaruku.ru/map/clinic",
    status: "found",
  },
  {
    week: "2026-W27",
    section: "/map/",
    cluster_id: "map-clinic",
    query: "clinic near me",
    serp_position: 7,
    delta_prev: 2,
    matched_url: "https://zaruku.ru/map/clinic",
    status: "found",
  },
  {
    week: "2026-W28",
    section: "/articles/",
    cluster_id: "article-risk",
    query: "cancer risk factors",
    serp_position: null,
    delta_prev: null,
    matched_url: "javascript:alert(1)",
    status: "no_data",
  },
];

test("buildPositionComparisonRows selects A and B positions by section and preserves coverage", () => {
  assert.deepEqual(buildPositionComparisonRows(trends, "2026-W28", "2026-W27"), [
    {
      section: "/articles/",
      primary_position: null,
      primary_coverage: 0,
      primary_found_rows: 0,
      primary_tracked_rows: 3,
      comparison_position: 12,
      comparison_coverage: 1,
      comparison_found_rows: 3,
      comparison_tracked_rows: 3,
    },
    {
      section: "/map/",
      primary_position: 4,
      primary_coverage: 1,
      primary_found_rows: 2,
      primary_tracked_rows: 2,
      comparison_position: 7,
      comparison_coverage: 0.5,
      comparison_found_rows: 1,
      comparison_tracked_rows: 2,
    },
  ]);
});

test("filterClusterRows bounds the selected-week table by section and status", () => {
  assert.deepEqual(
    filterClusterRows(clusters, { week: "2026-W28", section: "/map/", status: "found" }).map((row) => row.cluster_id),
    ["map-clinic"],
  );
  assert.deepEqual(
    filterClusterRows(clusters, { week: "2026-W28", section: "all", status: "no_data" }).map((row) => row.cluster_id),
    ["article-risk"],
  );
});

test("filterClusterRows applies a stable order for large selected-week result sets", () => {
  const shuffled = [
    { ...clusters[0], cluster_id: "z", query: "zeta" },
    { ...clusters[0], cluster_id: "a", query: "alpha" },
    { ...clusters[0], cluster_id: "m", query: "middle" },
  ];

  assert.deepEqual(filterClusterRows(shuffled, { week: "2026-W28", section: "all", status: "all" }).map((row) => row.cluster_id), ["a", "m", "z"]);
});

test("filterClusterRows calculates the selected comparison delta and keeps no-data neutral", () => {
  const rows = filterClusterRows(clusters, { week: "2026-W28", section: "all", status: "all" }, "2026-W27");

  assert.equal(rows.find((row) => row.cluster_id === "map-clinic")?.display_delta, -3);
  assert.equal(rows.find((row) => row.cluster_id === "article-risk")?.display_delta, null);
});

test("formatPositionDelta presents improving, declining, and missing values correctly", () => {
  assert.deepEqual(formatPositionDelta(-2), { label: "↑ 2", tone: "improved" });
  assert.deepEqual(formatPositionDelta(3.5), { label: "↓ 3,5", tone: "declined" });
  assert.deepEqual(formatPositionDelta(null), { label: "—", tone: "neutral" });
});

test("resolveSafeExternalUrl permits only absolute HTTP links", () => {
  assert.equal(resolveSafeExternalUrl("https://zaruku.ru/map/clinic"), "https://zaruku.ru/map/clinic");
  assert.equal(resolveSafeExternalUrl("javascript:alert(1)"), null);
  assert.equal(resolveSafeExternalUrl("/map/clinic"), null);
});

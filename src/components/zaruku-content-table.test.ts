import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuMetricAvailability, ZarukuSeoMetricRow } from "@/lib/types";
import { availableMetricColumns, sortContentRows } from "@/components/zaruku-content-table";

const pageMetrics: ZarukuMetricAvailability = {
  visits: false,
  users: true,
  pageviews: true,
  bounce_rate: false,
  avg_duration_seconds: false,
  page_depth: false,
};

const rows: ZarukuSeoMetricRow[] = [
  { label: "Бета", visits: 0, users: 20, pageviews: 30 },
  { label: "Альфа", visits: 0, users: 10, pageviews: 50 },
];

test("content tables expose only metrics available in the dataset contract", () => {
  assert.deepEqual(availableMetricColumns(pageMetrics).map((column) => column.key), ["users", "pageviews"]);
});

test("content rows can be sorted by a native metric or label", () => {
  assert.deepEqual(sortContentRows(rows, { key: "pageviews", direction: "desc" }).map((row) => row.label), ["Альфа", "Бета"]);
  assert.deepEqual(sortContentRows(rows, { key: "label", direction: "asc" }).map((row) => row.label), ["Альфа", "Бета"]);
});

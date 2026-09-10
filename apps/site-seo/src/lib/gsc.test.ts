import assert from "node:assert/strict";
import test from "node:test";
import type { DatasetMeta, Period } from "@reportingdash/site-seo-contract";
import { loadGscView, type GscReadRows } from "./gsc.ts";

const week: Period = { kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" };
const month: Period = { kind: "calendar_month", key: "2026-01", from: "2026-01-01", to: "2026-01-31", sourceTimezone: "Europe/Moscow" };
const meta = (period: Period): DatasetMeta => ({ sourceKey: "google_search_console", period, state: "ready", collectionMode: "manual", completeness: "complete", importId: "fixture-import", exportedAt: null, loadedAt: "2026-01-05T00:00:00Z", freshness: "current", latestAttempt: "success" });
const metrics = { clicks: 7, impressions: 100, ctrPct: 7, averagePosition: 3 };

test("keeps covering daily facts for a selected ISO week but excludes month-only queries", () => {
  const rows: GscReadRows = {
    meta: meta(month), summary: { ...metrics, clicks: 99 },
    daily: [{ date: "2026-01-02", metrics, meta: meta(month) }, { date: "2026-01-12", metrics, meta: meta(month) }],
    dimensions: [{ dimension: "query", value: "месячный запрос", metrics, meta: meta(month) }],
    indexing: meta(month),
  };

  const view = loadGscView(rows, week);

  assert.deepEqual(view.daily.map((point) => point.date), ["2026-01-02"]);
  assert.equal(view.summary?.clicks, 7);
  assert.equal(view.meta.period?.key, "2026-W01");
  assert.equal(view.meta.collectionMode, "derived");
  assert.equal(view.meta.completeness, "limited");
  assert.equal(view.meta.importId, "fixture-import");
  assert.deepEqual(view.dimensions, []);
  assert.equal(view.dimensionMeta.query?.state, "missing");
});

test("returns exact weekly query dimensions with their own provenance", () => {
  const rows: GscReadRows = {
    meta: meta(week), summary: metrics, daily: [], indexing: meta(week),
    dimensions: [{ dimension: "query", value: "недельный запрос", metrics, meta: meta(week) }],
  };

  const view = loadGscView(rows, week);

  assert.deepEqual(view.dimensions.map((row) => row.value), ["недельный запрос"]);
  assert.equal(view.dimensionMeta.query?.period?.key, "2026-W01");
});

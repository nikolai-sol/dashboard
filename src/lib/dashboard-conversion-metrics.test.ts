import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversionTrend,
  postClickConversionsByDate,
  resolveDashboardConversions,
} from "./dashboard-conversion-metrics";

test("post-click goal reaches override zero advertising conversions once", () => {
  const rows = [
    { goal_reaches: 762, campaign_breakdown: [{ goal_reaches: 400 }] },
    { goal_reaches: 811, campaign_breakdown: [{ goal_reaches: 500 }] },
    { goal_reaches: 0, campaign_breakdown: [] },
  ];
  const total = resolveDashboardConversions(0, rows);

  assert.equal(total, 1573);
  assert.equal(resolveDashboardConversions(99, rows), 1573);
});

test("authoritative post-click zero does not fall back to advertising conversions", () => {
  assert.equal(resolveDashboardConversions(25, []), 0);
  assert.equal(resolveDashboardConversions(25, [{ goal_reaches: 0 }]), 0);
});

test("advertising conversions remain the fallback when post-click analytics is absent", () => {
  assert.equal(resolveDashboardConversions(25, undefined), 25);
});

test("daily conversion authority sums parent post-click points by date", () => {
  const timeseries = [
    { date: "2026-09-01", goal_reaches: 6, campaign_breakdown: [{ goal_reaches: 4 }] },
    { date: "2026-09-01", goal_reaches: 5, campaign_breakdown: [{ goal_reaches: 3 }] },
    { date: "2026-09-02", goal_reaches: 0, campaign_breakdown: [] },
  ];
  assert.deepEqual(
    [...postClickConversionsByDate(timeseries)!.entries()],
    [
      ["2026-09-01", 11],
      ["2026-09-02", 0],
    ],
  );
  assert.equal(postClickConversionsByDate(undefined), null);
});

test("post-click-only dates affect only the dedicated conversion trend", () => {
  const advertisingDaily = [
    { date: "2026-09-01", spend: 100, conversions: 9 },
  ];
  const conversionTrend = buildConversionTrend(
    advertisingDaily,
    new Map([
      ["2026-09-01", 6],
      ["2026-09-02", 5],
    ]),
  );

  assert.deepEqual(advertisingDaily, [
    { date: "2026-09-01", spend: 100, conversions: 9 },
  ]);
  assert.deepEqual(conversionTrend, [
    { date: "2026-09-01", spend: 100, conversions: 6 },
    { date: "2026-09-02", spend: 0, conversions: 5 },
  ]);
  assert.deepEqual(buildConversionTrend(advertisingDaily, null), advertisingDaily);
});

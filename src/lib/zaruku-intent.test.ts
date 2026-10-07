import assert from "node:assert/strict";
import test from "node:test";
import { buildIntentView, previousIntentRange } from "./zaruku-intent";
import type { IntentDailyRow } from "./types";

function day(date: string, medical: number, noise: number, medicalClicks = medical, noiseClicks = noise, sourceCoverage: IntentDailyRow["sourceCoverage"] = "complete"): IntentDailyRow[] {
  return ["medical", "noise", "brand", "uncertain", "other"].map(bucket => ({ date, bucket: bucket as IntentDailyRow["bucket"], queryRows: 1, impressions: bucket === "medical" ? medical : bucket === "noise" ? noise : 0, clicks: bucket === "medical" ? medicalClicks : bucket === "noise" ? noiseClicks : 0, sourceCoverage, ingestionRunId: "fixture" }));
}
test("weighted shares and all four independent signed deltas use their own denominators", () => {
  const view = buildIntentView([...day("2026-09-01", 10, 90, 90, 10), ...day("2026-08-31", 90, 10, 10, 90)], { from: "2026-09-01", to: "2026-09-01" }, { from: "2026-08-31", to: "2026-08-31" });
  assert.deepEqual(view.deltas, { medicalImpressionPp: -80, medicalClickPp: 80, noiseImpressionPp: 80, noiseClickPp: -80 });
  const weighted = buildIntentView([...day("2026-09-01", 10, 90), ...day("2026-09-02", 900, 100)], { from: "2026-09-01", to: "2026-09-02" }, { from: "2026-08-30", to: "2026-08-31" });
  assert.equal(weighted.current.medicalImpressionShare, 910 / 1100 * 100);
});
test("unverified and missing dates retain values, contiguous ranges, clipped ISO bins and null comparisons", () => {
  const view = buildIntentView([...day("2026-09-09", 10, 90, 1, 9, "observed_unknown"), ...day("2026-09-11", 90, 10)], { from: "2026-09-09", to: "2026-09-15" }, { from: "2026-09-02", to: "2026-09-08" });
  assert.equal(view.current.completeness, "partial");
  assert.deepEqual(view.current.availableRanges, [{ from: "2026-09-09", to: "2026-09-09" }, { from: "2026-09-11", to: "2026-09-11" }]);
  assert.deepEqual(view.weekly.map(p => p.requested), [{ from: "2026-09-09", to: "2026-09-13" }, { from: "2026-09-14", to: "2026-09-15" }]);
  assert.equal(view.current.impressions, 200);
  assert.equal(view.weekly[1].impressions, null);
  assert.equal(view.deltas.medicalClickPp, null);
  const unknown = buildIntentView(day("2026-09-09", 10, 90, 1, 9, "observed_unknown"), { from: "2026-09-09", to: "2026-09-09" }, { from: "2026-09-08", to: "2026-09-08" });
  assert.equal(unknown.current.completeness, "unverified");
});
test("absent bucket is unavailable evidence and zero denominators remain null", () => {
  const range = { from: "2026-09-01", to: "2026-09-01" };
  assert.equal(buildIntentView(day(range.from, 0, 0), range, range).current.medicalClickShare, null);
  assert.equal(buildIntentView(day(range.from, 10, 90).slice(1), range, range).current.completeness, "unavailable");
});
test("previous range uses previous calendar month or equal inclusive length across year/leap boundaries", () => {
  assert.deepEqual(previousIntentRange({ from: "2026-09-01", to: "2026-09-30" }), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(previousIntentRange({ from: "2024-03-01", to: "2024-03-31" }), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(previousIntentRange({ from: "2026-01-01", to: "2026-01-31" }), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(previousIntentRange({ from: "2026-09-08", to: "2026-10-05" }), { from: "2026-08-11", to: "2026-09-07" });
  assert.deepEqual(previousIntentRange({ from: "2026-01-01", to: "2026-01-03" }), { from: "2025-12-29", to: "2025-12-31" });
});

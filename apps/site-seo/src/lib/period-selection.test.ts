import assert from "node:assert/strict";
import test from "node:test";
import { calendarMonthPeriod, createPeriodSelection, isoWeekPeriod, resolveComparisonWeek } from "./period-selection.ts";

test("derives Monday through Sunday boundaries for an ISO week crossing the year", () => {
  assert.deepEqual(isoWeekPeriod("2026-W01", "Europe/Moscow"), {
    kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow",
  });
});

test("keeps the Alice month and GSC period independent from the primary week", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W01", comparisonWeek: "2025-W52", aliceMonth: "2026-01", gsc: calendarMonthPeriod("2026-01", "Europe/Moscow") }, "Europe/Moscow");
  assert.equal(selection.traffic.primary.key, "2026-W01");
  assert.equal(selection.traffic.comparison?.key, "2025-W52");
  assert.equal(selection.alice.key, "2026-01");
  assert.equal(selection.gsc.kind, "calendar_month");
});

test("compare mode preserves explicit B and chooses another week for the earliest A", () => {
  const weeks = ["2026-W35", "2026-W36", "2026-W37"].map((key) => isoWeekPeriod(key, "Europe/Moscow"));
  assert.equal(resolveComparisonWeek(weeks[0]!, null, weeks, "compare")?.key, "2026-W36");
  assert.equal(resolveComparisonWeek(weeks[1]!, weeks[2]!, weeks, "compare")?.key, "2026-W37");
  assert.equal(resolveComparisonWeek(weeks[1]!, weeks[2]!, weeks, "previous")?.key, "2026-W35");
});

import assert from "node:assert/strict";
import test from "node:test";
import { calendarMonthPeriod, createPeriodSelection, isoWeekPeriod } from "./period-selection.ts";

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

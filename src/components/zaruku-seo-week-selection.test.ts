import assert from "node:assert/strict";
import test from "node:test";
import { createWeekSelection, previousAvailableWeek, updateWeekSelection } from "@/components/zaruku-seo-week-selection";

const weeks = ["2026-W28", "2026-W30", "2026-W31"];

test("createWeekSelection starts at the latest week without comparison", () => {
  assert.deepEqual(createWeekSelection("2026-W31"), {
    primaryWeek: "2026-W31",
    comparisonWeek: null,
  });
});

test("previousAvailableWeek returns the preceding available ISO week", () => {
  assert.equal(previousAvailableWeek(weeks, "2026-W30"), "2026-W28");
  assert.equal(previousAvailableWeek(weeks, "2026-W28"), null);
});

test("updateWeekSelection moves the other selector to the nearest alternative", () => {
  assert.deepEqual(
    updateWeekSelection(
      { primaryWeek: "2026-W31", comparisonWeek: "2026-W30" },
      "primaryWeek",
      "2026-W30",
      weeks,
    ),
    { primaryWeek: "2026-W30", comparisonWeek: "2026-W28" },
  );

  assert.deepEqual(
    updateWeekSelection(
      { primaryWeek: "2026-W31", comparisonWeek: "2026-W30" },
      "comparisonWeek",
      "2026-W31",
      weeks,
    ),
    { primaryWeek: "2026-W30", comparisonWeek: "2026-W31" },
  );
});

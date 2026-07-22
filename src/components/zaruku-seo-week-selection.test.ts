import assert from "node:assert/strict";
import test from "node:test";
import {
  canCompareWeeks,
  createWeekSelection,
  previousAvailableWeek,
  reconcileWeekSelection,
  shouldShowSeoWeekToolbar,
  updateWeekSelection,
} from "@/components/zaruku-seo-week-selection";

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

test("reconcileWeekSelection clears comparison and repairs primary when data shrinks to one week", () => {
  assert.deepEqual(
    reconcileWeekSelection({ primaryWeek: "2026-W31", comparisonWeek: "2026-W30" }, ["2026-W32"]),
    { primaryWeek: "2026-W32", comparisonWeek: null },
  );
  assert.equal(canCompareWeeks(["2026-W32"]), false);
  assert.equal(canCompareWeeks(["2026-W31", "2026-W32"]), true);
});

test("SEO week toolbar is scoped to SEO, Work, and Content tabs", () => {
  assert.equal(shouldShowSeoWeekToolbar("seo"), true);
  assert.equal(shouldShowSeoWeekToolbar("work"), true);
  assert.equal(shouldShowSeoWeekToolbar("content"), true);
  assert.equal(shouldShowSeoWeekToolbar("seo_ops"), false);
  assert.equal(shouldShowSeoWeekToolbar("overview"), false);
  assert.equal(shouldShowSeoWeekToolbar("audience"), false);
  assert.equal(shouldShowSeoWeekToolbar("quality"), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  ABBOTT_NO_COMPLETED_DAYS,
  AbbottDateRangeError,
  defaultAbbottRange,
  detectAbbottPreset,
  latestCompletedAbbottDate,
  normalizeAbbottRequestedRange,
  resolveAbbottPreset,
} from "./abbott-date-range";

test("Abbott defaults to current month through yesterday", () => {
  assert.deepEqual(defaultAbbottRange(new Date("2026-07-16T12:00:00+02:00")), {
    from: "2026-07-01",
    to: "2026-07-15",
  });
});

test("Abbott calculates the latest completed date independently of the browser timezone", () => {
  assert.equal(latestCompletedAbbottDate(new Date("2026-06-30T21:30:00Z"), "Europe/Moscow"), "2026-06-30");
});

test("Abbott range accepts a configured business timezone", () => {
  assert.equal(latestCompletedAbbottDate(new Date("2026-07-01T23:30:00Z"), "America/New_York"), "2026-06-30");
});

test("Abbott current-month presets exclude the current incomplete day", () => {
  assert.deepEqual(resolveAbbottPreset("this_month", new Date("2026-08-09T12:00:00Z")), {
    kind: "range", from: "2026-08-01", to: "2026-08-08",
  });
  assert.deepEqual(resolveAbbottPreset("this_week", new Date("2026-08-09T12:00:00Z")), {
    kind: "range", from: "2026-08-03", to: "2026-08-08",
  });
});

test("Abbott previous period presets use complete calendar periods", () => {
  assert.deepEqual(resolveAbbottPreset("previous_month", new Date("2026-08-09T12:00:00Z")), {
    kind: "range", from: "2026-07-01", to: "2026-07-31",
  });
  assert.deepEqual(resolveAbbottPreset("previous_week", new Date("2026-08-09T12:00:00Z")), {
    kind: "range", from: "2026-07-27", to: "2026-08-02",
  });
});

test("Abbott current period presets are empty until a completed day exists inside them", () => {
  assert.deepEqual(resolveAbbottPreset("this_month", new Date("2026-08-01T09:00:00Z")), {
    kind: "empty", message: ABBOTT_NO_COMPLETED_DAYS,
  });
  assert.deepEqual(resolveAbbottPreset("this_week", new Date("2026-08-10T09:00:00Z")), {
    kind: "empty", message: ABBOTT_NO_COMPLETED_DAYS,
  });
  assert.equal(defaultAbbottRange(new Date("2026-11-01T09:00:00Z"), "Europe/Moscow"), null);
});

test("Abbott previous month handles New Year and leap-year February", () => {
  assert.deepEqual(resolveAbbottPreset("previous_month", new Date("2026-01-03T12:00:00Z")), {
    kind: "range", from: "2025-12-01", to: "2025-12-31",
  });
  assert.deepEqual(resolveAbbottPreset("previous_month", new Date("2024-03-05T12:00:00Z")), {
    kind: "range", from: "2024-02-01", to: "2024-02-29",
  });
});

test("Abbott normalizes ranges to the latest completed business date", () => {
  assert.deepEqual(normalizeAbbottRequestedRange(
    { from: "2026-08-01", to: "2026-08-09" },
    new Date("2026-08-09T12:00:00Z"),
  ), { from: "2026-08-01", to: "2026-08-08" });
});

test("Abbott rejects malformed and inverted requested ranges", () => {
  assert.throws(
    () => normalizeAbbottRequestedRange({ from: "2026-02-30", to: "2026-03-01" }),
    AbbottDateRangeError,
  );
  assert.throws(
    () => normalizeAbbottRequestedRange({ from: "2026-08-09", to: "2026-08-01" }),
    AbbottDateRangeError,
  );
});

test("Abbott detects each exact preset and treats all other ranges as custom", () => {
  const now = new Date("2026-08-09T12:00:00Z");
  assert.equal(detectAbbottPreset({ from: "2026-08-01", to: "2026-08-08" }, now), "this_month");
  assert.equal(detectAbbottPreset({ from: "2026-07-01", to: "2026-07-31" }, now), "previous_month");
  assert.equal(detectAbbottPreset({ from: "2026-08-03", to: "2026-08-08" }, now), "this_week");
  assert.equal(detectAbbottPreset({ from: "2026-07-27", to: "2026-08-02" }, now), "previous_week");
  assert.equal(detectAbbottPreset({ from: "2026-08-02", to: "2026-08-08" }, now), "custom");
});

import assert from "node:assert/strict";
import test from "node:test";
import { businessCalendarIsoDate } from "@/lib/abbott-date-range";
import { resolveZarukuDailyPeriod } from "@/lib/zaruku-daily-period";

test("uses the Moscow calendar date across its midnight boundary", () => {
  assert.equal(
    businessCalendarIsoDate(new Date("2026-07-22T21:30:00Z"), "Europe/Moscow"),
    "2026-07-23",
  );
  assert.equal(
    businessCalendarIsoDate(new Date("2026-07-22T20:59:59Z"), "Europe/Moscow"),
    "2026-07-22",
  );
});

test("cuts a requested daily period off two UTC calendar days before today", () => {
  assert.deepEqual(
    resolveZarukuDailyPeriod({
      requestedFrom: "2026-07-01",
      requestedTo: "2026-07-23",
      today: "2026-07-23",
    }),
    {
      requested: { from: "2026-07-01", to: "2026-07-23" },
      expectedTo: "2026-07-21",
      effective: { from: "2026-07-01", to: "2026-07-21" },
    },
  );
});

test("keeps a requested daily period that ends before the cutoff", () => {
  assert.deepEqual(
    resolveZarukuDailyPeriod({
      requestedFrom: "2026-07-01",
      requestedTo: "2026-07-13",
      today: "2026-07-23",
    }).effective,
    { from: "2026-07-01", to: "2026-07-13" },
  );
});

test("rejects a daily period whose start is after its effective end", () => {
  assert.throws(
    () =>
      resolveZarukuDailyPeriod({
        requestedFrom: "2026-07-22",
        requestedTo: "2026-07-23",
        today: "2026-07-23",
      }),
    /requestedFrom 2026-07-22 is after effectiveTo 2026-07-21/,
  );
});

test("rejects invalid ISO calendar dates explicitly", () => {
  assert.throws(
    () =>
      resolveZarukuDailyPeriod({
        requestedFrom: "2026-02-30",
        requestedTo: "2026-07-23",
        today: "2026-07-23",
      }),
    /requestedFrom must be a valid ISO date in YYYY-MM-DD format/,
  );
});

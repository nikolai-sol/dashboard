import assert from "node:assert/strict";
import test from "node:test";

import { normalizeValueForPeriod } from "./plan-normalizer";

const campaign = { configFrom: "2026-07-01", configTo: "2026-09-15" };

test("allocates a monthly plan across only the configured campaign dates", () => {
  const input = { total: 3000, monthly: { сентябрь: 3000 }, ...campaign };

  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2026-09-01", periodTo: "2026-09-15" }), 3000);
  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2026-09-01", periodTo: "2026-09-05" }), 1000);
  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2026-09-16", periodTo: "2026-09-30" }), 0);
  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2026-09-01", periodTo: "2026-09-30" }), 3000);
});

test("preserves calendar-month allocation when campaign dates are absent", () => {
  assert.equal(
    normalizeValueForPeriod({
      total: 3000,
      monthly: { сентябрь: 3000 },
      periodFrom: "2026-09-01",
      periodTo: "2026-09-15",
    }),
    1500,
  );
});

test("keeps each partial campaign month whole and prorates selected subranges", () => {
  const input = {
    total: 4100,
    monthly: { июль: 1100, август: 1000, сентябрь: 2000 },
    configFrom: "2026-07-10",
    configTo: "2026-09-15",
  };

  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2026-07-10", periodTo: "2026-09-15" }), 4100);
  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2026-07-10", periodTo: "2026-07-20" }), 550);
});

test("anchors December and January monthly plans to the configured campaign", () => {
  const input = {
    total: 2200,
    monthly: { декабрь: 1200, январь: 1000 },
    configFrom: "2026-12-20",
    configTo: "2027-01-10",
  };

  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2026-12-20", periodTo: "2027-01-10" }), 2200);
  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2027-01-01", periodTo: "2027-01-05" }), 500);
  assert.equal(normalizeValueForPeriod({ ...input, periodFrom: "2028-01-01", periodTo: "2028-01-31" }), 0);
});

test("prorates total-only plans over configured campaign dates", () => {
  assert.ok(
    Math.abs(normalizeValueForPeriod({
      total: 7700,
      periodFrom: "2026-09-01",
      periodTo: "2026-09-05",
      ...campaign,
    }) - 500) < 0.000001,
  );
});

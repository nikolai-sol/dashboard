import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidDashboardDateRangeError,
  resolveDashboardDateRange,
} from "./dashboard-date-range";

const now = new Date("2026-07-22T10:00:00Z");

test("Zaruku defaults to the latest 28 complete UTC days", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/zaruku",
    configFrom: "2026-03-03",
    configTo: "2026-03-26",
    dashboardType: "zaruku_bi",
    now,
  }), { from: "2026-06-24", to: "2026-07-21" });
});

test("explicit Zaruku from and to override the rolling default", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/zaruku?from=2026-07-01&to=2026-07-14",
    configFrom: "2026-03-03",
    configTo: "2026-03-26",
    dashboardType: "zaruku_bi",
    now,
  }), { from: "2026-07-01", to: "2026-07-14" });
});

test("explicit Zaruku dates after the reporting cutoff clamp to the latest available day", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/zaruku?from=2026-08-24&to=2026-08-25",
    configFrom: "2026-03-03",
    configTo: "2026-03-26",
    dashboardType: "zaruku_bi",
    now: new Date("2026-08-25T12:00:00Z"),
  }), { from: "2026-08-23", to: "2026-08-23" });
});

test("explicit Zaruku ranges keep their start and clamp only a late end", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/zaruku?from=2026-08-01&to=2026-08-25",
    configFrom: null,
    configTo: null,
    dashboardType: "zaruku_bi",
    now: new Date("2026-08-25T12:00:00Z"),
  }), { from: "2026-08-01", to: "2026-08-23" });
});

test("Zaruku days selection ends on the last complete day", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/zaruku?days=7",
    configFrom: null,
    configTo: null,
    dashboardType: "zaruku_bi",
    now,
  }), { from: "2026-07-15", to: "2026-07-21" });
});

test("non-Zaruku dashboards preserve configured periods", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/other",
    configFrom: "2026-05-01",
    configTo: "2026-05-31",
    dashboardType: "generic",
    now,
  }), { from: "2026-05-01", to: "2026-05-31" });
});

test("multibrand preserves its current-month fallback", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/multibrand",
    configFrom: "2026-05-01",
    configTo: "2026-05-31",
    dashboardType: "multibrand",
    now,
  }), { from: "2026-07-01", to: "2026-07-31" });
});

test("invalid calendar dates never override a valid configured period", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/other?from=2026-02-31&to=2026-03-03",
    configFrom: "2026-05-01",
    configTo: "2026-05-31",
    dashboardType: "generic",
    now,
  }), { from: "2026-05-01", to: "2026-05-31" });
});

test("Abbott clamps explicit requests to its latest completed business day", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/abbott?from=2026-08-01&to=2026-08-09",
    configFrom: null,
    configTo: null,
    dashboardType: "abbott_bi",
    now: new Date("2026-08-09T12:00:00Z"),
  }), { from: "2026-08-01", to: "2026-08-08" });
});

test("Abbott rejects partial, malformed, and inverted explicit requests", () => {
  const base = {
    configFrom: null,
    configTo: null,
    dashboardType: "abbott_bi",
    now: new Date("2026-08-09T12:00:00Z"),
  } as const;

  for (const requestUrl of [
    "https://dash.test/abbott?from=2026-08-01",
    "https://dash.test/abbott?from=2026-02-30&to=2026-08-01",
    "https://dash.test/abbott?from=2026-08-08&to=2026-08-01",
  ]) {
    assert.throws(
      () => resolveDashboardDateRange({ ...base, requestUrl }),
      InvalidDashboardDateRangeError,
    );
  }
});

test("Abbott defaults only to completed current-month days", () => {
  assert.deepEqual(resolveDashboardDateRange({
    requestUrl: "https://dash.test/abbott",
    configFrom: "2026-01-01",
    configTo: "2026-01-31",
    dashboardType: "abbott_bi",
    now: new Date("2026-08-09T12:00:00Z"),
  }), { from: "2026-08-01", to: "2026-08-08" });
});

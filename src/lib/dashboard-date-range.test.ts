import assert from "node:assert/strict";
import test from "node:test";
import { resolveDashboardDateRange } from "./dashboard-date-range";

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

import assert from "node:assert/strict";
import test from "node:test";

import {
  compareAdvertisingDashboardSnapshots,
  comparisonExitCode,
  type AdvertisingDashboardSnapshot,
} from "./compare-advertising-dashboard-read-model";

function snapshot(overrides: Partial<AdvertisingDashboardSnapshot> = {}): AdvertisingDashboardSnapshot {
  return {
    dashboard_id: 29,
    client_id: "gidrofuril",
    period: { from: "2026-08-01", to: "2026-08-31" },
    plan_vs_fact: [{
      line_key: "olv-serials",
      channel: "OLV Serials",
      instrument: "Between",
      budget_plan: 100,
      impressions_plan: 1000,
      reach_plan: 800,
      clicks_plan: 10,
      views_plan: 700,
      conversions_plan: 2,
      budget_fact: 50,
      impressions_fact: 500,
      reach_fact: 400,
      clicks_fact: 5,
      views_fact: 350,
      conversions_fact: 1,
    }],
    channel_timeseries: [{
      line_key: "olv-serials",
      date: "2026-08-17",
      channel: "OLV Serials",
      instrument: "Between",
      impressions: 500,
      reach: 400,
      clicks: 5,
      spend: 50,
      views: 350,
      conversions: 1,
    }],
    unbound_facts: [],
    ...overrides,
  };
}

test("line-level mismatch includes dashboard line date metric values and delta", () => {
  const oldSnapshot = snapshot();
  const newSnapshot = snapshot({
    channel_timeseries: [{
      ...snapshot().channel_timeseries[0],
      impressions: 490,
    }],
  });

  const result = compareAdvertisingDashboardSnapshots(oldSnapshot, newSnapshot);
  assert.deepEqual(result.mismatches, [{
    dashboard_id: 29,
    client_id: "gidrofuril",
    scope: "line_daily",
    line_key: "olv-serials",
    date: "2026-08-17",
    metric: "impressions",
    old_value: 500,
    new_value: 490,
    delta: -10,
  }, {
    dashboard_id: 29,
    client_id: "gidrofuril",
    scope: "dashboard_daily",
    line_key: "__dashboard_total__",
    date: "2026-08-17",
    metric: "impressions",
    old_value: 500,
    new_value: 490,
    delta: -10,
  }]);
  assert.equal(comparisonExitCode([result]), 1);
});

test("exact metrics preserve unbound facts separately and still block cutover", () => {
  const current = snapshot({
    unbound_facts: [{
      canonical_campaign_id: 777,
      source_key: "between",
      platform_account_id: "1113",
      platform_campaign_id: "24999",
      campaign_name: "Unbound",
      first_date: "2026-08-17",
      last_date: "2026-08-17",
      impressions: 10,
      clicks: 1,
      spend: 2,
      views: 3,
      reach: 4,
      conversions: 0,
    }],
  });
  const result = compareAdvertisingDashboardSnapshots(current, current);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.unbound_facts.length, 1);
  assert.equal(comparisonExitCode([result]), 1);
});

test("exact match without unbound facts exits zero", () => {
  const current = snapshot();
  const result = compareAdvertisingDashboardSnapshots(current, current);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.unbound_facts, []);
  assert.equal(comparisonExitCode([result]), 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { PlanVsFactItem } from "./types";
import { projectPlanVsFactForPeriod } from "./dashboard-data-loader";

const planRow: PlanVsFactItem = {
  channel: "Video",
  instrument: "OLV",
  format: "video",
  buy_type: "CPM",
  platforms: [{ source_key: "yandex_direct", label: "Yandex Direct", color: "#000000" }],
  campaign_count: 1,
  budget_plan: 3000,
  impressions_plan: 300000,
  reach_plan: 100000,
  clicks_plan: 3000,
  views_plan: 200000,
  conversions_plan: 300,
  monthly_plan: { сентябрь: 3000 },
  monthly_breakdown: {
    сентябрь: {
      units: 300000,
      budget: 3000,
      impressions: 300000,
      reach: 100000,
      clicks: 3000,
      views: 200000,
      conversions: 300,
      ctr: 1,
    },
  },
  budget_fact: 700,
  impressions_fact: 70000,
  reach_fact: 30000,
  clicks_fact: 700,
  views_fact: 50000,
  conversions_fact: 70,
  pacing: 700 / 3000,
  frequency_plan: 3,
  frequency_fact: 70000 / 30000,
  cpm_plan: 10,
  cpm_fact: 10,
  cpc_plan: 1,
  cpc_fact: 1,
  cpv_plan: 0.015,
  cpv_fact: 0.014,
  cpa_plan: 10,
  cpa_fact: 10,
};

test("projects campaign-bounded channel plans into platform/export rows without changing facts", () => {
  const [projected] = projectPlanVsFactForPeriod(
    [planRow],
    "2026-09-01",
    "2026-09-05",
    "2026-07-01",
    "2026-09-15",
  );

  assert.equal(projected.budget_plan, 1000);
  assert.equal(projected.impressions_plan, 100000);
  assert.equal(projected.budget_fact, 700);
  assert.equal(projected.impressions_fact, 70000);
  assert.deepEqual(projected.monthly_breakdown, planRow.monthly_breakdown);
});

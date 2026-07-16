import assert from "node:assert/strict";
import test from "node:test";
import { groupByChannel, parseMediaPlanSource } from "@/lib/gsheet-fetcher";

test("parseMediaPlanSource preserves nested monthly values from stored inline rows", async () => {
  const result = await parseMediaPlanSource({
    inline_rows: [
      {
        line_key: "olw::hybrid::1",
        platform: "hybrid/between",
        channel: "ОЛВ WL inpage",
        format: "In-stream",
        buy_type: "CPM",
        units_plan: 1450,
        unit_price: 220,
        budget_plan: 319000,
        impressions_plan: 1450000,
        reach_plan: 483333,
        clicks_plan: 4350,
        monthly: {
          июль: 550000,
          август: 700000,
          сентябрь: 200000,
        },
      },
    ],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].monthly.июль, 550000);
  assert.equal(result.rows[0].monthly.август, 700000);
  assert.equal(result.rows[0].monthly.сентябрь, 200000);

  const [group] = groupByChannel(result.rows);
  assert.equal(group.monthly_breakdown.июль.impressions, 550000);
  assert.equal(group.monthly_breakdown.август.impressions, 700000);
  assert.equal(group.monthly_breakdown.сентябрь.impressions, 200000);
  assert.equal(group.monthly_breakdown.июль.budget, 121000);
  assert.equal(group.monthly_breakdown.август.budget, 154000);
  assert.equal(group.monthly_breakdown.сентябрь.budget, 44000);
});

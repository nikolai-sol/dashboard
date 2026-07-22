import assert from "node:assert/strict";
import test from "node:test";
import { availableMetricColumns, resolvePanelState } from "./zaruku-dataset-state";

test("successful zero rows means empty and not unavailable", () => {
  assert.equal(resolvePanelState({ state: "empty", message: null }), "empty");
});

test("failed source means unavailable", () => {
  assert.equal(resolvePanelState({ state: "unavailable", message: "Срез Метрики недоступен" }), "unavailable");
});

test("page grain exposes users and pageviews but not visits", () => {
  assert.deepEqual(availableMetricColumns({
    visits: false,
    users: true,
    pageviews: true,
    bounce_rate: false,
    avg_duration_seconds: false,
    page_depth: false,
  }), ["users", "pageviews"]);
});

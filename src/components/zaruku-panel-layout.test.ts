import assert from "node:assert/strict";
import test from "node:test";
import {
  ZARUKU_PANEL_REGISTRY,
  panelGridClass,
  resolveZarukuPanels,
} from "@/components/zaruku-panel-layout";

test("panel registry has unique IDs and valid defaults", () => {
  const ids = ZARUKU_PANEL_REGISTRY.map((panel) => panel.panelId);
  assert.equal(new Set(ids).size, ids.length);

  for (const panel of ZARUKU_PANEL_REGISTRY) {
    assert.ok(panel.allowedSizes.includes(panel.defaultSize));
  }
});

test("panel order is deterministic", () => {
  const overview = resolveZarukuPanels("overview");
  assert.deepEqual(overview.map((panel) => panel.panelId), [
    "overview.north_star",
    "overview.traffic_health",
    "overview.channels",
    "overview.search_engines",
    "overview.organic_search",
  ]);
});

test("panel size classes keep narrow layouts fluid", () => {
  assert.equal(panelGridClass("compact"), "min-w-0 xl:col-span-3");
  assert.equal(panelGridClass("half"), "min-w-0 xl:col-span-6");
  assert.equal(panelGridClass("wide"), "min-w-0 xl:col-span-8");
  assert.equal(panelGridClass("full"), "min-w-0 xl:col-span-12");
});

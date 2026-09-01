import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const dashboardSource = source("../components/AbbottBiDashboard.tsx");
const pageStatsSource = source("../components/abbott-page-stats.ts");
const privateStoreSource = source("./abbott-private-store.ts");
const adminFilterSource = source("../components/abbott/abbott-admin-user-filter.ts");

test("Abbott tab 3 keeps the active-release MNN read, filter, column, search, and export contract", () => {
  assert.match(privateStoreSource, /portal_content_catalog_mnn/);
  assert.match(privateStoreSource, /mnn_key/);
  assert.match(dashboardSource, /label="Направление"[\s\S]*?label="МНН"/);
  assert.match(
    dashboardSource,
    /key: "direction", label: "Направление"[\s\S]*?key: "mnn", label: "МНН"/,
  );
  assert.match(pageStatsSource, /matchesSelectedMnn/);
  assert.match(pageStatsSource, /\.\.\.\(row\.mnn \?\? \[\]\)/);
  assert.match(pageStatsSource, /МНН:/);
});

test("Abbott contract keeps direction, material type, URL identity, and admin-free filters", () => {
  assert.match(dashboardSource, /label="Направление"/);
  assert.match(dashboardSource, /label="Тип материала"/);
  assert.match(privateStoreSource, /portal_content_lookup_projection/);
  assert.match(adminFilterSource, /ВСЕ без админов/);
  assert.match(dashboardSource, /canonical visits from Logs API|каноническим визитам Logs API/);
});

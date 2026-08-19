import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(file: string): string {
  return readFileSync(path.resolve(file), "utf8");
}

test("advertising runtime does not import external actual-data fetchers", () => {
  const loader = read("src/lib/dashboard-data-loader.ts");
  const campaigns = read("src/app/api/admin/campaigns/all/route.ts");
  assert.doesNotMatch(loader, /fetchManualDataFromSourceConfig/);
  assert.doesNotMatch(loader, /loadDashboardManualFacts/);
  assert.doesNotMatch(loader, /fetchMediaPlanFromSourceConfig/);
  assert.doesNotMatch(loader, /fetchLeadsFromSourceConfig/);
  assert.doesNotMatch(loader, /dashboard_manual_facts_daily/);
  assert.doesNotMatch(campaigns, /manual-data-fetcher/);
});

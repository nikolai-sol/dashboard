import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { invokeDashboardLoaderWithAudience } from "./dashboard-data-loader";

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Abbott loader has no runtime asset, returning API, or legacy fallback path", () => {
  const loader = source("src/lib/abbott-bi.ts");
  const forbidden = [
    /node:fs/,
    /node:path/,
    /\bXLSX\b|from\s+["']xlsx["']/,
    /public["'`,/\\]+abbott/i,
    /api-metrika\.yandex/,
    /getMetrikaToken|fetchAbbottReturningDay|queryAbbottReturningApi/,
    /hasCanonical[A-Za-z]+Rows/,
    /queryReturningFallback/,
    /queryLegacy[A-Za-z]+/,
    /yandex_metrika_(?:params|internal|returned|external|traffic)/,
    /COUNT\s*\(\s*\*\s*\)[\s\S]{0,200}(?:fallback|legacy)/i,
    /\.catch\s*\(\s*\(\)\s*=>\s*\[\]\s*\)/,
    /CAST\s*\([^)]*(?:raw_user_id|user_id)[^)]*AS\s+UNSIGNED/i,
  ];

  forbidden.forEach((pattern) => assert.doesNotMatch(loader, pattern));
  assert.match(loader, /canonical_fact_metrika_site_analytics_daily/);
  assert.match(loader, /canonical_fact_metrika_returning_pages_daily/);
  assert.match(loader, /canonical_source_coverage_daily/);
  assert.match(loader, /canonical_fact_metrika_user_behavior_daily/);
});

test("trusted dashboard consumers pass audience into data loading", () => {
  const dashboardRoute = source("src/app/api/dashboard/[id]/route.ts");
  const excelRoute = source("src/app/api/dashboard/[id]/excel/route.ts");
  const publicAiRoute = source("src/app/api/dashboard/[id]/ai-summary/generate/route.ts");
  const adminAiRoute = source("src/app/api/admin/dashboards/[id]/ai-summary/route.ts");
  const adminAiGenerateRoute = source("src/app/api/admin/dashboards/[id]/ai-summary/generate/route.ts");

  for (const route of [dashboardRoute, excelRoute, publicAiRoute]) {
    assert.match(route, /loadDashboardData\([\s\S]{0,160}access\.audience[\s\S]{0,20}\)/);
  }
  for (const route of [adminAiRoute, adminAiGenerateRoute]) {
    assert.match(route, /loadDashboardData\([\s\S]{0,160}["']manager["'][\s\S]{0,20}\)/);
  }
});

test("dashboard loader requires Abbott audience and preserves it for comparisons", () => {
  const loader = source("src/lib/dashboard-data-loader.ts");

  assert.match(loader, /loadAbbottBiData\(dashboard\.id,\s*effectiveCounterIds,\s*range\.from,\s*range\.to,\s*audience\)/);
  assert.match(loader, /dashboardType\s*===\s*["']abbott_bi["'][\s\S]{0,500}trusted audience/i);
});

test("comparison invocation preserves the trusted audience behaviorally", async () => {
  const calls: Array<{ id: string; audience: string | undefined; url: string }> = [];
  const result = await invokeDashboardLoaderWithAudience(
    new Request("https://example.test/api/dashboard/7?from=2026-01-01"),
    "7",
    "embed",
    async (request, id, audience) => {
      calls.push({ id, audience, url: request.url });
      return "comparison-result";
    },
  );

  assert.equal(result, "comparison-result");
  assert.deepEqual(calls, [{
    id: "7",
    audience: "embed",
    url: "https://example.test/api/dashboard/7?from=2026-01-01",
  }]);
});

test("unused Zaruku BI export is removed while the live Zaruku SEO branch remains", async () => {
  const abbottModule = await import("./abbott-bi");
  const dashboardLoader = source("src/lib/dashboard-data-loader.ts");

  assert.equal("loadZarukuBiData" in abbottModule, false);
  assert.match(dashboardLoader, /dashboardType === "zaruku_bi"[\s\S]{0,500}loadZarukuSeoData/);
});

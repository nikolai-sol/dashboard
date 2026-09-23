import assert from "node:assert/strict";
import { mock, test } from "node:test";
import pool from "./db";
import { loadAbbottBiDataWithDependencies, type AbbottDashboardAudience } from "./abbott-bi";
import { resolveDashboardDateRange } from "./dashboard-date-range";
import { buildDashboardAiSummaryFromOverrideText, buildDashboardAiSummarySnapshot } from "./dashboard-ai-summary";
import {
  abbottDashboardLoaderDependencies,
  loadAbbottDashboardData,
  loadAbbottDashboardDataWithDependencies,
  type AbbottDashboardLoaderDependencies,
  type AbbottDashboardRow,
} from "./abbott-dashboard-loader";

const request = new Request("https://example.test/api/dashboard/18?from=2026-01-01&to=2026-01-13");
const dashboard: AbbottDashboardRow = {
  id: 18, client_id: "abbott", client_name: "Abbott", dashboard_name: "Abbott BI",
  dashboard_type: "abbott_bi", config: null,
};

async function fixture(audience: AbbottDashboardAudience = "manager") {
  return loadAbbottBiDataWithDependencies(18, ["90602537"], "2026-01-01", "2026-01-13", audience, {
    aggregateExecutor: { query: async () => [] },
    privateExecutor: { query: async () => { throw new Error("Private facts must not be read"); } },
    loadReleaseBundle: async () => { throw new Error("Fixture has no active release"); },
  });
}

function dependencies(overrides: Partial<AbbottDashboardLoaderDependencies> = {}): AbbottDashboardLoaderDependencies {
  return {
    findDashboard: async () => dashboard,
    findCounterIds: async () => ["90602537"],
    loadBi: async (_id, _counters, _from, _to, audience) => fixture(audience),
    ...overrides,
  };
}

test("preserves the complete Abbott payload and wrapper defaults", async () => {
  const bi = await fixture();
  const result = await loadAbbottDashboardDataWithDependencies(request, "18", "manager", dependencies({ loadBi: async () => bi }));
  assert.deepEqual(result, {
    dashboard_id: 18,
    data: {
      dashboard: {
        client_name: "Abbott", dashboard_name: "Abbott BI", logo_url: null, type: "abbott_bi",
        period: { from: "2026-01-01", to: "2026-01-13" }, currency: "RUB", language: "en",
        show_spend: false, filter_scope: "platform", section_order: [], multibrand: null,
      },
      ai_summary_enabled: false, kpi_config: [], visible_metrics: [],
      kpi: {
        total_impressions: 0, total_clicks: 0, total_spend: 0, total_conversions: 0, avg_ctr: 0, avg_cpm: 0,
        prev_impressions: 0, prev_clicks: 0, prev_spend: 0, prev_conversions: 0, prev_ctr: 0, prev_cpm: 0,
      },
      platforms: [], timeseries: [], plan_vs_fact: [], abbott_bi: bi,
    },
    previous_platforms: [], leads_rows: [], ai_summary_enabled: false, ai_summary_override_text: null,
    ai_summary_override: null, ai_summary_snapshot: null, server_timing: undefined,
  });
  assert.strictEqual(result.data.abbott_bi, bi);
});

test("accepts Abbott aliases and forwards configured counters, dates and trusted audiences", async () => {
  for (const identifier of ["18", "abbott", " ABBOTT "]) {
    for (const audience of ["manager", "embed"] as const) {
      const calls: unknown[][] = [];
      const result = await loadAbbottDashboardDataWithDependencies(request, identifier, audience, dependencies({
        findDashboard: async (id) => { calls.push(["dashboard", id]); return { ...dashboard, client_id: " ABBOTT " }; },
        findCounterIds: async (id) => { calls.push(["counters", id]); return ["configured"]; },
        loadBi: async (...args) => { calls.push(["bi", ...args]); return fixture(audience); },
      }));
      assert.deepEqual(calls, [["dashboard", identifier], ["counters", 18], ["bi", 18, ["configured"], "2026-01-01", "2026-01-13", audience]]);
      assert.deepEqual(result.data.abbott_bi, await fixture(audience));
    }
  }
});

test("rejects untrusted audiences and foreign identifiers before any dependency read", async () => {
  const unused = dependencies({ findDashboard: async () => { assert.fail("must not query"); } });
  for (const audience of [undefined, null, "public", "MANAGER"]) {
    await assert.rejects(loadAbbottDashboardDataWithDependencies(request, "18", audience as never, unused), /Abbott trusted audience is required/);
  }
  for (const id of ["28", "zaruku", "0018", "18other", ""]) {
    await assert.rejects(loadAbbottDashboardDataWithDependencies(request, id, "manager", unused), /Dashboard not found/);
  }
  await assert.rejects(loadAbbottDashboardData(request, "28", "manager"), /Dashboard not found/);
});

test("rejects missing or mismatched dashboard rows before counters or BI reads", async () => {
  for (const row of [undefined, { ...dashboard, client_id: "zaruku" }, { ...dashboard, dashboard_type: "zaruku_bi" as const }]) {
    await assert.rejects(loadAbbottDashboardDataWithDependencies(request, "18", "manager", dependencies({
      findDashboard: async () => row,
      findCounterIds: async () => { assert.fail("must not query counters"); },
    })), /Dashboard not found/);
  }
});

test("falls back to the existing Abbott authority only for an empty configured counter list", async () => {
  await loadAbbottDashboardDataWithDependencies(request, "18", "manager", dependencies({
    findCounterIds: async () => [],
    loadBi: async (_id, counters) => { assert.deepEqual(counters, ["90602537"]); return fixture(); },
  }));
});

test("keeps Abbott date validation, completed-day clamping and default period behavior", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-14T12:00:00Z") });
  for (const query of ["from=2026-01-01", "to=2026-01-13", "from=2026-02-30&to=2026-03-01", "from=2026-01-13&to=2026-01-01"]) {
    await assert.rejects(loadAbbottDashboardDataWithDependencies(new Request(`https://example.test/?${query}`), "18", "manager", dependencies({
      findCounterIds: async () => { assert.fail("invalid period must not read counters"); },
    })), /Invalid Abbott date range/);
  }
  for (const query of ["from=2026-01-01&to=2999-01-01", "days=90"]) {
    const periodRequest = new Request(`https://example.test/?${query}`);
    const expected = resolveDashboardDateRange({ requestUrl: periodRequest.url, configFrom: null, configTo: null, dashboardType: "abbott_bi" });
    const result = await loadAbbottDashboardDataWithDependencies(periodRequest, "18", "manager", dependencies({
      findDashboard: async () => ({ ...dashboard, config: { period_from: "2001-01-01", period_to: "2001-01-31" } }),
      loadBi: async (_id, _counters, from, to) => { assert.deepEqual({ from, to }, expected); return fixture(); },
    }));
    assert.deepEqual(result.data.dashboard.period, expected);
  }
  t.mock.timers.setTime(new Date("2026-09-01T12:00:00Z").getTime());
  await assert.rejects(loadAbbottDashboardDataWithDependencies(new Request("https://example.test/"), "18", "manager", dependencies()), /Invalid Abbott date range/);
});

test("preserves JSON metadata and AI summary overrides and matching snapshots", async () => {
  const config = { logo_url: "/abbott.svg", currency: 42, language: "en", show_ai_summary: true,
    ai_summary_authoring: { override_text: "Reviewed Abbott summary", updated_at: "2026-01-14T00:00:00Z" } };
  const initial = await loadAbbottDashboardDataWithDependencies(request, "18", "manager", dependencies({ findDashboard: async () => ({ ...dashboard, config }) }));
  const summary = buildDashboardAiSummaryFromOverrideText("Saved summary", "2026-01-14T00:00:00Z")!;
  const snapshot = buildDashboardAiSummarySnapshot(initial.data, summary);
  const result = await loadAbbottDashboardDataWithDependencies(request, "18", "manager", dependencies({
    findDashboard: async () => ({ ...dashboard, config: JSON.stringify({ ...config, ai_summary_snapshot: snapshot }) }),
  }));
  assert.equal(result.data.dashboard.logo_url, "/abbott.svg");
  assert.equal(result.data.dashboard.currency, "42");
  assert.equal(result.data.dashboard.language, "en");
  assert.equal(result.ai_summary_enabled, true);
  assert.equal(result.data.ai_summary_enabled, true);
  assert.equal(result.ai_summary_override_text, config.ai_summary_authoring.override_text);
  assert.deepEqual(result.ai_summary_override, buildDashboardAiSummaryFromOverrideText(config.ai_summary_authoring.override_text, config.ai_summary_authoring.updated_at));
  assert.deepEqual(result.ai_summary_snapshot, { ...summary, reason: undefined });
});

test("canonical source reads preserve schema override, role exclusion and account normalization", async () => {
  const calls: unknown[][] = [];
  const execute = mock.method(pool, "execute", async (sql: string, params: unknown[]) => {
    calls.push([sql, params]);
    return [[
      { platform: "yandex", schema_file: "schemas/yandex_metrika.yaml", role: "actual", source_config: '{"account_ids":[" 90602537 ","",123,"90602537"]}' },
      { platform: "yandex_metrika", schema_file: "schemas/yandex.yaml", role: "actual", source_config: { account_ids: ["wrong-schema"] } },
      { platform: "yandex_metrika", schema_file: "missing.yaml", role: "custom_table", source_config: { account_ids: ["excluded"] } },
      { platform: "yandex_metrika", schema_file: "schemas/yandex_metrika.yaml", role: "plan", source_config: { account_ids: ["plan-counter"] } },
      { platform: "yandex_metrika", schema_file: "schemas/yandex_metrika.yaml", role: "actual", source_config: "malformed" },
    ], []];
  });
  try {
    assert.deepEqual(await abbottDashboardLoaderDependencies.findCounterIds(18), ["90602537", "123", "plan-counter"]);
    assert.match(String(calls[0][0]), /FROM dashboard_sources ds[\s\S]*LEFT JOIN dashboard_campaign_filters/);
    assert.deepEqual(calls[0][1], [18]);
  } finally { execute.mock.restore(); }
});

test("timestamps an undated AI override before awaiting the canonical BI read", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-14T12:00:00Z") });
  const result = await loadAbbottDashboardDataWithDependencies(request, "18", "manager", dependencies({
    findDashboard: async () => ({ ...dashboard, config: { ai_summary_authoring: { override_text: "Reviewed summary" } } }),
    loadBi: async () => {
      t.mock.timers.setTime(new Date("2026-09-14T12:00:05Z").getTime());
      return fixture();
    },
  }));
  assert.equal(result.ai_summary_override?.generated_at, "2026-09-14T12:00:00.000Z");
});

test("canonical dashboard lookup preserves active-row SQL and both identifier parameters", async () => {
  const execute = mock.method(pool, "execute", async (sql: string, params: unknown[]) => {
    assert.equal(sql, "SELECT * FROM dashboards WHERE is_active = TRUE AND (id = ? OR client_id = ?) LIMIT 1");
    assert.deepEqual(params, ["abbott", "abbott"]);
    return [[dashboard], []];
  });
  try { assert.deepEqual(await abbottDashboardLoaderDependencies.findDashboard("abbott"), dashboard); }
  finally { execute.mock.restore(); }
});

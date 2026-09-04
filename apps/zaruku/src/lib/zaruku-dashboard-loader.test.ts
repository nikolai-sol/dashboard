import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import pool from "@/lib/db";
import { loadDashboardData } from "@/lib/dashboard-data-loader";

const dashboard = {
  id: 28, client_id: "zaruku", client_name: "Zaruku", dashboard_name: "SEO",
  dashboard_type: "zaruku_bi", config: { currency: "RUB", language: "ru", business_timezone: "Europe/Moscow" },
};
type SqlCall = { sql: string; params: unknown[] };
const request = new Request("https://dashboards.test/api/dashboard/zaruku?from=2026-07-10&to=2026-07-31");

function canonicalRows(sql: string, state: "facts" | "empty" | "failed") {
  if (sql.includes("FROM dashboards")) return [dashboard];
  if (sql.includes("FROM dashboard_sources")) return [{
    id: 101, dashboard_id: 28, platform: "yandex_metrika", role: "actual",
    schema_file: "schemas/yandex_metrika.yaml", source_config: { account_ids: ["66624469", "99078698"] },
  }];
  if (sql.includes("canonical_metrika_breakdown_coverage_daily")) {
    if (state === "failed") throw new Error("fixture collection unavailable");
    return ["devices", "organic_landing", "search_engines"].map(report_key => ({ report_key, coverage_rows: 22, complete_rows: 22 }));
  }
  if (sql.includes("wordstat:current-queries") || sql.includes("wordstat:current-regions") || sql.includes("wordstat:historical")) {
    return [{
      endpoint_from: "2026-07-10", endpoint_to: "2026-07-31", endpoint_scope_count: state === "failed" ? 0 : 1,
      endpoint_empty_scope_count: state === "empty" ? 1 : 0, endpoint_coverage_run_status: state === "failed" ? "failed" : "success",
      endpoint_last_status: state === "failed" ? "failed" : "success", endpoint_last_finished_at: "2026-08-01 06:00:00",
      endpoint_last_success_at: "2026-08-01 06:00:00", endpoint_rows_read: 0, endpoint_rows_written: 0,
      ...(state === "facts" ? { query: "рак", normalized_query: "рак", count: 150, classification: "medical", review_status: "reviewed", classification_active: 1, request_kind: "popular", device: "all" } : {}),
    }];
  }
  if (state !== "facts") return [];
  if (sql.includes("AS latest_run") || sql.includes("last_success_at") && sql.includes("canonical_collector_runs") && !sql.includes("wordstat:")) return [{
    source_key: "yandex_metrika", source_label: "Яндекс Метрика", collector: "fixture",
    expected_frequency_hours: 24, last_status: "failed", last_finished_at: "2026-08-02 06:00:00",
    last_success_at: "2026-08-01 06:00:00", success_date_from: "2026-07-10", success_date_to: "2026-07-31",
    success_rows_read: 2, success_rows_written: 2, last_error_at: "2026-08-02 06:00:00", last_error_summary: "fixture newer failure",
  }];
  if (sql.includes("GROUP BY COALESCE(traffic_source")) return [
    { label: "Search engine traffic", visits: "120", users: "100", pageviews: "160", bounce_rate: "12", avg_duration: "60", page_depth: "1.3" },
    { label: "Direct traffic", visits: "7", users: "6", pageviews: "9", bounce_rate: "0", avg_duration: "90", page_depth: "1.5" },
  ];
  if (sql.includes("analytics_scope = 'page'") && sql.includes("GROUP BY COALESCE(page_title")) return [{ label: "Historical page", url: "https://zaruku.ru/history/", visits: 0, users: 6, pageviews: 9 }];
  if (sql.includes("canonical_fact_metrika_returning_pages_daily")) return [{ label: "History", url: "https://zaruku.ru/history/", visits: 7, users: 6, returning_users: 3, returning_1_day_users: 1, returning_2_7_days_users: 1, returning_8_31_days_users: 1 }];
  if (sql.includes("FROM seo_positions_weekly")) return [{ week: "2026-W30", section: "History", cluster_id: "history", query: "рак", serp_position: 4, delta_prev: 1, matched_url: "https://zaruku.ru/history/", status: "tracked" }];
  if (sql.includes("FROM seo_tasks")) return [{ week: "2026-W30", task_id: "fixture-task", section: "History", title: "Direct history review", status: "needs_target_page", notion_url: null }];
  if (sql.includes("FROM seo_section_patterns") && !sql.includes("COUNT")) return [{ section: "History", url_pattern: "/history/", priority: 1 }];
  const serpRow = { week_key: "2026-W30", query_id: "fixture-query", query: "рак", page: "https://zaruku.ru/history/", page_id: "history", page_url: "https://zaruku.ru/history/", country: "rus", device: "desktop", impressions: 90, clicks: 9, ctr: 10, average_position: 4, week_from: "2026-07-20", week_to: "2026-07-26", is_partial_week: false };
  if (sql.includes("FROM canonical_fact_gsc_") || sql.includes("FROM canonical_fact_webmaster_")) return [serpRow];
  if (sql.includes("alice-visibility:snapshots")) return [{
    id: 11, analytics_account_id: "66624469", source_key: "yandex_webmaster_alice_manual", domain: "zaruku.ru", period_month: "2026-07-01",
    captured_at: "2026-08-01 12:00:00", official_sov_pct: "43.91", exported_query_count: 155, portal_present_query_count: 68,
    sample_presence_pct: "43.87", source_filename: "fixture.xlsx", source_sha256: "a".repeat(64), publication_status: "published", supersedes_snapshot_id: null, ingestion_run_id: "fixture-july",
  }];
  return [];
}

function payloadWithoutTiming<T extends { server_timing?: unknown }>(value: T) {
  const { server_timing: ignored, ...payload } = value;
  void ignored;
  return payload;
}

for (const state of ["facts", "empty", "failed"] as const) {
  test(`canonical ${state} fixture preserves the complete legacy Zaruku response and SQL parameters`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-08-03T12:00:00Z") });
    const calls: SqlCall[] = [];
    t.mock.method(pool, "execute", async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return [canonicalRows(sql, state), []];
    });
    const legacy = await loadDashboardData(request, "zaruku", "manager");
    const legacyCalls = calls.splice(0);
    const { loadZarukuDashboardData } = await import("./zaruku-dashboard-loader");
    const actual = await loadZarukuDashboardData(request, "zaruku", "manager");
    assert.deepEqual(payloadWithoutTiming(actual), payloadWithoutTiming(legacy));
    const facts = (items: SqlCall[]) => items.filter(({ sql }) => !sql.includes("FROM dashboards") && !sql.includes("FROM dashboard_sources") && !sql.includes("dashboard_media_plan_rows"));
    assert.deepEqual(facts(calls), facts(legacyCalls), "Every canonical SQL statement and parameter must remain unchanged");
    assert.equal(calls.some(({ sql }) => sql.includes("dashboard_media_plan_rows")), false);
    assert.equal(calls.some(({ params }) => params.includes("99078698")), false);
    assert.deepEqual(Object.keys(actual.server_timing ?? {}).sort(), ["gsc-db", "metrika-db", "seo-db", "total", "webmaster-db"]);
    assert.equal(actual.data.zaruku_seo?.alice_visibility.snapshots.length, state === "facts" ? 1 : 0);
    assert.equal(actual.data.zaruku_seo?.dataset_meta.devices.state, state === "failed" ? "unavailable" : "empty");
    const expectedWordstatStatus = state === "failed" ? "unavailable" : state === "empty" ? "empty" : "available";
    assert.equal(actual.data.zaruku_seo?.wordstat.status, expectedWordstatStatus);
    assert.equal(actual.data.zaruku_seo?.wordstat.current.query_status, expectedWordstatStatus);
    assert.equal(actual.data.zaruku_seo?.wordstat.current.region_status, expectedWordstatStatus);
    assert.equal(actual.data.zaruku_seo?.wordstat.historical.status, expectedWordstatStatus);
    if (state === "facts") {
      assert.equal(actual.data.zaruku_seo?.traffic_channels.find(row => row.label === "Прямые заходы")?.visits, 7);
      assert.equal(actual.data.zaruku_seo?.seo_os.tasks[0]?.status, "needs_target_page");
      assert.equal(actual.data.zaruku_seo?.alice_visibility.snapshots[0]?.officialSovPct, 43.91);
      assert.equal(actual.data.zaruku_seo?.gsc.summary[0]?.clicks, 9);
      assert.equal(actual.data.zaruku_seo?.webmaster.summary[0]?.clicks, 9);
      assert.equal(actual.data.zaruku_seo?.source_freshness[0]?.freshness_status, "failed");
      assert.equal(actual.data.zaruku_seo?.wordstat.current.queries[0]?.count, 150);
    }
  });
}

test("a dated direct canonical addition remains visible with unchanged historical period totals", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-08-03T12:00:00Z") });
  // Both collector and owner-added rows occupy the existing canonical fact table.
  // The adapter performs the SQL aggregate over the requested account/date bounds.
  const history = [
    { analytics_account_id: "66624469", report_date: "2026-01-15", ingestion_run_id: "owner-reviewed-history-fixture", visits: 17, users: 11, pageviews: 23 },
    { analytics_account_id: "66624469", report_date: "2026-01-20", ingestion_run_id: "collector-fixture", visits: 5, users: 4, pageviews: 8 },
    { analytics_account_id: "66624469", report_date: "2026-07-15", ingestion_run_id: "later-collector-fixture", visits: 120, users: 100, pageviews: 160 },
  ];
  const calls: SqlCall[] = [];
  t.mock.method(pool, "execute", async (sql: string, params: unknown[] = []) => {
    if (sql.includes("GROUP BY COALESCE(traffic_source")) {
      calls.push({ sql, params });
      assert.doesNotMatch(sql, /ingestion_run_id|publication_status|active_release|collected_at|LIMIT/i);
      const [from, to] = params.slice(-2).map(String);
      const selected = history.filter(row => row.analytics_account_id === params[1] && row.report_date >= from && row.report_date <= to);
      const totals = selected.reduce((total, row) => ({ visits: total.visits + row.visits, users: total.users + row.users, pageviews: total.pageviews + row.pageviews }), { visits: 0, users: 0, pageviews: 0 });
      return [[{ label: "Search engine traffic", ...totals }], []];
    }
    return [canonicalRows(sql, "facts"), []];
  });
  const historicalRequest = new Request("https://dashboards.test/api/dashboard/zaruku?from=2026-01-01&to=2026-01-31");
  const legacy = await loadDashboardData(historicalRequest, "zaruku", "manager");
  const { loadZarukuDashboardData } = await import("./zaruku-dashboard-loader");
  const actual = await loadZarukuDashboardData(historicalRequest, "zaruku", "manager");
  assert.deepEqual(payloadWithoutTiming(actual), payloadWithoutTiming(legacy));
  const traffic = actual.data.zaruku_seo!.traffic_channels[0];
  assert.deepEqual({ visits: traffic.visits, users: traffic.users, pageviews: traffic.pageviews }, { visits: 22, users: 15, pageviews: 31 });
  assert.deepEqual(actual.data.dashboard.period, { from: "2026-01-01", to: "2026-01-31" });
  assert.deepEqual(calls[1], calls[0]);
  assert.deepEqual(calls[1].params, ["yandex_metrika", "66624469", "2026-01-01", "2026-01-31"]);
});

test("non-Zaruku slugs and mismatched canonical identities fail before canonical fact reads", async (t) => {
  const calls: string[] = [];
  let identity: Record<string, unknown> = dashboard;
  t.mock.method(pool, "execute", async (sql: string) => { calls.push(sql); return [[identity], []]; });
  const { loadZarukuDashboardData } = await import("./zaruku-dashboard-loader");
  for (const id of ["abbott", "28", "", "zaruku/../abbott"]) await assert.rejects(loadZarukuDashboardData(request, id, "manager"), /Dashboard not found/);
  assert.equal(calls.length, 0);
  for (identity of [{ ...dashboard, client_id: "abbott" }, { ...dashboard, dashboard_type: "awareness" }]) {
    await assert.rejects(loadZarukuDashboardData(request, "zaruku", "manager"), /Dashboard not found/);
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every(sql => sql.includes("FROM dashboards")));
});

test("the extracted SQL and projection owner has no edits and the old import is a compatibility re-export", async () => {
  const owner = readFileSync(new URL("./zaruku-seo.ts", import.meta.url), "utf8");
  const legacy = readFileSync(new URL("../../../../src/lib/zaruku-seo.ts", import.meta.url), "utf8");
  assert.match(legacy, /export \* from "@zaruku\/lib\/zaruku-seo"/);
  assert.equal(createHash("sha256").update(owner).digest("hex"), "7f6169a4747c613c5e392af1231ddde3257aa88395f6b2d2dd65028dda6e785f");
});

test("the emitted canonical loader graph excludes private, advertising and source API modules", async () => {
  const result = await build({ entryPoints: ["apps/zaruku/src/lib/zaruku-dashboard-loader.ts"], bundle: true, write: false, metafile: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  const trace = Object.keys(result.metafile!.inputs).sort().join("\n");
  assert.match(trace, /apps\/zaruku\/src\/lib\/zaruku-seo.ts/);
  assert.doesNotMatch(trace, /abbott-(?:bi|private)|advertising-binding|canonical-adapter|gsheet-fetcher|leads-fetcher|manual-data-fetcher|schema-parser|dashboard-data-loader.ts/);
});

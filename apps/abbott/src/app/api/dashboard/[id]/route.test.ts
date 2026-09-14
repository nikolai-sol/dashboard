import assert from "node:assert/strict";
import { mock } from "node:test";
import test from "node:test";
import type { isDashboardAccessAuthorized } from "../../../../../../../src/lib/dashboard-access";
import { InvalidDashboardDateRangeError } from "../../../../../../../src/lib/dashboard-date-range";
import { createAbbottJsonHandler } from "../../../../lib/abbott-json-handler";
import { GET } from "./route";

type Access = Awaited<ReturnType<typeof isDashboardAccessAuthorized>>;

const context = {
  id: 18,
  client_id: "abbott",
  client_name: "Abbott",
  dashboard_name: "Abbott BI",
  dashboard_type: "abbott_bi",
  is_active: true,
  access_users_count: 0,
  auth_mode: "password_only" as const,
};

function access(audience: "manager" | "embed" = "manager"): Access {
  return {
    context,
    authorized: true,
    reason: "authorized",
    audience,
    credentialVersion: 1,
  } as unknown as Access;
}

function dashboardData() {
  return {
    dashboard: {
      client_name: "Abbott",
      dashboard_name: "Abbott BI",
      logo_url: null,
      type: "abbott_bi",
      period: { from: "2026-09-01", to: "2026-09-13" },
      currency: "RUB",
      language: "en",
      show_spend: false,
      filter_scope: "platform",
      section_order: [],
      multibrand: null,
    },
    ai_summary_enabled: true,
    kpi_config: [],
    visible_metrics: [],
    kpi: {},
    platforms: [],
    timeseries: [],
    plan_vs_fact: [],
    abbott_bi: {
      users_summary: [{ raw_user_id: "private-user" }],
      users_summary_without_admins: [{ raw_user_id: "private-user" }],
      user_actions: [{ raw_user_id: "private-user", visit_id: "visit-1", start_url: "/start?secret=1", end_url: "/end#secret" }],
      admin_user_filter: { raw_user_ids_json: ["private-user"] },
      page_stats: [],
      bitrix_pages: [],
      session_journeys: {
        rows: [{
          visit_id: "visit-1",
          entry_url_day: "/entry-day?secret=1",
          exit_url_day: "/exit-day?secret=1",
          entry_url_session: "/entry-session?secret=1",
          exit_url_session: "/exit-session?secret=1",
          content_path: ["/path?secret=1"],
          content_path_summary: "/path?secret=1",
          all_path_summary: "/path?secret=1",
        }],
      },
      external_events: [],
      external_clicks: [],
      time_buckets: { by_page: [] },
      returning: [],
      return_frequency: { return_pages: [] },
      general_materials: [],
    },
  };
}

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    dashboard_id: 18,
    data: dashboardData(),
    previous_platforms: [],
    leads_rows: [],
    ai_summary_enabled: true,
    ai_summary_override_text: null,
    ai_summary_override: null,
    ai_summary_snapshot: { title: "Snapshot", summary: "Saved" },
    server_timing: undefined,
    ...overrides,
  } as never;
}

test("route exports the configured Abbott GET handler", () => {
  assert.equal(typeof GET, "function");
});

test("wrong identity returns 404 without leaking authorization state or loading", async () => {
  let authorizeCalls = 0;
  let loadCalls = 0;
  const handler = createAbbottJsonHandler({
    authorize: async () => {
      authorizeCalls += 1;
      return access();
    },
    load: async () => {
      loadCalls += 1;
      return loaded();
    },
  });

  const response = await handler(
    new Request("https://example.test/api/dashboard/28"),
    { params: { id: "28" } },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Dashboard not found" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(authorizeCalls, 0);
  assert.equal(loadCalls, 0);
});

test("unauthorized canonical identity preserves current 401 metadata", async () => {
  const handler = createAbbottJsonHandler({
    authorize: async () => ({ context, authorized: false, reason: "auth_required" }) as unknown as Access,
    load: async () => assert.fail("loader must not run"),
  });
  const response = await handler(
    new Request("https://example.test/api/dashboard/18"),
    { params: Promise.resolve({ id: "18" }) },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Authentication required",
    auth_required: true,
    dashboard: {
      id: 18,
      client_id: "abbott",
      client_name: "Abbott",
      dashboard_name: "Abbott BI",
      auth_mode: "password_only",
    },
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("authorized aliases load the exact audience and preserve wrapper AI summary priority", async () => {
  for (const id of ["18", "abbott"]) {
    const override = { title: "Override", summary: "Managed" };
    const seen: unknown[][] = [];
    const handler = createAbbottJsonHandler({
      authorize: async () => access("manager"),
      load: async (...args) => {
        seen.push(args);
        return loaded({ ai_summary_override: override });
      },
    });
    const request = new Request(`https://example.test/api/dashboard/${id}?from=2026-09-01&to=2026-09-13`);
    const response = await handler(request, { params: { id } });
    assert.equal(response.status, 200);
    assert.deepEqual(seen, [[request, id, "manager"]]);
    assert.deepEqual((await response.json()).ai_summary, override);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("disabled AI summary is not attached by the response wrapper", async () => {
  const handler = createAbbottJsonHandler({
    authorize: async () => access(),
    load: async () => loaded({ ai_summary_enabled: false }),
  });
  const response = await handler(new Request("https://example.test/api/dashboard/18"), { params: { id: "18" } });
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(await response.json(), "ai_summary"), false);
});

test("embed response is projected before serialization", async () => {
  const handler = createAbbottJsonHandler({
    authorize: async () => access("embed"),
    load: async () => loaded(),
  });
  const response = await handler(
    new Request("https://example.test/api/dashboard/abbott?embed_key=valid"),
    { params: { id: "abbott" } },
  );
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /raw_user_id|visit_id|start_url|end_url/);
  assert.deepEqual(JSON.parse(text).abbott_bi.session_journeys.rows, []);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("invalid ranges, absent dashboards and unexpected failures keep existing semantics", async (t) => {
  const errorLog = mock.method(console, "error", () => undefined);
  t.after(() => errorLog.mock.restore());
  const cases = [
    [new InvalidDashboardDateRangeError(), 400, { error: "Invalid date range" }],
    [new Error("Dashboard not found"), 404, { error: "Dashboard not found" }],
    [new Error("database unavailable"), 500, { error: "Internal server error" }],
  ] as const;
  for (const [error, status, body] of cases) {
    const handler = createAbbottJsonHandler({
      authorize: async () => access(),
      load: async () => { throw error; },
    });
    const response = await handler(new Request("https://example.test/api/dashboard/18"), { params: { id: "18" } });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(errorLog.mock.callCount(), 1);
});

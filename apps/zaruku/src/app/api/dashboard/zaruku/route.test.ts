import assert from "node:assert/strict";
import test from "node:test";
import { InvalidDashboardDateRangeError } from "@/lib/dashboard-date-range";
import { createZarukuDashboardGetHandler } from "../../../../lib/zaruku-json-handler";

const context = { id: 28, client_id: "zaruku", dashboard_type: "zaruku_bi", client_name: "Zaruku", dashboard_name: "Dashboard", auth_mode: "password_only" };
const access = { authorized: true, audience: "manager", context, credentialVersion: 7 };

test("isolated Zaruku JSON rejects foreign client and dashboard type before data load", async () => {
  const calls: string[] = [];
  for (const foreign of [{ ...context, client_id: "abbott" }, { ...context, dashboard_type: "awareness" }, { ...context, dashboard_type: undefined }]) {
    const handler = createZarukuDashboardGetHandler({
      authorize: (async () => ({ ...access, context: foreign })) as never,
      load: (async () => { calls.push("load"); throw new Error("must not run"); }) as never,
    });
    const response = await handler(new Request("https://dash.test/api/dashboard/zaruku"));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.deepEqual(calls, []);
});

test("isolated Zaruku JSON preserves auth challenge metadata without loading data", async () => {
  const handler = createZarukuDashboardGetHandler({
    authorize: (async () => ({ authorized: false, context })) as never,
    load: (async () => { throw new Error("must not load"); }) as never,
  });
  const response = await handler(new Request("https://dash.test/api/dashboard/zaruku"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    error: "Authentication required", auth_required: true,
    dashboard: { id: 28, client_id: "zaruku", client_name: "Zaruku", dashboard_name: "Dashboard", auth_mode: "password_only" },
  });
});

test("isolated Zaruku JSON keeps canonical payload, AI summary precedence, safe timing, and audience", async () => {
  for (const audience of ["manager", "embed"]) {
    for (const summary of ["override", "snapshot", "disabled"]) {
      const calls: unknown[] = [];
      const data = { dashboard: { type: "zaruku_bi" }, zaruku_seo: { source_freshness: [{ source_key: "yandex_webmaster", status: "failed" }], wordstat: { rows: [1] }, seo_os: { rows: [2] }, alice: { month: "2026-07" }, historical: [{ date: "2026-01-01", visits: 42 }] } };
      const handler = createZarukuDashboardGetHandler({
        authorize: (async (_request: Request, id: string) => { calls.push(["authorize", id]); return { ...access, audience }; }) as never,
        load: (async (_request: Request, id: string, resolvedAudience: string) => {
          calls.push(["load", id, resolvedAudience]);
          return { data, ai_summary_enabled: summary !== "disabled", ai_summary_override: summary === "override" ? { headline: "Override" } : null, ai_summary_snapshot: { headline: "Snapshot" }, server_timing: { "metrika-db": 12.345, total: 20, "SELECT secret": 900 } };
        }) as never,
      });
      const response = await handler(new Request("https://dash.test/api/dashboard/zaruku?client_id=abbott"));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal(response.headers.get("Server-Timing"), "metrika-db;dur=12.3, total;dur=20.0");
      assert.deepEqual(await response.json(), { ...data, ...(summary === "disabled" ? {} : { ai_summary: { headline: summary === "override" ? "Override" : "Snapshot" } }) });
      assert.deepEqual(calls, [["authorize", "zaruku"], ["load", "zaruku", audience]]);
    }
  }
});

test("isolated Zaruku JSON preserves private sanitized date and data errors", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const [error, status, message] of [[new InvalidDashboardDateRangeError(), 400, "Invalid date range"], [new Error("Dashboard not found"), 404, "Dashboard not found"], [new Error("secret SQL detail"), 500, "Internal server error"]] as const) {
    const handler = createZarukuDashboardGetHandler({ authorize: (async () => access) as never, load: (async () => { throw error; }) as never });
    const response = await handler(new Request("https://dash.test/api/dashboard/zaruku"));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: message });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { InvalidDashboardDateRangeError } from "@/lib/dashboard-date-range";
import { createDashboardGetHandler } from "./[id]/route";

test("dashboard route maps invalid Abbott date ranges to a private 400 response", async () => {
  const GET = createDashboardGetHandler({
    isDashboardAccessAuthorized: (async () => ({
      authorized: true,
      audience: "manager",
      context: {},
    })) as never,
    loadDashboardData: (async () => {
      throw new InvalidDashboardDateRangeError();
    }) as never,
  });

  const response = await GET(
    new Request("https://dash.test/api/dashboard/abbott?from=2026-08-09&to=2026-08-01"),
    { params: { id: "abbott" } },
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Invalid date range" });
});

test("combined JSON delegates a canonical Zaruku identity using its constant slug and injected loader", async () => {
  const calls: unknown[] = [];
  const GET = createDashboardGetHandler({
    isDashboardAccessAuthorized: (async (_request: Request, identifier: string) => {
      calls.push(["authorize", identifier]);
      return { authorized: true, audience: "manager", context: { id: 28, client_id: "zaruku", dashboard_type: "zaruku_bi" } };
    }) as never,
    loadDashboardData: (async (_request: Request, identifier: string, audience: string) => {
      calls.push(["load", identifier, audience]);
      return { data: { dashboard: { type: "zaruku_bi" }, source_health: [{ status: "failed" }] }, ai_summary_enabled: false };
    }) as never,
  });
  const response = await GET(new Request("https://dash.test/api/dashboard/28"), { params: { id: "28" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(calls, [["authorize", "28"], ["load", "zaruku", "manager"]]);
  assert.deepEqual(await response.json(), { dashboard: { type: "zaruku_bi" }, source_health: [{ status: "failed" }] });
});

test("combined JSON does not infer Zaruku ownership from the URL identifier", async () => {
  const calls: unknown[] = [];
  const GET = createDashboardGetHandler({
    isDashboardAccessAuthorized: (async () => ({ authorized: true, audience: "manager", context: { id: 7, client_id: "other", dashboard_type: "awareness" } })) as never,
    loadDashboardData: (async (_request: Request, identifier: string) => { calls.push(identifier); return { data: { dashboard: { type: "awareness" } }, ai_summary_enabled: false }; }) as never,
  });
  const response = await GET(new Request("https://dash.test/api/dashboard/zaruku"), { params: { id: "zaruku" } });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["zaruku"]);
});

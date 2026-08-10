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

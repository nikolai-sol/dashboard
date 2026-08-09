import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("dashboard route maps invalid Abbott date ranges to a private 400 response", () => {
  assert.match(routeSource, /InvalidDashboardDateRangeError/);
  assert.match(routeSource, /instanceof\s+InvalidDashboardDateRangeError/);
  assert.match(routeSource, /privateJson\(\{ error: "Invalid date range" \}, \{ status: 400 \}\)/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
});

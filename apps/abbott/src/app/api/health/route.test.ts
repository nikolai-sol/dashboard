import assert from "node:assert/strict";
import test from "node:test";
import { createHealthHandler } from "../../../lib/abbott-health-handler";
import { GET } from "./route";

test("health identifies only the Abbott runtime and is never public-cacheable", async () => {
  const response = await createHealthHandler({ query: async () => undefined })();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    scope: "abbott",
    database: "connected",
  });
});

test("health fails closed without exposing database diagnostics", async () => {
  const response = await createHealthHandler({
    query: async () => {
      throw new Error("connect ECONNREFUSED manager-db password=sensitive");
    },
  })();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const responseText = await response.clone().text();
  assert.deepEqual(await response.json(), {
    ok: false,
    scope: "abbott",
    database: "disconnected",
  });
  assert.doesNotMatch(responseText, /manager-db|password|sensitive/i);
});

test("route exports the configured health handler", () => {
  assert.equal(typeof GET, "function");
});

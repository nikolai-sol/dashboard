import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Abbott build and dev use app-local Webpack discovery", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts.build, "next build --webpack");
  assert.equal(manifest.scripts.dev, "next dev --webpack");
});

test("isolated build discovers no inherited root middleware or edge functions", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../.next-abbott/server/middleware-manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.middleware), []);
  assert.deepEqual(Object.keys(manifest.functions), []);
  assert.deepEqual(manifest.sortedMiddleware, []);
});

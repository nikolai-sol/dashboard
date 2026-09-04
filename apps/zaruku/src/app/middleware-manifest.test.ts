import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the isolated Zaruku build emits no middleware from another runtime", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../.next-zaruku/server/middleware-manifest.json", import.meta.url), "utf8"),
  ) as {
    middleware: Record<string, { matchers: { originalSource: string }[] }>;
    functions: Record<string, unknown>;
    sortedMiddleware: string[];
  };

  assert.deepEqual(
    Object.values(manifest.middleware).flatMap(({ matchers }) => matchers.map(({ originalSource }) => originalSource)),
    [],
  );
  assert.deepEqual(Object.keys(manifest.middleware), []);
  assert.deepEqual(Object.keys(manifest.functions), []);
  assert.deepEqual(manifest.sortedMiddleware, []);
});

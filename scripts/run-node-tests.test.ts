import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("node test runner recursively lists every TypeScript test without shell globbing", () => {
  const result = spawnSync(process.execPath, ["scripts/run-node-tests.mjs", "--list"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout) as string[];
  assert.ok(files.includes("src/app/api/admin/campaigns/all/route.test.ts"));
  assert.ok(files.includes("scripts/import-zaruku-alice-visibility.test.ts"));
  assert.ok(files.includes("scripts/run-node-tests.test.ts"));
  assert.deepEqual(files, [...files].sort((left, right) => left.localeCompare(right, "en")));
  assert.equal(new Set(files).size, files.length);
  assert.ok(files.every((file) => /\.test\.tsx?$/.test(file) && !path.isAbsolute(file)));
});

test("package uses the cross-platform recursive node test runner", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(manifest.scripts["test:node"], "node scripts/run-node-tests.mjs");
});

test("node test runner scopes discovery to an explicitly requested application root", () => {
  const result = spawnSync(process.execPath, ["scripts/run-node-tests.mjs", "--list", "apps/zaruku/src"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout) as string[];
  assert.ok(files.includes("apps/zaruku/src/app/api/dashboard/zaruku/route.test.ts"));
  assert.ok(files.length > 0);
  assert.ok(files.every((file) => file.startsWith("apps/zaruku/src/") && /\.test\.tsx?$/.test(file)));
});

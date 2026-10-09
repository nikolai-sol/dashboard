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

test("predeploy covers every standalone Abbott contract file once without repeating that command", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const prefix = "node --import tsx --test ";
  const command = manifest.scripts["test:abbott-contract"];
  assert.ok(typeof command === "string" && command.startsWith(prefix));
  const abbottFiles = command.slice(prefix.length).split(" ");
  assert.equal(abbottFiles.length, 10);
  assert.ok(abbottFiles.every((file: string) => /^src\/[A-Za-z0-9_./-]+\.test\.tsx?$/.test(file)));
  const listed = spawnSync(process.execPath, ["scripts/run-node-tests.mjs", "--list"], {encoding: "utf8"});
  assert.equal(listed.status, 0, listed.stderr);
  const discovered = JSON.parse(listed.stdout) as string[];
  for (const file of abbottFiles) assert.equal(discovered.filter(found => found === file).length, 1, file);
  const predeploy = readFileSync("scripts/predeploy-verify.sh", "utf8");
  assert.ok(/^npm test$/m.test(predeploy));
  assert.ok(/^npm run test:abbott-contract-wiring$/m.test(predeploy));
  assert.ok(!/^npm run test:abbott-contract$/m.test(predeploy), "duplicate standalone Abbott command remains");
});

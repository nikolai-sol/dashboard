import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.resolve("src/app/api/admin/dashboards/[id]/binding-diagnostics/route.ts"),
  "utf8",
);

test("binding diagnostics require admin auth and read canonical diagnostics", () => {
  assert.match(source, /verifyAdminSession/);
  assert.match(source, /loadAdvertisingBindingDiagnostics/);
  assert.doesNotMatch(source, /manual-data-fetcher|fetch\(/);
});

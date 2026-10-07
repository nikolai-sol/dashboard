import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./ZarukuAliceVisibilityTab.tsx", import.meta.url), "utf8");
test("Alice summary cards wrap compactly and query sample cards require observed detail", () => {
  assert.match(source, /data-alice-kpi-grid/);
  assert.match(source, /grid-cols-1 sm:grid-cols-2/);
  assert.match(source, /hasExampleCoverage \? <>/);
  assert.match(source, /min-w-0.*break-words/);
});

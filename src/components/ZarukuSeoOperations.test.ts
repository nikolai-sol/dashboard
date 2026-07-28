import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoOperations.tsx", import.meta.url), "utf8");

test("operations tables use shared bounded frames", () => {
  assert.equal((source.match(/<ZarukuTableFrame mode="operational"/g) ?? []).length, 3);
  assert.doesNotMatch(source, /max-h-\[(?:300|360)px\] overflow-auto/);
  assert.match(source, /card-surface zaruku-panel/);
});

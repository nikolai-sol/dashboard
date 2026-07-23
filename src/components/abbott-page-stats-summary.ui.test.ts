import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./AbbottBiDashboard.tsx", import.meta.url), "utf8");

test("page stats summary uses the complete filtered row collection", () => {
  assert.match(source, /summarizeAbbottPageStats\(pageStatRows\)/);
  assert.doesNotMatch(source, /summarizeAbbottPageStats\(pageStatsPage\.pageRows\)/);
});

test("page stats passes its summary separately from paginated rows", () => {
  assert.match(
    source,
    /summaryRow=\{activeTab === "page_stats" \? pageStatsSummaryRow : undefined\}/,
  );
});

test("DataTable renders the optional summary before ordinary rows", () => {
  const summaryIndex = source.indexOf("{summaryRow ? (");
  const rowsIndex = source.indexOf("rows.map((row, index)");

  assert.notEqual(summaryIndex, -1);
  assert.notEqual(rowsIndex, -1);
  assert.ok(summaryIndex < rowsIndex);
});

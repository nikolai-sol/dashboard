import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./ZarukuAliceVisibilityTab.tsx", import.meta.url), "utf8");
test("Alice summary cards wrap compactly and sample cards require supplied counts", () => {
  assert.match(source, /data-alice-kpi-grid/);
  assert.match(source, /grid-cols-1 sm:grid-cols-2/);
  assert.match(source, /hasExampleCoverage \? <>/);
  assert.match(source, /min-w-0.*break-words/);
});

test("Alice chart and KPIs are neighboring desktop columns, stacked on mobile, with bounded monthly spacing", () => {
  const layoutStart = source.indexOf("data-alice-summary-layout");
  const chartStart = source.indexOf("data-alice-history-chart", layoutStart);
  const cardsStart = source.indexOf("data-alice-kpi-grid", chartStart);
  const layoutEnd = source.indexOf("data-alice-summary-end", cardsStart);
  assert.ok(layoutStart >= 0 && chartStart > layoutStart && cardsStart > chartStart && layoutEnd > cardsStart);
  assert.match(source.slice(layoutStart, layoutEnd), /grid-cols-1.*lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/);
  assert.match(source.slice(chartStart, cardsStart), /style=\{\{ width: chart\.width \}\}/);
  assert.doesNotMatch(source.slice(chartStart, cardsStart), /minWidth: chart\.width|h-56 w-full/);
  assert.match(source.slice(cardsStart, layoutEnd), /sm:grid-cols-2 lg:grid-cols-1/);
});

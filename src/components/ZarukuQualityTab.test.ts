import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuQualityTab.tsx", import.meta.url), "utf8");

test("quality tab reads from verdict to limitations to technical freshness", () => {
  const headings = ["Можно ли доверять данным?", "Покрытие и ограничения", "Свежесть источников", "Ожидаемые источники"];
  let previous = -1;
  for (const heading of headings) {
    const index = source.indexOf(heading);
    assert.ok(index > previous, `${heading} must follow the previous section`);
    previous = index;
  }
});

test("quality surface keeps collector internals in progressive disclosure", () => {
  assert.match(source, /buildZarukuTrustState/);
  assert.match(source, /<details/);
  assert.match(source, /Технические детали/);
  assert.match(source, /rows_written/);
  assert.doesNotMatch(source, />Source freshness</);
});

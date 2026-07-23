import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuAudienceTab.tsx", import.meta.url), "utf8");

test("audience starts with the city by map product signal", () => {
  const headings = ["Города и каталог онкоцентров", "Устройства", "Техническая среда", "Демография и интересы"];
  let previous = -1;
  for (const heading of headings) {
    const index = source.indexOf(heading);
    assert.ok(index > previous, `${heading} must follow the previous section`);
    previous = index;
  }
  assert.match(source, /город × `?\/map\//);
  assert.match(source, /<ZarukuRussiaDemandMap rows=\{data\.map_city_demand\}/);
});

test("every optional audience slice uses its explicit dataset state", () => {
  for (const key of ["map_city_demand", "devices", "source_devices", "browsers", "operating_systems", "age", "gender", "interests"]) {
    assert.match(source, new RegExp(`dataset_meta\\.${key}`));
  }
  assert.match(source, /<ZarukuPanelState/);
  assert.doesNotMatch(source, /geo_countries|geo_cities|Страны/);
});

test("source-device users use the row-level availability contract", () => {
  assert.match(source, /row\.users_available\s*===\s*false\s*\?\s*"—"/);
});

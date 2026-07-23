import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatAudienceUsers } from "@/components/ZarukuAudienceTab";
import type { ZarukuDatasetMeta, ZarukuSeoMetricRow } from "@/lib/types";

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
  assert.match(source, /meta\.metrics\.users\s*&&\s*row\.users_available\s*!==\s*false/);
});

test("multi-day audience users render an em dash instead of a summed value", () => {
  const row = { users: 123, users_available: true } as ZarukuSeoMetricRow;
  const meta = {
    requested_period: { from: "2026-07-19", to: "2026-07-21" },
    metrics: { users: false },
  } as ZarukuDatasetMeta;

  assert.equal(formatAudienceUsers(row, meta, "ru-RU"), "—");
});

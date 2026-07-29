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
  assert.match(source, /<ZarukuTableFrame mode="standard"/);
  assert.doesNotMatch(source, /<div className="overflow-x-auto">\s*<table/);
  assert.match(source, /card-surface zaruku-panel/);
  assert.doesNotMatch(source, /geo_countries|geo_cities|Страны/);
  assert.match(source, /export function isZarukuAudienceVisible/);
  assert.match(source, /isZarukuDatasetVisible/);
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

test("source-device table keeps horizontal cell padding on mobile", () => {
  assert.match(source, /<th className="px-4 py-2\.5 font-medium">Источник<\/th>/);
  assert.match(source, /<td className="px-4 py-2\.5 font-medium text-slate-700">\{row\.label\}<\/td>/);
  assert.doesNotMatch(source, /<th className="pb-2 font-medium">Источник<\/th>/);
  assert.doesNotMatch(source, /<td className="py-2\.5 font-medium text-slate-700">\{row\.label\}<\/td>/);
});

test("audience percentage labels move outside bars when the fill is too narrow", () => {
  assert.match(source, /const \[showPercentInside, setShowPercentInside\] = useState\(true\)/);
  assert.match(source, /new ResizeObserver\(evaluate\)/);
  assert.match(source, /fillWidth >= labelWidth \+ requiredGap/);
  assert.match(source, /style=\{\{ left: `calc\(\$\{fillPercent\}% \+ 6px\)` \}\}/);
  assert.match(source, /className="relative h-6 overflow-visible rounded-md bg-slate-50"/);
});

test("audience bar rows leave enough mobile track width for large percentages", () => {
  assert.match(source, /grid-cols-\[minmax\(92px,128px\)_minmax\(84px,1fr\)_64px\]/);
  assert.match(source, /sm:grid-cols-\[minmax\(110px,160px\)_minmax\(0,1fr\)_72px\]/);
});

test("audience detail panels are expanded by default", () => {
  const detailsTags = source.match(/<details\b[^>]*>/g) ?? [];

  assert.ok(detailsTags.length > 0, "expected audience to render detail panels");
  for (const detailsTag of detailsTags) {
    assert.match(detailsTag, /\bopen\b/, `${detailsTag} should be open by default`);
  }
});

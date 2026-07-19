import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoDashboard.tsx", import.meta.url), "utf8");

test("DataTable keeps behavior metric headers readable with spacing and wrapping", () => {
  assert.match(source, /min-w-\[1080px\]/);
  assert.match(source, /table-fixed/);
  assert.match(source, /px-3 pb-2 text-right font-medium leading-tight/);
  assert.match(source, /whitespace-normal/);
});

test("SEO tab renders one AI visibility panel and keeps long tables bounded", () => {
  const aiPanelMatches = source.match(/<AiAggregateVisibilityPanel/g) ?? [];

  assert.equal(aiPanelMatches.length, 1);
  assert.match(source, /data\.organic_landing_pages\.slice\(0, 10\)/);
  assert.match(source, /max-h-\[29rem\]/);
  assert.match(source, /max-h-\[30rem\]/);
});

test("SEO tab explains Metrika search phrases and hides empty Yandex landing page facts", () => {
  assert.match(source, /Поисковые фразы из Метрики/);
  assert.match(source, /Фразы, которые Метрика смогла определить после клика/);
  assert.match(source, /webmasterPages\.length > 0/);
});

test("SEO tab labels Yandex query table from its own week selection", () => {
  assert.match(source, /const webmasterQueryMeta = buildWebmasterSelectionMeta\(webmasterQuerySelection, webmasterWeek\)/);
  assert.match(source, /webmasterQueryMeta\.fallbackNote/);
});

test("Quality tab shows technical collector freshness wording", () => {
  assert.match(source, /Source freshness/);
  assert.match(source, /last successful cron/);
  assert.match(source, /rows written/);
});

test("SEO tab renders Search Console facts from canonical data without pending placeholder", () => {
  assert.match(source, /GSC search facts/);
  assert.match(source, /Search Console · canonical_fact_gsc_queries_daily/);
  assert.doesNotMatch(source, /title="Факты Google Search Console" source="gsc" layer="serp" pending/);
  assert.doesNotMatch(source, /Данные по Google-показам, кликам и CTR ожидаются из Search Console/);
});

test("pending and returning-content panels explain current state instead of showing misleading empty UI", () => {
  assert.match(source, /pending=\{data\.pending_requirements\.length > 0\}/);
  assert.doesNotMatch(source, /title="Что ещё ждём" layer="serp" pending right=/);
  assert.match(source, /Нет возвратного контента за выбранный период/);
});

test("SEO tab renders GSC product enrichment panels", () => {
  assert.match(source, /GSC landing pages/);
  assert.match(source, /GSC brand vs non-brand/);
  assert.match(source, /data\.gsc\.landing_pages/);
  assert.match(source, /data\.gsc\.brand_split/);
});

test("Geo tab focuses on a Russia bubble map instead of duplicate country and city lists", () => {
  assert.match(source, /function RussiaDemandBubbleMap/);
  assert.match(source, /function isRussiaDemandCity/);
  assert.match(source, /NON_RUSSIA_CITY_PATTERN/);
  assert.match(source, /Карта спроса по России/);
  assert.match(source, /размер круга = визиты/);
  assert.match(source, /formatPercent\(row\.share, locale, 1\)/);
  assert.match(source, /<RussiaDemandBubbleMap rows=\{data\.map_city_demand\}/);
  assert.doesNotMatch(source, /title="Страны"/);
  assert.doesNotMatch(source, /title="Города"/);
});

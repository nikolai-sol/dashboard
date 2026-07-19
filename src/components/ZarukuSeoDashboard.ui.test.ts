import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoDashboard.tsx", import.meta.url), "utf8");
const russiaMapSource = readFileSync(new URL("./ZarukuRussiaDemandMap.tsx", import.meta.url), "utf8");

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
  assert.match(source, /function PendingPanel[\s\S]*if \(data\.pending_requirements\.length === 0\) return null;/);
  assert.match(source, /pending=\{data\.pending_requirements\.length > 0\}/);
  assert.doesNotMatch(source, /title="Что ещё ждём" layer="serp" pending right=/);
  assert.match(source, /Нет возвратного контента за выбранный период/);
});

test("Behavior tab exposes canonical returning-content recency buckets", () => {
  assert.match(source, /возвратные пользователи/);
  assert.match(source, /1 день/);
  assert.match(source, /2–7 дней/);
  assert.match(source, /8–31 день/);
  assert.match(source, /row\.returning_1_day_users/);
  assert.match(source, /row\.returning_2_7_days_users/);
  assert.match(source, /row\.returning_8_31_days_users/);
}
);

test("SEO tab renders GSC product enrichment panels", () => {
  assert.match(source, /GSC landing pages/);
  assert.match(source, /GSC brand vs non-brand/);
  assert.match(source, /GSC countries/);
  assert.match(source, /GSC devices/);
  assert.match(source, /GSC search appearances/);
  assert.match(source, /GSC result types/);
  assert.match(source, /data\.gsc\.landing_pages/);
  assert.match(source, /data\.gsc\.brand_split/);
  assert.match(source, /data\.gsc\.country_summary/);
  assert.match(source, /data\.gsc\.search_appearance/);
  assert.match(source, /data\.gsc\.search_type_summary/);
  assert.match(source, /gscSummaryRows/);
});

test("Geo tab uses the projected Russia demand map instead of manual coordinates", () => {
  assert.match(source, /import ZarukuRussiaDemandMap from "@\/components\/ZarukuRussiaDemandMap"/);
  assert.match(source, /Карта спроса по России/);
  assert.match(source, /<ZarukuRussiaDemandMap rows=\{data\.map_city_demand\}/);
  assert.doesNotMatch(source, /function RussiaMapOutline/);
  assert.doesNotMatch(source, /RUSSIA_CITY_COORDINATES/);
  assert.doesNotMatch(source, /resolveRussiaCityPoint/);
  assert.doesNotMatch(source, /title="Страны"/);
  assert.doesNotMatch(source, /title="Города"/);

  assert.match(russiaMapSource, /from "@visx\/geo"/);
  assert.match(russiaMapSource, /RUSSIA_FEATURE/);
  assert.match(russiaMapSource, /rotate=\{\[-100, 0, 0\]\}/);
  assert.match(russiaMapSource, /separateMapMarkers/);
  assert.match(russiaMapSource, /marker\.anchorX/);
  assert.match(russiaMapSource, /city\.showLabel/);
  assert.match(russiaMapSource, /aria-label=\{`\$\{city\.row\.label\}:/);
  assert.match(russiaMapSource, /onPointerEnter/);
  assert.match(russiaMapSource, /onFocus/);
  assert.match(russiaMapSource, /Это не весь гео-трафик сайта/);
  assert.match(russiaMapSource, /визиты на раздел `\/map\/`/);
  assert.match(russiaMapSource, /размер круга = визиты/);
  assert.match(russiaMapSource, /formatPercent\(city\.row\.share, locale, 1\)/);
});

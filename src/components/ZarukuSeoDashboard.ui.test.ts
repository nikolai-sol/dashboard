import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoDashboard.tsx", import.meta.url), "utf8");
const russiaMapSource = readFileSync(new URL("./ZarukuRussiaDemandMap.tsx", import.meta.url), "utf8");

test("client navigation contains exactly six tabs in executive order", () => {
  const labels = ["Обзор", "SEO", "Контент", "Аудитория", "Работы и задачи", "Качество"];
  let lastIndex = -1;
  for (const label of labels) {
    const index = source.indexOf(`label: "${label}"`);
    assert.ok(index > lastIndex, `${label} must follow the previous tab`);
    lastIndex = index;
  }
  assert.doesNotMatch(source, /label: "SEO-операции"|label: "Гео"|label: "Устройства"|label: "Поведение"/);
});

test("Overview starts with explicit period context and data confidence", () => {
  const overviewSource = readFileSync(new URL("./ZarukuOverviewTab.tsx", import.meta.url), "utf8");
  assert.match(source, /import ZarukuOverviewTab/);
  assert.match(source, /<ZarukuOverviewTab data=\{data\}/);
  assert.match(overviewSource, /<ZarukuPeriodContext/);
  assert.match(overviewSource, /Что происходит с поисковой видимостью и целевым трафиком сейчас/);
  assert.match(overviewSource, /Частичные данные|Можно доверять|Критическая проблема/);
});

test("DataTable keeps behavior metric headers readable with spacing and wrapping", () => {
  assert.match(source, /min-w-\[1080px\]/);
  assert.match(source, /table-fixed/);
  assert.match(source, /px-3 pb-2 text-right font-medium leading-tight/);
  assert.match(source, /whitespace-normal/);
});

test("SEO tab follows the executive-to-detail hierarchy without duplicate source tables", () => {
  const aiPanelMatches = source.match(/<AiAggregateVisibilityPanel/g) ?? [];

  assert.equal(aiPanelMatches.length, 1);
  assert.match(source, /<ZarukuSeoExecutiveSummary/);
  assert.match(source, /<ZarukuSeoQueryComparison/);
  assert.match(source, /<ZarukuSeoPageComparison/);
  assert.match(source, /<ZarukuSeoDiagnostics/);
  assert.doesNotMatch(source, /title="GSC countries"/);
  assert.doesNotMatch(source, /title="Запросы Яндекса"/);
  assert.doesNotMatch(source, /title="Google Search Console queries"/);
});

test("SEO tab explains Metrika search phrases and uses the unified landing-page workspace", () => {
  assert.match(source, /Поисковые фразы из Метрики/);
  assert.match(source, /Фразы, которые Метрика смогла определить после клика/);
  assert.match(source, /buildUnifiedSeoPageRows/);
  assert.match(source, /webmasterRows: webmasterPages/);
  assert.doesNotMatch(source, /title="Посадочные страницы Яндекса"/);
});

test("SEO tab passes actual source weeks into unified comparisons", () => {
  assert.match(source, /webmaster: webmasterQuerySelection\.week/);
  assert.match(source, /google: gscQuerySelection\.week/);
  assert.match(source, /webmaster: webmasterPages\.length > 0 \? webmasterPageSelection\.week : null/);
  assert.match(source, /google: gscLandingPages\.length > 0 \? gscLandingPageSelection\.week : null/);
});

test("Quality tab shows technical collector freshness wording", () => {
  assert.match(source, /Source freshness/);
  assert.match(source, /last successful cron/);
  assert.match(source, /rows written/);
});

test("SEO tab renders Search Console facts through the unified read model without a pending placeholder", () => {
  assert.match(source, /data\.gsc\.queries/);
  assert.match(source, /data\.gsc\.landing_pages/);
  assert.match(source, /buildUnifiedSeoQueryRows/);
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

test("SEO tab keeps useful GSC diagnostics and removes country breakdown", () => {
  assert.match(source, /<ZarukuSeoDiagnostics/);
  assert.match(source, /data\.gsc\.landing_pages/);
  assert.match(source, /data\.gsc\.brand_split/);
  assert.match(source, /data\.gsc\.search_appearance/);
  assert.match(source, /data\.gsc\.search_type_summary/);
  assert.match(source, /gscSummaryRows/);
  assert.doesNotMatch(source, /data\.gsc\.country_summary/);
  assert.doesNotMatch(source, /Countries|GSC countries/);
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

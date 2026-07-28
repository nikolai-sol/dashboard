import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoDashboard.tsx", import.meta.url), "utf8");
const toolbarSource = readFileSync(new URL("./ZarukuSeoWeekToolbar.tsx", import.meta.url), "utf8");
const russiaMapSource = readFileSync(new URL("./ZarukuRussiaDemandMap.tsx", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("./ZarukuContentTab.tsx", import.meta.url), "utf8");
const audienceSource = readFileSync(new URL("./ZarukuAudienceTab.tsx", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("./ZarukuOverviewTab.tsx", import.meta.url), "utf8");
const panelLayoutSource = readFileSync(new URL("./zaruku-panel-layout.ts", import.meta.url), "utf8");
const globalsSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const paletteSource = readFileSync(new URL("../lib/chart-palette.ts", import.meta.url), "utf8");
const clientCopySource = readFileSync(new URL("./zaruku-client-copy.ts", import.meta.url), "utf8");

test("Zaruku uses shared visual tokens and chart palette", () => {
  for (const token of ["--accent-seo", "--accent-pos", "--ink", "--surface-alt", "--card-pad", "--gap-card", "--gap-section"]) {
    assert.match(globalsSource, new RegExp(token));
  }
  assert.match(paletteSource, /export const ZARUKU_CHART_PALETTE/);
  assert.match(source, /ZARUKU_CHART_PALETTE/);
});

test("Zaruku typography follows the RD-01 heading, KPI, and table-header contract", () => {
  assert.match(source, /className="zaruku-dashboard /);
  assert.match(source, /zaruku-kpi-value/);
  assert.match(globalsSource, /\.zaruku-dashboard :is\(h1, h2, h3, h4\)[\s\S]*font-family: var\(--zaruku-font-display\)/);
  assert.match(globalsSource, /\.zaruku-dashboard \.zaruku-kpi-value[\s\S]*font-family: var\(--zaruku-font-display\)[\s\S]*font-variant-numeric: tabular-nums/);
  assert.match(globalsSource, /\.zaruku-dashboard \.zaruku-table thead[\s\S]*font-family: var\(--zaruku-font-sans\)[\s\S]*font-size: 13px[\s\S]*line-height: 1\.4[\s\S]*text-transform: uppercase[\s\S]*color: var\(--muted\)/);
});

test("dashboard distinguishes the traffic period from SEO week selection", () => {
  assert.match(source, /Период трафика:\s*<\/span>\s*<span>\{data\.period\.from\} — \{data\.period\.to\}<\/span>/);
});

test("SEO week toolbar names its reporting period", () => {
  assert.match(toolbarSource, /Отчётная SEO-неделя/);
});

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

test("Overview does not show the duplicated period context strip", () => {
  assert.match(source, /import ZarukuOverviewTab/);
  assert.match(source, /<ZarukuOverviewTab data=\{data\}/);
  assert.doesNotMatch(overviewSource, /<ZarukuPeriodContext/);
  assert.match(overviewSource, /void data;/);
});

test("Overview uses a stable bounded desktop composition", () => {
  for (const panelName of [
    "north_star",
    "traffic_health",
    "channels",
    "organic_search",
  ]) {
    assert.match(panelLayoutSource, new RegExp(`panel\\("overview", "${panelName}"`));
  }
  assert.match(overviewSource, /className="zaruku-overview-grid"/);
  assert.doesNotMatch(overviewSource, /registryColumns=\{false\}|registrySpan=\{false\}/);
  assert.match(panelLayoutSource, /panel\("overview", "channels", 30, "half"/);
  assert.match(panelLayoutSource, /panel\("overview", "organic_search", 40, "half"/);
  assert.match(globalsSource, /grid-template-rows:\s*96px minmax\(129px, auto\) minmax\(280px, 1fr\)/);
  assert.match(source, /min-h-\[calc\(100vh-194px\)\]/);
  assert.match(source, /initialLimit=\{6\}/);
  assert.match(source, /titleInfo=\{/);
  assert.match(source, /ZARUKU_CLIENT_COPY\.technicalTail/);
  assert.match(clientCopySource, /Технический хвост/);
  assert.doesNotMatch(source, /Технический хвост:\{" "\}/);
});

test("Overview keeps KPI and chart content inside its desktop bounds", () => {
  assert.match(source, /<ResponsiveContainer width="100%" height="100%" initialDimension=\{\{ width: 1, height: 1 \}\}>/);
  assert.match(source, /<LineChart data=\{data\.organic_trend\} margin=\{\{ top: 8, right: 16, left: -20, bottom: 0 \}\}>/);
  assert.match(source, /<XAxis dataKey="label" padding=\{\{ right: 12 \}\}/);
});

test("Audience device panels shrink before their tables start scrolling", () => {
  assert.match(audienceSource, /grid-cols-\[minmax\(0,1fr\)\]/);
  assert.match(audienceSource, /<div className="min-w-0"><h4[^>]*>Типы устройств/);
  assert.match(audienceSource, /<div className="min-w-0"><h4[^>]*>Источник × устройство/);
});

test("SEO tab follows the executive-to-detail hierarchy without duplicate source tables", () => {
  const aiPanelMatches = source.match(/<AiAggregateVisibilityPanel/g) ?? [];

  assert.equal(aiPanelMatches.length, 1);
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
  assert.doesNotMatch(source, /title: "Запрос → посадочная"/);
});

test("SEO tab passes actual source weeks into unified comparisons", () => {
  assert.match(source, /webmaster: webmasterQuerySelection\.week/);
  assert.match(source, /google: gscQuerySelection\.week/);
  assert.match(source, /webmaster: webmasterPages\.length > 0 \? webmasterPageSelection\.week : null/);
  assert.match(source, /google: gscLandingPages\.length > 0 \? gscLandingPageSelection\.week : null/);
});

test("daily GSC and Webmaster presentation is independent from the SEO OS week selector", () => {
  assert.match(source, /const webmasterWeek = data\.webmaster\.latest_week;/);
  assert.match(source, /const gscWeek = data\.gsc\.latest_week;/);
  assert.doesNotMatch(source, /const webmasterWeek = primaryWeek/);
  assert.doesNotMatch(source, /const gscWeek = primaryWeek/);
  assert.doesNotMatch(source, /resolveRowsForWeekOrLatest/);
  assert.doesNotMatch(source, /показываем последнюю доступную неделю/);
});

test("Quality route uses the client-facing trust surface", () => {
  assert.match(source, /import ZarukuQualityTab/);
  assert.match(source, /<ZarukuQualityTab data=\{data\}/);
  assert.doesNotMatch(source, /function QualityTab|function SourceFreshnessTable/);
});

test("SEO tab renders Search Console facts through the unified read model without a pending placeholder", () => {
  assert.match(source, /data\.gsc\.queries/);
  assert.match(source, /data\.gsc\.landing_pages/);
  assert.match(source, /buildUnifiedSeoQueryRows/);
  assert.doesNotMatch(source, /title="Факты Google Search Console" source="gsc" layer="serp" pending/);
  assert.doesNotMatch(source, /Данные по Google-показам, кликам и CTR ожидаются из Search Console/);
});

test("pending and returning-content panels use explicit source states instead of misleading empty UI", () => {
  assert.match(source, /function PendingPanel[\s\S]*if \(data\.pending_requirements\.length === 0\) return null;/);
  assert.match(source, /pending=\{data\.pending_requirements\.length > 0\}/);
  assert.doesNotMatch(source, /title="Что ещё ждём" layer="serp" pending right=/);
  assert.match(contentSource, /meta=\{data\.dataset_meta\.returning_pages\}/);
  assert.match(contentSource, /hasRows=\{data\.returning_pages\.length > 0\}/);
});

test("source health renders collection provenance labels", () => {
  assert.match(source, /автоматически/);
  assert.match(source, /внешний импорт/);
  assert.match(source, /вручную/);
  assert.match(source, /не подключено/);
});

test("sidebar clarifies GEO as AI search rather than visitor geography", () => {
  assert.match(source, /SEO \/ AI-поиск/);
  assert.doesNotMatch(source, /SEO \/ GEO дашборд/);
});

test("audience bars localize common Metrika labels", () => {
  assert.match(source, /readableAudienceLabel/);
  assert.match(source, /Мужчины/);
  assert.match(source, /Женщины/);
  assert.match(source, /Возраст не определён/);
});

test("Content route uses one focused workspace without a legacy Behavior tab", () => {
  assert.match(source, /import ZarukuContentTab/);
  assert.match(source, /<ZarukuContentTab/);
  assert.match(contentSource, /aria-labelledby="content-sections-title" className="min-w-0 space-y-3"/);
  assert.doesNotMatch(source, /function ContentTab|function BehaviorTab/);
  assert.doesNotMatch(source, /Поведение по каналам/);
});

test("Work route uses the client-facing workspace wrapper", () => {
  assert.match(source, /import ZarukuWorkTab/);
  assert.match(source, /<ZarukuWorkTab/);
  assert.match(source, /<WeeklyFocusPanel/);
  assert.match(source, /<ZarukuSeoOperations/);
});

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

test("Audience route owns the projected city by map product signal", () => {
  assert.match(source, /import ZarukuAudienceTab/);
  assert.match(source, /<ZarukuAudienceTab/);
  assert.doesNotMatch(source, /function GeoTab|function DevicesTab|function AudienceTab/);
  assert.match(audienceSource, /import ZarukuRussiaDemandMap from "@\/components\/ZarukuRussiaDemandMap"/);
  assert.match(audienceSource, /Города и каталог онкоцентров/);
  assert.match(audienceSource, /<ZarukuRussiaDemandMap rows=\{data\.map_city_demand\}/);
  assert.doesNotMatch(source, /function RussiaMapOutline/);
  assert.doesNotMatch(source, /RUSSIA_CITY_COORDINATES/);
  assert.doesNotMatch(source, /resolveRussiaCityPoint/);
  assert.doesNotMatch(audienceSource, /Страны|geo_countries|geo_cities/);

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

test("Audience navigation is derived from visible datasets", () => {
  assert.match(source, /const visibleNav =/);
  assert.match(source, /isZarukuAudienceVisible\(data\)/);
  assert.match(source, /visibleNav\.map/);
  assert.match(source, /setActiveTab\("overview"\)/);
});

test("source freshness is rendered on its own sidebar line", () => {
  const sourcesStart = source.indexOf("{data.sources.map");
  const sourcesEnd = source.indexOf("</aside>", sourcesStart);
  const sourcesBlock = source.slice(sourcesStart, sourcesEnd);

  assert.match(sourcesBlock, /data-source-main-row/);
  assert.match(sourcesBlock, /data-source-freshness/);
  assert.doesNotMatch(sourcesBlock, /whitespace-nowrap/);
});

test("dashboard reports active tab changes to the page time owner", () => {
  assert.match(source, /onActiveTabChange\?: \(tab: ZarukuTabId\) => void/);
  assert.match(source, /onActiveTabChange\?\.\(tab\)/);
});

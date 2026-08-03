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
  assert.doesNotMatch(source, /Период трафика:/);
  assert.doesNotMatch(source, /счётчик \{data\.counters\.join/);
  assert.doesNotMatch(source, /\{data\.domain\}/);
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
  assert.doesNotMatch(overviewSource, /Ежедневные данные|стандартный лаг|недельный срез позиций|единый ежедневный период/);
  assert.match(overviewSource, /void data;/);
});

test("SEO comparison tables share one filter contract", () => {
  const querySource = readFileSync(new URL("./ZarukuSeoQueryComparison.tsx", import.meta.url), "utf8");
  const pageSource = readFileSync(new URL("./ZarukuSeoPageComparison.tsx", import.meta.url), "utf8");
  const workspaceSource = readFileSync(new URL("./zaruku-seo-workspace.ts", import.meta.url), "utf8");

  assert.match(workspaceSource, /export const ZARUKU_SEO_COMPARISON_FILTERS/);
  assert.match(querySource, /ZARUKU_SEO_COMPARISON_FILTERS/);
  assert.match(pageSource, /ZARUKU_SEO_COMPARISON_FILTERS/);
  assert.doesNotMatch(querySource, /const FILTERS/);
  assert.doesNotMatch(pageSource, /const FILTERS/);
});

test("SEO tab puts AI visibility and section positions before detail tables", () => {
  const seoStart = source.indexOf("function SeoTab");
  const seoEnd = source.indexOf("export default function ZarukuSeoDashboard");
  const seoSource = source.slice(seoStart, seoEnd);
  const aiIndex = seoSource.indexOf("<AiAggregateVisibilityPanel");
  const sectionIndex = seoSource.indexOf("<ZarukuSeoAnalytics");
  const queryTableIndex = seoSource.indexOf("<ZarukuSeoQueryComparison");
  const pageTableIndex = seoSource.indexOf("<ZarukuSeoPageComparison");

  assert.ok(aiIndex >= 0, "AI visibility panel must render on SEO");
  assert.ok(sectionIndex >= 0, "section positions chart must render on SEO");
  assert.ok(aiIndex < queryTableIndex, "AI visibility should come before query table");
  assert.ok(sectionIndex < queryTableIndex, "section positions should come before query table");
  assert.ok(queryTableIndex < pageTableIndex, "query table should still precede landing page table");
  assert.doesNotMatch(seoSource, /<ZarukuTrafficVisibility/);
  assert.match(seoSource, /showClusterTable=\{false\}/);
});

test("Overview uses a stable bounded desktop composition", () => {
  for (const panelName of [
    "north_star",
    "traffic_health",
    "channels",
    "search_engines",
    "organic_search",
  ]) {
    assert.match(panelLayoutSource, new RegExp(`panel\\("overview", "${panelName}"`));
  }
  assert.match(overviewSource, /className="zaruku-overview-grid"/);
  assert.doesNotMatch(overviewSource, /registryColumns=\{false\}|registrySpan=\{false\}/);
  assert.match(panelLayoutSource, /panel\("overview", "channels", 30, "half"/);
  assert.match(panelLayoutSource, /panel\("overview", "search_engines", 35, "half"/);
  assert.match(panelLayoutSource, /panel\("overview", "organic_search", 40, "full"/);
  assert.ok(source.indexOf('title="Каналы привлечения"') < source.indexOf('title="Поисковые системы"'));
  assert.ok(source.indexOf('title="Поисковые системы"') < source.indexOf('title="Органический поиск"'));
  assert.match(globalsSource, /grid-template-rows:\s*96px minmax\(129px, auto\) minmax\(260px, auto\) minmax\(280px, auto\)/);
  assert.match(globalsSource, /data-panel-id="overview\.search_engines"/);
  assert.match(source, /min-h-\[calc\(100vh-194px\)\]/);
  assert.match(source, /initialLimit=\{6\}/);
  assert.match(source, /titleInfo=\{/);
  assert.match(source, /ZARUKU_CLIENT_COPY\.technicalTail/);
  assert.match(clientCopySource, /Технический хвост/);
  assert.doesNotMatch(source, /Технический хвост:\{" "\}/);
});

test("SEO tab no longer renders the Metrika search-engines panel", () => {
  const seoStart = source.indexOf("function SeoTab");
  const seoEnd = source.indexOf("export default function ZarukuSeoDashboard");
  const seoSource = source.slice(seoStart, seoEnd);

  assert.doesNotMatch(seoSource, /title="Поисковые системы/);
  assert.doesNotMatch(seoSource, /data\.search_engines/);
});

test("Overview keeps KPI and chart content inside its desktop bounds", () => {
  assert.match(source, /import ZarukuInfoPopover/);
  assert.doesNotMatch(source, /function InfoTooltip/);
  assert.doesNotMatch(source, /aria-label="Описание основных показателей"/);
  assert.match(source, /data-zaruku-kpi-value-row/);
  assert.match(source, /flex min-w-0 flex-wrap items-baseline gap-x-1\.5 gap-y-1/);
  assert.match(source, /<ResponsiveContainer width="100%" height="100%" initialDimension=\{\{ width: 1, height: 1 \}\}>/);
  assert.match(source, /<LineChart data=\{data\.organic_trend\} margin=\{\{ top: 8, right: 16, left: -20, bottom: 0 \}\}>/);
  assert.match(source, /<XAxis dataKey="label" padding=\{\{ right: 12 \}\}/);
});

test("Traffic health shows secondary facts without a reveal button", () => {
  const start = source.indexOf("function TrafficHealthStrip");
  const end = source.indexOf("function AiAggregateVisibilityPanel");
  const trafficHealthSource = source.slice(start, end);

  assert.match(trafficHealthSource, /rows\.secondary\.length/);
  assert.match(trafficHealthSource, /rows\.secondary\.map/);
  assert.doesNotMatch(trafficHealthSource, /aria-expanded|setExpanded|ещё/);
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
  assert.match(source, /<ZarukuTableFrame mode="standard" label="Семантические кластеры">/);
  assert.match(source, /<table className="zaruku-table min-w-\[760px\]">/);
});

test("SEO tab hides Metrika search phrases but keeps the unified landing-page workspace", () => {
  const seoStart = source.indexOf("function SeoTab");
  const seoEnd = source.indexOf("export default function ZarukuSeoDashboard");
  const seoSource = source.slice(seoStart, seoEnd);

  assert.doesNotMatch(seoSource, /Поисковые фразы из Метрики/);
  assert.doesNotMatch(seoSource, /data\.search_phrases/);
  assert.match(source, /buildUnifiedSeoPageRows/);
  assert.match(source, /webmasterRows: webmasterPages/);
  assert.match(source, /metrikaRows: metrikaPageSelection\.rows/);
  assert.doesNotMatch(source, /title="Посадочные страницы Яндекса"/);
  assert.doesNotMatch(source, /title: "Запрос → посадочная"/);
});

test("SEO tab passes requested and actual source weeks into unified comparisons", () => {
  assert.match(source, /selectSourceWeekRows\(data\.webmaster\.queries, primaryWeek, data\.webmaster\.weeks\)/);
  assert.match(source, /selectSourceWeekRows\(data\.gsc\.queries, primaryWeek, data\.gsc\.weeks\)/);
  assert.match(source, /selectSourceWeekRows\(\s*data\.organic_landing_pages_weekly\.rows,\s*primaryWeek/);
  assert.match(source, /sourceWeekSelections=/);
});

test("unified SEO comparisons use the selected week while diagnostics keep their latest-week selection", () => {
  assert.match(source, /const diagnosticGscWeek = data\.gsc\.latest_week;/);
  assert.match(source, /selectSourceWeekRows\(data\.gsc\.landing_pages, primaryWeek, data\.gsc\.weeks\)/);
  assert.match(source, /selectSourceWeekRows\(data\.webmaster\.pages, primaryWeek, data\.webmaster\.weeks\)/);
  assert.doesNotMatch(source, /metrikaRows: data\.organic_landing_pages,/);
});

test("semantic health labels and charts the actual source week when the selected week is unavailable", () => {
  const panelStart = source.indexOf("function SemanticHealthPanel");
  const panelEnd = source.indexOf("function WeeklyFocusPanel");
  const panelSource = source.slice(panelStart, panelEnd);

  assert.match(
    panelSource,
    /selectSourceWeekRows\(data\.seo_intelligence\.sov\.rows, primaryWeek, data\.seo_intelligence\.sov\.weeks\)/,
  );
  assert.match(panelSource, /formatSourceWeekFallback\(selection\)/);
  assert.match(panelSource, /selection\.actualWeek/);
  assert.match(panelSource, /selection\.rows\.filter/);
  assert.doesNotMatch(panelSource, /selectedRows\[0\]\?\.period_label \?\? primaryWeek/);
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

test("SEO query workspace uses exact Webmaster query-page facts", () => {
  assert.match(source, /data\.webmaster\.query_pages/);
  assert.match(source, /webmasterQueryPageRows:/);
});

test("Overview does not render pending source context", () => {
  assert.doesNotMatch(source, /function PendingPanel/);
  assert.doesNotMatch(source, /<PendingPanel/);
  assert.doesNotMatch(source, /title="Что ещё ждём"/);
  assert.doesNotMatch(source, /formatPendingRequirementSources/);
});

test("returning-content panels use explicit source states instead of misleading empty UI", () => {
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

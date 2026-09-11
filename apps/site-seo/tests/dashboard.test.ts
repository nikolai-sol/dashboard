import assert from "node:assert/strict";
import test from "node:test";
import type { SiteProfile } from "@reportingdash/site-seo-contract";
import { dashboardTabs, resolveActiveTab } from "../src/components/Dashboard.tsx";
import { sourceStatusLabel } from "../src/components/Sources.tsx";
import { buildDashboardQuery, PeriodSelector } from "../src/components/PeriodSelector.tsx";
import { createPeriodSelection, calendarMonthPeriod } from "../src/lib/period-selection.ts";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Wordstat } from "../src/components/Wordstat.tsx";
import { Search } from "../src/components/Search.tsx";
import { Overview } from "../src/components/Overview.tsx";
import { Traffic } from "../src/components/Traffic.tsx";
import { Alice } from "../src/components/Alice.tsx";
import { SeoOs } from "../src/components/SeoOs.tsx";
import { Sources } from "../src/components/Sources.tsx";
import { siteLoginPath } from "../src/components/LoginForm.tsx";
import { readFileSync } from "node:fs";

const profile = {
  sources: [
    { sourceKey: "yandex_metrika", mode: "automated", bindingId: "fixture", importCadence: [] },
    { sourceKey: "google_search_console", mode: "manual", bindingId: "fixture", importCadence: ["previous_month"] },
    { sourceKey: "yandex_wordstat", mode: "disabled", bindingId: null, importCadence: [] },
    { sourceKey: "yandex_webmaster_alice_manual", mode: "manual", bindingId: "fixture", importCadence: ["previous_month"] },
    { sourceKey: "seo_os", mode: "automated", bindingId: "fixture", importCadence: [] },
  ],
} as unknown as SiteProfile;

test("uses the site-scoped standalone login route", () => {
  assert.equal(siteLoginPath("medroche"), "/api/dashboard/medroche/login");
});

test("passes the tab query from server search params into the dashboard", () => {
  const page = readFileSync(new URL("../src/app/dashboard/[siteSlug]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /activeTab=\{typeof values\.tab === "string" \? values\.tab : undefined\}/);
});

test("hides disabled adapters while preserving the available source sections", () => {
  const labels = dashboardTabs(profile).map((tab) => tab.label);
  assert.ok(labels.includes("Обзор"));
  assert.ok(labels.includes("SEO"));
  assert.ok(labels.includes("ИИ-видимость и конкуренты"));
  assert.ok(labels.includes("Работы и задачи"));
  assert.ok(!labels.includes("Спрос Wordstat"));
  assert.ok(!labels.includes("Посещаемость и страницы"));
});

test("falls back from an unknown or disabled tab to overview", () => {
  assert.equal(resolveActiveTab(dashboardTabs(profile), "wordstat"), "overview");
  assert.equal(resolveActiveTab(dashboardTabs(profile), "unknown"), "overview");
});

test("labels manual data with its actual loaded period rather than calling it current", () => {
  assert.match(sourceStatusLabel({ sourceKey: "google_search_console", period: { kind: "calendar_month", key: "2026-01", from: "2026-01-01", to: "2026-01-31", sourceTimezone: "Europe/Moscow" }, state: "ready", collectionMode: "manual", completeness: "complete", importId: "fixture", exportedAt: null, loadedAt: "2026-02-01T00:00:00Z", freshness: "delayed", latestAttempt: "success" }), /2026-01-01/);
});

test("sources disclose a failed latest attempt even when older partial facts remain visible", () => {
  assert.match(sourceStatusLabel({ sourceKey: "yandex_wordstat", period: { kind: "custom", key: "rolling", from: "2026-08-13", to: "2026-09-11", sourceTimezone: "Europe/Moscow" }, state: "partial", collectionMode: "automated", completeness: "limited", importId: "2474", exportedAt: null, loadedAt: "2026-09-11T06:55:01Z", freshness: "current", latestAttempt: "failed" }), /Последняя попытка сбора завершилась ошибкой/);
});

test("preserves validated periods, comparison, publication, and filters in controls and exports", () => {
  const query = buildDashboardQuery(createPeriodSelection({ primaryWeek: "2026-W01", comparisonWeek: "2025-W52", aliceMonth: "2026-01", gsc: calendarMonthPeriod("2026-01", "Europe/Moscow") }, "Europe/Moscow"), "publication-7", { country: "RU" });
  assert.match(query, /traffic_compare=2025-W52/);
  assert.match(query, /gsc_period=2026-01/);
  assert.match(query, /publication=publication-7/);
  assert.match(query, /filter_country=RU/);
  assert.match(query, /filter_search_type=web/);
  assert.match(query, /filter_device=all/);
});

test("period form preserves only the active display tab while export queries omit it", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W01", comparisonWeek: "2025-W52", aliceMonth: "2026-01", gsc: calendarMonthPeriod("2026-01", "Europe/Moscow") }, "Europe/Moscow");
  const html = renderToStaticMarkup(createElement(PeriodSelector, {
    selection,
    publicationId: "publication-7",
    filters: { country: "RU" },
    activeTab: "search",
  }));

  assert.match(html, /<input type="hidden" name="tab" value="search"\/>/);
  assert.equal(new URLSearchParams(buildDashboardQuery(selection, "publication-7", { country: "RU" })).has("tab"), false);
});

test("compact period controls preserve hidden independent source periods", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W37", comparisonWeek: "2026-W36", aliceMonth: "2026-09", gsc: calendarMonthPeriod("2026-09", "Europe/Moscow") }, "Europe/Moscow");
  const search = renderToStaticMarkup(createElement(PeriodSelector, { selection, publicationId: null, filters: {}, activeTab: "search" }));

  assert.match(search, /Отчётная SEO-неделя/);
  assert.match(search, /A · Основная неделя[^]*name="traffic_week"/);
  assert.match(search, /B · Сравнение[^]*name="traffic_compare"/);
  assert.doesNotMatch(search, />GSC<|>Алиса</);
  assert.match(search, /<option value="2026-W36" selected="">/);
  assert.match(search, /type="hidden" name="gsc_period" value="2026-09"/);
  assert.match(search, /type="hidden" name="alice_month" value="2026-09"/);
});

test("renders period controls and export links without emitting disabled GSC content", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W01", aliceMonth: "2026-01", gsc: calendarMonthPeriod("2026-01", "Europe/Moscow") }, "Europe/Moscow");
  const disabledGscProfile = { ...profile, title: "Тест", slug: "fixture", sources: [{ sourceKey: "google_search_console" as const, mode: "disabled" as const, bindingId: null, importCadence: [] }, { sourceKey: "yandex_webmaster" as const, mode: "automated" as const, bindingId: "webmaster", importCadence: [] }] } as SiteProfile;
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const model = { gsc: { meta: missing, summary: { clicks: 999, impressions: 999, ctrPct: 99, averagePosition: 1 }, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: { yandex_webmaster: { ...missing, sourceKey: "yandex_webmaster" as const, state: "ready" as const, collectionMode: "automated" as const, completeness: "complete" as const, importId: "fixture", freshness: "current" as const, latestAttempt: "success" as const } }, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };
  const html = renderToStaticMarkup(createElement(Dashboard, { profile: disabledGscProfile, selection, publicationId: "publication-7", filters: { country: "RU" }, model }));
  assert.match(html, /traffic_week/);
  assert.match(html, /\/excel\?/);
  assert.match(html, /\/pdf\?/);
  assert.doesNotMatch(html, /GSC:|999/);
  assert.doesNotMatch(html, /Google Search Console/);
});

test("renders one enabled active tab in the neutral shell and preserves scope query", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W01", aliceMonth: "2026-01", gsc: calendarMonthPeriod("2026-01", "Europe/Moscow") }, "Europe/Moscow");
  const searchProfile = { ...profile, title: "Тест", slug: "fixture", domain: "fixture.example", logoAsset: null, sources: [
    { sourceKey: "google_search_console" as const, mode: "manual" as const, bindingId: "gsc", importCadence: ["previous_month" as const] },
    { sourceKey: "yandex_wordstat" as const, mode: "disabled" as const, bindingId: null, importCadence: [] },
  ] } as SiteProfile;
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const model = { gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };

  const html = renderToStaticMarkup(createElement(Dashboard, { profile: searchProfile, selection, publicationId: "publication-7", filters: { country: "RU" }, model, activeTab: "search" }));

  assert.match(html, /site-seo-dashboard/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 2);
  assert.match(html, /tab=search/);
  assert.match(html, /traffic_week=2026-W01/);
  assert.match(html, /filter_country=RU/);
  assert.match(html, /id="search"/);
  assert.doesNotMatch(html, /id="overview"/);
  assert.doesNotMatch(html, /id="wordstat"/);
});

test("rolling Wordstat and source quality sheets do not claim the traffic calendar", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W37", aliceMonth: "2026-09", gsc: calendarMonthPeriod("2026-09", "Europe/Moscow") }, "Europe/Moscow");
  const sourceProfile = { ...profile, title: "Тест", slug: "fixture", domain: "fixture.example", logoAsset: null, sources: [
    { sourceKey: "yandex_wordstat" as const, mode: "automated" as const, bindingId: "wordstat", importCadence: [] },
    { sourceKey: "yandex_metrika" as const, mode: "automated" as const, bindingId: "metrika", importCadence: [] },
  ] } as SiteProfile;
  const missing = { sourceKey: "yandex_wordstat" as const, period: null, state: "missing" as const, collectionMode: "automated" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const gscMissing = { ...missing, sourceKey: "google_search_console" as const, collectionMode: "manual" as const };
  const model = { gsc: { meta: gscMissing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: gscMissing, datasets: { yandex_wordstat: missing }, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };

  for (const activeTab of ["wordstat", "sources"] as const) {
    const html = renderToStaticMarkup(createElement(Dashboard, { profile: sourceProfile, selection, publicationId: null, filters: {}, model, activeTab }));
    assert.doesNotMatch(html, /site-seo-toolbar/);
    assert.doesNotMatch(html, /site-seo-period-selector/);
  }
});

test("keeps canonical Metrika facts on overview after removing the standalone traffic navigation", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W01", aliceMonth: "2026-01", gsc: calendarMonthPeriod("2026-01", "Europe/Moscow") }, "Europe/Moscow");
  const sourceProfile = { ...profile, title: "Тест", slug: "fixture", sources: [
    { sourceKey: "google_search_console" as const, mode: "disabled" as const, bindingId: null, importCadence: [] },
    { sourceKey: "yandex_metrika" as const, mode: "automated" as const, bindingId: "metrika", importCadence: [] },
    { sourceKey: "yandex_webmaster" as const, mode: "automated" as const, bindingId: "webmaster", importCadence: [] },
  ] } as SiteProfile;
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const model = {
    gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing,
    datasets: { yandex_metrika: { ...missing, sourceKey: "yandex_metrika" as const, state: "ready" as const }, yandex_webmaster: { ...missing, sourceKey: "yandex_webmaster" as const, state: "partial" as const } }, wordstat: null, alice: null, seoOs: null, trafficComparison: {},
    metrika: { ...missing, sourceKey: "yandex_metrika" as const, state: "ready" as const, kind: "metrika" as const, summary: { visits: 20, pageviews: 30 }, daily: [{ date: "2026-01-02", visits: 4, pageviews: 6, users: 3 }], topPages: [{ page: "/a", visits: 4, pageviews: 6 }] },
    webmaster: { ...missing, sourceKey: "yandex_webmaster" as const, state: "partial" as const, kind: "webmaster" as const, summary: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 }, daily: [{ date: "2026-01-02", metrics: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 } }], topPages: [{ page: "/a", metrics: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 } }] },
  };
  const trafficHtml = renderToStaticMarkup(createElement(Dashboard, { profile: sourceProfile, selection, publicationId: null, filters: {}, model, activeTab: "traffic" }));
  const searchHtml = renderToStaticMarkup(createElement(Dashboard, { profile: sourceProfile, selection, publicationId: null, filters: {}, model, activeTab: "search" }));
  assert.match(trafficHtml, /id="overview"[^]*Поисковые визиты[^]*20/);
  assert.doesNotMatch(trafficHtml, /id="traffic"/);
  assert.match(searchHtml, /id="search"[^]*Позиции по разделам[^]*Запросы: Google, Яндекс и SEO OS/);
});

test("overview follows the accepted five-panel Zaruku composition with canonical facts", () => {
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const ready = { ...missing, state: "ready" as const, completeness: "complete" as const, latestAttempt: "success" as const };
  const model = {
    gsc: {
      meta: ready,
      summary: { clicks: 2, impressions: 20, ctrPct: 10, averagePosition: 3 },
      daily: [
        { date: "2026-01-01", metrics: { clicks: 1, impressions: 8, ctrPct: 12.5, averagePosition: 3 } },
        { date: "2026-01-02", metrics: { clicks: 1, impressions: 12, ctrPct: 8.33, averagePosition: 3 } },
      ],
      dimensions: [], dimensionMeta: {},
    },
    indexing: missing,
    datasets: {}, wordstat: null, alice: null, seoOs: null, trafficComparison: {},
    metrika: {
      ...ready, sourceKey: "yandex_metrika" as const, collectionMode: "automated" as const,
      kind: "metrika" as const, summary: { visits: 20, pageviews: 30 },
      trafficMeta: { ...ready, sourceKey: "yandex_metrika" as const, state: "partial" as const, completeness: "unknown" as const, collectionMode: "automated" as const },
      trafficHealth: { visits: 100, pageviews: 160, bounceRate: 17.5, avgVisitDurationSeconds: 95, pageDepth: 2.4 },
      channels: [
        { id: null, label: "Search engine traffic", visits: 60, pageviews: 100, bounceRate: 10, avgVisitDurationSeconds: 110, pageDepth: 2.8 },
        { id: null, label: "Direct traffic", visits: 40, pageviews: 60, bounceRate: 28.75, avgVisitDurationSeconds: 72.5, pageDepth: 1.8 },
      ],
      searchEngines: [
        { id: "google", label: "Google, search results", visits: 12, pageviews: 18, bounceRate: 8, avgVisitDurationSeconds: 120, pageDepth: 2.5 },
        { id: "google-mobile", label: "Google mobile", visits: 8, pageviews: 12, bounceRate: 20, avgVisitDurationSeconds: 60, pageDepth: 1.5 },
        { id: "yandex", label: "Yandex, search results", visits: 8, pageviews: 12, bounceRate: 15, avgVisitDurationSeconds: 90, pageDepth: 2 },
        { id: "yandex-mobile", label: "Яндекс mobile", visits: 2, pageviews: 4, bounceRate: 5, avgVisitDurationSeconds: 110, pageDepth: 3 },
        { id: "bing", label: "Bing, search results", visits: 3, pageviews: 5, bounceRate: 12, avgVisitDurationSeconds: 80, pageDepth: 1.8 },
      ],
      daily: [{ date: "2026-01-02", visits: 4, pageviews: 6, users: 3 }], topPages: [],
    },
    webmaster: {
      ...ready, sourceKey: "yandex_webmaster" as const, state: "partial" as const, completeness: "unknown" as const, collectionMode: "automated" as const,
      kind: "webmaster" as const,
      summary: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 },
      daily: [{ date: "2026-01-02", metrics: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 } }], topPages: [],
    },
  };

  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true }));
  const panelIds = [...html.matchAll(/data-panel-id="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(panelIds, [
    "overview.north_star",
    "overview.traffic_health",
    "overview.channels",
    "overview.search_engines",
    "overview.organic_search",
  ]);
  assert.match(html, /Цель: рост целевого органического трафика/);
  assert.match(html, /Здоровье трафика/);
  assert.match(html, /Каналы привлечения/);
  assert.match(html, /Поисковые системы/);
  assert.match(html, /Органический поиск/);
  assert.match(html, /Поисковые визиты[^]*20/);
  assert.match(html, /Здоровье трафика[^]*Визиты[^]*100[^]*Просмотры[^]*160[^]*Отказы[^]*17,5%[^]*Ср\. время[^]*1:35[^]*Глубина[^]*2,4/);
  assert.match(html, /Каналы привлечения[^]*Поиск[^]*60[^]*Прямые заходы[^]*40/);
  assert.match(html, /Поисковые системы[^]*>Google<[^]*20[^]*просмотры 30[^]*>Яндекс<[^]*10[^]*просмотры 16/);
  assert.match(html, /site-seo-engine-grid/);
  const searchEnginePanel = html.slice(
    html.indexOf('data-panel-id="overview.search_engines"'),
    html.indexOf('data-panel-id="overview.organic_search"'),
  );
  assert.match(searchEnginePanel, /data-chart-kind="vertical-bars"/);
  assert.match(searchEnginePanel, /site-seo-engine-bar[^>]*style="height:100%"/);
  assert.match(searchEnginePanel, /site-seo-engine-bar[^>]*style="height:50%"/);
  assert.doesNotMatch(searchEnginePanel, /site-seo-breakdown-track/);
  assert.doesNotMatch(searchEnginePanel, /role="img"/);
  assert.match(searchEnginePanel, /aria-label="Google: 20 визитов, 30 просмотров"/);
  assert.match(searchEnginePanel, /aria-label="Яндекс: 10 визитов, 16 просмотров"/);
  assert.equal(html.match(/data-engine-slot=/g)?.length, 2);
  assert.match(html, /data-engine-slot="google"[^>]*data-bounce-rate="12.8"[^>]*data-avg-visit-duration-seconds="96"[^>]*data-page-depth="2.1"/);
  assert.match(html, /data-engine-slot="yandex"[^>]*data-bounce-rate="13"[^>]*data-avg-visit-duration-seconds="94"[^>]*data-page-depth="2.2"/);
  assert.doesNotMatch(html, /Bing, search results/);
  assert.match(html, /data-panel-id="overview\.traffic_health"[^]*?<section[^>]*data-state="partial"/);
  assert.match(html, /data-panel-id="overview\.channels"[^]*?<section[^>]*data-state="partial"/);
  assert.match(html, /data-panel-id="overview\.search_engines"[^]*?<section[^>]*data-state="ready"/);
  assert.match(html, /data-panel-id="overview\.organic_search"[^]*?<section[^>]*data-state="ready"/);
  assert.match(html, /Google[^]*2/);
  assert.match(html, /Яндекс[^]*5/);
  assert.doesNotMatch(html, /данные неполные|данные готовы/);
  assert.doesNotMatch(html, /Пользователи за день|Пользователи за период|Доля России/);

  const oddHtml = renderToStaticMarkup(createElement(Overview, {
    id: "overview",
    model: { ...model, metrika: { ...model.metrika, searchEngines: [
      { id: "google", label: "Google", visits: 3, pageviews: 4, bounceRate: null, avgVisitDurationSeconds: null, pageDepth: null },
      { id: "yandex", label: "Yandex", visits: 1, pageviews: 2, bounceRate: null, avgVisitDurationSeconds: null, pageDepth: null },
    ] } },
    showGsc: true,
  }));
  const oddPanel = oddHtml.slice(oddHtml.indexOf('data-panel-id="overview.search_engines"'), oddHtml.indexOf('data-panel-id="overview.organic_search"'));
  assert.match(oddPanel, /site-seo-engine-y-axis[^]*>3<[^]*>1,5<[^]*>0</);
});

test("overview keeps all-traffic panels visible when search coverage is missing", () => {
  const searchMissing = { sourceKey: "yandex_metrika" as const, period: null, state: "missing" as const, collectionMode: "automated" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const trafficPartial = { ...searchMissing, period: { kind: "iso_week" as const, key: "2026-W32", from: "2026-08-03", to: "2026-08-09", sourceTimezone: "Europe/Moscow" }, state: "partial" as const, importId: "90", loadedAt: "2026-08-09 12:00:00", latestAttempt: "success" as const };
  const gscMissing = { ...searchMissing, sourceKey: "google_search_console" as const, collectionMode: "manual" as const };
  const model = {
    gsc: { meta: gscMissing, summary: null, daily: [], dimensions: [], dimensionMeta: {} },
    indexing: gscMissing, datasets: { yandex_metrika: searchMissing }, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {},
    metrika: {
      ...searchMissing, kind: "metrika" as const, summary: null, daily: [], topPages: [], searchEngines: [],
      trafficMeta: trafficPartial,
      trafficHealth: { visits: 9, pageviews: 14, bounceRate: 20, avgVisitDurationSeconds: 75, pageDepth: 1.8 },
      channels: [{ id: null, label: "Direct traffic", visits: 9, pageviews: 14, bounceRate: 20, avgVisitDurationSeconds: 75, pageDepth: 1.8 }],
    },
  };

  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: false, showMetrika: true, showWebmaster: false }));

  assert.match(html, /data-panel-id="overview\.traffic_health"[^]*?<section[^>]*data-state="partial"[^]*?Визиты[^]*?9/);
  assert.match(html, /data-panel-id="overview\.channels"[^]*?<section[^>]*data-state="partial"[^]*?Прямые заходы[^]*?9/);
  assert.match(html, /data-panel-id="overview\.search_engines"[^]*?<section[^>]*data-state="missing"[^]*?data-engine-slot="google"[^]*?data-engine-slot="yandex"/);
  assert.match(html, /data-panel-id="overview\.organic_search"[^]*?<section[^>]*data-state="missing"[^]*?Динамика: данные не опубликованы/);
  assert.match(html, /Поисковые визиты[^]*?<strong class="site-seo-kpi-value">—<\/strong>/);
});

test("overview keeps the accepted layout while unavailable metrics stay explicit", () => {
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const model = { gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true }));

  assert.equal(html.match(/data-panel-id="overview\./g)?.length, 5);
  assert.match(html, /Нет опубликованных строк каналов за выбранный период/);
  assert.equal(html.match(/data-engine-slot=/g)?.length, 2);
  assert.match(html, /data-engine-slot="google"[^]*>Google<[^]*—[^]*нет строк за период/);
  assert.match(html, /data-engine-slot="yandex"[^]*>Яндекс<[^]*—[^]*нет строк за период/);
  assert.match(html, /aria-label="Google: нет строк за период"/);
  assert.doesNotMatch(html, /site-seo-engine-y-axis[^]*?>1<[^]*?>1</);
  assert.doesNotMatch(html, /data-engine-slot="(?:google|yandex)"[^]*?<strong>0<\/strong>/);
  assert.match(html, /Динамика: данные не опубликованы/);
  assert.match(html, /data-state="missing"/);
  assert.doesNotMatch(html, />0<\/span>/);
});

test("overview preserves missing and failed empties without exposing completeness prose", () => {
  const base = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const expected = {
    missing: "данные не опубликованы",
    failed: "ошибка последнего сбора",
    partial: "нет строк за период",
    complete_empty: "нет строк за период",
  } as const;

  for (const state of Object.keys(expected) as Array<keyof typeof expected>) {
    const meta = { ...base, state, latestAttempt: state === "failed" ? "failed" as const : "none" as const };
    const model = { gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: base, datasets: { yandex_metrika: { ...meta, sourceKey: "yandex_metrika" as const } }, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };
    const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true, showMetrika: true, showWebmaster: false }));
    assert.match(html, new RegExp(expected[state]));
    assert.match(html, new RegExp(`Динамика[^]*${expected[state]}`));
    assert.doesNotMatch(html, /данные неполные|данные готовы|подтверждённо пусто/);
  }
});

test("overview trend aggregates observed dates into one ISO-week point and exposes the weekly total", () => {
  const meta = { sourceKey: "yandex_metrika" as const, period: { kind: "iso_week" as const, key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" }, state: "partial" as const, collectionMode: "automated" as const, completeness: "limited" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "success" as const };
  const model = { gsc: { meta: { ...meta, sourceKey: "google_search_console" as const, collectionMode: "manual" as const }, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: meta, datasets: { yandex_metrika: meta }, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {}, metrika: { ...meta, kind: "metrika" as const, summary: { visits: 9, pageviews: 12 }, daily: [{ date: "2026-01-01", visits: 2, pageviews: 3, users: 2 }, { date: "2026-01-02", visits: 3, pageviews: 4, users: 3 }, { date: "2026-01-04", visits: 4, pageviews: 5, users: 4 }], topPages: [] } };
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: false, showMetrika: true, showWebmaster: false }));

  assert.equal(html.match(/data-week="2026-W01"/g)?.length, 1);
  assert.match(html, /site-seo-trend-y-axis/);
  assert.match(html, /<caption>Еженедельные поисковые визиты<\/caption>/);
  assert.match(html, /<th>ISO-неделя<\/th><th>Визиты<\/th>/);
  assert.match(html, /<td>2026-W01<\/td><td>9<\/td>/);
  assert.doesNotMatch(html, /<th>Дата<\/th>|<td>2026-01-0[124]<\/td>/);
});

function renderSingleWeekTrend(visits: number): string {
  const meta = { sourceKey: "yandex_metrika" as const, period: { kind: "iso_week" as const, key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" }, state: "partial" as const, collectionMode: "automated" as const, completeness: "limited" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "success" as const };
  const model = { gsc: { meta: { ...meta, sourceKey: "google_search_console" as const, collectionMode: "manual" as const }, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: meta, datasets: { yandex_metrika: meta }, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {}, metrika: { ...meta, kind: "metrika" as const, summary: { visits, pageviews: visits }, daily: [{ date: "2026-01-01", visits, pageviews: visits, users: null }], topPages: [] } };
  return renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: false, showMetrika: true, showWebmaster: false }));
}

test("zero-visit weekly trend renders one zero tick and aligns its single X label with the point", () => {
  const html = renderSingleWeekTrend(0);

  assert.equal(html.match(/data-axis-tick="0"/g)?.length, 1);
  assert.equal(html.match(/data-grid-tick="0"/g)?.length, 1);
  assert.doesNotMatch(html, /data-axis-tick="1"/);
  assert.match(html, /data-grid-tick="0"[^>]*y1="160"[^>]*y2="160"/);
  assert.match(html, /site-seo-trend-axis" data-single="true"><span>2026-W01<\/span>/);
});

test("one-visit weekly trend renders unique ticks at the same coordinates as its grid lines", () => {
  const html = renderSingleWeekTrend(1);

  assert.equal(html.match(/data-axis-tick="1"/g)?.length, 1);
  assert.equal(html.match(/data-axis-tick="0"/g)?.length, 1);
  assert.match(html, /data-grid-tick="1"[^>]*y1="25"[^>]*y2="25"/);
  assert.match(html, /data-grid-tick="0"[^>]*y1="160"[^>]*y2="160"/);
  assert.match(html, /data-week="2026-W01"[^>]*cy="25"/);
});

test("overview omits Metrika-only panels when the source cannot render a full week", () => {
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const model = { gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: false, showMetrika: false, showWebmaster: false }));

  assert.doesNotMatch(html, /Здоровье трафика|Каналы привлечения|Поисковые системы|Органический поиск|Источник отключён|Источник Метрика отключён/);
  assert.match(html, /Цель: рост целевого органического трафика/);
});

test("Wordstat distinguishes an unconfigured source, failed collection, partial data, and confirmed empty", () => {
  const base = { sourceKey: "yandex_wordstat" as const, period: null, collectionMode: "automated" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const renderState = (state: "missing" | "failed" | "partial" | "complete_empty") => renderToStaticMarkup(createElement(Wordstat, { id: "wordstat", meta: { ...base, state, latestAttempt: state === "failed" ? "failed" : "none" }, data: null }));
  const expectedStateCopy = {
    missing: "Источник не настроен или сбор ещё не выполнен",
    failed: "Последний сбор завершился ошибкой",
    partial: "Неполные данные",
    complete_empty: "Подтверждённо пусто",
  } as const;
  const expectedEmptyCopy = {
    missing: "Текущие запросы Wordstat пока не опубликованы",
    failed: "Текущие запросы Wordstat недоступны: последний сбор завершился ошибкой",
    partial: "Текущие запросы Wordstat пока не опубликованы",
    complete_empty: "Сбор завершился успешно, но текущих запросов нет",
  } as const;

  for (const state of ["missing", "failed", "partial", "complete_empty"] as const) {
    const html = renderState(state);
    assert.match(html, /site-seo-panel/);
    assert.match(html, new RegExp(`data-state="${state}"`));
    assert.match(html, new RegExp(expectedStateCopy[state]));
    assert.match(html, new RegExp(expectedEmptyCopy[state]));
  }

  const staleAfterFailure = renderToStaticMarkup(createElement(Wordstat, { id: "wordstat", meta: { ...base, state: "partial", latestAttempt: "failed" }, data: null }));
  assert.match(staleAfterFailure, /Последняя попытка сбора завершилась ошибкой/);
  assert.doesNotMatch(staleAfterFailure, /показаны ранее опубликованные данные/);
  assert.match(staleAfterFailure, /Последний успешный сбор пока не подтверждён/);
  assert.match(staleAfterFailure, /Текущие запросы Wordstat пока не опубликованы/);
  assert.doesNotMatch(staleAfterFailure, /Спрос за выбранную ISO-неделю|Недельный спрос не опубликован/);
});

test("unified SEO queries use a labelled local scroll frame and grouped semantic headings", () => {
  const base = { sourceKey: "google_search_console" as const, period: null, state: "ready" as const, collectionMode: "manual" as const, completeness: "complete" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current" as const, latestAttempt: "success" as const };
  const model = {
    gsc: { meta: base, summary: { clicks: 2, impressions: 20, ctrPct: 10, averagePosition: 3 }, daily: [{ date: "2026-01-02", metrics: { clicks: 2, impressions: 20, ctrPct: 10, averagePosition: 3 } }], dimensions: [{ dimension: "query" as const, value: "лечение", metrics: { clicks: 2, impressions: 20, ctrPct: 10, averagePosition: 3 }, meta: base }], dimensionMeta: {} },
    indexing: base, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {},
  };

  const html = renderToStaticMarkup(createElement(Search, { id: "search", model, showGsc: true }));

  assert.match(html, /site-seo-panel/);
  assert.match(html, /site-seo-table-frame/);
  assert.match(html, /aria-label="Объединённые поисковые запросы"/);
  assert.match(html, /<th colSpan="4" data-source-group="google">[^]*Google<\/th><th colSpan="4" data-source-group="yandex">[^]*Яндекс Вебмастер<\/th><th colSpan="3" data-source-group="seo-os">[^]*SEO OS<\/th>/);
});

test("standard sheets use the accepted Zaruku-style stack of focused panels", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W37", aliceMonth: "2026-09", gsc: calendarMonthPeriod("2026-09", "Europe/Moscow") }, "Europe/Moscow");
  const meta = { sourceKey: "yandex_metrika" as const, period: selection.traffic.primary, state: "partial" as const, collectionMode: "automated" as const, completeness: "limited" as const, importId: "2474", exportedAt: null, loadedAt: "2026-09-11T06:55:01Z", freshness: "current" as const, latestAttempt: "success" as const };
  const gscMeta = { ...meta, sourceKey: "google_search_console" as const, state: "missing" as const, collectionMode: "manual" as const, importId: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const webmasterMeta = { ...meta, sourceKey: "yandex_webmaster" as const };
  const model = {
    gsc: { meta: gscMeta, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: gscMeta,
    datasets: { yandex_metrika: meta, google_search_console: gscMeta, yandex_webmaster: webmasterMeta }, wordstat: null, alice: null, seoOs: null, trafficComparison: {},
    metrika: { ...meta, kind: "metrika" as const, summary: { visits: 46, pageviews: 75 }, daily: [{ date: "2026-09-10", visits: 15, pageviews: 26, users: 15 }], topPages: [{ page: "/page", visits: 8, pageviews: 12 }] },
    webmaster: { ...webmasterMeta, kind: "webmaster" as const, summary: { clicks: 48, impressions: 1661, ctrPct: 2.9, averagePosition: 8.4 }, daily: [{ date: "2026-09-10", metrics: { clicks: 12, impressions: 400, ctrPct: 3, averagePosition: 8 } }], topPages: [{ page: "/page", metrics: { clicks: 8, impressions: 300, ctrPct: 2.7, averagePosition: 7 } }] },
  };
  const wordstat = { ...meta, sourceKey: "yandex_wordstat" as const, period: selection.traffic.primary, snapshotPeriod: { kind: "custom" as const, key: "rolling", from: "2026-08-13", to: "2026-09-11", sourceTimezone: "Europe/Moscow" }, kind: "wordstat" as const, demand: null, queries: [{ query: "бевацизумаб", count: 14982, kind: "popular", window: { from: "2026-08-13", to: "2026-09-11", snapshotDate: "2026-09-11", registryVersion: "core-v1", importId: "2474" } }] };
  const aliceMeta = { ...meta, sourceKey: "yandex_webmaster_alice_manual" as const, collectionMode: "manual" as const };
  const alice = { ...aliceMeta, kind: "alice" as const, officialSovPct: 12.5, samplePresencePct: 20, competitors: ["example.ru"], sources: ["alice.ru"], queries: [{ query: "лечение", portalPresent: true, portalPosition: 1, portalUrl: "https://med.roche.ru/page", sources: [{ rank: 1, domain: "med.roche.ru", url: "https://med.roche.ru/page" }] }] };
  const seoMeta = { ...meta, sourceKey: "seo_os" as const, collectionMode: "derived" as const };
  const seoOs = { ...seoMeta, kind: "seo_os" as const, rows: [], recommendations: [{ kind: "content", topic: "Онкология", pageUrl: "/page", action: "Обновить", sourceIds: ["webmaster"], sourcePeriods: ["2026-W37"], ruleVersion: "v1", publicationStatus: "published" }], tasks: [{ id: "task-1", status: "open" }] };

  const trafficHtml = renderToStaticMarkup(createElement(Traffic, { id: "traffic", model, selection }));
  const searchHtml = renderToStaticMarkup(createElement(Search, { id: "search", model, showGsc: true }));
  const wordstatHtml = renderToStaticMarkup(createElement(Wordstat, { id: "wordstat", meta: wordstat, data: wordstat }));
  const aliceHtml = renderToStaticMarkup(createElement(Alice, { id: "alice", meta: aliceMeta, data: alice }));
  const seoHtml = renderToStaticMarkup(createElement(SeoOs, { id: "seo-os", meta: seoMeta, data: seoOs }));
  const sourcesHtml = renderToStaticMarkup(createElement(Sources, { id: "sources", profile, model }));

  for (const html of [trafficHtml, searchHtml, wordstatHtml, aliceHtml, seoHtml, sourcesHtml]) assert.match(html, /site-seo-section-stack/);
  assert.deepEqual([...trafficHtml.matchAll(/data-panel-id="([^"]+)"/g)].map((match) => match[1]), ["traffic.summary", "traffic.trend", "traffic.pages"]);
  assert.deepEqual([...searchHtml.matchAll(/data-panel-id="([^"]+)"/g)].map((match) => match[1]), ["seo.alice", "seo.sections", "seo.queries"]);
  assert.deepEqual([...wordstatHtml.matchAll(/data-panel-id="([^"]+)"/g)].map((match) => match[1]), ["wordstat.summary", "wordstat.queries"]);
  assert.match(wordstatHtml, /Где есть медицинский спрос, что уже получает MedRoche и что стоит улучшить/);
  assert.match(wordstatHtml, /Wordstat показывает спрос, а не визиты, показы или долю сайта/);
  assert.match(wordstatHtml, /Последние 30 дней · 2026-08-13 — 2026-09-11/);
  assert.match(wordstatHtml, /Последний успешный сбор: 2026-09-11T06:55:01Z/);
  assert.match(wordstatHtml, /Текущие запросы Wordstat/);
  assert.match(wordstatHtml, /бевацизумаб[^]*14982[^]*2026-08-13 — 2026-09-11/);
  assert.match(wordstatHtml, /Частотности пересекающихся запросов нельзя складывать/);
  assert.doesNotMatch(wordstatHtml, /Спрос за выбранную ISO-неделю|Недельный спрос не опубликован/);
  assert.doesNotMatch(wordstatHtml, /Классификация|Региональные возможности|SEO OS/);
  assert.deepEqual([...aliceHtml.matchAll(/data-panel-id="([^"]+)"/g)].map((match) => match[1]), ["alice.summary", "alice.competitors", "alice.queries"]);
  assert.deepEqual([...seoHtml.matchAll(/data-panel-id="([^"]+)"/g)].map((match) => match[1]), ["seo-os.summary", "seo-os.recommendations", "seo-os.tasks"]);
  assert.deepEqual([...sourcesHtml.matchAll(/data-panel-id="([^"]+)"/g)].map((match) => match[1]), ["sources.summary", "sources.list"]);
});

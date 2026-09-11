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
  assert.ok(labels.includes("Поиск и индексация"));
  assert.ok(labels.includes("AI-видимость и конкуренты"));
  assert.ok(labels.includes("SEO OS"));
  assert.ok(!labels.includes("Wordstat"));
});

test("falls back from an unknown or disabled tab to overview", () => {
  assert.equal(resolveActiveTab(dashboardTabs(profile), "wordstat"), "overview");
  assert.equal(resolveActiveTab(dashboardTabs(profile), "unknown"), "overview");
});

test("labels manual data with its actual loaded period rather than calling it current", () => {
  assert.match(sourceStatusLabel({ sourceKey: "google_search_console", period: { kind: "calendar_month", key: "2026-01", from: "2026-01-01", to: "2026-01-31", sourceTimezone: "Europe/Moscow" }, state: "ready", collectionMode: "manual", completeness: "complete", importId: "fixture", exportedAt: null, loadedAt: "2026-02-01T00:00:00Z", freshness: "delayed", latestAttempt: "success" }), /2026-01-01/);
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

test("renders canonical Metrika and Webmaster facts without treating daily users as a period total", () => {
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
  assert.match(trafficHtml, /site-seo-kpi-label[^>]*>Визиты<\/span><span class="site-seo-kpi-value">20/);
  assert.match(trafficHtml, /Пользователи за день: 3/);
  assert.match(searchHtml, /Webmaster: partial; клики: 5; показы: 50/);
  assert.doesNotMatch(trafficHtml, /Пользователи за период/);
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
      trafficHealth: { visits: 100, pageviews: 160, bounceRate: 17.5, avgVisitDurationSeconds: 95, pageDepth: 2.4 },
      channels: [
        { id: null, label: "Search engine traffic", visits: 60, pageviews: 100, bounceRate: 10, avgVisitDurationSeconds: 110, pageDepth: 2.8 },
        { id: null, label: "Direct traffic", visits: 40, pageviews: 60, bounceRate: 28.75, avgVisitDurationSeconds: 72.5, pageDepth: 1.8 },
      ],
      searchEngines: [
        { id: "google", label: "Google, search results", visits: 12, pageviews: 18, bounceRate: 8, avgVisitDurationSeconds: 120, pageDepth: 2.5 },
        { id: "yandex", label: "Yandex, search results", visits: 8, pageviews: 12, bounceRate: 15, avgVisitDurationSeconds: 90, pageDepth: 2 },
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
  assert.match(html, /Поисковые системы[^]*Google, search results[^]*12[^]*Yandex, search results[^]*8/);
  assert.match(html, /Google[^]*2/);
  assert.match(html, /Яндекс[^]*5/);
  assert.match(html, /Яндекс[^]*данные неполные/);
  assert.match(html, /Google[^]*данные готовы/);
  assert.doesNotMatch(html, /Пользователи за день|Пользователи за период|Доля России/);
});

test("overview keeps the accepted layout while unavailable metrics stay explicit", () => {
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const model = { gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true }));

  assert.equal(html.match(/data-panel-id="overview\./g)?.length, 5);
  assert.match(html, /Нет опубликованных строк каналов за выбранный период/);
  assert.match(html, /Нет опубликованных строк поисковых систем за выбранный период/);
  assert.match(html, /Динамика: данные не опубликованы/);
  assert.match(html, /data-state="missing"/);
  assert.doesNotMatch(html, />0<\/span>/);
});

test("overview distinguishes missing, failed, partial, and confirmed-empty source states", () => {
  const base = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const expected = {
    missing: "данные не опубликованы",
    failed: "ошибка последнего сбора",
    partial: "данные неполные",
    complete_empty: "подтверждённо пусто",
  } as const;

  for (const state of Object.keys(expected) as Array<keyof typeof expected>) {
    const meta = { ...base, state, latestAttempt: state === "failed" ? "failed" as const : "none" as const };
    const model = { gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: base, datasets: { yandex_metrika: { ...meta, sourceKey: "yandex_metrika" as const } }, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };
    const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true, showMetrika: true, showWebmaster: false }));
    assert.match(html, new RegExp(expected[state]));
    assert.match(html, new RegExp(`Динамика[^]*${expected[state]}`));
  }
});

test("overview trend preserves calendar gaps and exposes the daily values", () => {
  const meta = { sourceKey: "yandex_metrika" as const, period: { kind: "iso_week" as const, key: "2026-W01", from: "2026-01-01", to: "2026-01-07", sourceTimezone: "Europe/Moscow" }, state: "partial" as const, collectionMode: "automated" as const, completeness: "limited" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "success" as const };
  const model = { gsc: { meta: { ...meta, sourceKey: "google_search_console" as const, collectionMode: "manual" as const }, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: meta, datasets: { yandex_metrika: meta }, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {}, metrika: { ...meta, kind: "metrika" as const, summary: { visits: 9, pageviews: 12 }, daily: [{ date: "2026-01-01", visits: 2, pageviews: 3, users: 2 }, { date: "2026-01-02", visits: 3, pageviews: 4, users: 3 }, { date: "2026-01-07", visits: 4, pageviews: 5, users: 4 }], topPages: [] } };
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: false, showMetrika: true, showWebmaster: false }));

  assert.equal(html.match(/data-series-segment=/g)?.length, 2);
  assert.match(html, /<caption>Ежедневные поисковые визиты<\/caption>/);
  assert.match(html, /2026-01-01[^]*2[^]*2026-01-07[^]*4/);
});

test("overview names a disabled Metrika source consistently", () => {
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const model = { gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: false, showMetrika: false, showWebmaster: false }));

  assert.match(html, /Органический поиск[^]*Источник отключён[^]*Источник Метрика отключён/);
  assert.doesNotMatch(html, /Органический поиск[^]*Динамика: данные не опубликованы/);
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

  for (const state of ["missing", "failed", "partial", "complete_empty"] as const) {
    const html = renderState(state);
    assert.match(html, /site-seo-panel/);
    assert.match(html, new RegExp(`data-state="${state}"`));
    assert.match(html, new RegExp(expectedStateCopy[state]));
  }
});

test("wide factual tables use a labelled local scroll frame and semantic headings", () => {
  const base = { sourceKey: "google_search_console" as const, period: null, state: "ready" as const, collectionMode: "manual" as const, completeness: "complete" as const, importId: "fixture", exportedAt: null, loadedAt: null, freshness: "current" as const, latestAttempt: "success" as const };
  const model = {
    gsc: { meta: base, summary: { clicks: 2, impressions: 20, ctrPct: 10, averagePosition: 3 }, daily: [{ date: "2026-01-02", metrics: { clicks: 2, impressions: 20, ctrPct: 10, averagePosition: 3 } }], dimensions: [], dimensionMeta: {} },
    indexing: base, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {},
  };

  const html = renderToStaticMarkup(createElement(Search, { id: "search", model, showGsc: true }));

  assert.match(html, /site-seo-panel/);
  assert.match(html, /site-seo-table-frame/);
  assert.match(html, /aria-label="Динамика GSC"/);
  assert.match(html, /<thead><tr><th>Дата<\/th><th>Клики<\/th><th>Показы<\/th><\/tr><\/thead><tbody>/);
});

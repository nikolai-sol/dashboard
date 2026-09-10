import assert from "node:assert/strict";
import test from "node:test";
import type { SiteProfile } from "@reportingdash/site-seo-contract";
import { dashboardTabs } from "../src/components/Dashboard.tsx";
import { sourceStatusLabel } from "../src/components/Sources.tsx";
import { buildDashboardQuery } from "../src/components/PeriodSelector.tsx";
import { createPeriodSelection, calendarMonthPeriod } from "../src/lib/period-selection.ts";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Wordstat } from "../src/components/Wordstat.tsx";

const profile = {
  sources: [
    { sourceKey: "yandex_metrika", mode: "automated", bindingId: "fixture", importCadence: [] },
    { sourceKey: "google_search_console", mode: "manual", bindingId: "fixture", importCadence: ["previous_month"] },
    { sourceKey: "yandex_wordstat", mode: "disabled", bindingId: null, importCadence: [] },
    { sourceKey: "yandex_webmaster_alice_manual", mode: "manual", bindingId: "fixture", importCadence: ["previous_month"] },
    { sourceKey: "seo_os", mode: "automated", bindingId: "fixture", importCadence: [] },
  ],
} as unknown as SiteProfile;

test("hides disabled adapters while preserving the available source sections", () => {
  const labels = dashboardTabs(profile).map((tab) => tab.label);
  assert.ok(labels.includes("Обзор"));
  assert.ok(labels.includes("Поиск и индексация"));
  assert.ok(labels.includes("AI-видимость и конкуренты"));
  assert.ok(labels.includes("SEO OS"));
  assert.ok(!labels.includes("Wordstat"));
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
  const html = renderToStaticMarkup(createElement(Dashboard, { profile: sourceProfile, selection, publicationId: null, filters: {}, model }));
  assert.match(html, /Визиты: 20/);
  assert.match(html, /Пользователи за день: 3/);
  assert.match(html, /Webmaster: partial; клики: 5; показы: 50/);
  assert.doesNotMatch(html, /Пользователи за период/);
});

test("Wordstat distinguishes an unconfigured source, failed collection, partial data, and confirmed empty", () => {
  const base = { sourceKey: "yandex_wordstat" as const, period: null, collectionMode: "automated" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const renderState = (state: "missing" | "failed" | "partial" | "complete_empty") => renderToStaticMarkup(createElement(Wordstat, { id: "wordstat", meta: { ...base, state, latestAttempt: state === "failed" ? "failed" : "none" }, data: null }));

  assert.match(renderState("missing"), /Источник не настроен или сбор ещё не выполнен/);
  assert.match(renderState("failed"), /Последний сбор завершился ошибкой/);
  assert.match(renderState("partial"), /Неполные данные/);
  assert.match(renderState("complete_empty"), /Подтверждённо пусто/);
});

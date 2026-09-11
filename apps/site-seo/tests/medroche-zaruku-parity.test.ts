import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SiteProfile } from "@reportingdash/site-seo-contract";

import { Dashboard, dashboardTabs } from "../src/components/Dashboard.tsx";
import { Overview } from "../src/components/Overview.tsx";
import { PeriodSelector } from "../src/components/PeriodSelector.tsx";
import { Search, aggregateWebmasterSections } from "../src/components/Search.tsx";
import { createAvailableMetrikaWeeksReadExecutor, createCanonicalReadExecutor } from "../src/lib/db.ts";
import * as periods from "../src/lib/period-selection.ts";

const timezone = "Europe/Moscow";
const w35 = periods.isoWeekPeriod("2026-W35", timezone);
const w36 = periods.isoWeekPeriod("2026-W36", timezone);
const w37 = periods.isoWeekPeriod("2026-W37", timezone);
const missing = {
  sourceKey: "google_search_console" as const,
  period: null,
  state: "missing" as const,
  collectionMode: "manual" as const,
  completeness: "unknown" as const,
  importId: null,
  exportedAt: null,
  loadedAt: null,
  freshness: "unknown" as const,
  latestAttempt: "none" as const,
};

const profile = {
  title: "Клиника",
  slug: "fixture",
  domain: "clinic.example",
  logoAsset: null,
  sources: [
    { sourceKey: "yandex_metrika", mode: "automated", bindingId: "metrika", importCadence: [] },
    { sourceKey: "google_search_console", mode: "manual", bindingId: "gsc", importCadence: [] },
    { sourceKey: "yandex_webmaster", mode: "automated", bindingId: "webmaster", importCadence: [] },
    { sourceKey: "yandex_wordstat", mode: "automated", bindingId: "wordstat", importCadence: [] },
    { sourceKey: "yandex_webmaster_alice_manual", mode: "manual", bindingId: "alice", importCadence: [] },
    { sourceKey: "seo_os", mode: "automated", bindingId: "seo-os", importCadence: [] },
  ],
  seoSections: [
    { id: "diseases", label: "Заболевания", pathPrefixes: ["/diseases/"] },
    { id: "products", label: "Препараты", pathPrefixes: ["/products/"] },
    { id: "events", label: "Мероприятия", pathPrefixes: ["/events/"] },
    { id: "innovations", label: "Инновации", pathPrefixes: ["/innovations/"] },
    { id: "inno-puls", label: "INNO-ПУЛЬС", pathPrefixes: ["/innovations/inno-puls/"] },
  ],
} as unknown as SiteProfile;

function model() {
  return {
    gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} },
    indexing: missing,
    datasets: {},
    metrika: null,
    webmaster: {
      ...missing,
      sourceKey: "yandex_webmaster" as const,
      collectionMode: "automated" as const,
      period: w36,
      state: "partial" as const,
      kind: "webmaster" as const,
      summary: { clicks: 17, impressions: 300, ctrPct: 5.67, averagePosition: 4.2 },
      daily: [],
      topPages: [
        { page: "https://clinic.example/innovations/?utm=x#part", metrics: { clicks: 2, impressions: 100, ctrPct: 2, averagePosition: 6 } },
        { page: "https://clinic.example/innovations/no-position", metrics: { clicks: 1, impressions: 120, ctrPct: 0.83, averagePosition: null } },
        { page: "https://clinic.example/innovations/inno-puls/story?x=1", metrics: { clicks: 3, impressions: 50, ctrPct: 6, averagePosition: 2 } },
        { page: "/innovations/inno-puls/second", metrics: { clicks: 4, impressions: 50, ctrPct: 8, averagePosition: 4 } },
        { page: "/products/a", metrics: { clicks: 8, impressions: 100, ctrPct: 8, averagePosition: 3 } },
      ],
      queryFacts: [
        { query: "лечение", metrics: { clicks: 7, impressions: 100, ctrPct: 7, averagePosition: 3.5 } },
        { query: "  ЛЕЧЕНИЕ  ", metrics: { clicks: 2, impressions: 20, ctrPct: 10, averagePosition: 6 } },
      ],
    },
    wordstat: null,
    alice: {
      ...missing,
      sourceKey: "yandex_webmaster_alice_manual" as const,
      collectionMode: "manual" as const,
      state: "ready" as const,
      kind: "alice" as const,
      officialSovPct: 12.5,
      samplePresencePct: 20,
      competitors: [],
      sources: [],
      queries: [],
    },
    seoOs: null,
    trafficComparison: {},
  };
}

test("uses the approved six-item navigation order and client-facing labels", () => {
  assert.deepEqual(dashboardTabs(profile).map(({ id, label }) => [id, label]), [
    ["overview", "Обзор"],
    ["search", "SEO"],
    ["alice", "ИИ-видимость и конкуренты"],
    ["wordstat", "Спрос Wordstat"],
    ["seo-os", "Работы и задачи"],
    ["sources", "Источники"],
  ]);
});

test("renders the compact SEO-week selector from canonical available weeks", () => {
  const selection = periods.createPeriodSelection({ primaryWeek: "2026-W36", comparisonWeek: "2026-W35", aliceMonth: "2026-09", gsc: w35 }, timezone);
  const html = renderToStaticMarkup(createElement(PeriodSelector, {
    selection,
    publicationId: null,
    filters: {},
    activeTab: "search",
    availableWeeks: [w36, w35],
  } as never));

  assert.match(html, /Отчётная SEO-неделя/);
  assert.match(html, /role="group" aria-label="Режим сравнения"/);
  assert.match(html, /aria-pressed="false"[^>]*>Одна неделя<\/button>/);
  assert.match(html, /aria-pressed="true"[^>]*>Сравнить<\/button>/);
  assert.match(html, /A · Основная неделя[^]*<select[^]*name="traffic_week"/);
  assert.match(html, /B · Сравнение[^]*<select[^]*name="traffic_compare"/);
  assert.doesNotMatch(html, /<select(?=[^>]*name="traffic_compare")(?=[^>]*disabled="")/);
  assert.match(html, /data-week="2026-W35"[^>]*aria-label="Сравнить с предыдущей доступной неделей"/);
  assert.match(html, /<option value="2026-W36" selected="">2026-W36/);
  assert.doesNotMatch(html, />GSC<|>Алиса</);
  assert.match(html, /type="hidden" name="gsc_period" value="2026-W35"/);
  assert.match(html, /type="hidden" name="alice_month" value="2026-09"/);
});

test("period selector disables comparison in single mode and renders an explicit empty state", () => {
  const selection = periods.createPeriodSelection({ primaryWeek: "2026-W36", aliceMonth: "2026-09", gsc: w35 }, timezone);
  const single = renderToStaticMarkup(createElement(PeriodSelector, {
    selection,
    publicationId: null,
    filters: {},
    activeTab: "search",
    availableWeeks: [w36, w35],
  } as never));
  const empty = renderToStaticMarkup(createElement(PeriodSelector, {
    selection,
    publicationId: null,
    filters: {},
    activeTab: "search",
    availableWeeks: [],
  } as never));

  assert.match(single, /aria-pressed="true"[^>]*>Одна неделя<\/button>/);
  assert.match(single, /<select(?=[^>]*name="traffic_compare")(?=[^>]*disabled="")[^>]*>/);
  assert.match(empty, /<select(?=[^>]*name="traffic_week")(?=[^>]*disabled="")[^>]*>[^]*Нет доступных недель/);
  assert.match(empty, /<button(?=[^>]*aria-label="Сравнить с предыдущей доступной неделей")(?=[^>]*disabled="")[^>]*>/);
});

test("falls back from incomplete W37 to latest fully covered W36", () => {
  const selection = periods.createPeriodSelection({ primaryWeek: "2026-W37", comparisonWeek: "2026-W35", aliceMonth: "2026-09", gsc: periods.calendarMonthPeriod("2026-08", timezone) }, timezone);
  const resolver = (periods as unknown as { resolveAvailableWeekSelection: (current: periods.PeriodSelection, available: readonly typeof w36[]) => periods.PeriodSelection }).resolveAvailableWeekSelection;

  assert.equal(typeof resolver, "function");
  const resolved = resolver(selection, [w36, w35]);
  assert.equal(resolved.traffic.primary.key, "2026-W36");
  assert.equal(resolved.traffic.comparison?.key, "2026-W35");
  assert.equal(resolved.gsc.key, "2026-08", "an explicit monthly GSC period remains independent");
});

test("returns no primary selection when Metrika has no fully covered week", () => {
  const selection = periods.createPeriodSelection({ primaryWeek: "2026-W37", aliceMonth: "2026-09", gsc: w36 }, timezone);

  assert.equal(periods.resolveAvailableWeekSelection(selection, []), null);
});

test("keeps independent tabs available but suppresses incomplete Metrika facts when no full week exists", () => {
  const selection = periods.createPeriodSelection({ primaryWeek: "2026-W37", aliceMonth: "2026-09", gsc: w36 }, timezone);
  const view = model();
  const html = renderToStaticMarkup(createElement(Dashboard, {
    profile,
    model: { ...view, metrika: { ...missing, sourceKey: "yandex_metrika", collectionMode: "automated", period: selection.traffic.primary, state: "partial", kind: "metrika", summary: { visits: 999, pageviews: 999 }, daily: [{ date: "2026-09-07", visits: 999, pageviews: 999, users: 999 }], topPages: [], channels: [], searchEngines: [] } },
    selection,
    publicationId: null,
    filters: {},
    activeTab: "overview",
    availableWeeks: [],
  }));
  const seoHtml = renderToStaticMarkup(createElement(Dashboard, {
    profile,
    model: view,
    selection,
    publicationId: null,
    filters: {},
    activeTab: "search",
    availableWeeks: [],
  }));

  assert.match(html, /id="overview"/);
  assert.match(html, />SEO<[^]*>Источники</);
  assert.doesNotMatch(html, /999/);
  assert.match(seoHtml, /id="search"[^]*ИИ-видимость в Алисе AI/);
  assert.match(seoHtml, /Нет доступных недель/);
});

test("canonical Metrika coverage accepts successful empty days while excluding failed and incomplete weeks", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createAvailableMetrikaWeeksReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    const acceptsSuccessfulEmpty = /CASE WHEN status IN \('success', 'empty'\) THEN 0 ELSE 1 END/.test(sql);
    const excludesIncomplete = /SUM\(pagination_complete = 0\) = 0/.test(sql);
    return [acceptsSuccessfulEmpty && excludesIncomplete ? [
      { week_key: "2026-W36", period_from: "2026-08-31", period_to: "2026-09-06" },
      { week_key: "2026-W35", period_from: "2026-08-24", period_to: "2026-08-30" },
    ] : [], []];
  } });
  const result = await execute({
    name: "available_metrika_weeks",
    scope: { clientId: "client", siteId: "site", dashboardId: 42, sourceKey: "yandex_metrika", analyticsAccountId: "counter", resourceId: "counter" },
    timezone,
  });

  assert.equal("kind" in result && result.kind, "available_metrika_weeks");
  assert.deepEqual("weeks" in result && result.weeks.map((week) => week.key), ["2026-W36", "2026-W35"]);
  assert.match(calls[0]!.sql, /canonical_metrika_breakdown_coverage_daily/);
  assert.match(calls[0]!.sql, /report_key = 'search_engines'/);
  assert.match(calls[0]!.sql, /segment_key = 'russia'/);
  assert.match(calls[0]!.sql, /HAVING COUNT\(DISTINCT report_date\) = 7/);
  assert.match(calls[0]!.sql, /CASE WHEN status IN \('success', 'empty'\) THEN 0 ELSE 1 END/);
  assert.doesNotMatch(calls[0]!.sql, /status IN \([^)]*'failed'/);
  assert.match(calls[0]!.sql, /SUM\(pagination_complete = 0\) = 0/);
  assert.deepEqual(calls[0]!.params, ["yandex_metrika", "counter"]);
});

test("Webmaster query facts use the exact scope, week, ALL device and unbounded page rows", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const execute = createCanonicalReadExecutor({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("site-seo:webmaster-meta")) return [[{ row_count: 7, covered_days: 7, import_id: 91, loaded_at: "2026-09-07" }], []];
    if (sql.includes("site-seo:webmaster-queries")) return [[{ query_text: "лечение", clicks: "7", impressions: "100", ctr_pct: "7", average_position: "3.5" }], []];
    return [[], []];
  } });
  const result = await execute({
    name: "dataset",
    scope: { clientId: "client", siteId: "site", dashboardId: 42, sourceKey: "yandex_webmaster", analyticsAccountId: "webmaster", resourceId: "host" },
    period: w36,
    publicationId: null,
    filters: {},
  });

  assert.equal("queryFacts" in result && result.queryFacts?.[0]?.query, "лечение");
  const queryCall = calls.find(({ sql }) => sql.includes("site-seo:webmaster-queries"))!;
  assert.match(queryCall.sql, /canonical_fact_webmaster_queries_daily/);
  assert.match(queryCall.sql, /device_type = 'ALL'/);
  assert.deepEqual(queryCall.params, ["yandex_webmaster", "webmaster", "host", "2026-08-31", "2026-09-06"]);
  const pageCall = calls.find(({ sql }) => sql.includes("site-seo:webmaster-pages"))!;
  assert.doesNotMatch(pageCall.sql, /LIMIT 20/);
  assert.match(pageCall.sql, /AS positioned_impressions/);
});

test("SEO page renders Alice summary, longest-prefix sections, and the normalized Yandex query union", () => {
  const html = renderToStaticMarkup(createElement(Search, { id: "search", model: model(), profile, showGsc: true } as never));
  const panels = [...html.matchAll(/data-panel-id="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(panels, ["seo.alice", "seo.sections", "seo.queries"]);
  assert.match(html, /ИИ-видимость в Алисе AI[^]*12,5%[^]*20%/);
  assert.match(html, /Позиции по разделам/);
  assert.match(html, /Заболевания[^]*—/);
  assert.match(html, /Препараты[^]*8[^]*100[^]*3/);
  assert.match(html, /Инновации[^]*3[^]*220[^]*6/);
  assert.match(html, /INNO-ПУЛЬС[^]*7[^]*100[^]*3/);
  assert.match(html, /Запросы: Google, Яндекс и SEO OS/);
  assert.match(html, /Google[^]*Показы[^]*Клики[^]*CTR[^]*Позиция/);
  assert.match(html, /Яндекс Вебмастер[^]*Показы[^]*Клики[^]*CTR[^]*Позиция/);
  assert.match(html, /SEO OS[^]*Позиция[^]*Дельта[^]*Статус/);
  assert.equal(html.match(/<th scope="row" class="site-seo-wrap-cell">лечение<\/th>/g)?.length, 1);
  assert.match(html, /лечение[^]*—[^]*—[^]*—[^]*—[^]*120[^]*9[^]*7,5%[^]*3,92[^]*—[^]*—[^]*—/);
});

test("section position uses only impressions that carry a position", () => {
  const sections = aggregateWebmasterSections(profile.seoSections!, [
    { page: "/innovations/mixed", metrics: { clicks: 2, impressions: 220, ctrPct: 0.91, averagePosition: 10, positionedImpressions: 100 } },
    { page: "/innovations/positioned", metrics: { clicks: 1, impressions: 100, ctrPct: 1, averagePosition: 2, positionedImpressions: 100 } },
  ]);

  assert.equal(sections.find((section) => section.id === "innovations")?.metrics?.averagePosition, 6);
});

test("overview keeps missing states but omits completeness prose and repeated organic copy", () => {
  const partial = { ...missing, sourceKey: "yandex_metrika" as const, collectionMode: "automated" as const, state: "partial" as const };
  const view = model();
  const html = renderToStaticMarkup(createElement(Overview, {
    id: "overview",
    model: { ...view, datasets: { yandex_metrika: partial }, metrika: { ...partial, kind: "metrika", summary: { visits: 66, pageviews: 80 }, daily: [{ date: "2026-09-03", visits: 66, pageviews: 80, users: 60 }], topPages: [], channels: [], searchEngines: [] } },
    showGsc: false,
    showMetrika: true,
    showWebmaster: false,
  } as never));

  assert.doesNotMatch(html, /данные неполные|данные готовы|Поисковые визиты · Россия/);
  assert.match(html, /<td>2026-W36<\/td><td>66<\/td>/);
  assert.equal(html.match(/data-engine-slot=/g)?.length, 2);
  assert.match(html, /нет строк за период/);
});

test("Dashboard supplies the same available week list to overview and SEO toolbars", () => {
  const selection = periods.createPeriodSelection({ primaryWeek: "2026-W36", comparisonWeek: "2026-W35", aliceMonth: "2026-09", gsc: w35 }, timezone);
  const html = renderToStaticMarkup(createElement(Dashboard, {
    profile,
    model: model(),
    selection,
    publicationId: null,
    filters: {},
    activeTab: "search",
    availableWeeks: [w36, w35],
  } as never));

  assert.match(html, /name="traffic_week"[^]*2026-W36[^]*2026-W35/);
});

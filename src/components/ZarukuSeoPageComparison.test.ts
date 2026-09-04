import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSeoPageComparison from "@/components/ZarukuSeoPageComparison";
import { buildUnifiedSeoPageRows } from "@/components/zaruku-seo-workspace";

const source = readFileSync(new URL("./ZarukuSeoPageComparison.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("./zaruku-seo-workspace.ts", import.meta.url), "utf8");

function sourceWeek(
  requestedWeek: string | null,
  actualWeek: string | null = requestedWeek,
  fallback = false,
) {
  return { requestedWeek, actualWeek, fallback };
}

test("renders exact joined page rows without noisy period pills", () => {
  const rows = buildUnifiedSeoPageRows({
    gscRows: [{
      week: "2026-W29", page: "https://zaruku.ru/map/?utm_source=test", impressions: 100, clicks: 10,
      ctr: 10, average_position: 3, week_from: "2026-07-13", week_to: "2026-07-19", is_partial_week: false,
    }],
    webmasterRows: [{
      week: "2026-W29", url: "/map/", device: "ALL", impressions: 200, clicks: 20,
      ctr: 10, average_position: 7, week_from: "2026-07-13", week_to: "2026-07-19", is_partial_week: false,
    }],
    metrikaRows: [{
      label: "Карта онкоцентров", url: "https://www.zaruku.ru/map/#top", visits: 50, users: 40, pageviews: 60,
      bounce_rate: 20, avg_duration_seconds: 90, page_depth: 1.5,
    }],
    seoOsRows: [{
      week: "2026-W29", section: "/map/", cluster_id: "map", query: "онкоцентры",
      serp_position: 4, delta_prev: -1, matched_url: "https://zaruku.ru/map/", status: "found",
    }],
  });

  assert.equal(rows.length, 1);
  const markup = renderToStaticMarkup(createElement(ZarukuSeoPageComparison, {
    rows,
    sourceWeekSelections: {
      google: sourceWeek("2026-W29"),
      webmaster: sourceWeek("2026-W29"),
      metrika: sourceWeek("2026-W29"),
      seoOs: sourceWeek("2026-W29"),
    },
    locale: "ru-RU",
  }));

  assert.doesNotMatch(markup, /SEO-неделя 2026-W29/);
  assert.doesNotMatch(markup, /Поведение на сайте/);
  assert.match(markup, /Google RF/);
  assert.match(markup, /Яндекс Вебмастер/);
  assert.match(markup, /Метрика/);
  assert.match(markup, /2026-W29/);
  assert.match(markup, /Запросы SEO OS/);
  assert.match(markup, /Карта онкоцентров/);
  assert.doesNotMatch(markup, /конверси/i);
});

test("keeps page-table width inside its own responsive scroll panel", () => {
  assert.match(source, /<section className="min-w-0/);
  assert.match(source, /<ZarukuTableFrame mode="comparison"/);
  assert.match(source, /<table className="w-full min-w-\[900px\]/);
  assert.doesNotMatch(source, /overflow-auto min-w-\[1320px\]/);
  assert.match(source, /flex flex-wrap items-center justify-center/);
  assert.match(source, /thead className="sticky top-0/);
});

test("page workspace exposes search sorting pagination and safe absolute links", () => {
  assert.match(source, /type="search"/);
  assert.match(source, /PAGE_SIZE = 50/);
  assert.match(source, /Фильтр посадочных страниц/);
  assert.match(source, /ZARUKU_SEO_COMPARISON_FILTERS/);
  assert.match(workspaceSource, /Только с подтверждённой посадочной/);
  assert.match(workspaceSource, /Топ-3/);
  assert.match(workspaceSource, /Топ-10/);
  assert.match(workspaceSource, /Топ-20/);
  assert.match(workspaceSource, /Выросли/);
  assert.match(workspaceSource, /Снизились/);
  assert.match(workspaceSource, /Нет позиции/);
  assert.match(source, /Визиты/);
  assert.match(source, /Страница/);
  assert.match(source, /resolveZarukuContentUrl/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noreferrer"/);
  assert.doesNotMatch(source, /href=\{row\.url\}/);
  assert.doesNotMatch(source, /useEffect\(\(\) => setPage/);
});

test("every page comparison metric header exposes sorting", () => {
  for (const sortKey of [
    "google_impressions",
    "google_clicks",
    "google_ctr",
    "google_position",
    "webmaster_impressions",
    "webmaster_clicks",
    "webmaster_ctr",
    "webmaster_position",
    "visits",
    "users",
    "bounce_rate",
    "avg_duration_seconds",
    "seo_os_tracked_queries",
  ]) {
    assert.match(source, new RegExp(`sortKey="${sortKey}"`), sortKey);
  }
});

test("renders an em dash when row-level users are unavailable", () => {
  const rows = buildUnifiedSeoPageRows({
    gscRows: [],
    webmasterRows: [],
    metrikaRows: [{
      label: "Карта онкоцентров",
      url: "https://zaruku.ru/map/",
      visits: 50,
      users: 0,
      users_available: false,
      pageviews: 60,
      bounce_rate: 20,
      avg_duration_seconds: 90,
      page_depth: 1.5,
    }],
    seoOsRows: [],
  });
  const markup = renderToStaticMarkup(createElement(ZarukuSeoPageComparison, {
    rows,
    sourceWeekSelections: {
      google: sourceWeek(null),
      webmaster: sourceWeek(null),
      metrika: sourceWeek(null),
      seoOs: sourceWeek(null),
    },
    locale: "ru-RU",
  }));

  assert.match(
    markup,
    /text-slate-600">50<\/td><td class="px-1\.5 py-3 text-right tabular-nums text-slate-600">—<\/td>/,
  );
  assert.doesNotMatch(
    markup,
    /text-slate-600">50<\/td><td class="px-1\.5 py-3 text-right tabular-nums text-slate-600">0<\/td>/,
  );
});

test("page filters run before pagination and use landing-source evidence", () => {
  const rows = buildUnifiedSeoPageRows({
    gscRows: Array.from({ length: 75 }, (_, index) => ({
      week: "2026-W29",
      page: `https://zaruku.ru/page-${index}/`,
      impressions: 10 + index,
      clicks: 1,
      ctr: 10,
      average_position: index >= 60 ? 2 : 30,
      week_from: "2026-07-13",
      week_to: "2026-07-19",
      is_partial_week: false,
    })),
    webmasterRows: [],
    metrikaRows: [],
    seoOsRows: [],
  });

  const markup = renderToStaticMarkup(createElement(ZarukuSeoPageComparison, {
    rows,
    sourceWeekSelections: {
      google: sourceWeek("2026-W29"),
      webmaster: sourceWeek("2026-W29"),
      metrika: sourceWeek("2026-W29"),
      seoOs: sourceWeek("2026-W29"),
    },
    defaultFilter: "top3",
  }));

  assert.match(markup, /15 найдено · Страница 1 из 1/);
  assert.match(markup, /page-60/);
  assert.doesNotMatch(markup, /page-59/);
});

test("shows a source-local Metrika fallback and the mismatch notice", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuSeoPageComparison, {
    rows: [],
    sourceWeekSelections: {
      google: sourceWeek("2026-W30"),
      webmaster: sourceWeek("2026-W30"),
      metrika: sourceWeek("2026-W30", "2026-W29", true),
      seoOs: sourceWeek("2026-W30"),
    },
  }));

  assert.match(markup, /W30 недоступна, показано W29/);
  assert.match(markup, /Периоды источников различаются/);
});

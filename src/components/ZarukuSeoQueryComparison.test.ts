import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSeoQueryComparison, { toggleSeoSort } from "@/components/ZarukuSeoQueryComparison";
import type { UnifiedSeoQueryRow } from "@/components/zaruku-seo-workspace";

const source = readFileSync(new URL("./ZarukuSeoQueryComparison.tsx", import.meta.url), "utf8");

const rows: UnifiedSeoQueryRow[] = [{
  key: "инвалидность при онкологии",
  query: "инвалидность при онкологии",
  section: "/map/",
  google: { impressions: 100, clicks: 10, ctr: 10, average_position: 2 },
  webmaster: { impressions: 200, clicks: 20, ctr: 10, average_position: null },
  seo_os: { tracked_position: 4, delta_prev: -2, status: "found", matched_url: "https://zaruku.ru/map/" },
  google_pages: ["https://zaruku.ru/article/"],
  webmaster_pages: ["https://zaruku.ru/yandex-landing/"],
}];

test("toggles an active sort and defaults each metric family correctly", () => {
  assert.deepEqual(
    toggleSeoSort({ key: "google_position", direction: "asc" }, "google_position"),
    { key: "google_position", direction: "desc" },
  );
  assert.deepEqual(
    toggleSeoSort({ key: "google_position", direction: "desc" }, "webmaster_position"),
    { key: "webmaster_position", direction: "asc" },
  );
  assert.deepEqual(
    toggleSeoSort({ key: "google_position", direction: "asc" }, "google_impressions"),
    { key: "google_impressions", direction: "desc" },
  );
  assert.deepEqual(
    toggleSeoSort({ key: "google_position", direction: "asc" }, "webmaster_clicks"),
    { key: "webmaster_clicks", direction: "desc" },
  );
});

test("renders grouped source columns, accessible sorting, and missing positions", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuSeoQueryComparison, {
    rows,
    sourceWeeks: { google: "2026-W29", webmaster: "2026-W28", seoOs: "2026-W29" },
    defaultSort: { key: "google_position", direction: "asc" },
    locale: "ru-RU",
  }));

  assert.match(markup, /Фраза/);
  assert.match(markup, /Раздел/);
  assert.match(markup, /Google RF/);
  assert.match(markup, /Яндекс Вебмастер/);
  assert.match(markup, /Яндекс: \/yandex-landing\//);
  assert.match(markup, /SEO OS/);
  assert.match(markup, /Позиция/);
  assert.match(markup, /<button/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, />—</);
  assert.match(markup, /Периоды источников различаются/);
  assert.doesNotMatch(markup, /Яндекс RF/);
});

test("keeps query-table width inside its own responsive scroll panel", () => {
  assert.match(source, /<section className="min-w-0/);
  assert.match(source, /<ZarukuTableFrame mode="comparison"/);
  assert.match(source, /<table className="w-full min-w-\[900px\]/);
  assert.doesNotMatch(source, /overflow-auto min-w-\[1180px\]/);
  assert.match(source, /flex flex-wrap items-center justify-center/);
  assert.match(source, /thead className="sticky top-0/);
});

test("query workspace exposes search and mounts at most 50 rows", () => {
  const manyRows = Array.from({ length: 75 }, (_, index) => ({
    ...rows[0],
    key: `query-${index}`,
    query: `Запрос ${index}`,
    google: { ...rows[0].google!, average_position: index + 1 },
  }));
  const markup = renderToStaticMarkup(createElement(ZarukuSeoQueryComparison, {
    rows: manyRows,
    sourceWeeks: { google: "2026-W29", webmaster: "2026-W29", seoOs: "2026-W29" },
  }));
  assert.match(markup, /type="search"/);
  assert.match(markup, /Страница 1 из 2/);
  assert.match(markup, /Запрос 49/);
  assert.doesNotMatch(markup, /Запрос 50/);
  assert.match(markup, /Предыдущая/);
  assert.match(markup, /Следующая/);
  assert.doesNotMatch(source, /useEffect\(\(\) => setPage/);
});

test("confirmed-landing filter runs across the full row set before pagination", () => {
  const manyRows = Array.from({ length: 75 }, (_, index) => ({
    ...rows[0],
    key: `query-${index}`,
    query: `Запрос ${index}`,
    google_pages: index >= 60 ? [`https://zaruku.ru/page-${index}/`] : [],
    webmaster_pages: [],
  }));
  const markup = renderToStaticMarkup(createElement(ZarukuSeoQueryComparison, {
    rows: manyRows,
    sourceWeeks: { google: "2026-W29", webmaster: "2026-W29", seoOs: "2026-W29" },
    defaultFilter: "confirmed_landing",
  }));

  assert.match(markup, /Только с подтверждённой посадочной/);
  assert.match(markup, /15 найдено · Страница 1 из 1/);
  assert.match(markup, /Запрос 60/);
  assert.match(markup, /Google:/);
  assert.match(markup, /Google Search Console или Яндекс Вебмастер/);
  assert.match(markup, /SEO OS и представительская страница Яндекса фильтр не подтверждают/);
  assert.doesNotMatch(markup, /Запрос 59/);
});

test("confirmed-landing filter shows its quiet empty state", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuSeoQueryComparison, {
    rows: [{ ...rows[0], google_pages: [], webmaster_pages: [] }],
    sourceWeeks: { google: "2026-W29", webmaster: "2026-W29", seoOs: "2026-W29" },
    defaultFilter: "confirmed_landing",
  }));

  assert.match(markup, /Нет запросов с подтверждённой посадочной за выбранный период/);
});

test("query workspace distinguishes unavailable sources from an empty result", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuSeoQueryComparison, {
    rows: [],
    sourceWeeks: { google: null, webmaster: null, seoOs: null },
    sourceAvailability: { google: false, webmaster: false, seoOs: false },
  }));
  assert.match(markup, /Источник недоступен/);
  assert.doesNotMatch(markup, /По выбранному фильтру запросов нет/);
});

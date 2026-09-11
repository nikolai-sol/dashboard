import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SiteProfile } from "@reportingdash/site-seo-contract";

import { Content, aggregateContentSections, filterSortPaginateContentPages } from "../src/components/Content.tsx";
import type { MetrikaCanonicalData, MetrikaContentPageRow } from "../src/lib/db.ts";

const sections = [
  { id: "innovations", label: "Инновации", pathPrefixes: ["/innovations/"] },
  { id: "inno-puls", label: "INNO-ПУЛЬС", pathPrefixes: ["/innovations/inno-puls/"] },
  { id: "products", label: "Препараты", pathPrefixes: ["/products/"] },
];

const profile = {
  domain: "med.roche.ru",
  seoSections: sections,
} as unknown as SiteProfile;

const row = (url: string, pageviews: number, visits: number, bounceRate: number | null, duration: number | null, depth: number | null, title: string | null = null): MetrikaContentPageRow => ({
  url, title, pageviews, visits, bounceRate, avgVisitDurationSeconds: duration, pageDepth: depth,
});

function metrika(contentPages: readonly MetrikaContentPageRow[]): MetrikaCanonicalData {
  return {
    sourceKey: "yandex_metrika", period: { kind: "iso_week", from: "2026-08-31", to: "2026-09-06", key: "2026-W36", sourceTimezone: "Europe/Moscow" },
    state: "ready", collectionMode: "automated", completeness: "complete", importId: "81", exportedAt: null, loadedAt: "2026-09-07", freshness: "unknown", latestAttempt: "success",
    kind: "metrika", summary: null, daily: [], topPages: [], contentPages,
  };
}

test("content sections use longest-prefix matching and weighted entry-page metrics", () => {
  const result = aggregateContentSections(sections, [
    row("https://med.roche.ru/innovations/story", 30, 10, 20, 60, 2),
    row("/innovations/inno-puls/one", 20, 4, 50, 120, 4),
    row("/innovations/inno-puls/two", 10, 6, 0, 60, 2),
  ]);

  assert.deepEqual(result, [
    { id: "innovations", label: "Инновации", pageviews: 30, visits: 10, bounceRate: 20, avgVisitDurationSeconds: 60, pageDepth: 2 },
    { id: "inno-puls", label: "INNO-ПУЛЬС", pageviews: 30, visits: 10, bounceRate: 20, avgVisitDurationSeconds: 84, pageDepth: 2.8 },
  ]);
});

test("all-pages controls search, sort and paginate by 50 without inventing rows", () => {
  const pages = Array.from({ length: 51 }, (_, index) => row(`/products/${String(index + 1).padStart(2, "0")}`, 51 - index, index + 1, 10, 60, 2, `Препарат ${index + 1}`));
  const first = filterSortPaginateContentPages(pages, "", { key: "pageviews", direction: "desc" }, 1);
  const second = filterSortPaginateContentPages(pages, "", { key: "pageviews", direction: "desc" }, 2);
  const found = filterSortPaginateContentPages(pages, "Препарат 51", { key: "title", direction: "asc" }, 1);

  assert.equal(first.rows.length, 50);
  assert.equal(first.totalPages, 2);
  assert.deepEqual(second.rows.map(({ url }) => url), ["/products/51"]);
  assert.deepEqual(found.rows.map(({ title }) => title), ["Препарат 51"]);
});

test("content UI follows the canonical reading order, links relative URLs and omits unavailable returns", () => {
  const html = renderToStaticMarkup(createElement(Content, {
    id: "content", profile, data: metrika([
      row("/products/a", 31, 12, 25, 90, 2.5, "Препарат A"),
      row("/innovations/inno-puls/story", 20, 10, 15, 120, 3, "История"),
    ]),
  }));
  const headings = ["Состояние контента", "Разделы сайта", "Популярные страницы", "Лучшее удержание", "Риск отказов", "Все страницы"];
  let previous = -1;
  for (const heading of headings) {
    const index = html.indexOf(heading);
    assert.ok(index > previous, `${heading} must follow the previous section`);
    previous = index;
  }
  assert.doesNotMatch(html, /Возврат к контенту/);
  assert.match(html, /href="https:\/\/med\.roche\.ru\/products\/a"/);
  assert.match(html, /type="search"/);
  assert.match(html, /aria-label="Сортировка страниц"/);
  assert.match(html, /Страница 1 из 1/);
  assert.match(html, /site-seo-table-frame/);
  assert.match(html, /site-seo-content-table/);
});

test("content UI uses compact honest empty states", () => {
  const html = renderToStaticMarkup(createElement(Content, { id: "content", profile, data: metrika([]) }));
  assert.match(html, /Нет канонических метрик страниц за выбранную неделю\./);
  assert.doesNotMatch(html, />0%<|>0:00</);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSeoQueryComparison, { toggleSeoSort } from "@/components/ZarukuSeoQueryComparison";
import type { UnifiedSeoQueryRow } from "@/components/zaruku-seo-workspace";

const rows: UnifiedSeoQueryRow[] = [{
  key: "инвалидность при онкологии",
  query: "инвалидность при онкологии",
  section: "/map/",
  google: { impressions: 100, clicks: 10, ctr: 10, average_position: 2 },
  webmaster: { impressions: 200, clicks: 20, ctr: 10, average_position: null },
  seo_os: { tracked_position: 4, delta_prev: -2, status: "found", matched_url: "https://zaruku.ru/map/" },
  google_pages: ["https://zaruku.ru/article/"],
}];

test("toggles an active sort and defaults a new position sort to ascending", () => {
  assert.deepEqual(
    toggleSeoSort({ key: "google_position", direction: "asc" }, "google_position"),
    { key: "google_position", direction: "desc" },
  );
  assert.deepEqual(
    toggleSeoSort({ key: "google_position", direction: "desc" }, "webmaster_position"),
    { key: "webmaster_position", direction: "asc" },
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
  assert.match(markup, /SEO OS/);
  assert.match(markup, /Позиция/);
  assert.match(markup, /<button/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, />—</);
  assert.match(markup, /Периоды источников различаются/);
  assert.doesNotMatch(markup, /Яндекс RF/);
});

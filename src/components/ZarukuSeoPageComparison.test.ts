import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSeoPageComparison from "@/components/ZarukuSeoPageComparison";
import { buildUnifiedSeoPageRows } from "@/components/zaruku-seo-workspace";

const source = readFileSync(new URL("./ZarukuSeoPageComparison.tsx", import.meta.url), "utf8");

test("renders exact joined page rows with separate SEO and behavior periods", () => {
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
    seoWeek: "2026-W29",
    sourceWeeks: { google: "2026-W29", webmaster: "2026-W29", seoOs: "2026-W29" },
    trafficPeriod: { from: "2026-03-03", to: "2026-03-26" },
    locale: "ru-RU",
  }));

  assert.match(markup, /SEO-неделя 2026-W29/);
  assert.match(markup, /Поведение на сайте 2026-03-03 — 2026-03-26/);
  assert.match(markup, /Google RF/);
  assert.match(markup, /Яндекс Вебмастер/);
  assert.match(markup, /Метрика/);
  assert.match(markup, /Запросы SEO OS/);
  assert.match(markup, /Карта онкоцентров/);
  assert.doesNotMatch(markup, /конверси/i);
});

test("keeps page-table width inside its own responsive scroll panel", () => {
  assert.match(source, /<section className="min-w-0/);
  assert.match(source, /max-h-\[42rem\] overflow-auto[\s\S]*min-w-\[1320px\]/);
  assert.match(source, /flex flex-wrap items-center justify-center/);
  assert.match(source, /thead className="sticky top-0/);
});

test("page workspace exposes search sorting pagination and safe absolute links", () => {
  assert.match(source, /type="search"/);
  assert.match(source, /PAGE_SIZE = 50/);
  assert.match(source, /Google: показы/);
  assert.match(source, /Яндекс: показы/);
  assert.match(source, /Визиты/);
  assert.match(source, /Название/);
  assert.match(source, /resolveZarukuContentUrl/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noreferrer"/);
  assert.doesNotMatch(source, /href=\{row\.url\}/);
  assert.doesNotMatch(source, /useEffect\(\(\) => setPage/);
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
    seoWeek: null,
    sourceWeeks: { google: null, webmaster: null, seoOs: null },
    trafficPeriod: { from: "2026-07-01", to: "2026-07-21" },
    locale: "ru-RU",
  }));

  assert.match(
    markup,
    /text-slate-600">50<\/td><td class="px-2 py-3 text-right tabular-nums text-slate-600">—<\/td>/,
  );
  assert.doesNotMatch(
    markup,
    /text-slate-600">50<\/td><td class="px-2 py-3 text-right tabular-nums text-slate-600">0<\/td>/,
  );
});

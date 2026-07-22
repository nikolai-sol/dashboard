import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSeoPageComparison from "@/components/ZarukuSeoPageComparison";
import { buildUnifiedSeoPageRows } from "@/components/zaruku-seo-workspace";

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

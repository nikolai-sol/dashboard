import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import ZarukuSeoAnalytics from "./ZarukuSeoAnalytics";
import type { ZarukuSeoOsData } from "@/lib/types";

test("renders retry-later unavailable state when positions query failed", () => {
  const seoOs: ZarukuSeoOsData = {
    available: false,
    status: "unavailable",
    error: "positions: database unavailable",
    data_availability: {
      section_patterns: true,
      positions: false,
      opportunities: true,
      tasks: true,
      runs: true,
      traffic_visibility: true,
    },
    weeks: [],
    latest_week: null,
    section_patterns: [{ section: "/map/", url_pattern: "/map/", priority: 1 }],
    position_trend: [],
    clusters: [],
    opportunities: [],
    tasks: [],
    runs: [],
    traffic_visibility: [],
  };

  const html = renderToStaticMarkup(createElement(ZarukuSeoAnalytics, {
    seoOs,
    primaryWeek: null,
    comparisonWeek: null,
  }));

  assert.match(html, /Позиции SEO временно недоступны/);
  assert.match(html, /Повторите попытку позже/);
  assert.doesNotMatch(html, /Нет найденных позиций/);
});

test("chart-only mode omits the duplicate cluster table", () => {
  const seoOs: ZarukuSeoOsData = {
    available: true,
    status: "available",
    error: null,
    data_availability: {
      section_patterns: true,
      positions: true,
      opportunities: true,
      tasks: true,
      runs: true,
      traffic_visibility: true,
    },
    weeks: ["2026-W29"],
    latest_week: "2026-W29",
    section_patterns: [{ section: "/map/", url_pattern: "/map/", priority: 1 }],
    position_trend: [{
      week: "2026-W29", section: "/map/", average_position: 4, coverage: 1, found_rows: 1, tracked_rows: 1,
    }],
    clusters: [{
      week: "2026-W29", section: "/map/", cluster_id: "map", query: "онкоцентры",
      serp_position: 4, delta_prev: -1, matched_url: "https://zaruku.ru/map/", status: "found",
    }],
    opportunities: [],
    tasks: [],
    runs: [],
    traffic_visibility: [],
  };

  const html = renderToStaticMarkup(createElement(ZarukuSeoAnalytics, {
    seoOs,
    primaryWeek: "2026-W29",
    comparisonWeek: null,
    showClusterTable: false,
  }));

  assert.match(html, /Позиции по разделам/);
  assert.doesNotMatch(html, /Кластеры запросов/);
  assert.doesNotMatch(html, /онкоцентры/);
});

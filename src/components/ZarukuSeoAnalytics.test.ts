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

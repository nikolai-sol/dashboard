import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuPanelState from "./ZarukuPanelState";
import ZarukuPeriodContext from "./ZarukuPeriodContext";
import type { ZarukuDatasetMeta } from "@/lib/types";

const baseMeta: ZarukuDatasetMeta = {
  state: "ready",
  sources: ["metrika"],
  period: { from: "2026-06-24", to: "2026-07-19" },
  requested_period: { from: "2026-06-24", to: "2026-07-21" },
  geography: "unsegmented",
  metrics: {
    visits: true,
    users: true,
    pageviews: true,
    bounce_rate: true,
    avg_duration_seconds: true,
    page_depth: true,
  },
  message: null,
};

test("panel state distinguishes unavailable, empty, and partial", () => {
  const unavailable = renderToStaticMarkup(React.createElement(ZarukuPanelState, {
    meta: { ...baseMeta, state: "unavailable", message: "Стабильный срез недоступен." },
    hasRows: false,
  }, React.createElement("span", null, "rows")));
  const empty = renderToStaticMarkup(React.createElement(ZarukuPanelState, {
    meta: { ...baseMeta, state: "empty" },
    hasRows: false,
  }, React.createElement("span", null, "rows")));
  const partial = renderToStaticMarkup(React.createElement(ZarukuPanelState, {
    meta: { ...baseMeta, state: "partial", message: "Данные доступны по 2026-07-19." },
    hasRows: true,
  }, React.createElement("span", null, "rows")));

  assert.match(unavailable, /Источник недоступен/);
  assert.match(empty, /Нет данных за выбранный период/);
  assert.match(partial, /Частичные данные/);
  assert.match(partial, /rows/);
});

test("period context keeps onsite, search, and AI periods separate", () => {
  const html = renderToStaticMarkup(React.createElement(ZarukuPeriodContext, {
    onsite: { requested: { from: "2026-06-24", to: "2026-07-21" }, actual: { from: "2026-06-24", to: "2026-07-19" } },
    search: [{ label: "Google RF", period: "2026-W29" }, { label: "Яндекс", period: "2026-W28" }],
    ai: { period: "2026-07", provenance: "wm_alisa_manual" },
  }));

  assert.match(html, /24\.06\.2026–21\.07\.2026/);
  assert.match(html, /по 19\.07\.2026/);
  assert.match(html, /2026-W29/);
  assert.match(html, /2026-W28/);
  assert.match(html, /wm_alisa_manual/);
});

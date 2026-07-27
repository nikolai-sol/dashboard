import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSectionState from "./ZarukuSectionState";
import type { ZarukuDatasetMeta } from "@/lib/types";

const baseMeta: ZarukuDatasetMeta = {
  state: "ready",
  sources: ["metrika"],
  period: { from: "2026-07-13", to: "2026-07-19" },
  requested_period: { from: "2026-07-13", to: "2026-07-19" },
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

test("all-empty or hidden content panels collapse to one quiet section message", () => {
  const html = renderToStaticMarkup(React.createElement(ZarukuSectionState, {
    panels: [
      { meta: { ...baseMeta, state: "empty" }, hasRows: false },
      { meta: { ...baseMeta, state: "hidden" }, hasRows: false },
      { meta: { ...baseMeta, state: "unavailable" }, hasRows: false },
    ],
  },
  React.createElement("article", null, "first panel"),
  React.createElement("article", null, "second panel")));

  assert.equal((html.match(/Нет данных за выбранный период/g) ?? []).length, 1);
  assert.doesNotMatch(html, /first panel|second panel/);
  assert.doesNotMatch(html, /amber|warning/);
});

test("one renderable panel keeps the section content", () => {
  const html = renderToStaticMarkup(React.createElement(ZarukuSectionState, {
    panels: [
      { meta: { ...baseMeta, state: "empty" }, hasRows: false },
      { meta: baseMeta, hasRows: true },
    ],
  }, React.createElement("article", null, "renderable panel")));

  assert.match(html, /renderable panel/);
  assert.doesNotMatch(html, /Нет данных за выбранный период/);
});

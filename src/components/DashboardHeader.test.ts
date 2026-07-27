import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardHeader, { type DashboardDateControlsMode } from "@/components/DashboardHeader";

function renderMode(dateControlsMode: DashboardDateControlsMode) {
  return renderToStaticMarkup(createElement(DashboardHeader, {
    clientName: "Zaruku",
    title: "Dashboard",
    periodLabel: "01.07.2026 — 27.07.2026",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-27",
    dateControlsMode,
  }));
}

test("active date controls preserve the existing calendar UI", () => {
  const html = renderMode("active");
  assert.match(html, /type="date"/);
  assert.doesNotMatch(html, /Эта вкладка работает по неделям/);
});

test("weekly tabs keep calendar controls visible but disabled", () => {
  const html = renderMode("disabled");
  assert.match(html, /Эта вкладка работает по неделям/);
  assert.match(html, /type="date"[^>]*disabled=""/);
  assert.match(html, /type="button"[^>]*disabled=""/);
});

test("tabs without a time owner hide calendar controls", () => {
  const html = renderMode("hidden");
  assert.doesNotMatch(html, /type="date"/);
  assert.doesNotMatch(html, /This month|This week|Yesterday|Choose period/);
});

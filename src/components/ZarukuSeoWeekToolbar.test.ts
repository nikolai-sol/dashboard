import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import ZarukuSeoWeekToolbar from "./ZarukuSeoWeekToolbar";

test("associates the unavailable description with the focusable wrapper", () => {
  const html = renderToStaticMarkup(createElement(ZarukuSeoWeekToolbar, {
    weeks: ["2026-W01"],
    primaryWeek: "2026-W01",
    comparisonWeek: null,
    comparisonEnabled: false,
    onComparisonEnabledChange() {},
    onPrimaryWeekChange() {},
    onComparisonWeekChange() {},
    onComparePrevious() {},
  }));

  assert.match(
    html,
    /<span(?=[^>]*\btabindex="0")(?=[^>]*\baria-describedby="zaruku-previous-week-unavailable-description")[^>]*>/,
  );
});

test("disables Compare mode when fewer than two weeks are available", () => {
  const html = renderToStaticMarkup(createElement(ZarukuSeoWeekToolbar, {
    weeks: ["2026-W01"],
    primaryWeek: "2026-W01",
    comparisonWeek: null,
    comparisonEnabled: false,
    onComparisonEnabledChange() {},
    onPrimaryWeekChange() {},
    onComparisonWeekChange() {},
    onComparePrevious() {},
  }));

  assert.match(html, /<button(?=[^>]*disabled="")(?=[^>]*aria-pressed="false")[^>]*>Compare<\/button>/);
});

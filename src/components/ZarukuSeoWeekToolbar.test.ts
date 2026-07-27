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

test("disables comparison mode when fewer than two weeks are available", () => {
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

  assert.match(html, /<button(?=[^>]*disabled="")(?=[^>]*aria-pressed="false")[^>]*>Сравнить<\/button>/);
});

test("keeps the week controls stacked until the content column is wide enough", () => {
  const html = renderToStaticMarkup(createElement(ZarukuSeoWeekToolbar, {
    weeks: ["2026-W01", "2026-W02"],
    primaryWeek: "2026-W02",
    comparisonWeek: "2026-W01",
    comparisonEnabled: true,
    onComparisonEnabledChange() {},
    onPrimaryWeekChange() {},
    onComparisonWeekChange() {},
    onComparePrevious() {},
  }));

  assert.match(html, /lg:grid-cols-\[auto_minmax\(10rem,1fr\)_minmax\(10rem,1fr\)_2rem\]/);
  assert.doesNotMatch(html, /sm:grid-cols-\[auto_minmax\(10rem,1fr\)_minmax\(10rem,1fr\)_2rem\]/);
});

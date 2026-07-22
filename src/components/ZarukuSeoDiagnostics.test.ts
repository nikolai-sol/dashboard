import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSeoDiagnostics from "@/components/ZarukuSeoDiagnostics";

test("renders secondary GSC diagnostics in progressive disclosure without country breakdown", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuSeoDiagnostics, {
    summaryRows: [],
    brandRows: [],
    appearanceRows: [],
    resultTypeRows: [],
    periods: {
      summary: { label: "2026-W29", fallbackNote: null },
      brand: { label: "2026-W29", fallbackNote: null },
      appearance: { label: "2026-W29", fallbackNote: null },
      resultType: { label: "2026-W29", fallbackNote: null },
    },
    locale: "ru-RU",
  }));

  assert.match(markup, /<details/);
  assert.match(markup, /Дополнительная диагностика/);
  assert.match(markup, /Устройства/);
  assert.match(markup, /Брендовые и небрендовые запросы/);
  assert.match(markup, /Внешний вид в поиске/);
  assert.match(markup, /Типы результатов/);
  assert.doesNotMatch(markup, /Countries|Страны|GSC countries/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuTableFrame from "@/components/ZarukuTableFrame";

function sampleTable() {
  return createElement(
    "table",
    null,
    createElement("tbody", null, createElement("tr", null, createElement("td", null, "row"))),
  );
}

test("comparison frame owns both axes without a minimum width", () => {
  const html = renderToStaticMarkup(
    createElement(
      ZarukuTableFrame,
      { mode: "comparison", label: "Запросы" },
      sampleTable(),
    ),
  );

  assert.match(html, /data-table-mode="comparison"/);
  assert.match(html, /overflow-auto/);
  assert.match(html, /max-h-\[42rem\]/);
  assert.doesNotMatch(html, /min-w-\[/);
});

test("table frame modes expose the intended scroll contract", () => {
  const expectations = {
    compact: "overflow-x-auto",
    standard: "overflow-x-auto",
    operational: "max-h-[30rem] overflow-auto",
    comparison: "max-h-[42rem] overflow-auto",
  } as const;

  for (const [mode, expectedClass] of Object.entries(expectations)) {
    const html = renderToStaticMarkup(
      createElement(
        ZarukuTableFrame,
        {
          mode: mode as keyof typeof expectations,
          label: `${mode} table`,
        },
        sampleTable(),
      ),
    );
    assert.match(html, new RegExp(expectedClass.replaceAll("[", "\\[").replaceAll("]", "\\]")));
    assert.match(html, /role="region"/);
    assert.match(html, /tabindex="0"/);
  }
});

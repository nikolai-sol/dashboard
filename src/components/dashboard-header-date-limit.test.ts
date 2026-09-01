import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardHeader from "./DashboardHeader";

test("dashboard date inputs expose the source reporting cutoff", () => {
  const html = renderToStaticMarkup(createElement(DashboardHeader, {
    clientName: "Zaruku",
    title: "Portal BI",
    periodLabel: "August",
    showIdentity: false,
    dateFrom: "2026-08-01",
    dateTo: "2026-08-23",
    maxDate: "2026-08-23",
  }));

  assert.equal((html.match(/max="2026-08-23"/g) ?? []).length, 2);
});

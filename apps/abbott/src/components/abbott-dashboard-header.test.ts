import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardHeader from "../../../../src/components/DashboardHeader";
import { getDashboardI18n } from "../../../../src/lib/dashboard-i18n";
import { build } from "esbuild";

test("Abbott header markup matches the production header with its date slot and PDF states", async () => {
  const { default: AbbottDashboardHeader } = await import("./AbbottDashboardHeader");
  for (const pdfMode of [false, true]) {
    for (const logoUrl of [undefined, "/logos/abbott.svg"]) {
      for (const labels of [undefined, getDashboardI18n("ru").header]) {
        const props = { clientName: "Abbott", title: "Аналитика трафика", periodLabel: "1 авг. 2026 г. - 9 авг. 2026 г.", pdfMode, logoUrl, labels, dateControlsSlot: createElement("div", { "data-picker": "abbott" }, "Этот месяц") };
        assert.equal(renderToStaticMarkup(createElement(AbbottDashboardHeader, props)), renderToStaticMarkup(createElement(DashboardHeader, props)));
      }
    }
  }
});

test("page runtime graph contains Abbott UI and excludes unrelated dashboard or server modules", async () => {
  const source = readFileSync(new URL("./AbbottDashboardHeader.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ComparisonToggle|ZARUKU|zaruku|from ["']@\/components\/DashboardHeader/);
  const result = await build({ entryPoints: ["apps/abbott/src/components/AbbottDashboardPage.tsx"], bundle: true, write: false, metafile: true, packages: "external", platform: "browser", logLevel: "silent", tsconfig: "apps/abbott/tsconfig.json" });
  const inputs = Object.keys(result.metafile!.inputs).sort();
  const graph = inputs.join("\n");
  assert.match(graph, /AbbottDashboardHeader\.tsx/);
  assert.match(graph, /AbbottBiDashboard\.tsx/);
  assert.match(graph, /DashboardAccessGate\.tsx/);
  assert.doesNotMatch(graph, /zaruku|advertising|ComparisonToggle|Campaign|MediaPlan|Performance|schema-parser|dashboard-data-loader|src\/app\/dashboard|src\/lib\/db\.ts/);
  const allowedShared = /^(?:src\/components\/(?:AbbottBiDashboard\.tsx|DashboardAccessGate\.tsx|abbott[^/]*\.(?:ts|tsx)|abbott\/[^/]+\.(?:ts|tsx))|src\/lib\/(?:abbott-[^/]+|dashboard-i18n|formatters)\.ts)$/;
  assert.deepEqual(inputs.filter((input) => input.startsWith("src/") && !allowedShared.test(input)), []);
});

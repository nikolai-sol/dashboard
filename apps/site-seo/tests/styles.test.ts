import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const appRoot = path.resolve(process.cwd(), "apps/site-seo");

test("site-seo layout loads its own responsive dashboard styles", () => {
  const layout = readFileSync(path.join(appRoot, "src/app/layout.tsx"), "utf8");
  const stylesheet = path.join(appRoot, "src/app/globals.css");

  assert.match(layout, /import\s+["']\.\/globals\.css["']/);
  assert.ok(existsSync(stylesheet), "apps/site-seo/src/app/globals.css must exist");
});

test("local stylesheet defines the responsive neutral shell contract", () => {
  const stylesheet = path.join(appRoot, "src/app/globals.css");
  const css = readFileSync(stylesheet, "utf8");

  assert.match(css, /\.site-seo-page\s*\{/);
  assert.match(css, /\.site-seo-rail\s*\{/);
  assert.match(css, /\.site-seo-table-frame\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*767px\)/);
  assert.doesNotMatch(css, /zaruku/i);
});

test("shell geometry and typography match the reference dashboard", () => {
  const css = readFileSync(path.join(appRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /body\s*\{[^}]*radial-gradient/);
  assert.match(css, /\.site-seo-dashboard\s*\{[^}]*display\s*:\s*flex[^}]*border\s*:[^}]*border-radius\s*:\s*12px/);
  assert.match(css, /\.site-seo-rail\s*\{[^}]*width\s*:\s*240px[^}]*border-right/);
  assert.match(css, /\.site-seo-rail a\[aria-current="page"\]\s*\{[^}]*background\s*:\s*var\(--site-seo-slate-100\)/);
  assert.match(css, /\.site-seo-dashboard :is\(h1, h2, h3, h4\)\s*\{[^}]*Georgia/);
  assert.match(css, /\.site-seo-mobile-tabs\s*\{[^}]*display\s*:\s*none/);
});

test("mobile header and content stay within the reference frame", () => {
  const css = readFileSync(path.join(appRoot, "src/app/globals.css"), "utf8");
  const mobileCss = css.slice(css.indexOf("@media (max-width: 767px)"));

  assert.match(css, /\.site-seo-header-row\s*\{[^}]*flex-wrap\s*:\s*wrap/);
  assert.match(mobileCss, /\.site-seo-exports\s*\{[^}]*width\s*:\s*auto/);
  assert.match(mobileCss, /\.site-seo-selected-tab\s*\{[^}]*padding\s*:\s*16px/);
  assert.match(mobileCss, /\.site-seo-overview-panel-header\s*\{[^}]*flex-direction\s*:\s*column/);
  assert.match(mobileCss, /\.site-seo-source-badge\s*\{[^}]*max-width\s*:\s*100%[^}]*flex-wrap\s*:\s*wrap/);
});

test("local stylesheet covers the shell controls, identity, exports, and login", () => {
  const css = readFileSync(path.join(appRoot, "src/app/globals.css"), "utf8");

  for (const selector of [
    "site-seo-period-selector",
    "site-seo-field",
    "site-seo-input",
    "site-seo-button",
    "site-seo-login-form",
    "site-seo-header",
    "site-seo-identity",
    "site-seo-logo",
    "site-seo-exports",
    "site-seo-toolbar",
  ]) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{`), `${selector} must have a scoped rule`);
  }

  assert.match(css, /\.site-seo-logo\s*\{[^}]*width\s*:[^;}]+;[^}]*height\s*:[^;}]+;/);
  const mobileCss = css.slice(css.indexOf("@media (max-width: 767px)"));
  assert.match(mobileCss, /\.site-seo-logo\s*\{/);
  assert.match(mobileCss, /\.site-seo-period-selector\s*\{/);
});

test("canonical dataset states use distinct semantic status colours", () => {
  const css = readFileSync(path.join(appRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /\.site-seo-status-badge\[data-state="ready"\][^{]*\{[^}]*var\(--site-seo-status-success\)/);
  assert.match(css, /\.site-seo-status-badge\[data-state="complete_empty"\][^{]*\{[^}]*var\(--site-seo-status-success\)/);
  assert.match(css, /\.site-seo-status-badge\[data-state="partial"\][^{]*\{[^}]*var\(--site-seo-status-warning\)/);
  assert.match(css, /\.site-seo-status-badge\[data-state="missing"\][^{]*\{[^}]*var\(--site-seo-status-neutral\)/);
  assert.match(css, /\.site-seo-status-badge\[data-state="failed"\][^{]*\{[^}]*var\(--site-seo-status-critical\)/);
  assert.match(css, /\.site-seo-panel\[data-state="partial"\][^{]*\{[^}]*var\(--site-seo-status-warning\)/);
  assert.match(css, /\.site-seo-panel\[data-state="failed"\][^{]*\{[^}]*var\(--site-seo-status-critical\)/);
});

test("overview uses the accepted Zaruku panel geometry", () => {
  const css = readFileSync(path.join(appRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /\.site-seo-overview-grid\s*\{[^}]*display:\s*grid/);
  assert.match(css, /@media \(min-width:\s*1280px\)[^]*\.site-seo-overview-grid\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /data-panel-id="overview\.north_star"[^]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /data-panel-id="overview\.channels"[^]*grid-column:\s*span\s*6/);
  assert.match(css, /data-panel-id="overview\.search_engines"[^]*grid-column:\s*span\s*6/);
  assert.match(css, /data-panel-id="overview\.organic_search"[^]*grid-column:\s*1\s*\/\s*-1/);
});

test("overview canonical breakdowns render as compact factual bars", () => {
  const css = readFileSync(path.join(appRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /\.site-seo-breakdown-list\s*\{[^}]*display:\s*grid/);
  assert.match(css, /\.site-seo-breakdown-track\s*\{[^}]*background:/);
  assert.match(css, /\.site-seo-breakdown-track\s*>\s*span\s*\{[^}]*background:\s*var\(--site-seo-teal-600\)/);
});

test("overview search engines and weekly trend expose their two-column and labelled-axis geometry", () => {
  const css = readFileSync(path.join(appRoot, "src/app/globals.css"), "utf8");

  assert.match(css, /\.site-seo-engine-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.site-seo-trend-chart\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.site-seo-trend-y-axis\s*\{/);
  assert.match(css, /\.site-seo-trend-axis\[data-single="true"\]\s*\{[^}]*justify-content:\s*center/);
});

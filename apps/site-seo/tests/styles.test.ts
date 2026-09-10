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

  assert.match(css, /\.site-seo-shell\s*\{/);
  assert.match(css, /\.site-seo-rail\s*\{/);
  assert.match(css, /\.site-seo-table-frame\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*767px\)/);
  assert.doesNotMatch(css, /zaruku/i);
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

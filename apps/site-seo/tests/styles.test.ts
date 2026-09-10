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

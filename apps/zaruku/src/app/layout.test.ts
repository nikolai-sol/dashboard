import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(import.meta.url);

function renderLayout(filename: string) {
  const fonts: unknown[] = [];
  const font = (name: string) => (options: { variable: string }) => {
    fonts.push({ name, options });
    return { variable: `fixture-${name}` };
  };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: { default?: React.ComponentType<{ children: React.ReactNode }>; metadata?: unknown } = {};
  runInNewContext(output, { exports, require: (name: string) => {
    if (name === "./globals.css") return {};
    if (name === "next/font/google") return { Inter: font("Inter"), JetBrains_Mono: font("JetBrains_Mono") };
    return require(name);
  } });
  assert.ok(exports.default);
  return JSON.parse(JSON.stringify({ fonts, metadata: exports.metadata,
    html: renderToStaticMarkup(createElement(exports.default, null, createElement("p", null, "Отчёт 123"))) }));
}

test("isolated document preserves combined font configuration, metadata and rendered body", () => {
  const combined = renderLayout(path.join(root, "src/app/layout.tsx"));
  assert.deepEqual(combined.fonts, [
    { name: "Inter", options: { variable: "--font-inter", subsets: ["latin"] } },
    { name: "JetBrains_Mono", options: { variable: "--font-mono", subsets: ["latin"] } },
  ]);
  assert.deepEqual(renderLayout(path.join(root, "apps/zaruku/src/app/layout.tsx")), combined);
});

test("isolated build emits the inherited document fonts and presentation classes", () => {
  const build = path.join(root, "apps/zaruku/.next-zaruku");
  const html = readFileSync(path.join(build, "server/app/_not-found.html"), "utf8");
  assert.match(html, /<title>ReportingDash<\/title>/);
  assert.match(html, /<meta name="description" content="Client reporting dashboards"/);
  assert.match(html, /<body class="[^"]*antialiased/);
  const css = readdirSync(path.join(build, "static/css")).filter(name => name.endsWith(".css"))
    .map(name => readFileSync(path.join(build, "static/css", name), "utf8")).join("\n");
  assert.match(css, /--font-inter:/);
  assert.match(css, /--font-mono:/);
  assert.match(css, /font-family:Inter/);
  assert.match(css, /font-family:["']?JetBrains/);
  const manifest = JSON.parse(readFileSync(path.join(build, "server/next-font-manifest.json"), "utf8"));
  assert.ok(Object.values(manifest.app).some(files => Array.isArray(files) && files.some(file => /\.woff2$/.test(file))));
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("isolated layout stays at the production baseline and CSS scans only its shared Abbott UI", () => {
  const layout = execFileSync("git", ["show", "8f389a28df1c4b741ec33b7538f0354b74f5a40e:src/app/layout.tsx"], { encoding: "utf8" });
  const isolatedLayout=layout.replace('  description: "Client reporting dashboards",','  description: "Client reporting dashboards",\n  icons: { icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzAwNzJjNiIvPjxjaXJjbGUgY3g9IjE2IiBjeT0iMTYiIHI9IjYiIGZpbGw9IndoaXRlIi8+PC9zdmc+" },');
  assert.equal(readFileSync(new URL("./layout.tsx", import.meta.url), "utf8"), isolatedLayout);
  const baselineCss = execFileSync("git", ["show", "8f389a28df1c4b741ec33b7538f0354b74f5a40e:src/app/globals.css"], { encoding: "utf8" });
  const sources = [
    '@source "../../../../src/components/AbbottBiDashboard.tsx";',
    '@source "../../../../src/components/DashboardAccessGate.tsx";',
    '@source "../../../../src/components/abbott/AbbottAdminUsersPanel.tsx";',
    '@source "../../../../src/components/abbott/AbbottDatePicker.tsx";',
  ].join("\n");
  assert.equal(readFileSync(new URL("./globals.css", import.meta.url), "utf8"), baselineCss.replace('@import "tailwindcss";', `@import "tailwindcss";\n${sources}`));
});

test("isolated compiled CSS contains shared Abbott grid and responsive utilities", () => {
  const directory = new URL("../../.next-abbott/static/css/", import.meta.url);
  const css = readdirSync(directory).filter((name) => name.endsWith(".css")).map((name) => readFileSync(new URL(name, directory), "utf8")).join("\n");
  assert.match(css, /\.grid\{display:grid\}/);
  assert.match(css, /\.xl\\:grid-cols-2/);
});

test("dynamic route validates identity before rendering and retains the requested Abbott alias", () => {
  const source = readFileSync(new URL("./dashboard/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /normalizeAbbottIdentifier\(id\)/);
  assert.match(source, /if \(!normalizeAbbottIdentifier\(id\)\) notFound\(\)/);
  assert.match(source, /dashboardId=\{dashboardId\}/);
  assert.doesNotMatch(source, /@\/app\/dashboard/);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const componentPath = path.join(root, "apps/zaruku/src/components/ZarukuDashboardPage.tsx");
const routePath = path.join(root, "apps/zaruku/src/app/dashboard/zaruku/page.tsx");
const combinedPath = path.join(root, "src/app/dashboard/[id]/page.tsx");

function sourceAt(filename: string) {
  assert.ok(existsSync(filename), `Missing extracted Zaruku file: ${path.relative(root, filename)}`);
  return readFileSync(filename, "utf8");
}

function functionSource(source: string, name: string) {
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result: ts.Node | undefined;
  function visit(node: ts.Node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(ast) === name) {
      result = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, `Missing ${name}`);
  return result.getText(ast);
}

function normalizeSlug(source: string) {
  return source.replaceAll("${dashboardId}", "zaruku").replaceAll("${id}", "zaruku");
}

test("the extracted page keeps the Zaruku endpoints, date helpers, and shared UI contracts", () => {
  const source = sourceAt(componentPath);
  for (const contract of [
    "/api/dashboard/zaruku", "/api/dashboard/zaruku/pdf", "/api/dashboard/zaruku/excel",
    "ZarukuSeoDashboard", "clampZarukuDateRange", "latestZarukuReportingDate", "DashboardAccessGate",
  ]) assert.ok(source.includes(contract), `Missing contract: ${contract}`);
  assert.match(source, /export default function ZarukuDashboardPage\(/);
  assert.match(source, /const dashboardId = "zaruku"/);
  assert.doesNotMatch(source, /useParams/);
});

test("the isolated route directly exports the page and the combined adapter dispatches before legacy hooks", () => {
  assert.match(sourceAt(routePath), /export \{ default \} from "\.\.\/\.\.\/\.\.\/components\/ZarukuDashboardPage"/);
  assert.match(sourceAt(routePath), /export const dynamic = "force-dynamic"/, "Keep request-time query rendering from the combined dynamic route");
  assert.match(sourceAt(path.join(root, "apps/zaruku/src/compat/combined.ts")), /ZarukuDashboardPage/);
  const combined = sourceAt(combinedPath);
  const dispatcher = functionSource(combined, "DashboardByIdPage");
  assert.match(dispatcher, /String\(params\.id\)\.toLowerCase\(\)/);
  assert.match(dispatcher, /dashboardId === "zaruku"[\s\S]*<ZarukuDashboardPage[\s\S]*<CombinedDashboardByIdPage/);
  assert.doesNotMatch(dispatcher, /useEffect|useState/);
  assert.match(dispatcher, /unsupportedDashboardFallback=\{<CombinedDashboardByIdPage \/>\}/);
  const legacy = functionSource(combined, "CombinedDashboardByIdPage");
  const body = legacy.slice(legacy.indexOf("() ") + 3) + "\n";
  assert.equal(createHash("sha256").update(body).digest("hex"),
    "a78bfb341fa9b0453e1bd83d5edd93ef37afa8d30f3787f55c40e1bcdbfb1a31",
    "The existing Abbott, advertising, and numeric/type-driven compatibility behavior must stay unchanged");
});

test("the direct Next route has no compatibility-only PageProps", () => {
  const source = sourceAt(componentPath);
  const page = functionSource(source, "ZarukuDashboardPage");
  assert.match(page, /ZarukuDashboardPage\(\)/);
  assert.match(page, /return <ZarukuDashboardPageContent \/>/);
  assert.doesNotMatch(page, /unsupportedDashboardFallback/);
  assert.match(sourceAt(path.join(root, "apps/zaruku/src/compat/combined.ts")),
    /ZarukuDashboardPageContent as ZarukuDashboardPage/);
});

test("the malformed-payload render path uses technical-unavailable UI and selects a combined fallback once", () => {
  const source = sourceAt(componentPath);
  const unavailable = functionSource(source, "DashboardPayloadUnavailable");
  const compiled = ts.transpileModule(`${unavailable}\nmodule.exports = DashboardPayloadUnavailable;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const renderExports: Record<string, unknown> = {};
  const renderModule = { exports: renderExports as unknown };
  runInNewContext(compiled, {
    module: renderModule,
    exports: renderExports,
    require: createRequire(import.meta.url),
    TECH_ISSUES_MESSAGE: "Извините тех проблемы. мы скоро вернем все на место!",
  });
  const render = renderModule.exports as (props: { fallback?: ReturnType<typeof createElement> }) => ReturnType<typeof createElement>;
  const isolated = renderToStaticMarkup(createElement(render, {}));
  assert.match(isolated, /data-dashboard-ready="false"/);
  assert.match(isolated, /Извините тех проблемы\. мы скоро вернем все на место!/);
  let fallbackRenders = 0;
  function LegacyFallback() {
    fallbackRenders += 1;
    return createElement("p", null, "Legacy fallback");
  }
  assert.equal(renderToStaticMarkup(createElement(render, { fallback: createElement(LegacyFallback) })), "<p>Legacy fallback</p>");
  assert.equal(fallbackRenders, 1);
});

test("200 malformed payloads are classified before the page can dereference their dashboard fields", async () => {
  const source = sourceAt(componentPath);
  const isRecord = functionSource(source, "isRecord");
  const isZarukuDashboardPayload = functionSource(source, "isZarukuDashboardPayload");
  const getDashboardData = functionSource(source, "getDashboardData");
  const compiled = ts.transpileModule(`${isRecord}\n${isZarukuDashboardPayload}\n${getDashboardData}\nmodule.exports = getDashboardData;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;

  for (const payload of [
    null,
    {},
    { dashboard: { type: "awareness" } },
    { dashboard: { type: "zaruku_bi", language: "ru" }, zaruku_seo: {} },
    { dashboard: { type: "zaruku_bi", period: { from: "2026-01-01", to: "2026-01-31" } }, zaruku_seo: {} },
  ]) {
    const fetchCalls: string[] = [];
    const loadModule = { exports: undefined as unknown };
    runInNewContext(compiled, {
      console: { warn() {} },
      fetch: async (url: string) => {
        fetchCalls.push(url);
        return { status: 200, ok: true, json: async () => payload };
      },
      URLSearchParams,
      module: loadModule,
      exports: loadModule.exports,
    });
    const load = loadModule.exports as (id: string) => Promise<{
      data: unknown;
      errorMessage: string | null;
      unsupportedPayload?: boolean;
    }>;
    const result = await load("zaruku");
    assert.deepEqual(fetchCalls, ["/api/dashboard/zaruku"]);
    assert.equal(result.data, null);
    assert.equal(result.errorMessage, "Unexpected dashboard payload");
    assert.equal(result.unsupportedPayload, true);
  }
});

test("an unsupported successful payload selects the combined fallback before generic API-error rendering", () => {
  const source = sourceAt(componentPath);
  const selectRenderState = functionSource(source, "selectDashboardRenderState");
  const compiled = ts.transpileModule(`${selectRenderState}\nmodule.exports = selectDashboardRenderState;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: undefined as unknown };
  runInNewContext(compiled, { module, exports: module.exports });
  const select = module.exports as (state: Record<string, unknown>) => string;
  assert.equal(select({
    isLoading: false,
    authRequired: false,
    authMeta: null,
    notFound: false,
    dashboard: null,
    apiError: "Извините тех проблемы. мы скоро вернем все на место!",
    unsupportedPayload: true,
  }), "unsupported");
});

test("the extraction preserves fetch statuses, query encoding, date calculations, and export parameters verbatim", () => {
  const extracted = sourceAt(componentPath);
  const combined = sourceAt(combinedPath);
  for (const name of [
    "formatPeriodDate", "shiftDate", "isoToday", "startOfCurrentMonth",
    "startOfCurrentWeek", "buildQuickRange", "detectQuickRangePreset", "exportPdf", "exportExcel",
    "applyImmediateDateRange", "applyDateRange", "handleQuickRangePresetChange",
    "handleDraftDateFromChange", "handleDraftDateToChange",
  ]) {
    assert.equal(normalizeSlug(functionSource(extracted, name)), normalizeSlug(functionSource(combined, name)), name);
  }
});

test("the extraction retains query defaults, auth reloads, cancellation, and tab-owned date controls", () => {
  const source = sourceAt(componentPath);
  for (const name of ["from", "to", "compare_from", "compare_to", "access_token", "embed_key", "brand"]) {
    assert.ok(source.includes(`searchParams.get("${name}") ?? ""`), `${name} default must stay empty`);
  }
  assert.match(source, /searchParams\.get\("pdf"\) === "true"/);
  assert.match(source, /searchParams\.get\("mobile"\) === "1"/);
  assert.match(source, /useState<ZarukuTabId>\("overview"\)/);
  assert.match(source, /useState\(initialAccessToken\)/);
  assert.match(source, /useState\(initialEmbedKey\)/);
  assert.match(source, /useState\(0\)/);
  assert.match(source, /let cancelled = false[\s\S]*if \(cancelled\)[\s\S]*cancelled = true/);
  assert.match(source, /\[dashboardId, initialFrom, initialTo, isZarukuDashboard, queryFrom, queryTo, router, searchParams\]/);
  assert.match(source, /\[compareRange, dashboardId, dateRange, reloadKey, router, searchParams, selectedBrandId, viewerAccessToken, viewerEmbedKey\]/);
  assert.match(source, /setViewerAccessToken\(accessToken\)[\s\S]*params\.set\("access_token", accessToken\)[\s\S]*setReloadKey\(\(value\) => value \+ 1\)/);
  assert.match(source, /zarukuTimeOwner\(zarukuActiveTab\)/);
  assert.match(source, /dateControlsMode=\{zarukuDateControlsMode\}[\s\S]*showIdentity=\{false\}[\s\S]*maxDate=\{zarukuMaxDate\}/);
  assert.match(source, /<ZarukuSeoDashboard data=\{zarukuSeoData\} locale=\{locale\} onActiveTabChange=\{setZarukuActiveTab\} \/>/);
  const header = source.slice(source.lastIndexOf("<DashboardHeader"), source.lastIndexOf("<ZarukuSeoDashboard"));
  assert.doesNotMatch(header, /onExportPdf=|onExportExcel=|onToggleCompare=/, "Do not expose previously hidden export or comparison controls");
});

test("the isolated page's emitted dependency trace excludes Abbott and advertising UI", async () => {
  sourceAt(componentPath);
  sourceAt(routePath);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [routePath],
    tsconfig: "apps/zaruku/tsconfig.json",
    bundle: true,
    write: false,
    metafile: true,
    packages: "external",
    platform: "browser",
    format: "esm",
    logLevel: "silent",
  });
  const dependencies = Object.keys(result.metafile!.inputs).sort();
  assert.ok(dependencies.includes("src/components/ZarukuSeoDashboard.tsx"));
  assert.ok(dependencies.includes("src/components/DashboardAccessGate.tsx"));
  assert.doesNotMatch(dependencies.join("\n"), /Abbott|abbott-date|KPICard|CampaignPerformanceTable|Multibrand|src\/app\/dashboard\/\[id\]/);
});

test("Zaruku-only date helpers retain the shared import path's reporting cutoff and clamping", async () => {
  sourceAt(path.join(root, "src/lib/zaruku-date-range.ts"));
  const isolated = await import("../../../../src/lib/zaruku-date-range");
  const shared = await import("../../../../src/lib/dashboard-date-range");
  assert.equal(shared.clampZarukuDateRange, isolated.clampZarukuDateRange);
  assert.equal(shared.latestZarukuReportingDate, isolated.latestZarukuReportingDate);
  for (const [timestamp, latest] of [
    ["2026-09-01T00:00:00Z", "2026-08-30"],
    ["2024-03-01T23:59:59Z", "2024-02-28"],
    ["2026-01-01T00:00:00Z", "2025-12-30"],
  ]) {
    const now = new Date(timestamp);
    assert.equal(isolated.latestZarukuReportingDate(now), latest);
    for (const range of [
      { from: "", to: "" },
      { from: "2020-01-01", to: "2020-01-31" },
      { from: "2020-01-01", to: "2099-12-31" },
      { from: "2099-12-30", to: "2099-12-31" },
    ]) {
      assert.deepEqual(isolated.clampZarukuDateRange(range, now), {
        from: range.from > latest ? latest : range.from,
        to: range.to > latest ? latest : range.to,
      });
      assert.deepEqual(shared.clampZarukuDateRange(range, now), isolated.clampZarukuDateRange(range, now));
    }
  }
});

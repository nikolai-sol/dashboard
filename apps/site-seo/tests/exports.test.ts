import assert from "node:assert/strict";
import test from "node:test";
import type { DatasetMeta, Period } from "@reportingdash/site-seo-contract";
import * as XLSX from "xlsx";
import { buildDashboardExportRows, buildExportRows, buildGscExportRows, toCsv } from "../src/lib/exports.ts";
import { createExcelExportHandler, createPdfExportHandler } from "../src/lib/route-handlers.ts";
import { createPeriodSelection } from "../src/lib/period-selection.ts";

const period: Period = { kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" };
const selection = createPeriodSelection({ primaryWeek: "2026-W01", aliceMonth: "2026-01", gsc: period }, "Europe/Moscow");
const readRequest = { slug: "medroche", selection, publicationId: "publication-7", filters: { country: "RU" } } as const;
const meta: DatasetMeta = { sourceKey: "google_search_console", period: null, state: "missing", collectionMode: "manual", completeness: "unknown", importId: null, exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none" };

test("exports actual period and the missing-data limitation instead of a zero result", () => {
  const csv = toCsv(buildExportRows({ period, source: meta, title: "Поиск Google" }));
  assert.match(csv, /2025-12-29/);
  assert.match(csv, /Нужна выгрузка/);
  assert.doesNotMatch(csv, /0,00/);
});

test("exports canonical GSC summary, daily facts, and exact dimension rows", () => {
  const rows = buildGscExportRows({ period, source: { ...meta, state: "ready", period }, summary: { clicks: 7, impressions: 100, ctrPct: 7, averagePosition: 3 }, daily: [{ date: "2026-01-02", metrics: { clicks: 2, impressions: 10, ctrPct: 20, averagePosition: 2 } }], dimensions: [{ dimension: "query", value: "онкология", metrics: { clicks: 2, impressions: 10, ctrPct: 20, averagePosition: 2 } }] });
  assert.match(toCsv(rows), /онкология/);
  assert.match(toCsv(rows), /2026-01-02/);
  assert.match(toCsv(rows), /Итоговые клики/);
});

test("omits GSC rows from an export when GSC is disabled in the profile", () => {
  const rows = buildDashboardExportRows({ profile: { sources: [{ sourceKey: "google_search_console", mode: "disabled", bindingId: null, importCadence: [] }, { sourceKey: "yandex_webmaster", mode: "automated", bindingId: "webmaster", importCadence: [] }] } as never, selection, model: { gsc: { meta, summary: { clicks: 999, impressions: 999, ctrPct: 99, averagePosition: 1 }, daily: [], dimensions: [], dimensionMeta: {} }, datasets: { yandex_webmaster: { ...meta, sourceKey: "yandex_webmaster", state: "ready" } } } });
  assert.doesNotMatch(toCsv(rows), /Google Search Console|999/);
  assert.match(toCsv(rows), /yandex_webmaster/);
});

test("exports the same canonical Metrika and Webmaster facts shown by the dashboard", () => {
  const rows = buildDashboardExportRows({
    profile: { sources: [
      { sourceKey: "google_search_console", mode: "disabled", bindingId: null, importCadence: [] },
      { sourceKey: "yandex_metrika", mode: "automated", bindingId: "metrika", importCadence: [] },
      { sourceKey: "yandex_webmaster", mode: "automated", bindingId: "webmaster", importCadence: [] },
    ] } as never,
    selection,
    model: {
      gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} },
      datasets: {
        yandex_metrika: { ...meta, sourceKey: "yandex_metrika", state: "ready", period },
        yandex_webmaster: { ...meta, sourceKey: "yandex_webmaster", state: "partial", period },
      },
      metrika: { ...meta, sourceKey: "yandex_metrika", state: "ready", period, kind: "metrika", summary: { visits: 20, pageviews: 30 }, daily: [{ date: "2026-01-02", visits: 4, pageviews: 6, users: 3 }], topPages: [{ page: "/a", visits: 4, pageviews: 6 }] },
      webmaster: { ...meta, sourceKey: "yandex_webmaster", state: "partial", period, kind: "webmaster", summary: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 }, daily: [{ date: "2026-01-02", metrics: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 } }], topPages: [{ page: "/a", metrics: { clicks: 5, impressions: 50, ctrPct: 10, averagePosition: 3 } }] },
    },
  });
  const csv = toCsv(rows);
  assert.match(csv, /Визиты Metrika.*20/);
  assert.match(csv, /Показы Webmaster.*50/);
  assert.match(csv, /Пользователи за день 2026-01-02.*3/);
  assert.doesNotMatch(csv, /Пользователи за период/);
});

test("exports selected traffic comparison period and its canonical metrics", () => {
  const comparison = createPeriodSelection({ primaryWeek: "2026-W01", comparisonWeek: "2025-W52", aliceMonth: "2026-01", gsc: period }, "Europe/Moscow");
  const rows = buildDashboardExportRows({
    profile: { sources: [{ sourceKey: "yandex_metrika", mode: "automated", bindingId: "metrika", importCadence: [] }] } as never,
    selection: comparison,
    model: {
      gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} },
      datasets: { yandex_metrika: { ...meta, sourceKey: "yandex_metrika", state: "ready", period } },
      metrika: null,
      webmaster: null,
      trafficComparison: {
        yandex_metrika: { ...meta, sourceKey: "yandex_metrika", state: "ready", period: comparison.traffic.comparison!, kind: "metrika", summary: { visits: 98765, pageviews: 123456 }, daily: [], topPages: [] },
      },
    },
  } as never);
  const csv = toCsv(rows);
  assert.match(csv, /Сравнение.*2025-W52/);
  assert.match(csv, /98765/);
});

test("exports actual Wordstat snapshot windows, Alice query sources, and published SEO OS evidence", () => {
  const rows = buildDashboardExportRows({
    profile: { sources: [
      { sourceKey: "yandex_wordstat", mode: "automated", bindingId: "wordstat", importCadence: [] },
      { sourceKey: "yandex_webmaster_alice_manual", mode: "manual", bindingId: "alice", importCadence: [] },
      { sourceKey: "seo_os", mode: "automated", bindingId: "seo-os", importCadence: [] },
    ] } as never,
    selection,
    model: {
      gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} },
      datasets: {},
      wordstat: {
        ...meta, sourceKey: "yandex_wordstat", period: selection.traffic.primary, snapshotPeriod: { kind: "custom", key: "rolling:2026-07-27:2026-08-25", from: "2026-07-27", to: "2026-08-25", sourceTimezone: "Europe/Moscow" }, state: "partial", completeness: "unknown", kind: "wordstat", demand: 35,
        queries: [{ query: "лечение", kind: "popular", count: 100, window: { from: "2026-07-27", to: "2026-08-25", snapshotDate: "2026-08-25", registryVersion: "registry-2", importId: "run-2" } }],
      },
      alice: {
        ...meta, sourceKey: "yandex_webmaster_alice_manual", period: selection.alice, state: "ready", completeness: "complete", kind: "alice", officialSovPct: 43.91, samplePresencePct: 43.87, competitors: [], sources: ["one.test"],
        queries: [{ query: "лечение", portalPresent: true, portalPosition: 2, portalUrl: "https://portal.test/a", sources: [{ rank: 1, domain: "one.test", url: "https://one.test/a" }] }],
      },
      seoOs: {
        ...meta, sourceKey: "seo_os", period, state: "partial", completeness: "unknown", kind: "seo_os", rows: [],
        recommendations: [{ kind: "topic_opportunity", topic: "Онкология", pageUrl: "https://example.test/oncology", action: "Добавить раздел", sourceIds: ["opp-1"], sourcePeriods: ["2026-W01"], ruleVersion: "v3", publicationStatus: "published" }],
        tasks: [{ id: "task-1", status: "open" }],
      },
    },
  } as never);
  const csv = toCsv(rows);
  assert.match(csv, /Период от.*2025-12-29/);
  assert.match(csv, /Спрос Wordstat.*35/);
  assert.match(csv, /Окно snapshot Wordstat.*2026-07-27.*2026-08-25/);
  assert.match(csv, /snapshot 2026-08-25/);
  assert.match(csv, /Официальный SOV Алиса.*43\.91/);
  assert.match(csv, /Sample presence Алиса.*43\.87/);
  assert.match(csv, /Запрос Алиса: лечение.*1\. one\.test/);
  assert.match(csv, /Рекомендация SEO OS: Онкология.*Добавить раздел.*rule: v3/);
  assert.match(csv, /Задача SEO OS task-1.*open/);
});

test("refuses an export session from another dashboard before any canonical read", async () => {
  let calls = 0;
  const response = await createExcelExportHandler({
    registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche" } as never, bindings: [] },
    credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 99, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => { calls += 1; throw new Error("must not read"); },
  })(readRequest);
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("creates an Excel workbook from the same scoped read model", async () => {
  const response = await createExcelExportHandler({
    registration: { profile: { clientId: "client-med", dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc", importCadence: [] }] } as never, bindings: [{ bindingId: "gsc", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account", resourceId: "resource" }] },
    credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => ({ meta: { ...meta, state: "complete_empty", period }, summary: null, daily: [], dimensions: [], indexing: meta }),
  })(readRequest);
  assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
  assert.deepEqual(workbook.SheetNames, ["SEO"]);
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.SEO!);
  assert.ok(rows.length > 0);
  assert.ok(rows.some((row) => row.field === "Период от" && row.value === "2025-12-29"));
  assert.ok(rows.some((row) => row.field === "Источник" && row.value === "google_search_console"));
});

test("renders a real PDF only after the same site-scoped authorization and read", async () => {
  let closed = false;
  let setContentWaitUntil: string | null = null;
  let launchedExecutablePath: string | null = null;
  const response = await createPdfExportHandler({
    registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc", importCadence: [] }] } as never, bindings: [{ bindingId: "gsc", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account", resourceId: "resource" }] },
    credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => ({ meta: { ...meta, state: "complete_empty", period }, summary: null, daily: [], dimensions: [], indexing: meta }),
  }, { executablePath: "/opt/chromium/chrome", launch: async (options) => { launchedExecutablePath = options.executablePath ?? null; return { newPage: async () => ({ setViewport: async () => {}, emulateMediaType: async () => {}, setContent: async (_html, pageOptions) => { setContentWaitUntil = pageOptions.waitUntil; }, pdf: async () => new Uint8Array([37, 80, 68, 70]) }), close: async () => { closed = true; } }; } })(readRequest);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [37, 80, 68, 70]);
  assert.equal(closed, true);
  assert.equal(setContentWaitUntil, "load");
  assert.equal(launchedExecutablePath, "/opt/chromium/chrome");
});

test("returns 401 for a stale PDF session before the canonical read or browser launch", async () => {
  let reads = 0;
  let launches = 0;
  const response = await createPdfExportHandler({
    registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche" } as never, bindings: [] },
    credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 0, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => { reads += 1; throw new Error("must not read"); },
  }, { launch: async () => { launches += 1; throw new Error("must not launch"); } })(readRequest);
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
  assert.equal(launches, 0);
});

test("reports an authorized Excel read failure as unavailable", async () => {
  const response = await createExcelExportHandler({
    registration: { profile: { clientId: "client-med", dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc", importCadence: [] }] } as never, bindings: [{ bindingId: "gsc", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account", resourceId: "resource" }] },
    credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => { throw new Error("database unavailable"); },
  })(readRequest);
  assert.equal(response.status, 503);
});

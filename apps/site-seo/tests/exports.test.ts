import assert from "node:assert/strict";
import test from "node:test";
import type { DatasetMeta, Period } from "@reportingdash/site-seo-contract";
import { buildExportRows, toCsv } from "../src/lib/exports.ts";
import { createExcelExportHandler } from "../src/app/api/dashboard/[siteSlug]/excel/route.ts";
import { createPdfExportHandler } from "../src/app/api/dashboard/[siteSlug]/pdf/route.ts";

const period: Period = { kind: "iso_week", key: "2026-W01", from: "2025-12-29", to: "2026-01-04", sourceTimezone: "Europe/Moscow" };
const meta: DatasetMeta = { sourceKey: "google_search_console", period: null, state: "missing", collectionMode: "manual", completeness: "unknown", importId: null, exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none" };

test("exports actual period and the missing-data limitation instead of a zero result", () => {
  const csv = toCsv(buildExportRows({ period, source: meta, title: "Поиск Google" }));
  assert.match(csv, /2025-12-29/);
  assert.match(csv, /Нужна выгрузка/);
  assert.doesNotMatch(csv, /0,00/);
});

test("refuses an export session from another dashboard before any canonical read", async () => {
  let calls = 0;
  const response = await createExcelExportHandler({
    registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche" } as never, bindings: [] },
    credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 99, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => { calls += 1; throw new Error("must not read"); },
  })({ slug: "medroche", period });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("creates an Excel workbook from the same scoped read model", async () => {
  const response = await createExcelExportHandler({
    registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc", importCadence: [] }] } as never, bindings: [{ bindingId: "gsc", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account", resourceId: "resource" }] },
    credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => ({ meta: { ...meta, state: "complete_empty", period }, summary: null, daily: [], dimensions: [], indexing: meta }),
  })({ slug: "medroche", period });
  assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).slice(0, 2)], [80, 75]);
});

test("renders a real PDF only after the same site-scoped authorization and read", async () => {
  let closed = false;
  const response = await createPdfExportHandler({
    registration: { profile: { dashboardId: 42, siteId: "site-med", slug: "medroche", sources: [{ sourceKey: "google_search_console", mode: "manual", bindingId: "gsc", importCadence: [] }] } as never, bindings: [{ bindingId: "gsc", clientId: "client-med", siteId: "site-med", dashboardId: 42, sourceKey: "google_search_console", analyticsAccountId: "account", resourceId: "resource" }] },
    credentialVersion: 1,
    getSession: async () => ({ audience: "viewer", family: "site_seo", dashboardId: 42, siteId: "site-med", credentialVersion: 1, expiresAt: "2026-10-01T00:00:00Z" }),
    execute: async () => ({ meta: { ...meta, state: "complete_empty", period }, summary: null, daily: [], dimensions: [], indexing: meta }),
  }, { launch: async () => ({ newPage: async () => ({ setViewport: async () => {}, emulateMediaType: async () => {}, setContent: async () => {}, pdf: async () => new Uint8Array([37, 80, 68, 70]) }), close: async () => { closed = true; } }) })({ slug: "medroche", period });
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [37, 80, 68, 70]);
  assert.equal(closed, true);
});

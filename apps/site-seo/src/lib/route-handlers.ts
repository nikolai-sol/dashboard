import puppeteer from "puppeteer";
import * as XLSX from "xlsx";
import type { SiteRegistration } from "@reportingdash/site-seo-contract";
import { assertAuthorizedSiteSession, type SiteSeoSession } from "./auth.ts";
import type { CanonicalReadExecutor } from "./db.ts";
import { buildDashboardExportRows } from "./exports.ts";
import { loadDashboardReadModel } from "./read-model.ts";
import type { PeriodSelection } from "./period-selection.ts";

export type DashboardJsonDependencies = Readonly<{
  registration: SiteRegistration;
  credentialVersion: number;
  getSession: () => Promise<SiteSeoSession | null>;
  execute: CanonicalReadExecutor;
}>;

export type DashboardReadRequest = Readonly<{
  slug: string;
  selection: PeriodSelection;
  publicationId: string | null;
  filters: Readonly<Record<string, string>>;
}>;

const PRIVATE_JSON = { headers: { "cache-control": "private, no-store" } } as const;

function authorize(deps: DashboardJsonDependencies) {
  return deps.getSession().then((session) => assertAuthorizedSiteSession(session, {
    dashboardId: deps.registration.profile.dashboardId,
    siteId: deps.registration.profile.siteId,
    credentialVersion: deps.credentialVersion,
  }));
}

export function createDashboardJsonHandler(deps: DashboardJsonDependencies) {
  return async (request: DashboardReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404, ...PRIVATE_JSON });
    let session: SiteSeoSession;
    try { session = await authorize(deps); }
    catch { return Response.json({ error: "unauthorized" }, { status: 401, ...PRIVATE_JSON }); }
    try {
      return Response.json(
        await loadDashboardReadModel({ registration: deps.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: deps.execute }),
        { headers: { "cache-control": "private, no-store" } },
      );
    } catch {
      return Response.json({ error: "canonical_read_unavailable" }, { status: 503, ...PRIVATE_JSON });
    }
  };
}

export function createExcelExportHandler(deps: DashboardJsonDependencies) {
  return async (request: DashboardReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404, ...PRIVATE_JSON });
    let session: SiteSeoSession;
    try { session = await authorize(deps); }
    catch { return Response.json({ error: "unauthorized" }, { status: 401, ...PRIVATE_JSON }); }
    try {
      const model = await loadDashboardReadModel({ registration: deps.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: deps.execute });
      const sheet = XLSX.utils.json_to_sheet(buildDashboardExportRows({ profile: deps.registration.profile, selection: request.selection, model }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "SEO");
      return new Response(XLSX.write(workbook, { type: "array", bookType: "xlsx" }), { headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": "attachment; filename=site-seo-export.xlsx",
        "cache-control": "private, no-store",
      } });
    } catch {
      return Response.json({ error: "canonical_read_unavailable" }, { status: 503, ...PRIVATE_JSON });
    }
  };
}

type PdfPage = Readonly<{
  setViewport: (options: { width: number; height: number; deviceScaleFactor: number }) => Promise<void>;
  emulateMediaType: (type: "print") => Promise<void>;
  setContent: (html: string, options: { waitUntil: "load" }) => Promise<void>;
  pdf: (options: { format: "A4"; landscape: true; printBackground: true; margin: Record<"top" | "right" | "bottom" | "left", string> }) => Promise<Uint8Array>;
}>;
type PdfBrowser = Readonly<{ newPage: () => Promise<PdfPage>; close: () => Promise<void> }>;
export type PdfLaunch = (options: { headless: true; args: string[] }) => Promise<PdfBrowser>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function printableHtml(rows: ReturnType<typeof buildDashboardExportRows>): string {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>SEO export</title><body><table>${rows.map((row) => `<tr><th>${escapeHtml(row.field)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")}</table></body></html>`;
}

export function createPdfExportHandler(deps: DashboardJsonDependencies, options: Readonly<{ launch?: PdfLaunch }> = {}) {
  const launch = options.launch ?? (puppeteer.launch.bind(puppeteer) as unknown as PdfLaunch);
  return async (request: DashboardReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404, ...PRIVATE_JSON });
    let session: SiteSeoSession;
    try { session = await authorize(deps); }
    catch { return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "private, no-store" } }); }
    let browser: PdfBrowser | null = null;
    try {
      const model = await loadDashboardReadModel({ registration: deps.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: deps.execute });
      browser = await launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await page.emulateMediaType("print");
      await page.setContent(printableHtml(buildDashboardExportRows({ profile: deps.registration.profile, selection: request.selection, model })), { waitUntil: "load" });
      const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "18mm", right: "12mm", bottom: "18mm", left: "12mm" } });
      return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=site-seo-export.pdf", "cache-control": "private, no-store" } });
    } catch {
      return Response.json({ error: "pdf_generation_failed" }, { status: 500, headers: { "cache-control": "private, no-store" } });
    } finally {
      if (browser) await browser.close();
    }
  };
}

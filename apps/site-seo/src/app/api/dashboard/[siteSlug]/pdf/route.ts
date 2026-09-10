import puppeteer from "puppeteer";
import { assertAuthorizedSiteSession } from "../../../../../lib/auth.ts";
import { buildExportRows } from "../../../../../lib/exports.ts";
import { loadDashboardReadModel } from "../../../../../lib/read-model.ts";
import type { DashboardJsonDependencies, DashboardReadRequest } from "../route.ts";

type PdfPage = Readonly<{
  setViewport: (options: { width: number; height: number; deviceScaleFactor: number }) => Promise<void>;
  emulateMediaType: (type: "print") => Promise<void>;
  setContent: (html: string, options: { waitUntil: "networkidle0" }) => Promise<void>;
  pdf: (options: { format: "A4"; landscape: true; printBackground: true; margin: Record<"top" | "right" | "bottom" | "left", string> }) => Promise<Uint8Array>;
}>;
type PdfBrowser = Readonly<{ newPage: () => Promise<PdfPage>; close: () => Promise<void> }>;
export type PdfLaunch = (options: { headless: true; args: string[] }) => Promise<PdfBrowser>;

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function printableHtml(rows: ReturnType<typeof buildExportRows>): string { return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>SEO export</title><body><table>${rows.map((row) => `<tr><th>${escapeHtml(row.field)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")}</table></body></html>`; }

export function createPdfExportHandler(deps: DashboardJsonDependencies, options: Readonly<{ launch?: PdfLaunch }> = {}) {
  const launch = options.launch ?? (puppeteer.launch.bind(puppeteer) as unknown as PdfLaunch);
  return async (request: DashboardReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404 });
    let session;
    try {
      session = assertAuthorizedSiteSession(await deps.getSession(), { dashboardId: deps.registration.profile.dashboardId, siteId: deps.registration.profile.siteId, credentialVersion: deps.credentialVersion });
    } catch {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "private, no-store" } });
    }
    let browser: PdfBrowser | null = null;
    try {
      const model = await loadDashboardReadModel({ registration: deps.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: deps.execute });
      browser = await launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await page.emulateMediaType("print");
      await page.setContent(printableHtml(buildExportRows({ title: "Google Search Console", period: request.selection.gsc, source: model.gsc.meta })), { waitUntil: "networkidle0" });
      const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "18mm", right: "12mm", bottom: "18mm", left: "12mm" } });
      return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=site-seo-export.pdf", "cache-control": "private, no-store" } });
    } catch {
      return Response.json({ error: "pdf_generation_failed" }, { status: 500, headers: { "cache-control": "private, no-store" } });
    } finally {
      if (browser) await browser.close();
    }
  };
}

export async function GET(): Promise<Response> { return Response.json({ error: "site_not_configured" }, { status: 503 }); }

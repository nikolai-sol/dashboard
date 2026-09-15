import puppeteer from "puppeteer";
import * as XLSX from "xlsx";
import type { SiteRegistration } from "@reportingdash/site-seo-contract";
import { assertAuthorizedSiteSession, type SiteSeoSession } from "./auth.ts";
import type { CanonicalReadExecutor } from "./db.ts";
import { buildDashboardExportRows } from "./exports.ts";
import { loadDashboardReadModel } from "./read-model.ts";
import type { PeriodSelection } from "./period-selection.ts";
import type { DashboardReadModel } from "./read-model.ts";

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

export type IntentQueryOptions = Readonly<{
  category: "target" | "other";
  page: number;
  pageSize: number;
  format: "json" | "csv" | "xlsx";
  expectedPublicationId: string | null;
}>;

export type IntentQueryReadRequest = DashboardReadRequest & Readonly<{ intent: IntentQueryOptions }>;

function boundedPositiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error("invalid positive integer");
  return Math.min(maximum, Math.max(1, Number(value)));
}

export function parseIntentQueryOptions(url: URL): IntentQueryOptions {
  const category = url.searchParams.get("intent_category");
  if (category !== "target" && category !== "other") throw new Error("invalid intent category");
  const format = url.searchParams.get("intent_format") ?? "json";
  if (format !== "json" && format !== "csv" && format !== "xlsx") throw new Error("invalid intent format");
  const expectedPublicationId = url.searchParams.get("intent_publication");
  if (expectedPublicationId !== null && (expectedPublicationId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(expectedPublicationId))) throw new Error("invalid intent publication");
  return {
    category,
    page: boundedPositiveInteger(url.searchParams.get("intent_page"), 1, 10_000),
    pageSize: boundedPositiveInteger(url.searchParams.get("intent_page_size"), 50, 100),
    format,
    expectedPublicationId,
  };
}

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

type IntentQueryHandlerOptions = Readonly<{
  loadModel?: (input: Parameters<typeof loadDashboardReadModel>[0]) => Promise<DashboardReadModel>;
}>;

function intentSourceLabel(source: "google" | "yandex"): string {
  return source === "google" ? "Google" : "Яндекс";
}

function intentMatchType(matchType: "exact" | "phrase" | null): string {
  return matchType === "exact" ? "точное" : matchType === "phrase" ? "фраза" : "";
}

function intentDownloadRows(model: DashboardReadModel, category: "target" | "other") {
  const intent = model.targetIntent;
  const base = {
    "Категория": category === "target" ? intent.target.label : intent.other.label,
    "Период с": intent.period.from,
    "Период по": intent.period.to,
    "Активная публикация": intent.provenance!.publicationId,
  };
  return intent.queries.filter((row) => row.category === category && row.impressions > 0).map((row) => ({
    ...base,
    "Запрос": row.query,
    "Источник": intentSourceLabel(row.source),
    "Показы": row.impressions,
    "Клики": row.clicks,
    ...(category === "target" ? {
      "Группа": row.group ?? "",
      "Правило": row.matchedRule ?? "",
      "Тип совпадения": intentMatchType(row.matchType),
    } : { "Статус классификации": "не найдено правило" }),
  }));
}

function csvValue(input: string | number): string {
  const raw = String(input);
  const value = typeof input === "string" && (/^[\t\r]/.test(raw) || /^\s*[=+@-]/.test(raw)) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function intentCsv(model: DashboardReadModel, category: "target" | "other"): string {
  const intent = model.targetIntent;
  const rows = intentDownloadRows(model, category);
  const headers = category === "target"
    ? ["Запрос", "Источник", "Показы", "Клики", "Группа", "Правило", "Тип совпадения"]
    : ["Запрос", "Источник", "Показы", "Клики", "Статус классификации"];
  const data = rows.map((row) => headers.map((header) => csvValue(row[header as keyof typeof row] ?? "")).join(";"));
  return [
    `Категория;${csvValue(category === "target" ? intent.target.label : intent.other.label)}`,
    `Период с;Период по`,
    `${intent.period.from};${intent.period.to}`,
    `Активная публикация;${csvValue(intent.provenance!.publicationId)}`,
    headers.join(";"),
    ...data,
  ].join("\r\n");
}

export function createIntentQueryHandler(deps: DashboardJsonDependencies, options: IntentQueryHandlerOptions = {}) {
  const loadModel = options.loadModel ?? loadDashboardReadModel;
  return async (request: IntentQueryReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404, ...PRIVATE_JSON });
    let session: SiteSeoSession;
    try { session = await authorize(deps); }
    catch { return Response.json({ error: "unauthorized" }, { status: 401, ...PRIVATE_JSON }); }
    try {
      const model = await loadModel({ registration: deps.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: deps.execute });
      const intent = model.targetIntent;
      if (intent.state !== "ready" || !intent.provenance) return Response.json({ error: "intent_classification_unavailable" }, { status: 503, ...PRIVATE_JSON });
      if (request.intent.expectedPublicationId && request.intent.expectedPublicationId !== intent.provenance.publicationId) {
        return Response.json({ error: "intent_publication_changed", activePublicationId: intent.provenance.publicationId }, { status: 409, ...PRIVATE_JSON });
      }
      const rows = intent.queries.filter((row) => row.category === request.intent.category && row.impressions > 0);
      const label = request.intent.category === "target" ? intent.target.label : intent.other.label;
      if (request.intent.format === "json") {
        const totalPages = Math.max(1, Math.ceil(rows.length / request.intent.pageSize));
        const page = Math.min(totalPages, request.intent.page);
        const start = (page - 1) * request.intent.pageSize;
        return Response.json({
          category: request.intent.category, label, period: intent.period,
          activePublicationId: intent.provenance.publicationId,
          page, pageSize: request.intent.pageSize,
          totalRows: rows.length, totalPages,
          rows: rows.slice(start, start + request.intent.pageSize),
        }, { headers: { "cache-control": "private, no-store" } });
      }
      const filename = `site-seo-intent-${request.intent.category}-${intent.period.key}`;
      if (request.intent.format === "csv") return new Response(`\uFEFF${intentCsv(model, request.intent.category)}`, { headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=${filename}.csv`,
        "cache-control": "private, no-store",
      } });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(intentDownloadRows(model, request.intent.category)), "Запросы");
      return new Response(XLSX.write(workbook, { type: "array", bookType: "xlsx" }), { headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename=${filename}.xlsx`,
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
export type PdfLaunch = (options: { headless: true; args: string[]; executablePath?: string }) => Promise<PdfBrowser>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function printableHtml(rows: ReturnType<typeof buildDashboardExportRows>): string {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>SEO export</title><body><table>${rows.map((row) => `<tr><th>${escapeHtml(row.field)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")}</table></body></html>`;
}

export function createPdfExportHandler(deps: DashboardJsonDependencies, options: Readonly<{ launch?: PdfLaunch; executablePath?: string }> = {}) {
  const launch = options.launch ?? (puppeteer.launch.bind(puppeteer) as unknown as PdfLaunch);
  const executablePath = options.executablePath ?? process.env.PUPPETEER_EXECUTABLE_PATH;
  return async (request: DashboardReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404, ...PRIVATE_JSON });
    let session: SiteSeoSession;
    try { session = await authorize(deps); }
    catch { return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "private, no-store" } }); }
    let browser: PdfBrowser | null = null;
    try {
      const model = await loadDashboardReadModel({ registration: deps.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: deps.execute });
      browser = await launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"], ...(executablePath ? { executablePath } : {}) });
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

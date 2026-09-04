import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { createViewerExportToken } from "@/lib/access-auth";
import { RUNTIME_MANIFESTS } from "@reportingdash/runtime-contract";
import { authorizeZarukuRoute, isZarukuDashboardIdentity, ZARUKU_DASHBOARD_SLUG } from "./zaruku-route-access";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS } });
}

function buildDashboardUrl(request: Request, baseUrl: string, accessToken?: string) {
  const { searchParams } = new URL(request.url);
  const url = new URL(`/dashboard/${ZARUKU_DASHBOARD_SLUG}`, baseUrl);
  url.searchParams.set("pdf", "true");
  for (const key of ["from", "to", "compare_from", "compare_to"]) {
    const value = searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }
  if (accessToken) url.searchParams.set("access_token", accessToken);
  const embedKey = searchParams.get("embed_key");
  if (embedKey) url.searchParams.set("embed_key", embedKey);
  return url.toString();
}

export function createZarukuPdfGetHandler(dependencies: {
  authorize?: typeof authorizeZarukuRoute;
  launch?: typeof puppeteer.launch;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  baseUrl?: string;
} = {}) {
  const authorize = dependencies.authorize ?? authorizeZarukuRoute;
  const launch = dependencies.launch ?? puppeteer.launch.bind(puppeteer);
  const wait = dependencies.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? (() => new Date());
  const baseUrl = dependencies.baseUrl ?? (process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${RUNTIME_MANIFESTS.zaruku.port}`);

  return async function GET(request: Request) {
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
      const access = await authorize(request, ZARUKU_DASHBOARD_SLUG);
      if (!access.context || !isZarukuDashboardIdentity(access.context)) {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      if (!access.authorized) {
        return privateJson({ error: "Authentication required" }, { status: 401 });
      }
      const accessToken = access.context.auth_mode === "public" ? undefined
        : access.credentialVersion === undefined
          ? createViewerExportToken(access.context.id, access.audience)
          : createViewerExportToken(access.context.id, access.audience, access.credentialVersion);
      const dashboardUrl = buildDashboardUrl(request, baseUrl, accessToken);
      const filenameDate = now().toISOString().slice(0, 10);

      browser = await launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await page.emulateMediaType("print");
      await page.goto(dashboardUrl, { waitUntil: "networkidle0", timeout: 30000 });
      await page.waitForSelector("[data-dashboard-ready='true']", { timeout: 30000 });
      await page.evaluate(async () => {
        if ("fonts" in document) await document.fonts.ready;
      });
      await wait(1200);
      const generatedLabel = new Intl.DateTimeFormat("ru-RU").format(now());
      const pdfBuffer = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        margin: { top: "18mm", right: "12mm", bottom: "18mm", left: "12mm" },
        displayHeaderFooter: true,
        headerTemplate: `
        <div style="font-size:9px; width:100%; text-align:right; padding:0 12mm; color:#94a3b8;">
          ReportingDash
        </div>
      `,
        footerTemplate: `
        <div style="font-size:9px; width:100%; display:flex; justify-content:space-between; padding:0 12mm; color:#94a3b8;">
          <span>Сгенерировано: ${generatedLabel}</span>
          <span>Стр. <span class="pageNumber"></span> из <span class="totalPages"></span></span>
        </div>
      `,
      });
      return new NextResponse(Buffer.from(pdfBuffer), {
        headers: {
          ...PRIVATE_RESPONSE_HEADERS,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="dashboard-${ZARUKU_DASHBOARD_SLUG}-${filenameDate}.pdf"`,
        },
      });
    } catch (error) {
      console.error("PDF generation error:", error);
      return privateJson({ error: "PDF generation failed" }, { status: 500 });
    } finally {
      if (browser) await browser.close();
    }
  };
}

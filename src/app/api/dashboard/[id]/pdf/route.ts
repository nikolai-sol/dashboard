import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { createViewerExportToken } from "@/lib/access-auth";
import { isDashboardAccessAuthorized } from "@/lib/dashboard-access";

export const dynamic = "force-dynamic";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS },
  });
}

function buildDashboardUrl(request: Request, dashboardId: string, accessToken?: string) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const compareFrom = searchParams.get("compare_from");
  const compareTo = searchParams.get("compare_to");
  const embedKey = searchParams.get("embed_key");
  const baseUrl = process.env.INTERNAL_BASE_URL || "http://127.0.0.1:3001";
  const url = new URL(`/dashboard/${dashboardId}`, baseUrl);
  url.searchParams.set("pdf", "true");
  if (from) url.searchParams.set("from", from);
  if (to) url.searchParams.set("to", to);
  if (compareFrom) url.searchParams.set("compare_from", compareFrom);
  if (compareTo) url.searchParams.set("compare_to", compareTo);
  if (accessToken) url.searchParams.set("access_token", accessToken);
  if (embedKey) url.searchParams.set("embed_key", embedKey);
  return url.toString();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const { id } = await Promise.resolve(context.params);
    const access = await isDashboardAccessAuthorized(request, id);
    if (!access.context) {
      return privateJson({ error: "Dashboard not found" }, { status: 404 });
    }
    if (!access.authorized) {
      return privateJson({ error: "Authentication required" }, { status: 401 });
    }
    const dashboardUrl = buildDashboardUrl(
      request,
      id,
      access.context.auth_mode !== "public"
        ? access.credentialVersion === undefined
          ? createViewerExportToken(access.context.id, access.audience)
          : createViewerExportToken(
              access.context.id,
              access.audience,
              access.credentialVersion,
            )
        : undefined,
    );
    const filenameDate = new Date().toISOString().slice(0, 10);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.emulateMediaType("print");
    await page.goto(dashboardUrl, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });
    await page.waitForSelector("[data-dashboard-ready='true']", { timeout: 30000 });
    await page.evaluate(async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const generatedLabel = new Intl.DateTimeFormat("ru-RU").format(new Date());
    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: {
        top: "18mm",
        right: "12mm",
        bottom: "18mm",
        left: "12mm",
      },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-size:9px; width:100%; text-align:right; padding:0 12mm; color:#94a3b8;">
          SolGoood Dashboard
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
        "Content-Disposition": `attachment; filename="dashboard-${id}-${filenameDate}.pdf"`,
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return privateJson(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

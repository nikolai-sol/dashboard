import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { PUPPETEER_REVISIONS } from "puppeteer-core/internal/revisions.js";
import { createViewerExportToken } from "../../../../src/lib/access-auth";
import { normalizeAbbottIdentifier } from "@reportingdash/runtime-contract";
import { authorizeAbbottRoute, isAbbottDashboardIdentity } from "./abbott-route-access";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS },
  });
}

export function buildAbbottDashboardUrl(
  request: Request,
  dashboardId: string,
  accessToken?: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (normalizeAbbottIdentifier(dashboardId) !== "abbott") throw new Error("Dashboard not found");
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const compareFrom = searchParams.get("compare_from");
  const compareTo = searchParams.get("compare_to");
  const embedKey = searchParams.get("embed_key");
  const baseUrl = env.ABBOTT_INTERNAL_BASE_URL || "http://127.0.0.1:3004";
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

export function createAuthorizedViewerExportToken(access: {
  context: {
    id: number;
    auth_mode: "public" | "email_password" | "password_only";
  };
  audience: "manager" | "embed";
  credentialVersion?: number;
}) {
  if (access.context.auth_mode === "public") return undefined;
  return access.credentialVersion === undefined
    ? createViewerExportToken(access.context.id, access.audience)
    : createViewerExportToken(
        access.context.id,
        access.audience,
        access.credentialVersion,
      );
}

export function createAbbottPdfHandler(overrides: Partial<{
  authorize: typeof authorizeAbbottRoute;
  launch: typeof puppeteer.launch;
  wait: (milliseconds: number) => Promise<void>;
}> = {}) {
  const authorize = overrides.authorize ?? authorizeAbbottRoute;
  const launch = overrides.launch ?? puppeteer.launch.bind(puppeteer);
  const wait = overrides.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  return async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> | { id: string } },
  ) {
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    let stage: "authorize" | "launch" | "prepare" | "navigate" | "ready" | "render" = "authorize";

    try {
      const { id } = await Promise.resolve(context.params);
      if (normalizeAbbottIdentifier(id) !== "abbott") {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      const access = await authorize(request, id);
      if (!isAbbottDashboardIdentity(access.context)) {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      if (!access.authorized) {
        return privateJson({ error: "Authentication required" }, { status: 401 });
      }
      const dashboardUrl = buildAbbottDashboardUrl(
        request,
        id,
        createAuthorizedViewerExportToken(access),
      );
      const filenameDate = new Date().toISOString().slice(0, 10);

      stage = "launch";
      browser = await launch({
        // Version is derived from the installed locked package, not ambient
        // HOME/cache or another dashboard's browser. Deploy attests this tree.
        headless: true,
        executablePath: `/var/lib/dashboard-abbott/browser-cache-chrome/chrome/linux-${PUPPETEER_REVISIONS.chrome}/chrome-linux64/chrome`,
        pipe: true,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      stage = "prepare";
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await page.emulateMediaType("print");
      stage = "navigate";
      await page.goto(dashboardUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      stage = "ready";
      await page.waitForSelector("[data-dashboard-ready='true']", { timeout: 30000 });
      await page.evaluate(async () => {
        if ("fonts" in document) {
          await document.fonts.ready;
        }
      });
      await wait(1200);

      const generatedLabel = new Intl.DateTimeFormat("ru-RU").format(new Date());
      stage = "render";
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
          "Content-Disposition": `attachment; filename="dashboard-${id}-${filenameDate}.pdf"`,
        },
      });
    } catch (error) {
      // Browser errors can contain credential-bearing URLs in message, stack,
      // cause, name, or code. Only locally defined diagnostic labels are safe.
      console.error("Abbott PDF generation failed", {
        stage,
        error_class: error instanceof Error ? "Error" : "NonError",
      });
      return privateJson(
        { error: "PDF generation failed" },
        { status: 500, headers: { "X-Abbott-PDF-Failure-Stage": stage } },
      );
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  };
}

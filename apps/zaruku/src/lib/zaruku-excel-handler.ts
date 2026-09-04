import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { loadZarukuDashboardData } from "./zaruku-dashboard-loader";
import { authorizeZarukuRoute, isZarukuDashboardIdentity, ZARUKU_DASHBOARD_SLUG } from "./zaruku-route-access";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS } });
}

function filenameSafe(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "dashboard";
}

export function createZarukuExcelGetHandler(dependencies: {
  authorize?: typeof authorizeZarukuRoute;
  load?: typeof loadZarukuDashboardData;
} = {}) {
  const authorize = dependencies.authorize ?? authorizeZarukuRoute;
  const load = dependencies.load ?? loadZarukuDashboardData;
  return async function GET(request: Request) {
    try {
      const access = await authorize(request, ZARUKU_DASHBOARD_SLUG);
      if (!access.context || !isZarukuDashboardIdentity(access.context)) return privateJson({ error: "Dashboard not found" }, { status: 404 });
      if (!access.authorized) return privateJson({ error: "Authentication required" }, { status: 401 });
      const { data } = await load(request, ZARUKU_DASHBOARD_SLUG, access.audience);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "ReportingDash";
      workbook.created = new Date();
      workbook.properties.date1904 = true;
      // Legacy Zaruku has no advertising sections, custom tables or comparison sheets.
      // Its hidden export endpoint therefore returns this workbook without worksheets.
      const buffer = await workbook.xlsx.writeBuffer();
      const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const filename = `${filenameSafe(data.dashboard.client_name)}_${data.dashboard.period.from}_${data.dashboard.period.to}.xlsx`;
      return new NextResponse(payload, { headers: {
        ...PRIVATE_RESPONSE_HEADERS,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      } });
    } catch (error) {
      if (error instanceof Error && error.message === "Dashboard not found") return privateJson({ error: "Dashboard not found" }, { status: 404 });
      console.error("Dashboard Excel export error:", error);
      return privateJson({ error: "Internal server error" }, { status: 500 });
    }
  };
}

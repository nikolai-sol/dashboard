import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { normalizeAbbottIdentifier } from "@reportingdash/runtime-contract";
import { projectAbbottDashboardData } from "../../../../src/lib/abbott-data-projection";
import { loadAbbottDashboardData } from "./abbott-dashboard-loader";
import { authorizeAbbottRoute, isAbbottDashboardIdentity } from "./abbott-route-access";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: PRIVATE_RESPONSE_HEADERS });
}

function filenameSafe(value: string): string {
  const ascii = value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "dashboard";
}

export function createAbbottExcelHandler(overrides: Partial<{
  authorize: typeof authorizeAbbottRoute;
  load: typeof loadAbbottDashboardData;
}> = {}) {
  const authorize = overrides.authorize ?? authorizeAbbottRoute;
  const load = overrides.load ?? loadAbbottDashboardData;

  return async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> | { id: string } },
  ) {
    try {
      const { id } = await Promise.resolve(context.params);
      if (normalizeAbbottIdentifier(id) !== "abbott") {
        return privateJson({ error: "Dashboard not found" }, 404);
      }
      const access = await authorize(request, id);
      if (!isAbbottDashboardIdentity(access.context)) {
        return privateJson({ error: "Dashboard not found" }, 404);
      }
      if (!access.authorized) {
        return privateJson({ error: "Authentication required" }, 401);
      }
      const result = await load(request, id, access.audience);
      if (result.dashboard_id !== 18 || result.dashboard_id !== access.context.id
        || result.data.dashboard.type !== "abbott_bi") {
        return privateJson({ error: "Dashboard not found" }, 404);
      }
      const data = projectAbbottDashboardData(result.data, access.audience);
      // The combined HTTP handler emits no worksheets for the Abbott loader's
      // empty section_order and absent custom/comparison tables. Preserve that
      // contract; AbbottBiDashboard owns the separate client-side XLSX exports.
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "ReportingDash";
      workbook.created = new Date();
      workbook.properties.date1904 = true;
      const buffer = await workbook.xlsx.writeBuffer();
      const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const filename = `${filenameSafe(data.dashboard.client_name)}_${data.dashboard.period.from}_${data.dashboard.period.to}.xlsx`;
      return new NextResponse(payload, {
        headers: {
          ...PRIVATE_RESPONSE_HEADERS,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Dashboard not found") {
        return privateJson({ error: "Dashboard not found" }, 404);
      }
      console.error("Dashboard Excel export error:", error);
      return privateJson({ error: "Internal server error" }, 500);
    }
  };
}

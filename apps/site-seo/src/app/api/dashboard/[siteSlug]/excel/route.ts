import * as XLSX from "xlsx";
import { assertAuthorizedSiteSession } from "../../../../../lib/auth.ts";
import { buildExportRows } from "../../../../../lib/exports.ts";
import { loadDashboardReadModel } from "../../../../../lib/read-model.ts";
import type { DashboardJsonDependencies, DashboardReadRequest } from "../route.ts";

export function createExcelExportHandler(deps: DashboardJsonDependencies) {
  return async (request: DashboardReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404 });
    try {
      const session = assertAuthorizedSiteSession(await deps.getSession(), {
        dashboardId: deps.registration.profile.dashboardId, siteId: deps.registration.profile.siteId, credentialVersion: deps.credentialVersion,
      });
      const model = await loadDashboardReadModel({ registration: deps.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: deps.execute });
      const sheet = XLSX.utils.json_to_sheet(buildExportRows({ title: "Google Search Console", period: request.selection.gsc, source: model.gsc.meta }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "SEO");
      const contents = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      return new Response(contents, {
        headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=site-seo-export.xlsx", "cache-control": "private, no-store" },
      });
    } catch {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  };
}

export async function GET(): Promise<Response> { return Response.json({ error: "site_not_configured" }, { status: 503 }); }

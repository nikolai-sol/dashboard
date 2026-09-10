import * as XLSX from "xlsx";
import { assertAuthorizedSiteSession } from "../../../../../lib/auth.ts";
import { buildExportRows } from "../../../../../lib/exports.ts";
import { loadDashboardReadModel } from "../../../../../lib/read-model.ts";
import type { DashboardJsonDependencies, DashboardReadRequest } from "../route.ts";
import { getSiteSeoRuntime, parseDashboardReadRequest } from "../../../../../lib/runtime.ts";

export function createExcelExportHandler(deps: DashboardJsonDependencies) {
  return async (request: DashboardReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404 });
    let session;
    try {
      session = assertAuthorizedSiteSession(await deps.getSession(), {
        dashboardId: deps.registration.profile.dashboardId, siteId: deps.registration.profile.siteId, credentialVersion: deps.credentialVersion,
      });
    } catch {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    try {
      const model = await loadDashboardReadModel({ registration: deps.registration, claim: session, selection: request.selection, publicationId: request.publicationId, filters: request.filters, execute: deps.execute });
      const sheet = XLSX.utils.json_to_sheet(buildExportRows({ title: "Google Search Console", period: request.selection.gsc, source: model.gsc.meta }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "SEO");
      const contents = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      return new Response(contents, {
        headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=site-seo-export.xlsx", "cache-control": "private, no-store" },
      });
    } catch {
      return Response.json({ error: "canonical_read_unavailable" }, { status: 503 });
    }
  };
}

export async function GET(request: Request, context: { params: Promise<{ siteSlug: string }> | { siteSlug: string } }): Promise<Response> {
  try {
    const runtime = await getSiteSeoRuntime();
    const { siteSlug } = await Promise.resolve(context.params);
    const session = await runtime.resolveSession(request.headers.get("cookie"), runtime.registration);
    return createExcelExportHandler({ registration: runtime.registration, credentialVersion: session?.credentialVersion ?? -1, getSession: async () => session, execute: runtime.execute })(parseDashboardReadRequest(new URL(request.url), siteSlug, runtime.registration.profile.businessTimezone));
  } catch { return Response.json({ error: "site_runtime_unavailable" }, { status: 503 }); }
}

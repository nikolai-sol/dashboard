import type { Period } from "@reportingdash/site-seo-contract";
import { assertAuthorizedSiteSession } from "../../../../../lib/auth.ts";
import { buildExportRows } from "../../../../../lib/exports.ts";
import { loadDashboardReadModel } from "../../../../../lib/read-model.ts";
import type { DashboardJsonDependencies } from "../route.ts";

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }

export function createPdfExportHandler(deps: DashboardJsonDependencies) {
  return async (request: Readonly<{ slug: string; period: Period }>): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404 });
    try {
      const session = assertAuthorizedSiteSession(await deps.getSession(), {
        dashboardId: deps.registration.profile.dashboardId, siteId: deps.registration.profile.siteId, credentialVersion: deps.credentialVersion,
      });
      const model = await loadDashboardReadModel({ registration: deps.registration, claim: session, period: request.period, execute: deps.execute });
      const rows = buildExportRows({ title: "Google Search Console", period: request.period, source: model.gsc.meta });
      const body = `<!doctype html><html lang="ru"><title>SEO export</title><body><table>${rows.map((row) => `<tr><th>${escapeHtml(row.field)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")}</table></body></html>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": "inline; filename=site-seo-print.html" } });
    } catch {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  };
}

/** A printable response; a PDF renderer is deliberately not faked without an approved dependency. */
export async function GET(): Promise<Response> { return Response.json({ error: "site_not_configured" }, { status: 503 }); }

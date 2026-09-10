import { createPdfExportHandler } from "../../../../../lib/route-handlers.ts";
import { getSiteSeoRuntime, parseDashboardReadRequest } from "../../../../../lib/runtime.ts";

export async function GET(request: Request, context: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  try {
    const runtime = await getSiteSeoRuntime();
    const { siteSlug } = await context.params;
    const session = await runtime.resolveSession(request.headers.get("cookie"), runtime.registration);
    return createPdfExportHandler({ registration: runtime.registration, credentialVersion: session?.credentialVersion ?? -1, getSession: async () => session, execute: runtime.execute })(parseDashboardReadRequest(new URL(request.url), siteSlug, runtime.registration.profile.businessTimezone));
  } catch { return Response.json({ error: "site_runtime_unavailable" }, { status: 503 }); }
}

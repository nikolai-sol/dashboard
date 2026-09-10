import { createDashboardJsonHandler } from "../../../../lib/route-handlers.ts";
import { getSiteSeoRuntime, parseDashboardReadRequest } from "../../../../lib/runtime.ts";

export async function GET(request: Request, context: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  try {
    const runtime = await getSiteSeoRuntime();
    const { siteSlug } = await context.params;
    if (siteSlug !== runtime.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "private, no-store" } });
    const session = await runtime.resolveSession(request.headers.get("cookie"), runtime.registration);
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "private, no-store" } });
    const handler = createDashboardJsonHandler({ registration: runtime.registration, credentialVersion: session?.credentialVersion ?? -1, getSession: async () => session, execute: runtime.execute });
    try { return handler(parseDashboardReadRequest(new URL(request.url), siteSlug, runtime.registration.profile.businessTimezone)); }
    catch { return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "private, no-store" } }); }
  } catch {
    return Response.json({ error: "site_runtime_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}

import { createIntentQueryHandler, parseIntentQueryOptions } from "../../../../../lib/route-handlers.ts";
import { getSiteSeoRuntime, parseDashboardReadRequest } from "../../../../../lib/runtime.ts";

const PRIVATE_JSON = { headers: { "cache-control": "private, no-store" } } as const;

export async function GET(request: Request, context: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  try {
    const runtime = await getSiteSeoRuntime();
    const { siteSlug } = await context.params;
    if (siteSlug !== runtime.registration.profile.slug) return Response.json({ error: "not_found" }, { status: 404, ...PRIVATE_JSON });
    const session = await runtime.resolveSession(request.headers.get("cookie"), runtime.registration);
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, ...PRIVATE_JSON });
    try {
      const url = new URL(request.url);
      return createIntentQueryHandler({ registration: runtime.registration, credentialVersion: session.credentialVersion, getSession: async () => session, execute: runtime.execute })({
        ...parseDashboardReadRequest(url, siteSlug, runtime.registration.profile.businessTimezone),
        intent: parseIntentQueryOptions(url),
      });
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400, ...PRIVATE_JSON });
    }
  } catch {
    return Response.json({ error: "site_runtime_unavailable" }, { status: 503, ...PRIVATE_JSON });
  }
}

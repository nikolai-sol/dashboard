import type { SiteRegistration } from "@reportingdash/site-seo-contract";
import { type SiteSeoSession, assertAuthorizedSiteSession } from "../../../../lib/auth.ts";
import type { CanonicalReadExecutor } from "../../../../lib/db.ts";
import { loadDashboardReadModel } from "../../../../lib/read-model.ts";
import type { PeriodSelection } from "../../../../lib/period-selection.ts";
import { getSiteSeoRuntime, parseDashboardReadRequest } from "../../../../lib/runtime.ts";

export type DashboardJsonDependencies = Readonly<{
  registration: SiteRegistration;
  credentialVersion: number;
  getSession: () => Promise<SiteSeoSession | null>;
  execute: CanonicalReadExecutor;
}>;

export type DashboardReadRequest = Readonly<{
  slug: string;
  selection: PeriodSelection;
  publicationId: string | null;
  filters: Readonly<Record<string, string>>;
}>;

export function createDashboardJsonHandler(deps: DashboardJsonDependencies) {
  return async (request: DashboardReadRequest): Promise<Response> => {
    if (request.slug !== deps.registration.profile.slug) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    try {
      const session = assertAuthorizedSiteSession(
        await deps.getSession(),
        { dashboardId: deps.registration.profile.dashboardId, siteId: deps.registration.profile.siteId, credentialVersion: deps.credentialVersion },
      );
      const data = await loadDashboardReadModel({
        registration: deps.registration,
        claim: session,
        selection: request.selection,
        publicationId: request.publicationId,
        filters: request.filters,
        execute: deps.execute,
      });
      return Response.json(data);
    } catch {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  };
}

/** Runtime wiring is intentionally fail-closed until T7 registers the profile and shared password authority. */
export async function GET(request: Request, context: { params: Promise<{ siteSlug: string }> | { siteSlug: string } }): Promise<Response> {
  try {
    const runtime = await getSiteSeoRuntime();
    const { siteSlug } = await Promise.resolve(context.params);
    const session = await runtime.resolveSession(request.headers.get("cookie"), runtime.registration);
    const handler = createDashboardJsonHandler({ registration: runtime.registration, credentialVersion: session?.credentialVersion ?? -1, getSession: async () => session, execute: runtime.execute });
    return handler(parseDashboardReadRequest(new URL(request.url), siteSlug, runtime.registration.profile.businessTimezone));
  } catch {
    return Response.json({ error: "site_runtime_unavailable" }, { status: 503 });
  }
}

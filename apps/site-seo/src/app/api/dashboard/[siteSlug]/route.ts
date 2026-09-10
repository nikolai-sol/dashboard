import type { Period, SiteRegistration } from "@reportingdash/site-seo-contract";
import { type SiteSeoSession, assertAuthorizedSiteSession } from "../../../../lib/auth.ts";
import type { CanonicalReadExecutor } from "../../../../lib/db.ts";
import { loadDashboardReadModel } from "../../../../lib/read-model.ts";

export type DashboardJsonDependencies = Readonly<{
  registration: SiteRegistration;
  credentialVersion: number;
  getSession: () => Promise<SiteSeoSession | null>;
  execute: CanonicalReadExecutor;
}>;

export function createDashboardJsonHandler(deps: DashboardJsonDependencies) {
  return async (request: Readonly<{ slug: string; period: Period }>): Promise<Response> => {
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
        period: request.period,
        execute: deps.execute,
      });
      return Response.json(data);
    } catch {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  };
}

/** Runtime wiring is intentionally fail-closed until T7 registers the profile and shared password authority. */
export async function GET(): Promise<Response> {
  return Response.json({ error: "site_not_configured" }, { status: 503 });
}

import type { SiteProfile } from "@reportingdash/site-seo-contract";

export function createHealthHandler(profile: SiteProfile, version: string) {
  return () => Response.json({ siteId: profile.siteId, version });
}

export async function GET(): Promise<Response> {
  return Response.json({ status: "not_configured" }, { status: 503 });
}

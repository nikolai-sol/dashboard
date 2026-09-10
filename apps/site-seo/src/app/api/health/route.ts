import type { SiteProfile } from "@reportingdash/site-seo-contract";
import { loadRegistrationFromEnvironment } from "../../../lib/runtime.ts";

export function createHealthHandler(profile: SiteProfile, version: string) {
  return () => Response.json({ siteId: profile.siteId, version });
}

export async function GET(): Promise<Response> {
  try {
    const registration = await loadRegistrationFromEnvironment();
    return createHealthHandler(registration.profile, registration.profile.profileVersion)();
  } catch {
    return Response.json({ status: "site_runtime_unavailable" }, { status: 503 });
  }
}

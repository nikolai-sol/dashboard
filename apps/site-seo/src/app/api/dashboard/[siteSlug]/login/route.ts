import { createSiteLoginHandler, verifyCanonicalSitePassword } from "../../../../../lib/login.ts";
import { loadRegistrationFromEnvironment } from "../../../../../lib/runtime.ts";

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ siteSlug: string }> }>,
): Promise<Response> {
  const registration = await loadRegistrationFromEnvironment();
  const { siteSlug } = await context.params;
  if (siteSlug !== registration.profile.slug) {
    return Response.json(
      { error: "Not found" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }
  return createSiteLoginHandler({
    loadRegistration: async () => registration,
    verifyPassword: verifyCanonicalSitePassword,
  })(request);
}

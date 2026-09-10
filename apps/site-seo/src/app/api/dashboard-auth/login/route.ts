import { createSiteLoginHandler, verifyCanonicalSitePassword } from "../../../../lib/login.ts";
import { loadRegistrationFromEnvironment } from "../../../../lib/runtime.ts";

export async function POST(request: Request): Promise<Response> {
  return createSiteLoginHandler({
    loadRegistration: loadRegistrationFromEnvironment,
    verifyPassword: verifyCanonicalSitePassword,
  })(request);
}

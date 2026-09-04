import { isDashboardAccessAuthorized } from "@/lib/dashboard-access";

export const ZARUKU_DASHBOARD_SLUG = "zaruku";

export function isZarukuDashboardIdentity(context: unknown): boolean {
  if (!context || typeof context !== "object") return false;
  const identity = context as { client_id?: unknown; dashboard_type?: unknown };
  return String(identity.client_id ?? "").trim().toLowerCase() === ZARUKU_DASHBOARD_SLUG
    && identity.dashboard_type === "zaruku_bi";
}

export function createZarukuRouteAuthorizer(
  dependencies: { authorize?: typeof isDashboardAccessAuthorized } = {},
) {
  const authorize = dependencies.authorize ?? isDashboardAccessAuthorized;
  return async function authorizeZarukuRoute(request: Request, identifier: string = ZARUKU_DASHBOARD_SLUG) {
    if (String(identifier).trim().toLowerCase() !== ZARUKU_DASHBOARD_SLUG) {
      return { context: null, authorized: false as const, reason: "not_found" as const };
    }
    const access = await authorize(request, ZARUKU_DASHBOARD_SLUG);
    if (!isZarukuDashboardIdentity(access.context)) {
      return { context: null, authorized: false as const, reason: "not_found" as const };
    }
    return access;
  };
}

export const authorizeZarukuRoute = createZarukuRouteAuthorizer();

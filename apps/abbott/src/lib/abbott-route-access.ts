import { normalizeAbbottIdentifier } from "@reportingdash/runtime-contract";
import { isDashboardAccessAuthorized } from "../../../../src/lib/dashboard-access";
import type { DashboardAccessContext } from "../../../../src/lib/dashboard-access";

export function isAbbottDashboardIdentity(
  context: unknown,
): context is DashboardAccessContext & { dashboard_type: "abbott_bi" } {
  if (!context || typeof context !== "object") return false;
  const row = context as { id?: unknown; client_id?: unknown; dashboard_type?: unknown };
  return Number(row.id) === 18
    && String(row.client_id ?? "").trim().toLowerCase() === "abbott"
    && row.dashboard_type === "abbott_bi";
}

export function createAbbottRouteAuthorizer(
  dependencies: { authorize: typeof isDashboardAccessAuthorized } = {
    authorize: isDashboardAccessAuthorized,
  },
) {
  return async (request: Request, identifier: string) => {
    if (normalizeAbbottIdentifier(identifier) !== "abbott") {
      return { context: null, authorized: false as const, reason: "not_found" as const };
    }
    const access = await dependencies.authorize(request, identifier);
    if (!isAbbottDashboardIdentity(access.context)) {
      return { context: null, authorized: false as const, reason: "not_found" as const };
    }
    return access;
  };
}

export const authorizeAbbottRoute = createAbbottRouteAuthorizer();

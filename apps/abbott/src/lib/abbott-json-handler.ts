import { normalizeAbbottIdentifier } from "@reportingdash/runtime-contract";
import { NextResponse } from "next/server";
import { projectAbbottDashboardData } from "../../../../src/lib/abbott-data-projection";
import { InvalidDashboardDateRangeError } from "../../../../src/lib/dashboard-date-range";
import { loadAbbottDashboardData } from "./abbott-dashboard-loader";
import {
  authorizeAbbottRoute,
  isAbbottDashboardIdentity,
} from "./abbott-route-access";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

type AbbottJsonHandlerDependencies = {
  authorize: typeof authorizeAbbottRoute;
  load: typeof loadAbbottDashboardData;
};

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS },
  });
}

export function createAbbottJsonHandler(
  overrides: Partial<AbbottJsonHandlerDependencies> = {},
) {
  const authorize = overrides.authorize ?? authorizeAbbottRoute;
  const load = overrides.load ?? loadAbbottDashboardData;

  return async function GET(
    request: Request,
    routeContext: { params: Promise<{ id: string }> | { id: string } },
  ) {
    try {
      const { id } = await Promise.resolve(routeContext.params);
      if (normalizeAbbottIdentifier(id) !== "abbott") {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }

      const access = await authorize(request, id);
      if (!isAbbottDashboardIdentity(access.context)) {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      if (!access.authorized) {
        return privateJson(
          {
            error: "Authentication required",
            auth_required: true,
            dashboard: {
              id: access.context.id,
              client_id: access.context.client_id,
              client_name: access.context.client_name,
              dashboard_name: access.context.dashboard_name,
              auth_mode: access.context.auth_mode,
            },
          },
          { status: 401 },
        );
      }

      const result = await load(request, id, access.audience);
      if (
        result.dashboard_id !== 18
        || result.dashboard_id !== access.context.id
        || result.data.dashboard.type !== "abbott_bi"
        || result.data.dashboard.type !== access.context.dashboard_type
      ) {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      if (result.ai_summary_enabled) {
        result.data.ai_summary = result.ai_summary_override ?? result.ai_summary_snapshot ?? undefined;
      }
      const projected = projectAbbottDashboardData(result.data, access.audience);
      if (access.audience !== "embed" || !projected.abbott_bi) {
        return privateJson(projected);
      }
      const embedAbbott = Object.fromEntries(
        Object.entries(projected.abbott_bi).filter(([key]) => key !== "session_journeys"),
      );
      return privateJson({ ...projected, abbott_bi: embedAbbott });
    } catch (error) {
      if (error instanceof InvalidDashboardDateRangeError) {
        return privateJson({ error: "Invalid date range" }, { status: 400 });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Dashboard not found") {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      console.error("Dashboard API error:", error);
      return privateJson({ error: "Internal server error" }, { status: 500 });
    }
  };
}

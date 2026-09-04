import { NextResponse } from "next/server";
import { InvalidDashboardDateRangeError } from "@/lib/dashboard-date-range";
import { formatPrivateServerTiming, loadZarukuDashboardData } from "./zaruku-dashboard-loader";
import { authorizeZarukuRoute, isZarukuDashboardIdentity, ZARUKU_DASHBOARD_SLUG } from "./zaruku-route-access";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS } });
}

export function createZarukuDashboardGetHandler(dependencies: {
  authorize?: typeof authorizeZarukuRoute;
  load?: typeof loadZarukuDashboardData;
} = {}) {
  const authorize = dependencies.authorize ?? authorizeZarukuRoute;
  const load = dependencies.load ?? loadZarukuDashboardData;

  return async function GET(request: Request) {
    try {
      const access = await authorize(request, ZARUKU_DASHBOARD_SLUG);
      if (!access.context || !isZarukuDashboardIdentity(access.context)) {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      if (!access.authorized) {
        return privateJson({
          error: "Authentication required",
          auth_required: true,
          dashboard: {
            id: access.context.id,
            client_id: access.context.client_id,
            client_name: access.context.client_name,
            dashboard_name: access.context.dashboard_name,
            auth_mode: access.context.auth_mode,
          },
        }, { status: 401 });
      }
      const { data, ai_summary_enabled, ai_summary_override, ai_summary_snapshot, server_timing } = await load(
        request, ZARUKU_DASHBOARD_SLUG, access.audience,
      );
      if (ai_summary_enabled) data.ai_summary = ai_summary_override ?? ai_summary_snapshot ?? undefined;
      const serverTiming = server_timing ? formatPrivateServerTiming(server_timing) : "";
      return privateJson(data, serverTiming ? { headers: { "Server-Timing": serverTiming } } : undefined);
    } catch (error) {
      if (error instanceof InvalidDashboardDateRangeError) {
        return privateJson({ error: "Invalid date range" }, { status: 400 });
      }
      if (error instanceof Error && error.message === "Dashboard not found") {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      console.error("Dashboard API error:", error);
      return privateJson({ error: "Internal server error" }, { status: 500 });
    }
  };
}

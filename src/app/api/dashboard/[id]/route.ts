import { NextResponse } from "next/server";
import { projectAbbottDashboardData } from "@/lib/abbott-data-projection";
import { isDashboardAccessAuthorized } from "@/lib/dashboard-access";
import { formatPrivateServerTiming, loadDashboardData as defaultLoadDashboardData } from "@/lib/dashboard-data-loader";
import { InvalidDashboardDateRangeError } from "@/lib/dashboard-date-range";
import { createZarukuDashboardGetHandler, isZarukuDashboardIdentity } from "@zaruku/compat/api";

export const dynamic = "force-dynamic";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

type DashboardGetHandlerDependencies = {
  isDashboardAccessAuthorized: typeof isDashboardAccessAuthorized;
  loadDashboardData: typeof defaultLoadDashboardData;
};

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS },
  });
}

export function createDashboardGetHandler(
  dependencies: Partial<DashboardGetHandlerDependencies> = {},
) {
  const authorize = dependencies.isDashboardAccessAuthorized ?? isDashboardAccessAuthorized;
  const loadDashboardData = dependencies.loadDashboardData ?? defaultLoadDashboardData;

  return async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> | { id: string } },
  ) {
    try {
      const { id } = await Promise.resolve(context.params);
      const access = await authorize(request, id);
      if (!access.context) {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }
      if (isZarukuDashboardIdentity(access.context)) {
        return createZarukuDashboardGetHandler({
          authorize: async () => access,
          ...(dependencies.loadDashboardData ? { load: dependencies.loadDashboardData } : {}),
        })(request);
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
      const { data, ai_summary_enabled, ai_summary_override, ai_summary_snapshot, server_timing } = await loadDashboardData(
        request,
        id,
        access.audience,
      );
      if (ai_summary_enabled) {
        data.ai_summary = ai_summary_override ?? ai_summary_snapshot ?? undefined;
      }
      const serverTimingHeader = server_timing ? formatPrivateServerTiming(server_timing) : "";
      return privateJson(
        projectAbbottDashboardData(data, access.audience),
        serverTimingHeader ? { headers: { "Server-Timing": serverTimingHeader } } : undefined,
      );
    } catch (error) {
      if (error instanceof InvalidDashboardDateRangeError) {
        return privateJson({ error: "Invalid date range" }, { status: 400 });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Dashboard not found") {
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }

      console.error("Dashboard API error:", error);
      return privateJson(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}

export const GET = createDashboardGetHandler();

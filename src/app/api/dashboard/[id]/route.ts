import { NextResponse } from "next/server";
import { projectAbbottDashboardData } from "@/lib/abbott-data-projection";
import { isDashboardAccessAuthorized } from "@/lib/dashboard-access";
import { loadDashboardData } from "@/lib/dashboard-data-loader";

export const dynamic = "force-dynamic";

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const access = await isDashboardAccessAuthorized(request, id);
    if (!access.context) {
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
    const { data, ai_summary_enabled, ai_summary_override, ai_summary_snapshot } = await loadDashboardData(
      request,
      id,
    );
    if (ai_summary_enabled) {
      data.ai_summary = ai_summary_override ?? ai_summary_snapshot ?? undefined;
    }
    return privateJson(projectAbbottDashboardData(data, access.audience));
  } catch (error) {
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
}

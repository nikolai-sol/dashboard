import { NextResponse } from "next/server";
import { isDashboardAccessAuthorized } from "@/lib/dashboard-access";
import { buildDashboardAiSummaryCacheKey, generateDashboardAiSummary } from "@/lib/dashboard-ai-summary";
import { loadDashboardData } from "@/lib/dashboard-data-loader";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const access = await isDashboardAccessAuthorized(request, id);
    if (!access.context) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    if (!access.authorized) {
      return NextResponse.json(
        {
          error: "Authentication required",
          auth_required: true,
          dashboard: {
            id: access.context.id,
            client_id: access.context.client_id,
            client_name: access.context.client_name,
            dashboard_name: access.context.dashboard_name,
          },
        },
        { status: 401 },
      );
    }
    const { data, ai_summary_enabled, ai_summary_override } = await loadDashboardData(request, id);
    if (ai_summary_enabled) {
      data.ai_summary =
        ai_summary_override ??
        await generateDashboardAiSummary(data, {
          cacheKey: buildDashboardAiSummaryCacheKey(request, id),
        });
    }
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Dashboard not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    console.error("Dashboard API error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: message,
      },
      { status: 500 },
    );
  }
}

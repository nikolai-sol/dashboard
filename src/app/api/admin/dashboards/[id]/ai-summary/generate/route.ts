import { NextResponse } from "next/server";
import { generateDashboardAiSummary } from "@/lib/dashboard-ai-summary";
import { loadDashboardData } from "@/lib/dashboard-data-loader";

function getDashboardId(rawId: string): number | null {
  const dashboardId = Number(rawId);
  return Number.isFinite(dashboardId) ? dashboardId : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const dashboardId = getDashboardId(id);
    if (dashboardId === null) {
      return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
    }

    const { data, ai_summary_enabled, ai_summary_override_text } = await loadDashboardData(
      request,
      String(dashboardId),
    );

    if (!ai_summary_enabled) {
      return NextResponse.json(
        { error: "AI summary authoring is disabled for this dashboard" },
        { status: 409 },
      );
    }

    const candidate = await generateDashboardAiSummary(data);
    return NextResponse.json({
      enabled: true,
      source: "generated_fresh",
      override_text: ai_summary_override_text ?? null,
      candidate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Dashboard not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to generate AI summary candidate", details: message },
      { status: 500 },
    );
  }
}

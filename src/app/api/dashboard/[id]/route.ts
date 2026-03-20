import { NextResponse } from "next/server";
import { loadDashboardData } from "@/lib/dashboard-data-loader";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const { data } = await loadDashboardData(request, id);
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

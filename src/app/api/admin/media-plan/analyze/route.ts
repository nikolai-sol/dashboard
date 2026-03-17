import { NextResponse } from "next/server";
import { normalizeDashboardPayload } from "@/lib/admin-dashboards";
import {
  analyzeMediaPlanPayload,
  type MediaPlanRowOverrideMap,
} from "@/lib/media-plan-preflight";

export const dynamic = "force-dynamic";

type AnalyzeRequestBody = {
  dashboard?: unknown;
  row_overrides?: MediaPlanRowOverrideMap;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as AnalyzeRequestBody;
    const payload = normalizeDashboardPayload(body.dashboard ?? body);
    const rowOverrides =
      body.row_overrides && typeof body.row_overrides === "object" ? body.row_overrides : {};
    const analysis = await analyzeMediaPlanPayload(payload, rowOverrides);
    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to analyze media plan",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

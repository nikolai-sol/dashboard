import { NextResponse } from "next/server";
import { normalizeDashboardPayload } from "@/lib/admin-dashboards";
import {
  applyMediaPlanReview,
  type MediaPlanRowOverrideMap,
  type MediaPlanResolutionMap,
} from "@/lib/media-plan-preflight";

export const dynamic = "force-dynamic";

type ConfirmRequestBody = {
  dashboard?: unknown;
  resolutions?: MediaPlanResolutionMap;
  row_overrides?: MediaPlanRowOverrideMap;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ConfirmRequestBody;
    const payload = normalizeDashboardPayload(body.dashboard ?? body);
    const resolutions =
      body.resolutions && typeof body.resolutions === "object" ? body.resolutions : {};
    const rowOverrides =
      body.row_overrides && typeof body.row_overrides === "object" ? body.row_overrides : {};

    const result = await applyMediaPlanReview(payload, resolutions, rowOverrides);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to confirm media plan review",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

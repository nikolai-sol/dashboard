import { NextResponse } from "next/server";
import {
  applyLeadsReview,
  type LeadsPlatformBindingMap,
  type LeadsSourceConfig,
} from "@/lib/leads-fetcher";

export const dynamic = "force-dynamic";

type ConfirmRequestBody = {
  source_config?: unknown;
  selected_platforms?: unknown;
  platform_bindings?: unknown;
};

function parseSelectedPlatforms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function parsePlatformBindings(value: unknown): LeadsPlatformBindingMap {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, binding]) => [key, String(binding ?? "")]),
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ConfirmRequestBody;
    const sourceConfig =
      body.source_config && typeof body.source_config === "object"
        ? (body.source_config as LeadsSourceConfig)
        : {};
    const selectedPlatforms = parseSelectedPlatforms(body.selected_platforms);
    const platformBindings = parsePlatformBindings(body.platform_bindings);
    const result = await applyLeadsReview(sourceConfig, selectedPlatforms, platformBindings);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to confirm leads review",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import {
  analyzeLeadSourceConfig,
  type LeadsSourceConfig,
} from "@/lib/leads-fetcher";

export const dynamic = "force-dynamic";

type PreviewRequestBody = {
  source_config?: unknown;
  selected_platforms?: unknown;
};

function parseSelectedPlatforms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as PreviewRequestBody;
    const sourceConfig =
      body.source_config && typeof body.source_config === "object"
        ? (body.source_config as LeadsSourceConfig)
        : {};
    const selectedPlatforms = parseSelectedPlatforms(body.selected_platforms);
    const analysis = await analyzeLeadSourceConfig(sourceConfig, selectedPlatforms);
    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to analyze leads source",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

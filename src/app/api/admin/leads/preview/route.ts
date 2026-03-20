import { NextResponse } from "next/server";
import {
  analyzeLeadSourceConfig,
  type LeadsSourceConfig,
} from "@/lib/leads-fetcher";
import { normalizeDashboardPayload } from "@/lib/admin-dashboards";
import { fetchMediaPlanFromSourceConfig, groupByChannel } from "@/lib/gsheet-fetcher";
import { aggregateByChannel, fetchManualData } from "@/lib/manual-data-fetcher";

export const dynamic = "force-dynamic";

type PreviewRequestBody = {
  source_config?: unknown;
  selected_platforms?: unknown;
  dashboard?: unknown;
};

function parseSelectedPlatforms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

async function resolveDashboardContext(rawDashboard: unknown): Promise<{ selectedPlatforms: string[]; selectedChannels: string[] }> {
  if (!rawDashboard || typeof rawDashboard !== "object") {
    return { selectedPlatforms: [], selectedChannels: [] };
  }

  const payload = normalizeDashboardPayload(rawDashboard);
  const selectedPlatforms = Array.from(
    new Set(
      payload.sources
        .filter((source) => source.role === "actual" && source.platform !== "leads" && source.platform !== "manual_data")
        .map((source) => source.platform)
        .concat(
          payload.sources
            .filter((source) => source.platform === "manual_data")
            .map((source) => String(source.source_config?.platform ?? "").trim().toLowerCase())
            .filter(Boolean),
        ),
    ),
  );

  const selectedChannels = new Set<string>();
  const planSource = payload.sources.find((source) => source.role === "plan");
  if (planSource) {
    try {
      const rows = await fetchMediaPlanFromSourceConfig(planSource.source_config ?? {});
      for (const item of groupByChannel(rows)) {
        if (item.channel) selectedChannels.add(item.channel);
      }
    } catch {
      // ignore plan parsing failures in leads preview context
    }
  }

  const manualSources = payload.sources.filter((source) => source.platform === "manual_data");
  for (const source of manualSources) {
    const sourceConfig = source.source_config ?? {};
    const defaultChannel = String(sourceConfig.channel ?? "").trim();
    if (defaultChannel) selectedChannels.add(defaultChannel);
    const sheetUrl = String(sourceConfig.sheet_url ?? "").trim();
    if (!sheetUrl) continue;
    try {
      const rows = await fetchManualData(sheetUrl, {
        defaultPlatform: String(sourceConfig.platform ?? "").trim(),
        defaultChannel,
      });
      for (const item of aggregateByChannel(rows)) {
        if (item.channel) selectedChannels.add(item.channel);
      }
    } catch {
      // ignore manual sheet failures in leads preview context
    }
  }

  return {
    selectedPlatforms,
    selectedChannels: Array.from(selectedChannels).sort((a, b) => a.localeCompare(b)),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as PreviewRequestBody;
    const sourceConfig =
      body.source_config && typeof body.source_config === "object"
        ? (body.source_config as LeadsSourceConfig)
        : {};
    const context = await resolveDashboardContext(body.dashboard);
    const selectedPlatforms = context.selectedPlatforms.length
      ? context.selectedPlatforms
      : parseSelectedPlatforms(body.selected_platforms);
    const analysis = await analyzeLeadSourceConfig(sourceConfig, selectedPlatforms, context.selectedChannels);
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

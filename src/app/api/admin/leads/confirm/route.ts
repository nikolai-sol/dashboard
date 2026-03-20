import { NextResponse } from "next/server";
import {
  applyLeadsReview,
  type LeadsChannelBindingMap,
  type LeadsPlatformBindingMap,
  type LeadsSourceConfig,
} from "@/lib/leads-fetcher";
import { normalizeDashboardPayload } from "@/lib/admin-dashboards";
import { fetchMediaPlanFromSourceConfig, groupByChannel } from "@/lib/gsheet-fetcher";
import { aggregateByChannel, fetchManualData } from "@/lib/manual-data-fetcher";

export const dynamic = "force-dynamic";

type ConfirmRequestBody = {
  source_config?: unknown;
  selected_platforms?: unknown;
  platform_bindings?: unknown;
  channel_bindings?: unknown;
  dashboard?: unknown;
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

function parseChannelBindings(value: unknown): LeadsChannelBindingMap {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, binding]) => [key, String(binding ?? "")]),
  );
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
      // ignore plan parsing failures in leads confirm context
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
      // ignore manual sheet failures in leads confirm context
    }
  }

  return {
    selectedPlatforms,
    selectedChannels: Array.from(selectedChannels).sort((a, b) => a.localeCompare(b)),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ConfirmRequestBody;
    const sourceConfig =
      body.source_config && typeof body.source_config === "object"
        ? (body.source_config as LeadsSourceConfig)
        : {};
    const context = await resolveDashboardContext(body.dashboard);
    const selectedPlatforms = context.selectedPlatforms.length
      ? context.selectedPlatforms
      : parseSelectedPlatforms(body.selected_platforms);
    const platformBindings = parsePlatformBindings(body.platform_bindings);
    const channelBindings = parseChannelBindings(body.channel_bindings);
    const result = await applyLeadsReview(
      sourceConfig,
      selectedPlatforms,
      context.selectedChannels,
      platformBindings,
      channelBindings,
    );
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

import { NextResponse } from "next/server";
import { normalizeDashboardPayload } from "@/lib/admin-dashboards";
import { groupByChannel, fetchMediaPlanFromSourceConfig } from "@/lib/gsheet-fetcher";
import { loadSchema } from "@/lib/schema-parser";
import {
  countAdsCampaigns,
  countAnalyticsAccounts,
  type CanonicalFilter,
} from "@/lib/canonical-adapter";
import { resolveSourceKey, resolveSourceType } from "@/lib/source-mapping";
import { fetchManualData, aggregateByChannel } from "@/lib/manual-data-fetcher";
import { analyzeLeadSourceConfig } from "@/lib/leads-fetcher";

export const dynamic = "force-dynamic";

function parseSourceConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseAccountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const payload = normalizeDashboardPayload(body);

    const actualSources = payload.sources.filter((source) => source.role === "actual");
    const planSource = payload.sources.find((source) => source.role === "plan");

    const selectedActualPlatforms = payload.sources
      .filter((source) => source.role === "actual" && source.platform !== "leads")
      .map((source) => source.platform);

    const actualSummary: Array<{
      platform: string;
      campaigns: number;
      status: "ok" | "empty" | "error";
      message?: string;
    }> = [];

    for (const source of actualSources) {
      try {
        const schema = loadSchema(source.schema_file);
        const sourceKey = schema.source_key ?? resolveSourceKey(source.platform);
        const sourceType = schema.source_type ?? resolveSourceType(sourceKey);

        if (sourceType === "gsheet") {
          continue;
        }

        if (sourceType === "leads") {
          const sourceConfig = parseSourceConfig(source.source_config);
          const analysis = await analyzeLeadSourceConfig(sourceConfig, selectedActualPlatforms);
          actualSummary.push({
            platform: source.platform,
            campaigns: analysis.rows_parsed,
            status:
              analysis.status === "error"
                ? "error"
                : analysis.rows_parsed > 0
                  ? "ok"
                  : "empty",
            message:
              analysis.rows_parsed > 0
                ? `Leads rows loaded · bound=${analysis.binding_summary.canonical_bound} unresolved=${analysis.binding_summary.unresolved}`
                : analysis.issues[0]?.message ?? "No parsable leads rows",
          });
          continue;
        }

        if (sourceType === "manual") {
          const sourceConfig = parseSourceConfig(source.source_config);
          const sheetUrl = String(sourceConfig?.sheet_url ?? "").trim();
          if (!sheetUrl) {
            actualSummary.push({
              platform: source.platform,
              campaigns: 0,
              status: "error",
              message: "Sheet URL is empty",
            });
            continue;
          }
          try {
            const rows = await fetchManualData(sheetUrl, {
              defaultPlatform: String(sourceConfig?.platform ?? "").trim(),
              defaultChannel: String(sourceConfig?.channel ?? "").trim(),
            });
            const channels = aggregateByChannel(rows);
            const count = channels.length;
            actualSummary.push({
              platform: source.platform,
              campaigns: count,
              status: count > 0 ? "ok" : "empty",
              message: count > 0 ? "Manual sheet loaded" : "Sheet has no parsable rows",
            });
          } catch (err) {
            actualSummary.push({
              platform: source.platform,
              campaigns: 0,
              status: "error",
              message: err instanceof Error ? err.message : "Failed to load manual sheet",
            });
          }
          continue;
        }

        if (schema.source !== "mysql") {
          actualSummary.push({
            platform: source.platform,
            campaigns: 0,
            status: "error",
            message: "Source is not mysql",
          });
          continue;
        }

        const filter: CanonicalFilter = {
          source_key: sourceKey,
          date_from: "1900-01-01",
          date_to: "2999-12-31",
          account_ids: parseAccountIds(source.source_config?.account_ids),
          campaign_filter: source.filters[0] ?? {
            filter_type: "all",
            filter_value: null,
          },
        };

        const total =
          sourceType === "analytics"
            ? await countAnalyticsAccounts(sourceKey, filter.account_ids)
            : await countAdsCampaigns(filter);

        actualSummary.push({
          platform: source.platform,
          campaigns: total,
          status: total > 0 ? "ok" : "empty",
          message: sourceType === "analytics" ? "Analytics source checked by account presence." : undefined,
        });
      } catch (error) {
        actualSummary.push({
          platform: source.platform,
          campaigns: 0,
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load canonical source",
        });
      }
    }

    let planRows = 0;
    let planChannels = 0;
    let planPlatforms = 0;
    let planStatus: "connected" | "missing_url" | "error" | "not_configured" = "not_configured";
    let planMessage = "";

    if (planSource) {
      const sourceConfig = parseSourceConfig(planSource.source_config);
      const hasInput =
        Boolean(String(sourceConfig.sheet_url ?? "").trim()) ||
        Array.isArray(sourceConfig.inline_rows) ||
        Boolean(sourceConfig.upload_file);
      if (!hasInput) {
        planStatus = "missing_url";
        planMessage = "Sheet URL is empty and no uploaded plan is attached.";
      } else {
        try {
          const rows = await fetchMediaPlanFromSourceConfig(sourceConfig);
          const channels = groupByChannel(rows);
          const platforms = new Set(rows.map((row) => row.platform).filter(Boolean));
          planRows = rows.length;
          planChannels = channels.length;
          planPlatforms = platforms.size;
          planStatus = rows.length > 0 ? "connected" : "error";
          if (!rows.length) {
            planMessage = "Sheet has no parsable rows.";
          }
        } catch (error) {
          planStatus = "error";
          planMessage = error instanceof Error ? error.message : "Failed to load media plan";
        }
      }
    }

    return NextResponse.json({
      summary: {
        actual: actualSummary,
        plan: {
          status: planStatus,
          rows: planRows,
          channels: planChannels,
          platforms: planPlatforms,
          message: planMessage,
        },
        totals: {
          actual_sources: actualSummary.length,
          actual_campaigns: actualSummary.reduce((sum, item) => sum + item.campaigns, 0),
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to build preview", details: String(error) },
      { status: 500 },
    );
  }
}

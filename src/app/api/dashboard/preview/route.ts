import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { normalizeDashboardPayload } from "@/lib/admin-dashboards";
import { aggregatePlanByChannel, fetchMediaPlan } from "@/lib/gsheet-fetcher";
import { loadSchema } from "@/lib/schema-parser";

export const dynamic = "force-dynamic";

function qualifyFilter(filter: string): string {
  if (filter.includes(".")) return filter;
  return filter.replace(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)/, "c.$1");
}

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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const payload = normalizeDashboardPayload(body);

    const actualSources = payload.sources.filter((source) => source.role === "actual");
    const planSource = payload.sources.find((source) => source.role === "plan");

    const actualSummary: Array<{
      platform: string;
      campaigns: number;
      status: "ok" | "empty" | "error";
      message?: string;
    }> = [];

    for (const source of actualSources) {
      try {
        const schema = loadSchema(source.schema_file);
        if (schema.source !== "mysql" || !schema.tables) {
          actualSummary.push({
            platform: source.platform,
            campaigns: 0,
            status: "error",
            message: "Source is not mysql",
          });
          continue;
        }

        const campaigns = schema.tables.campaigns;
        const filter = source.filters[0] ?? { filter_type: "all" as const, filter_value: null };
        const wheres: string[] = [];
        const params: Array<string | number> = [];

        if (campaigns.filter) {
          wheres.push(qualifyFilter(campaigns.filter));
        }

        if (filter.filter_type === "name_pattern" && filter.filter_value) {
          wheres.push(`c.${campaigns.name_col} LIKE ?`);
          params.push(filter.filter_value);
        } else if (filter.filter_type === "id_list" && filter.filter_value) {
          const ids = filter.filter_value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
          if (ids.length > 0) {
            wheres.push(`c.${campaigns.id_col} IN (${ids.map(() => "?").join(",")})`);
            params.push(...ids);
          }
        }

        const whereSql = wheres.length ? ` WHERE ${wheres.join(" AND ")}` : "";
        const sql = `SELECT COUNT(*) as total FROM ${campaigns.table} c${whereSql}`;
        const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
        const total = Number(rows[0]?.total ?? 0);

        actualSummary.push({
          platform: source.platform,
          campaigns: total,
          status: total > 0 ? "ok" : "empty",
        });
      } catch (error) {
        const err = error as { code?: string; message?: string };
        actualSummary.push({
          platform: source.platform,
          campaigns: 0,
          status: "error",
          message:
            err.code === "ER_NO_SUCH_TABLE"
              ? "No campaigns table yet for this platform."
              : err.message ?? "Failed to load campaigns",
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
      const sheetUrl = String(sourceConfig.sheet_url ?? "").trim();
      if (!sheetUrl) {
        planStatus = "missing_url";
        planMessage = "Sheet URL is empty.";
      } else {
        try {
          const rows = await fetchMediaPlan(sheetUrl);
          const channels = aggregatePlanByChannel(rows);
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

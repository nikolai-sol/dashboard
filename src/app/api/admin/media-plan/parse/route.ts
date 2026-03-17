import { NextResponse } from "next/server";
import { collectMonthsFound, parseMediaPlanSource } from "@/lib/gsheet-fetcher";

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sheetUrl = String(url.searchParams.get("url") ?? "").trim();
    const result = await parseMediaPlanSource({ sheet_url: sheetUrl });

    return NextResponse.json({
      rows: result.rows.map((row) => ({
        instrument: row.platform,
        channel: row.channel,
        format: row.format,
        buy_type: row.buy_type,
        budget_plan: row.budget_plan,
        units_plan: row.units_plan,
        unit_price: row.unit_price,
        impressions_plan: row.impressions_plan,
        reach_plan: row.reach_plan,
        frequency_plan: row.frequency_plan,
        views_plan: row.views_plan,
        clicks_plan: row.clicks_plan,
        conversions_plan: row.conversions_plan,
        ctr_plan: row.ctr_plan,
        cpm_plan: row.cpm_plan,
        cpc_plan: row.cpc_plan,
        cpv_plan: row.cpv_plan,
        cpa_plan: row.cpa_plan,
        monthly: row.monthly,
      })),
      months_found: collectMonthsFound(result.rows),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to parse media plan", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { source_config?: unknown };
    const sourceConfig = parseSourceConfig(body.source_config);
    const result = await parseMediaPlanSource(sourceConfig);

    return NextResponse.json({
      rows: result.rows.map((row) => ({
        instrument: row.platform,
        channel: row.channel,
        format: row.format,
        buy_type: row.buy_type,
        budget_plan: row.budget_plan,
        units_plan: row.units_plan,
        unit_price: row.unit_price,
        impressions_plan: row.impressions_plan,
        reach_plan: row.reach_plan,
        frequency_plan: row.frequency_plan,
        views_plan: row.views_plan,
        clicks_plan: row.clicks_plan,
        conversions_plan: row.conversions_plan,
        ctr_plan: row.ctr_plan,
        cpm_plan: row.cpm_plan,
        cpc_plan: row.cpc_plan,
        cpv_plan: row.cpv_plan,
        cpa_plan: row.cpa_plan,
        monthly: row.monthly,
      })),
      months_found: collectMonthsFound(result.rows),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to parse media plan", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

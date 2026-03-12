import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { loadSchema } from "@/lib/schema-parser";
import { buildAggregateQuery, buildTimeseriesQuery } from "@/lib/query-builder";
import {
  aggregatePlanByChannel,
  fetchMediaPlan,
  type ChannelPlanAggregate,
  type MediaPlanRow,
} from "@/lib/gsheet-fetcher";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import type { DashboardData, PlatformStats, TimeSeriesPoint } from "@/lib/types";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type DashboardRow = RowDataPacket & {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: DashboardData["dashboard"]["type"];
  config: string | JsonRecord | null;
};

type SourceRow = RowDataPacket & {
  id: number;
  dashboard_id: number;
  platform: string;
  schema_file: string;
  role: "actual" | "plan";
  source_config: string | JsonRecord | null;
  filter_type: "name_pattern" | "id_list" | "all" | null;
  filter_value: string | null;
};

type AggregateRow = RowDataPacket & {
  total_impressions: number | string | null;
  total_clicks: number | string | null;
  total_spend: number | string | null;
  total_conversions: number | string | null;
  total_views: number | string | null;
  total_reach: number | string | null;
  avg_frequency: number | string | null;
  avg_ctr: number | string | null;
  avg_cpm: number | string | null;
};

type TimeseriesRow = RowDataPacket & {
  date: string | Date;
  impressions: number | string | null;
  clicks: number | string | null;
  spend: number | string | null;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function parseJson(value: unknown): JsonRecord {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as JsonRecord;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return value as JsonRecord;
  }
  return {};
}

function shiftDate(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveDateRange(
  request: Request,
  config: JsonRecord,
): { from: string; to: string } {
  const params = new URL(request.url).searchParams;
  const fromQuery = params.get("from");
  const toQuery = params.get("to");
  const daysQuery = params.get("days");

  const configFrom = String(config.period_from ?? "2025-01-01");
  const configTo = String(config.period_to ?? "2025-03-31");

  if (fromQuery && toQuery) {
    return { from: fromQuery, to: toQuery };
  }

  if (daysQuery) {
    const days = Number(daysQuery);
    if (Number.isFinite(days) && days > 0) {
      const today = new Date();
      const to = today.toISOString().slice(0, 10);
      const from = shiftDate(to, -(days - 1));
      return { from, to };
    }
  }

  return { from: configFrom, to: configTo };
}

function buildPreviousPeriod(dateFrom: string, dateTo: string): { from: string; to: string } {
  const fromDate = new Date(`${dateFrom}T00:00:00Z`);
  const toDate = new Date(`${dateTo}T00:00:00Z`);
  const spanDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
  const prevTo = shiftDate(dateFrom, -1);
  const prevFrom = shiftDate(prevTo, -(spanDays - 1));
  return { from: prevFrom, to: prevTo };
}

function defaultKpiConfig(type: DashboardData["dashboard"]["type"]): string[] {
  if (type === "performance") {
    return ["conversions", "cpa", "clicks", "cpc", "spend"];
  }
  if (type === "overview") {
    return ["impressions", "clicks", "ctr", "spend", "conversions"];
  }
  return ["impressions", "clicks", "ctr", "cpm", "spend"];
}

function getKpiConfig(config: JsonRecord, type: DashboardData["dashboard"]["type"]): string[] {
  const raw = config.kpi_cards;
  if (Array.isArray(raw)) {
    const values = raw
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
    if (values.length === 5) {
      return values;
    }
  }
  return defaultKpiConfig(type);
}

function mergePlatformStats(items: PlatformStats[]): PlatformStats[] {
  const byId = new Map<string, PlatformStats>();

  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, { ...item });
      continue;
    }

    existing.impressions += item.impressions;
    existing.clicks += item.clicks;
    existing.spend += item.spend;
    existing.conversions += item.conversions;
    existing.views += item.views;
    existing.reach += item.reach;
    existing.ctr = existing.impressions > 0 ? (existing.clicks / existing.impressions) * 100 : 0;
    existing.cpm = existing.impressions > 0 ? (existing.spend / existing.impressions) * 1000 : 0;
    existing.frequency = existing.reach > 0 ? existing.impressions / existing.reach : 0;
  }

  return [...byId.values()].map((row) => ({
    ...row,
    ctr: Number(row.ctr.toFixed(2)),
    cpm: Number(row.cpm.toFixed(2)),
    frequency: Number(row.frequency.toFixed(2)),
    spend: Number(row.spend.toFixed(2)),
  }));
}

function mergeTimeseries(items: TimeSeriesPoint[]): TimeSeriesPoint[] {
  const map = new Map<string, TimeSeriesPoint>();

  for (const item of items) {
    const key = `${item.platform}:${item.date}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item });
      continue;
    }
    existing.impressions += item.impressions;
    existing.clicks += item.clicks;
    existing.spend += item.spend;
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildPlanVsFactRows(
  channels: ChannelPlanAggregate[],
  platformMap: Map<string, PlatformStats>,
): DashboardData["plan_vs_fact"] {
  return channels.map((channelAgg) => {
    const facts = channelAgg.platforms.reduce(
      (acc, platformId) => {
        const stat = platformMap.get(platformId);
        if (!stat) return acc;
        acc.budget_fact += stat.spend;
        acc.impressions_fact += stat.impressions;
        acc.clicks_fact += stat.clicks;
        acc.views_fact += stat.views;
        acc.conversions_fact += stat.conversions;
        return acc;
      },
      {
        budget_fact: 0,
        impressions_fact: 0,
        clicks_fact: 0,
        views_fact: 0,
        conversions_fact: 0,
      },
    );

    const cpm_fact =
      facts.impressions_fact > 0 ? (facts.budget_fact / facts.impressions_fact) * 1000 : 0;
    const cpc_fact = facts.clicks_fact > 0 ? facts.budget_fact / facts.clicks_fact : 0;
    const cpv_fact = facts.views_fact > 0 ? facts.budget_fact / facts.views_fact : 0;
    const cpa_fact =
      facts.conversions_fact > 0 ? facts.budget_fact / facts.conversions_fact : 0;

    return {
      channel: channelAgg.channel,
      buy_type: channelAgg.buy_type,
      platforms: channelAgg.platforms,
      platform_colors: channelAgg.platforms.map(
        (platform) => PLATFORM_COLORS[platform]?.hex ?? "#94a3b8",
      ),
      budget_plan: Number(channelAgg.budget_plan.toFixed(2)),
      budget_fact: Number(facts.budget_fact.toFixed(2)),
      pacing:
        channelAgg.budget_plan > 0
          ? Number((facts.budget_fact / channelAgg.budget_plan).toFixed(3))
          : 0,
      impressions_plan: channelAgg.impressions_plan,
      impressions_fact: Math.round(facts.impressions_fact),
      clicks_plan: channelAgg.clicks_plan,
      clicks_fact: Math.round(facts.clicks_fact),
      views_plan: channelAgg.views_plan,
      views_fact: Math.round(facts.views_fact),
      conversions_plan: channelAgg.conversions_plan,
      conversions_fact: Math.round(facts.conversions_fact),
      cpm_plan: Number(channelAgg.cpm_plan.toFixed(4)),
      cpm_fact: Number(cpm_fact.toFixed(4)),
      cpc_plan: Number(channelAgg.cpc_plan.toFixed(4)),
      cpc_fact: Number(cpc_fact.toFixed(4)),
      cpv_plan: Number(channelAgg.cpv_plan.toFixed(4)),
      cpv_fact: Number(cpv_fact.toFixed(4)),
      cpa_plan: Number(channelAgg.cpa_plan.toFixed(4)),
      cpa_fact: Number(cpa_fact.toFixed(4)),
    };
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id: requestedId } = await Promise.resolve(context.params);

    const [dashboardRows] = await pool.execute<DashboardRow[]>(
      "SELECT * FROM dashboards WHERE is_active = TRUE AND (id = ? OR client_id = ?) LIMIT 1",
      [requestedId, requestedId],
    );

    const dashboard = dashboardRows[0];
    if (!dashboard) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }

    const config = parseJson(dashboard.config);
    const range = resolveDateRange(request, config);
    const previousRange = buildPreviousPeriod(range.from, range.to);

    const [sourceRows] = await pool.execute<SourceRow[]>(
      `SELECT ds.*, dcf.filter_type, dcf.filter_value
       FROM dashboard_sources ds
       LEFT JOIN dashboard_campaign_filters dcf ON dcf.dashboard_source_id = ds.id
       WHERE ds.dashboard_id = ?`,
      [dashboard.id],
    );

    const platformStatsRaw: PlatformStats[] = [];
    const timeseriesRaw: TimeSeriesPoint[] = [];
    const prevStatsRaw: PlatformStats[] = [];
    const planRows: MediaPlanRow[] = [];

    for (const source of sourceRows) {
      try {
        const schema = loadSchema(source.schema_file);

        if (source.role === "plan" && schema.source === "gsheet") {
          const sourceConfig = parseJson(source.source_config);
          const sheetUrl = String(sourceConfig.sheet_url ?? "").trim();
          if (sheetUrl) {
            const rows = await fetchMediaPlan(sheetUrl);
            planRows.push(...rows);
          }
          continue;
        }

        if (schema.source !== "mysql" || !schema.tables) {
          continue;
        }

        const filter = {
          filter_type: source.filter_type ?? "all",
          filter_value: source.filter_value,
        };

        const aggregateQuery = buildAggregateQuery(schema, filter, range.from, range.to);
        const [aggregateRows] = await pool.execute<AggregateRow[]>(aggregateQuery.sql, aggregateQuery.params);
        const aggregate = aggregateRows[0];

        const platformMeta = PLATFORM_COLORS[source.platform];
        platformStatsRaw.push({
          id: source.platform,
          name: platformMeta?.label ?? schema.display_name,
          color: platformMeta?.hex ?? "#94a3b8",
          impressions: asNumber(aggregate?.total_impressions),
          clicks: asNumber(aggregate?.total_clicks),
          spend: Number(asNumber(aggregate?.total_spend).toFixed(2)),
          conversions: Math.round(asNumber(aggregate?.total_conversions)),
          views: Math.round(asNumber(aggregate?.total_views)),
          reach: Math.round(asNumber(aggregate?.total_reach)),
          frequency: Number(asNumber(aggregate?.avg_frequency).toFixed(2)),
          ctr: Number(asNumber(aggregate?.avg_ctr).toFixed(2)),
          cpm: Number(asNumber(aggregate?.avg_cpm).toFixed(2)),
        });

        const prevAggregateQuery = buildAggregateQuery(schema, filter, previousRange.from, previousRange.to);
        const [prevAggregateRows] = await pool.execute<AggregateRow[]>(
          prevAggregateQuery.sql,
          prevAggregateQuery.params,
        );
        const prevAggregate = prevAggregateRows[0];
        prevStatsRaw.push({
          id: source.platform,
          name: platformMeta?.label ?? schema.display_name,
          color: platformMeta?.hex ?? "#94a3b8",
          impressions: asNumber(prevAggregate?.total_impressions),
          clicks: asNumber(prevAggregate?.total_clicks),
          spend: Number(asNumber(prevAggregate?.total_spend).toFixed(2)),
          conversions: Math.round(asNumber(prevAggregate?.total_conversions)),
          views: Math.round(asNumber(prevAggregate?.total_views)),
          reach: Math.round(asNumber(prevAggregate?.total_reach)),
          frequency: Number(asNumber(prevAggregate?.avg_frequency).toFixed(2)),
          ctr: Number(asNumber(prevAggregate?.avg_ctr).toFixed(2)),
          cpm: Number(asNumber(prevAggregate?.avg_cpm).toFixed(2)),
        });

        const timeseriesQuery = buildTimeseriesQuery(schema, filter, range.from, range.to);
        const [timeseriesRows] = await pool.execute<TimeseriesRow[]>(timeseriesQuery.sql, timeseriesQuery.params);

        for (const row of timeseriesRows) {
          timeseriesRaw.push({
            date: toIsoDate(row.date),
            platform: source.platform,
            impressions: asNumber(row.impressions),
            clicks: asNumber(row.clicks),
            spend: Number(asNumber(row.spend).toFixed(2)),
          });
        }
      } catch (sourceError) {
        console.warn(`Skipping source ${source.platform}:`, sourceError);
      }
    }

    const platformResults = mergePlatformStats(platformStatsRaw);
    const prevPlatformResults = mergePlatformStats(prevStatsRaw);
    const timeseriesResults = mergeTimeseries(timeseriesRaw);

    const totalImpressions = platformResults.reduce((sum, row) => sum + row.impressions, 0);
    const totalClicks = platformResults.reduce((sum, row) => sum + row.clicks, 0);
    const totalSpend = platformResults.reduce((sum, row) => sum + row.spend, 0);

    const prevImpressions = prevPlatformResults.reduce((sum, row) => sum + row.impressions, 0);
    const prevClicks = prevPlatformResults.reduce((sum, row) => sum + row.clicks, 0);
    const prevSpend = prevPlatformResults.reduce((sum, row) => sum + row.spend, 0);

    const kpi = {
      total_impressions: totalImpressions,
      total_clicks: totalClicks,
      total_spend: Number(totalSpend.toFixed(2)),
      avg_ctr: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
      avg_cpm: totalImpressions > 0 ? Number(((totalSpend / totalImpressions) * 1000).toFixed(2)) : 0,
      prev_impressions: prevImpressions,
      prev_clicks: prevClicks,
      prev_spend: Number(prevSpend.toFixed(2)),
      prev_ctr:
        prevImpressions > 0 ? Number(((prevClicks / prevImpressions) * 100).toFixed(2)) : 0,
      prev_cpm:
        prevImpressions > 0 ? Number(((prevSpend / prevImpressions) * 1000).toFixed(2)) : 0,
    };

    const planByChannel = aggregatePlanByChannel(planRows);
    const platformMap = new Map(platformResults.map((item) => [item.id, item]));
    const planVsFact = buildPlanVsFactRows(planByChannel, platformMap);

    const response: DashboardData = {
      dashboard: {
        client_name: dashboard.client_name,
        dashboard_name: dashboard.dashboard_name,
        type: dashboard.dashboard_type,
        period: {
          from: range.from,
          to: range.to,
        },
        currency: String(config.currency ?? "EUR"),
      },
      kpi_config: getKpiConfig(config, dashboard.dashboard_type),
      kpi,
      platforms: platformResults,
      timeseries: timeseriesResults,
      plan_vs_fact: planVsFact,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

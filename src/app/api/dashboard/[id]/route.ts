import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { loadSchema } from "@/lib/schema-parser";
import {
  getAdsAggregate,
  getCampaignDailyFactsByIds,
  getAdsTimeseries,
  getAnalyticsAggregate,
  getAnalyticsTimeseries,
  getFactByCampaignIds,
  getTimeseriesByCampaignIds,
  type CanonicalFilter,
} from "@/lib/canonical-adapter";
import {
  aggregatePlanByPlatform,
  fetchMediaPlanFromSourceConfig,
  groupByChannel,
  MONTH_COLUMNS,
  type ChannelGroup,
  type MediaPlanRow,
  type PlatformPlanAggregate,
} from "@/lib/gsheet-fetcher";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import {
  resolvePlatformIdFromSourceKey,
  resolveSourceKey,
  resolveSourceType,
} from "@/lib/source-mapping";
import type {
  AnalyticsKPI,
  AnalyticsTimeSeriesPoint,
  DashboardData,
  DashboardSectionId,
  PlatformStats,
  TimeSeriesPoint,
  PlanVsFactItem,
  ChannelPerformanceItem,
  ChannelPerformanceMetric,
} from "@/lib/types";
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

type BindingRow = RowDataPacket & {
  channel: string;
  source_key: string;
  platform_campaign_id: string;
};

type FrequencyOverrideItem = {
  source_key: string;
  platform_campaign_id: string;
  month_key: string;
  frequency: number;
};

type CampaignDailyFactRow = {
  date: string;
  platform_campaign_id: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
};

const SPEND_RELATED_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);
const DEFAULT_SECTION_ORDER_WITH_SPEND: DashboardSectionId[] = [
  "kpi_grid",
  "spend_section",
  "trend_chart",
  "platform_table",
  "channel_table",
  "plan_vs_fact",
];
const DEFAULT_SECTION_ORDER_NO_SPEND: DashboardSectionId[] = [
  "kpi_grid",
  "trend_chart",
  "platform_table",
  "channel_table",
  "plan_vs_fact",
];

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

function parseAccountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function shiftDate(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function resolveDateRange(
  request: Request,
  config: JsonRecord,
): { from: string; to: string } {
  const params = new URL(request.url).searchParams;
  const fromQuery = params.get("from");
  const toQuery = params.get("to");
  const daysQuery = params.get("days");

  const fallbackRange = currentMonthRange();
  const configFrom = String(config.period_from ?? fallbackRange.from);
  const configTo = String(config.period_to ?? fallbackRange.to);

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

function monthKeyFromDate(dateIso: string): string {
  return dateIso.slice(0, 7);
}

function monthStart(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

function monthEnd(dateIso: string): string {
  const date = new Date(`${monthStart(dateIso)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

function inclusiveDays(dateFrom: string, dateTo: string): number {
  const fromDate = new Date(`${dateFrom}T00:00:00Z`);
  const toDate = new Date(`${dateTo}T00:00:00Z`);
  return Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
}

function formatMonthLabel(monthKey: string): string {
  return monthKey.charAt(0).toUpperCase() + monthKey.slice(1);
}

function buildPeriodMonths(dateFrom: string, dateTo: string) {
  const months: Array<{
    key: string;
    label: string;
    from: string;
    to: string;
    days_in_month: number;
    selected_days: number;
  }> = [];
  let cursor = monthStart(dateFrom);
  while (cursor <= dateTo) {
    const cursorMonthEnd = monthEnd(cursor);
    const from = maxIso(dateFrom, cursor);
    const to = minIso(dateTo, cursorMonthEnd);
    const monthIndex = new Date(`${cursor}T00:00:00Z`).getUTCMonth();
    const key = MONTH_COLUMNS[monthIndex];
    months.push({
      key,
      label: formatMonthLabel(key),
      from,
      to,
      days_in_month: inclusiveDays(cursor, cursorMonthEnd),
      selected_days: inclusiveDays(from, to),
    });
    cursor = shiftDate(cursorMonthEnd, 1);
  }
  return months;
}

function roundMetric(value: number, metric: string): number {
  if (
    metric === "ctr" ||
    metric === "cpm" ||
    metric === "cpc" ||
    metric === "cpv" ||
    metric === "cpa" ||
    metric === "frequency"
  ) {
    return Number(value.toFixed(4));
  }
  if (metric === "spend") return Number(value.toFixed(2));
  return Math.round(value);
}

function buildCompletionStatus(metric: string, completionPct: number | null): ChannelPerformanceMetric["status"] {
  if (completionPct === null) return null;
  if (metric === "spend") {
    if (completionPct < 70) return "red";
    if (completionPct < 90) return "yellow";
    if (completionPct <= 110) return "green";
    if (completionPct <= 125) return "yellow";
    return "red";
  }
  if (completionPct < 70) return "red";
  if (completionPct < 90) return "yellow";
  return "green";
}

function buildMetricSummary(metric: string, fact: number, plan: number): ChannelPerformanceMetric {
  const completionPct =
    metric === "ctr" || metric === "cpm" || metric === "cpc" || metric === "cpv" || metric === "cpa"
      ? null
      : plan > 0
        ? (fact / plan) * 100
        : null;
  return {
    fact: roundMetric(fact, metric),
    plan: roundMetric(plan, metric),
    completion_pct: completionPct === null ? null : Number(completionPct.toFixed(1)),
    status: buildCompletionStatus(metric, completionPct),
  };
}

function normalizeFrequencyOverrides(config: JsonRecord): FrequencyOverrideItem[] {
  const raw = config.campaign_frequency_overrides;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const sourceKey = String(row.source_key ?? "").trim().toLowerCase();
      const campaignId = String(row.platform_campaign_id ?? "").trim();
      const monthKey = String(row.month_key ?? "").trim();
      const frequency = Number(row.frequency ?? 0);
      if (!sourceKey || !campaignId || !/^\d{4}-\d{2}$/.test(monthKey) || !Number.isFinite(frequency) || frequency <= 0) {
        return null;
      }
      return {
        source_key: sourceKey,
        platform_campaign_id: campaignId,
        month_key: monthKey,
        frequency: Number(frequency.toFixed(4)),
      };
    })
    .filter((item): item is FrequencyOverrideItem => Boolean(item));
}

function buildFrequencyOverrideMap(items: FrequencyOverrideItem[]) {
  return new Map(
    items.map((item) => [
      `${item.source_key}:${item.platform_campaign_id}:${item.month_key}`,
      item.frequency,
    ]),
  );
}

function applyFrequencyOverride(
  sourceKey: string,
  row: CampaignDailyFactRow,
  overrideMap: Map<string, number>,
): CampaignDailyFactRow {
  const override = overrideMap.get(`${sourceKey}:${row.platform_campaign_id}:${monthKeyFromDate(row.date)}`);
  if (!override || override <= 0) {
    return row;
  }
  return {
    ...row,
    reach: row.impressions > 0 ? row.impressions / override : 0,
  };
}

function sumCampaignDailyFacts(rows: CampaignDailyFactRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.impressions += row.impressions;
      acc.reach += row.reach;
      acc.clicks += row.clicks;
      acc.spend += row.spend;
      acc.views += row.views;
      acc.conversions += row.conversions;
      return acc;
    },
    { impressions: 0, reach: 0, clicks: 0, spend: 0, views: 0, conversions: 0 },
  );
}

function sumFactRows(rows: NonNullable<DashboardData["channel_timeseries"]>) {
  return rows.reduce(
    (acc, row) => {
      acc.impressions += asNumber(row.impressions);
      acc.reach += asNumber(row.reach);
      acc.clicks += asNumber(row.clicks);
      acc.views += asNumber(row.views);
      acc.conversions += asNumber(row.conversions);
      acc.spend += asNumber(row.spend);
      return acc;
    },
    { impressions: 0, reach: 0, clicks: 0, views: 0, conversions: 0, spend: 0 },
  );
}

function buildNormalizedPlanMetrics(
  row: PlanVsFactItem,
  months: Array<{ key: string; selected_days: number; days_in_month: number }>,
) {
  const totals = { impressions: 0, reach: 0, clicks: 0, views: 0, conversions: 0, spend: 0 };
  months.forEach((month) => {
    const item = row.monthly_breakdown?.[month.key];
    if (!item) return;
    const ratio = month.days_in_month > 0 ? month.selected_days / month.days_in_month : 0;
    totals.impressions += asNumber(item.impressions) * ratio;
    totals.reach += asNumber(item.reach) * ratio;
    totals.clicks += asNumber(item.clicks) * ratio;
    totals.views += asNumber(item.views) * ratio;
    totals.conversions += asNumber(item.conversions) * ratio;
    totals.spend += asNumber(item.budget) * ratio;
  });

  const frequency = totals.reach > 0 ? totals.impressions / totals.reach : 0;
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const cpv = totals.views > 0 ? totals.spend / totals.views : 0;
  const cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0;

  return { ...totals, frequency, ctr, cpm, cpc, cpv, cpa };
}

function defaultKpiConfig(type: DashboardData["dashboard"]["type"], showSpend: boolean): string[] {
  if (type === "performance") {
    return showSpend
      ? ["conversions", "cpa", "clicks", "cpc", "spend"]
      : ["conversions", "clicks", "ctr", "impressions", "reach"];
  }
  if (type === "overview") {
    return showSpend
      ? ["impressions", "clicks", "ctr", "spend", "conversions"]
      : ["impressions", "clicks", "ctr", "conversions", "reach"];
  }
  return showSpend
    ? ["impressions", "clicks", "ctr", "cpm", "spend"]
    : ["impressions", "clicks", "ctr", "views", "reach"];
}

function getKpiConfig(
  config: JsonRecord,
  type: DashboardData["dashboard"]["type"],
  showSpend: boolean,
): string[] {
  const raw = config.kpi_cards;
  if (Array.isArray(raw)) {
    const values = raw
      .map((item) => String(item).trim().toLowerCase())
      .filter((item) => showSpend || !SPEND_RELATED_METRICS.has(item))
      .filter(Boolean)
      .slice(0, 5);
    if (values.length > 0) {
      return values;
    }
  }
  return defaultKpiConfig(type, showSpend);
}

function getSectionOrder(config: JsonRecord, showSpend: boolean): DashboardSectionId[] {
  const allowed = showSpend
    ? DEFAULT_SECTION_ORDER_WITH_SPEND
    : DEFAULT_SECTION_ORDER_NO_SPEND;
  if (!Array.isArray(config.section_order)) {
    return allowed;
  }
  const raw = config.section_order.map((item) => String(item) as DashboardSectionId);
  const seen = new Set<DashboardSectionId>();
  return raw.filter((item) => allowed.includes(item) && !seen.has(item) && seen.add(item));
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

function mergeAnalyticsKpi(items: AnalyticsKPI[]): AnalyticsKPI {
  if (!items.length) {
    return {
      total_visits: 0,
      total_users: 0,
      total_pageviews: 0,
      avg_bounce_rate: 0,
      avg_visit_duration: 0,
    };
  }

  const totals = items.reduce(
    (acc, item) => {
      acc.total_visits += item.total_visits;
      acc.total_users += item.total_users;
      acc.total_pageviews += item.total_pageviews;
      acc.avg_bounce_rate += item.avg_bounce_rate;
      acc.avg_visit_duration += item.avg_visit_duration;
      return acc;
    },
    {
      total_visits: 0,
      total_users: 0,
      total_pageviews: 0,
      avg_bounce_rate: 0,
      avg_visit_duration: 0,
    },
  );

  return {
    total_visits: totals.total_visits,
    total_users: totals.total_users,
    total_pageviews: totals.total_pageviews,
    avg_bounce_rate: Number((totals.avg_bounce_rate / items.length).toFixed(2)),
    avg_visit_duration: Number((totals.avg_visit_duration / items.length).toFixed(2)),
  };
}

function mergeAnalyticsTimeseries(items: AnalyticsTimeSeriesPoint[]): AnalyticsTimeSeriesPoint[] {
  const map = new Map<string, AnalyticsTimeSeriesPoint>();

  for (const item of items) {
    const existing = map.get(item.date);
    if (!existing) {
      map.set(item.date, { ...item });
      continue;
    }

    existing.visits += item.visits;
    existing.users += item.users;
    existing.pageviews += item.pageviews;
    existing.bounce_rate = Number(((existing.bounce_rate + item.bounce_rate) / 2).toFixed(2));
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function loadAdjustedCampaignDailyFacts(
  sourceKey: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
  overrideMap: Map<string, number>,
): Promise<CampaignDailyFactRow[]> {
  const rows = await getCampaignDailyFactsByIds(sourceKey, campaignIds, dateFrom, dateTo);
  return rows.map((row) =>
    applyFrequencyOverride(
      sourceKey,
      {
        date: toIsoDate(row.date),
        platform_campaign_id: String(row.platform_campaign_id ?? ""),
        impressions: asNumber(row.impressions),
        reach: asNumber(row.reach),
        clicks: asNumber(row.clicks),
        spend: Number(asNumber(row.spend).toFixed(2)),
        views: asNumber(row.views),
        conversions: asNumber(row.conversions),
      },
      overrideMap,
    ),
  );
}

async function applyAggregateReachOverrides(
  sourceKey: string,
  aggregate: Awaited<ReturnType<typeof getAdsAggregate>>,
  dateFrom: string,
  dateTo: string,
  overrideMap: Map<string, number>,
) {
  const overrideCampaignIds = Array.from(
    new Set(
      Array.from(overrideMap.keys())
        .filter((key) => key.startsWith(`${sourceKey}:`))
        .map((key) => key.split(":")[1])
        .filter(Boolean),
    ),
  );
  if (!overrideCampaignIds.length || !aggregate) {
    return aggregate;
  }

  const rawRows = await getCampaignDailyFactsByIds(sourceKey, overrideCampaignIds, dateFrom, dateTo);
  if (!rawRows.length) {
    return aggregate;
  }

  const rawReach = rawRows.reduce((sum, row) => sum + asNumber(row.reach), 0);
  const adjustedRows = await loadAdjustedCampaignDailyFacts(
    sourceKey,
    overrideCampaignIds,
    dateFrom,
    dateTo,
    overrideMap,
  );
  const adjustedReach = adjustedRows.reduce((sum, row) => sum + row.reach, 0);
  const nextReach = Math.max(0, asNumber(aggregate.total_reach) - rawReach + adjustedReach);
  return {
    ...aggregate,
    total_reach: nextReach,
  };
}

async function buildPlanVsFactRowsByChannel(
  channelGroups: ChannelGroup[],
  bindingsByChannel: Map<string, Array<{ source_key: string; platform_campaign_id: string }>>,
  actualAdsSourceKeys: Set<string>,
  dateFrom: string,
  dateTo: string,
  overrideMap: Map<string, number>,
): Promise<PlanVsFactItem[]> {
  const factPromises = channelGroups.map(async (group) => {
    const bindings = bindingsByChannel.get(group.channel) ?? [];
    if (bindings.length === 0) {
      const fallbackSourceKey = resolveSourceKey(group.instrument);
      if (!actualAdsSourceKeys.has(fallbackSourceKey)) {
        return null;
      }
      return getFactByCampaignIds(fallbackSourceKey, [], dateFrom, dateTo);
    }

    const bySource = new Map<string, string[]>();
    bindings.forEach((binding) => {
      if (!bySource.has(binding.source_key)) {
        bySource.set(binding.source_key, []);
      }
      bySource.get(binding.source_key)!.push(binding.platform_campaign_id);
    });

    const results = await Promise.all(
      Array.from(bySource.entries()).map(([sourceKey, ids]) =>
        loadAdjustedCampaignDailyFacts(sourceKey, ids, dateFrom, dateTo, overrideMap),
      ),
    );

    const totals = sumCampaignDailyFacts(results.flat());
    return {
      total_impressions: totals.impressions,
      total_reach: totals.reach,
      total_clicks: totals.clicks,
      total_spend: totals.spend,
      total_conversions: totals.conversions,
      total_views: totals.views,
    };
  });

  const facts = await Promise.all(factPromises);

  return channelGroups.map((group, index) => {
    const fact = facts[index] ?? null;
    const bindings = bindingsByChannel.get(group.channel) ?? [];
    const platforms =
      bindings.length > 0
        ? Array.from(new Set(bindings.map((binding) => binding.source_key))).map((sourceKey) => {
            const platformId = resolvePlatformIdFromSourceKey(sourceKey);
            const meta = PLATFORM_COLORS[platformId];
            return {
              source_key: sourceKey,
              label: meta?.label ?? sourceKey,
              color: meta?.hex ?? "#94a3b8",
            };
          })
        : (() => {
            const fallbackSourceKey = resolveSourceKey(group.instrument);
            if (!actualAdsSourceKeys.has(fallbackSourceKey)) return [];
            const platformId = resolvePlatformIdFromSourceKey(fallbackSourceKey);
            const meta = PLATFORM_COLORS[platformId];
            return [
              {
                source_key: fallbackSourceKey,
                label: meta?.label ?? fallbackSourceKey,
                color: meta?.hex ?? "#94a3b8",
              },
            ];
          })();

    const totalImpressions = asNumber(fact?.total_impressions);
    const totalReach = asNumber(fact?.total_reach);
    const totalClicks = asNumber(fact?.total_clicks);
    const totalViews = asNumber(fact?.total_views);
    const totalConversions = asNumber(fact?.total_conversions);
    const totalSpend = Number(asNumber(fact?.total_spend).toFixed(2));

    const budgetPlan = Number(group.budget_plan || 0);
    const impressionsPlan = Number(group.impressions_plan || 0);
    const reachPlan = Number(group.reach_plan || 0);
    const clicksPlan = Number(group.clicks_plan || 0);
    const viewsPlan = Number(group.views_plan || 0);
    const conversionsPlan = Number(group.conversions_plan || 0);

    const pacing = budgetPlan > 0 ? totalSpend / budgetPlan : 0;

    const frequencyPlan = reachPlan > 0 ? impressionsPlan / reachPlan : 0;
    const frequencyFact = totalReach > 0 ? totalImpressions / totalReach : 0;
    const cpmPlan = impressionsPlan > 0 ? (budgetPlan / impressionsPlan) * 1000 : 0;
    const cpcPlan = clicksPlan > 0 ? budgetPlan / clicksPlan : 0;
    const cpvPlan = viewsPlan > 0 ? budgetPlan / viewsPlan : 0;
    const cpaPlan = conversionsPlan > 0 ? budgetPlan / conversionsPlan : 0;

    const cpmFact = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const cpcFact = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const cpvFact = totalViews > 0 ? totalSpend / totalViews : 0;
    const cpaFact = totalConversions > 0 ? totalSpend / totalConversions : 0;

    return {
      channel: group.channel,
      instrument: group.instrument,
      format: group.format,
      buy_type: group.buy_type,
      platforms,
      campaign_count: bindings.length,

      budget_plan: Number(budgetPlan.toFixed(2)),
      impressions_plan: impressionsPlan,
      reach_plan: Math.round(reachPlan),
      clicks_plan: clicksPlan,
      views_plan: viewsPlan,
      conversions_plan: conversionsPlan,
      monthly_plan: { ...group.monthly },
      monthly_breakdown: Object.fromEntries(
        Object.entries(group.monthly_breakdown ?? {}).map(([month, item]) => [
          month,
          {
            units: Number(item.units || 0),
            budget: Number((item.budget || 0).toFixed(2)),
            impressions: Math.round(item.impressions || 0),
            clicks: Math.round(item.clicks || 0),
            views: Math.round(item.views || 0),
            conversions: Math.round(item.conversions || 0),
            reach: Math.round(item.reach || 0),
            ctr: Number((item.ctr || 0).toFixed(4)),
          },
        ]),
      ),
      budget_fact: Number(totalSpend.toFixed(2)),
      impressions_fact: Math.round(totalImpressions),
      reach_fact: Math.round(totalReach),
      clicks_fact: Math.round(totalClicks),
      views_fact: Math.round(totalViews),
      conversions_fact: Math.round(totalConversions),
      pacing,
      frequency_plan: Number(frequencyPlan.toFixed(4)),
      frequency_fact: Number(frequencyFact.toFixed(4)),

      cpm_plan: Number(cpmPlan.toFixed(4)),
      cpm_fact: Number(cpmFact.toFixed(4)),
      cpc_plan: Number(cpcPlan.toFixed(4)),
      cpc_fact: Number(cpcFact.toFixed(4)),
      cpv_plan: Number(cpvPlan.toFixed(4)),
      cpv_fact: Number(cpvFact.toFixed(4)),
      cpa_plan: Number(cpaPlan.toFixed(4)),
      cpa_fact: Number(cpaFact.toFixed(4)),
    };
  });
}

async function buildChannelTimeseries(
  channelGroups: ChannelGroup[],
  bindingsByChannel: Map<string, Array<{ source_key: string; platform_campaign_id: string }>>,
  actualAdsSourceKeys: Set<string>,
  dateFrom: string,
  dateTo: string,
  overrideMap: Map<string, number>,
): Promise<DashboardData["channel_timeseries"]> {
  const timeseries = await Promise.all(
    channelGroups.map(async (group) => {
      const bindings = bindingsByChannel.get(group.channel) ?? [];
      const bySource = new Map<string, string[]>();

      if (bindings.length === 0) {
        const fallbackSourceKey = resolveSourceKey(group.instrument);
        if (actualAdsSourceKeys.has(fallbackSourceKey)) {
          bySource.set(fallbackSourceKey, []);
        }
      } else {
        bindings.forEach((binding) => {
          if (!bySource.has(binding.source_key)) {
            bySource.set(binding.source_key, []);
          }
          bySource.get(binding.source_key)!.push(binding.platform_campaign_id);
        });
      }

      if (!bySource.size) return [];

      const sourceResults = await Promise.all(
        Array.from(bySource.entries()).map(([sourceKey, ids]) =>
          ids.length
            ? loadAdjustedCampaignDailyFacts(sourceKey, ids, dateFrom, dateTo, overrideMap)
            : getTimeseriesByCampaignIds(sourceKey, ids, dateFrom, dateTo).then((rows) =>
                rows.map((row) => ({
                  date: toIsoDate(row.date),
                  platform_campaign_id: "",
                  impressions: asNumber(row.impressions),
                  reach: asNumber(row.reach),
                  clicks: asNumber(row.clicks),
                  spend: Number(asNumber(row.spend).toFixed(2)),
                  views: asNumber(row.views),
                  conversions: asNumber(row.conversions),
                })),
              ),
        ),
      );

      const byDate = new Map<
        string,
        { impressions: number; reach: number; clicks: number; spend: number; views: number; conversions: number }
      >();

      sourceResults.flat().forEach((row) => {
        const date = toIsoDate(row.date);
        if (!byDate.has(date)) {
          byDate.set(date, { impressions: 0, reach: 0, clicks: 0, spend: 0, views: 0, conversions: 0 });
        }
        const item = byDate.get(date)!;
        item.impressions += asNumber(row.impressions);
        item.reach += asNumber(row.reach);
        item.clicks += asNumber(row.clicks);
        item.spend += asNumber(row.spend);
        item.views += asNumber(row.views);
        item.conversions += asNumber(row.conversions);
      });

      return Array.from(byDate.entries()).map(([date, item]) => ({
        date,
        channel: group.channel,
        instrument: group.instrument,
        impressions: item.impressions,
        reach: item.reach,
        clicks: item.clicks,
        spend: Number(item.spend.toFixed(2)),
        views: item.views,
        conversions: item.conversions,
      }));
    }),
  );

  return timeseries.flat().sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel));
}

function buildChannelPerformance(
  planVsFact: PlanVsFactItem[],
  channelTimeseries: DashboardData["channel_timeseries"],
  dateFrom: string,
  dateTo: string,
): ChannelPerformanceItem[] {
  const periodMonths = buildPeriodMonths(dateFrom, dateTo);
  const factRowsByChannel = new Map<string, NonNullable<DashboardData["channel_timeseries"]>>();

  (channelTimeseries ?? []).forEach((row) => {
    if (!factRowsByChannel.has(row.channel)) {
      factRowsByChannel.set(row.channel, []);
    }
    factRowsByChannel.get(row.channel)!.push(row);
  });

  return planVsFact.map((row) => {
    const planOnly = row.campaign_count === 0;
    const factRows = planOnly ? [] : factRowsByChannel.get(row.channel) ?? [];
    const summaryFacts = sumFactRows(factRows);
    const summaryPlan = buildNormalizedPlanMetrics(row, periodMonths);
    const metrics: ChannelPerformanceItem["metrics"] = {
      impressions: buildMetricSummary("impressions", summaryFacts.impressions, summaryPlan.impressions),
      reach: buildMetricSummary("reach", summaryFacts.reach, summaryPlan.reach),
      frequency: buildMetricSummary(
        "frequency",
        summaryFacts.reach > 0 ? summaryFacts.impressions / summaryFacts.reach : 0,
        summaryPlan.frequency,
      ),
      clicks: buildMetricSummary("clicks", summaryFacts.clicks, summaryPlan.clicks),
      views: buildMetricSummary("views", summaryFacts.views, summaryPlan.views),
      conversions: buildMetricSummary("conversions", summaryFacts.conversions, summaryPlan.conversions),
      spend: buildMetricSummary("spend", summaryFacts.spend, summaryPlan.spend),
      ctr: buildMetricSummary(
        "ctr",
        summaryFacts.impressions > 0 ? (summaryFacts.clicks / summaryFacts.impressions) * 100 : 0,
        summaryPlan.ctr,
      ),
      cpm: buildMetricSummary(
        "cpm",
        summaryFacts.impressions > 0 ? (summaryFacts.spend / summaryFacts.impressions) * 1000 : 0,
        summaryPlan.cpm,
      ),
      cpc: buildMetricSummary(
        "cpc",
        summaryFacts.clicks > 0 ? summaryFacts.spend / summaryFacts.clicks : 0,
        summaryPlan.cpc,
      ),
      cpv: buildMetricSummary(
        "cpv",
        summaryFacts.views > 0 ? summaryFacts.spend / summaryFacts.views : 0,
        summaryPlan.cpv,
      ),
      cpa: buildMetricSummary(
        "cpa",
        summaryFacts.conversions > 0 ? summaryFacts.spend / summaryFacts.conversions : 0,
        summaryPlan.cpa,
      ),
    };

    const months =
      periodMonths.length > 1
        ? periodMonths.map((month) => {
            const monthlyFacts = sumFactRows(
              factRows.filter((factRow) => factRow.date >= month.from && factRow.date <= month.to),
            );
            const monthlyPlan = buildNormalizedPlanMetrics(row, [month]);
            return {
              month: month.label,
              from: month.from,
              to: month.to,
              metrics: {
                impressions: buildMetricSummary("impressions", monthlyFacts.impressions, monthlyPlan.impressions),
                reach: buildMetricSummary("reach", monthlyFacts.reach, monthlyPlan.reach),
                frequency: buildMetricSummary(
                  "frequency",
                  monthlyFacts.reach > 0 ? monthlyFacts.impressions / monthlyFacts.reach : 0,
                  monthlyPlan.frequency,
                ),
                clicks: buildMetricSummary("clicks", monthlyFacts.clicks, monthlyPlan.clicks),
                views: buildMetricSummary("views", monthlyFacts.views, monthlyPlan.views),
                conversions: buildMetricSummary("conversions", monthlyFacts.conversions, monthlyPlan.conversions),
                spend: buildMetricSummary("spend", monthlyFacts.spend, monthlyPlan.spend),
                ctr: buildMetricSummary(
                  "ctr",
                  monthlyFacts.impressions > 0 ? (monthlyFacts.clicks / monthlyFacts.impressions) * 100 : 0,
                  monthlyPlan.ctr,
                ),
                cpm: buildMetricSummary(
                  "cpm",
                  monthlyFacts.impressions > 0 ? (monthlyFacts.spend / monthlyFacts.impressions) * 1000 : 0,
                  monthlyPlan.cpm,
                ),
                cpc: buildMetricSummary(
                  "cpc",
                  monthlyFacts.clicks > 0 ? monthlyFacts.spend / monthlyFacts.clicks : 0,
                  monthlyPlan.cpc,
                ),
                cpv: buildMetricSummary(
                  "cpv",
                  monthlyFacts.views > 0 ? monthlyFacts.spend / monthlyFacts.views : 0,
                  monthlyPlan.cpv,
                ),
                cpa: buildMetricSummary(
                  "cpa",
                  monthlyFacts.conversions > 0 ? monthlyFacts.spend / monthlyFacts.conversions : 0,
                  monthlyPlan.cpa,
                ),
              },
            };
          })
        : undefined;

    return {
      channel: row.channel,
      instrument: row.instrument,
      buy_type: row.buy_type,
      platforms: row.platforms,
      campaign_count: row.campaign_count,
      plan_only: planOnly,
      metrics,
      months,
    };
  });
}

function buildPlanBasedPlatformSpend(
  platformStats: PlatformStats[],
  planRows: MediaPlanRow[],
): Map<string, number> {
  const rowsByPlatform = new Map<string, MediaPlanRow[]>();
  for (const row of planRows) {
    const platformId = String(row.platform ?? "").trim().toLowerCase();
    if (!platformId) continue;
    if (!rowsByPlatform.has(platformId)) {
      rowsByPlatform.set(platformId, []);
    }
    rowsByPlatform.get(platformId)!.push(row);
  }

  const spendByPlatform = new Map<string, number>();
  for (const stat of platformStats) {
    const planPlatformRows = rowsByPlatform.get(stat.id) ?? [];
    if (!planPlatformRows.length) continue;

    const totalPlanBudget = planPlatformRows.reduce((sum, row) => sum + asNumber(row.budget_plan), 0);
    const derivedSpend = planPlatformRows.reduce((sum, row) => {
      const budgetShare =
        totalPlanBudget > 0 ? asNumber(row.budget_plan) / totalPlanBudget : 1 / planPlatformRows.length;
      const impressions = stat.impressions * budgetShare;
      const clicks = stat.clicks * budgetShare;
      const views = stat.views * budgetShare;
      const conversions = stat.conversions * budgetShare;

      if (row.buy_type === "CPC" && row.cpc_plan > 0) {
        return sum + clicks * row.cpc_plan;
      }
      if (row.buy_type === "CPV" && row.cpv_plan > 0) {
        return sum + views * row.cpv_plan;
      }
      if (row.buy_type === "CPA" && row.cpa_plan > 0) {
        return sum + conversions * row.cpa_plan;
      }
      if (row.cpm_plan > 0) {
        return sum + (impressions / 1000) * row.cpm_plan;
      }
      return sum;
    }, 0);

    if (derivedSpend > 0) {
      spendByPlatform.set(stat.id, Number(derivedSpend.toFixed(2)));
    }
  }

  return spendByPlatform;
}

function buildPlanBasedTimeseriesSpend(
  timeseries: TimeSeriesPoint[],
  planRows: MediaPlanRow[],
): void {
  const rowsByPlatform = new Map<string, MediaPlanRow[]>();
  for (const row of planRows) {
    const platformId = String(row.platform ?? "").trim().toLowerCase();
    if (!platformId) continue;
    if (!rowsByPlatform.has(platformId)) {
      rowsByPlatform.set(platformId, []);
    }
    rowsByPlatform.get(platformId)!.push(row);
  }

  timeseries.forEach((point) => {
    const planPlatformRows = rowsByPlatform.get(point.platform) ?? [];
    if (!planPlatformRows.length) return;

    const totalPlanBudget = planPlatformRows.reduce((sum, row) => sum + asNumber(row.budget_plan), 0);
    const derivedSpend = planPlatformRows.reduce((sum, row) => {
      const budgetShare =
        totalPlanBudget > 0 ? asNumber(row.budget_plan) / totalPlanBudget : 1 / planPlatformRows.length;
      const impressions = point.impressions * budgetShare;
      const clicks = point.clicks * budgetShare;

      if (row.buy_type === "CPC" && row.cpc_plan > 0) {
        return sum + clicks * row.cpc_plan;
      }
      if (row.cpm_plan > 0) {
        return sum + (impressions / 1000) * row.cpm_plan;
      }
      return sum;
    }, 0);

    if (derivedSpend > 0) {
      point.spend = Number(derivedSpend.toFixed(2));
    }
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
    const frequencyOverrides = normalizeFrequencyOverrides(config);
    const frequencyOverrideMap = buildFrequencyOverrideMap(frequencyOverrides);
    const showSpend = Boolean(config.show_spend ?? true);
    const spendSource =
      String(config.spend_source ?? "platform_actual") === "media_plan_derived"
        ? "media_plan_derived"
        : "platform_actual";
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
    const analyticsKpiRaw: AnalyticsKPI[] = [];
    const analyticsTimeseriesRaw: AnalyticsTimeSeriesPoint[] = [];
    const actualAdsSourceKeys = new Set<string>();

    for (const source of sourceRows) {
      try {
        const schema = loadSchema(source.schema_file);
        const sourceKey = schema.source_key ?? resolveSourceKey(source.platform);
        const sourceType = schema.source_type ?? resolveSourceType(sourceKey);
        const sourceConfig = parseJson(source.source_config);

        if (source.role === "plan" && (schema.source === "gsheet" || sourceType === "gsheet")) {
          const rows = await fetchMediaPlanFromSourceConfig(sourceConfig);
          planRows.push(...rows);
          continue;
        }

        if (schema.source !== "mysql") {
          continue;
        }

        const filter: CanonicalFilter = {
          source_key: sourceKey,
          date_from: range.from,
          date_to: range.to,
          account_ids: parseAccountIds(sourceConfig.account_ids),
          campaign_filter: {
            filter_type: source.filter_type ?? "all",
            filter_value: source.filter_value,
          },
        };

        if (sourceType === "ads") {
          actualAdsSourceKeys.add(sourceKey);
          const aggregate = await applyAggregateReachOverrides(
            sourceKey,
            await getAdsAggregate(filter),
            range.from,
            range.to,
            frequencyOverrideMap,
          );

          const platformMeta = PLATFORM_COLORS[source.platform];
          const impressions = asNumber(aggregate?.total_impressions);
          const clicks = asNumber(aggregate?.total_clicks);
          const spend = Number(asNumber(aggregate?.total_spend).toFixed(2));
          const reach = Math.round(asNumber(aggregate?.total_reach));

          platformStatsRaw.push({
            id: source.platform,
            name: platformMeta?.label ?? schema.display_name,
            color: platformMeta?.hex ?? "#94a3b8",
            impressions,
            clicks,
            spend,
            conversions: Math.round(asNumber(aggregate?.total_conversions)),
            views: Math.round(asNumber(aggregate?.total_views)),
            reach,
            frequency: reach > 0 ? Number((impressions / reach).toFixed(2)) : 0,
            ctr: Number(asNumber(aggregate?.avg_ctr).toFixed(2)),
            cpm: Number(asNumber(aggregate?.avg_cpm).toFixed(2)),
          });

          const prevAggregate = await applyAggregateReachOverrides(
            sourceKey,
            await getAdsAggregate({
              ...filter,
              date_from: previousRange.from,
              date_to: previousRange.to,
            }),
            previousRange.from,
            previousRange.to,
            frequencyOverrideMap,
          );
          const prevImpressionsRaw = asNumber(prevAggregate?.total_impressions);
          const prevClicksRaw = asNumber(prevAggregate?.total_clicks);
          const prevSpendRaw = Number(asNumber(prevAggregate?.total_spend).toFixed(2));
          const prevReach = Math.round(asNumber(prevAggregate?.total_reach));
          prevStatsRaw.push({
            id: source.platform,
            name: platformMeta?.label ?? schema.display_name,
            color: platformMeta?.hex ?? "#94a3b8",
            impressions: prevImpressionsRaw,
            clicks: prevClicksRaw,
            spend: prevSpendRaw,
            conversions: Math.round(asNumber(prevAggregate?.total_conversions)),
            views: Math.round(asNumber(prevAggregate?.total_views)),
            reach: prevReach,
            frequency: prevReach > 0 ? Number((prevImpressionsRaw / prevReach).toFixed(2)) : 0,
            ctr: Number(asNumber(prevAggregate?.avg_ctr).toFixed(2)),
            cpm: Number(asNumber(prevAggregate?.avg_cpm).toFixed(2)),
          });

          const timeseriesRows = await getAdsTimeseries(filter);
          for (const row of timeseriesRows) {
            timeseriesRaw.push({
              date: toIsoDate(row.date),
              platform: source.platform,
              impressions: asNumber(row.impressions),
              clicks: asNumber(row.clicks),
              spend: Number(asNumber(row.spend).toFixed(2)),
            });
          }
          continue;
        }

        if (sourceType === "analytics") {
          const aggregate = await getAnalyticsAggregate(filter);
          analyticsKpiRaw.push({
            total_visits: Math.round(asNumber(aggregate?.total_visits)),
            total_users: Math.round(asNumber(aggregate?.total_users)),
            total_pageviews: Math.round(asNumber(aggregate?.total_pageviews)),
            avg_bounce_rate: Number(asNumber(aggregate?.avg_bounce_rate).toFixed(2)),
            avg_visit_duration: Number(asNumber(aggregate?.avg_visit_duration).toFixed(2)),
          });

          const timeseriesRows = await getAnalyticsTimeseries(filter);
          for (const row of timeseriesRows) {
            analyticsTimeseriesRaw.push({
              date: toIsoDate(row.date),
              visits: Math.round(asNumber(row.visits)),
              users: Math.round(asNumber(row.users)),
              pageviews: Math.round(asNumber(row.pageviews)),
              bounce_rate: Number(asNumber(row.bounce_rate).toFixed(2)),
            });
          }
        }
      } catch (sourceError) {
        console.warn(`Skipping source ${source.platform}:`, sourceError);
      }
    }

    const platformResults = mergePlatformStats(platformStatsRaw);
    const prevPlatformResults = mergePlatformStats(prevStatsRaw);
    const timeseriesResults = mergeTimeseries(timeseriesRaw);

    if (spendSource === "media_plan_derived") {
      buildPlanBasedTimeseriesSpend(timeseriesResults, planRows);

      const planSpendByPlatform = buildPlanBasedPlatformSpend(platformResults, planRows);
      const prevPlanSpendByPlatform = buildPlanBasedPlatformSpend(prevPlatformResults, planRows);

      platformResults.forEach((row) => {
        const derivedSpend = planSpendByPlatform.get(row.id);
        if (derivedSpend === undefined) return;
        row.spend = derivedSpend;
        row.cpm = row.impressions > 0 ? Number(((derivedSpend / row.impressions) * 1000).toFixed(2)) : 0;
      });

      prevPlatformResults.forEach((row) => {
        const derivedSpend = prevPlanSpendByPlatform.get(row.id);
        if (derivedSpend === undefined) return;
        row.spend = derivedSpend;
        row.cpm = row.impressions > 0 ? Number(((derivedSpend / row.impressions) * 1000).toFixed(2)) : 0;
      });
    }

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

    const planByChannel = groupByChannel(planRows);
    const planByPlatform = aggregatePlanByPlatform(planRows);
    const [bindingRows] = await pool.execute<BindingRow[]>(
      `SELECT channel, source_key, platform_campaign_id
       FROM media_plan_bindings
       WHERE dashboard_id = ?`,
      [dashboard.id],
    );
    const bindingsByChannel = bindingRows.reduce((acc, row) => {
      const channel = String(row.channel ?? "");
      if (!acc.has(channel)) {
        acc.set(channel, []);
      }
      acc.get(channel)!.push({
        source_key: String(row.source_key ?? ""),
        platform_campaign_id: String(row.platform_campaign_id ?? ""),
      });
      return acc;
    }, new Map<string, Array<{ source_key: string; platform_campaign_id: string }>>());
    const planVsFact = await buildPlanVsFactRowsByChannel(
      planByChannel,
      bindingsByChannel,
      actualAdsSourceKeys,
      range.from,
      range.to,
      frequencyOverrideMap,
    );
    const channelTimeseries = await buildChannelTimeseries(
      planByChannel,
      bindingsByChannel,
      actualAdsSourceKeys,
      range.from,
      range.to,
      frequencyOverrideMap,
    );
    const channelPerformance = buildChannelPerformance(planVsFact, channelTimeseries, range.from, range.to);
    const analyticsKpi = mergeAnalyticsKpi(analyticsKpiRaw);
    const analyticsTimeseries = mergeAnalyticsTimeseries(analyticsTimeseriesRaw);

    const response: DashboardData = {
      dashboard: {
        client_name: dashboard.client_name,
        dashboard_name: dashboard.dashboard_name,
        logo_url: typeof config.logo_url === "string" ? config.logo_url : null,
        type: dashboard.dashboard_type,
        period: {
          from: range.from,
          to: range.to,
        },
        currency: String(config.currency ?? "EUR"),
        show_spend: showSpend,
        section_order: getSectionOrder(config, showSpend),
      },
      kpi_config: getKpiConfig(config, dashboard.dashboard_type, showSpend),
      kpi,
      platforms: platformResults,
      timeseries: timeseriesResults,
      plan_vs_fact: planVsFact,
      channel_performance: channelPerformance,
      channel_timeseries: channelTimeseries,
      analytics:
        analyticsKpiRaw.length > 0
          ? {
              kpi: analyticsKpi,
              timeseries: analyticsTimeseries,
            }
          : undefined,
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

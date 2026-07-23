import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import {
  getDefaultAbbottCounterIds,
  getDefaultZarukuCounterIds,
  loadAbbottBiData,
  type AbbottDashboardAudience,
} from "@/lib/abbott-bi";
import { loadZarukuSeoData } from "@/lib/zaruku-seo";
import { loadSchema } from "@/lib/schema-parser";
import {
  getAdsAggregate,
  getCampaignBreakdown,
  getCampaignDailyFactsByIds,
  getAdsTimeseries,
  getAnalyticsAggregate,
  getAnalyticsTrafficSources,
  getAnalyticsTimeseries,
  getFactByCampaignIds,
  getPromopagesAggregate,
  getPromopagesAggregateByCampaignIds,
  getPromopagesCampaignBreakdown,
  getPromopagesTimeseries,
  getPromopagesTimeseriesByCampaignIds,
  getTimeseriesByCampaignIds,
  type CanonicalFilter,
  type PromopagesFilter,
} from "@/lib/canonical-adapter";
import { fetchCustomTable, fetchMediaPlanFromSourceConfig, groupByChannel, type ChannelGroup, type MediaPlanRow } from "@/lib/gsheet-fetcher";
import {
  aggregateByChannel,
  aggregateByPlatform,
  fetchManualDataFromSourceConfig,
  filterByDateRange,
  getTimeseriesByPlatform,
  type ManualDataRow,
  normalizeManualPlatformId,
} from "@/lib/manual-data-fetcher";
import {
  aggregateConfirmedLeadsByCanonicalChannel,
  aggregateConfirmedLeadsByPlatform,
  fetchLeadsFromSourceConfig,
  type ConfirmedLeadChannelRow,
  type LeadRow,
} from "@/lib/leads-fetcher";
import { loadDashboardManualFacts } from "@/lib/manual-data-store";
import { loadDashboardMediaPlanRows } from "@/lib/media-plan-store";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import {
  resolvePlatformIdFromSourceKey,
  resolveSourceKey,
  resolveSourceType,
} from "@/lib/source-mapping";
import { normalizeDashboardLanguage } from "@/lib/dashboard-i18n";
import {
  buildDashboardAiSummaryFromOverrideText,
  getMatchingDashboardAiSummarySnapshot,
  normalizeDashboardAiSummaryAuthoring,
} from "@/lib/dashboard-ai-summary";
import { normalizeDashboardMetrikaSettings } from "@/lib/dashboard-metrika-settings";
import { resolveDashboardDateRange } from "@/lib/dashboard-date-range";
import { normalizeDashboardSectionFieldOverrides } from "@/lib/dashboard-section-fields";
import {
  findMultibrandBrand,
  matchesAnyMultibrandPattern,
  normalizeMultibrandConfig,
} from "@/lib/multibrand";
import {
  getDefaultKpiCards,
  sanitizeSectionOrder as sanitizeDashboardSectionOrder,
  SPEND_RELATED_METRICS,
} from "@/lib/dashboard-presets";
import {
  buildPeriodMonths as buildNormalizedPeriodMonths,
  normalizeChannelPlan,
  normalizeValueForPeriod,
} from "@/lib/plan-normalizer";
import type {
  AnalyticsKPI,
  AnalyticsTimeSeriesPoint,
  TrafficSourceRow,
  PostClickAnalyticsRow,
  PostClickAnalyticsTimeSeriesPoint,
  CampaignBreakdownItem,
  ComparisonChannelItem,
  ComparisonData,
  ComparisonMetricDelta,
  ComparisonPlatformItem,
  ComparisonTimeSeriesPoint,
  CustomTableData,
  DashboardAiSummary,
  DashboardData,
  DashboardSectionId,
  FunnelStep,
  ManualChannelData,
  PlatformStats,
  TimeSeriesPoint,
  PlanVsFactItem,
  ChannelPerformanceItem,
  ChannelPerformanceMetric,
  BoundPromopagesChannelOverlay,
  BoundPromopagesTimeSeriesOverlay,
  PromopagesCampaignItem,
  PromopagesTimeSeriesPoint,
} from "@/lib/types";

type JsonRecord = Record<string, unknown>;

export type LoadedDashboardData = {
  dashboard_id: number;
  data: DashboardData;
  previous_platforms: PlatformStats[];
  leads_rows?: LeadRow[];
  ai_summary_enabled: boolean;
  ai_summary_override_text?: string | null;
  ai_summary_override?: DashboardAiSummary | null;
  ai_summary_snapshot?: DashboardAiSummary | null;
  server_timing?: DashboardServerTiming;
};

const SAFE_SERVER_TIMING_NAMES = [
  "metrika-db",
  "gsc-db",
  "webmaster-db",
  "seo-db",
  "total",
] as const;

export type DashboardServerTimingName = typeof SAFE_SERVER_TIMING_NAMES[number];
export type DashboardServerTiming = Partial<Record<DashboardServerTimingName, number>>;

export function formatPrivateServerTiming(timings: DashboardServerTiming): string {
  return SAFE_SERVER_TIMING_NAMES.flatMap((name) => {
    const duration = timings[name];
    return typeof duration === "number" && Number.isFinite(duration) && duration >= 0
      ? [`${name};dur=${duration.toFixed(1)}`]
      : [];
  }).join(", ");
}

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
  role: "actual" | "plan" | "custom_table";
  source_config: string | JsonRecord | null;
  filter_type: "name_pattern" | "id_list" | "all" | null;
  filter_value: string | null;
};

type BindingRow = RowDataPacket & {
  line_key: string | null;
  channel: string;
  source_key: string;
  platform_campaign_id: string;
};

type UtmBindingRow = RowDataPacket & {
  line_key: string | null;
  channel: string | null;
  utm_source: string | null;
};

type PostClickTrafficFactRow = RowDataPacket & {
  line_key: string | null;
  channel: string | null;
  date: string | null;
  visits: number | string | null;
  users: number | string | null;
  pageviews: number | string | null;
  page_depth: number | string | null;
  bounce_rate: number | string | null;
  avg_visit_duration: number | string | null;
};

type PostClickAdsFactRow = RowDataPacket & {
  line_key: string | null;
  date: string | null;
  source_keys: string | null;
  platform_account_ids: string | null;
  platform_campaign_ids: string | null;
  platform_delivery_entity_ids: string | null;
  platform_creative_ids: string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  views: number | string | null;
  reach: number | string | null;
  spend: number | string | null;
  video_views_25: number | string | null;
  video_views_50: number | string | null;
  video_views_75: number | string | null;
  video_views_100: number | string | null;
};

type PostClickCampaignTrafficFactRow = RowDataPacket & {
  line_key: string | null;
  channel: string | null;
  date: string | null;
  utm_campaign: string | null;
  visits: number | string | null;
  users: number | string | null;
  pageviews: number | string | null;
  page_depth: number | string | null;
  bounce_rate: number | string | null;
  avg_visit_duration: number | string | null;
};

type PostClickCampaignGoalFactRow = RowDataPacket & {
  line_key: string | null;
  date: string | null;
  utm_campaign: string | null;
  goal_reaches: number | string | null;
};

type PostClickCampaignAdsFactRow = RowDataPacket & {
  line_key: string | null;
  date: string | null;
  utm_campaign: string | null;
  source_keys: string | null;
  platform_account_ids: string | null;
  platform_campaign_ids: string | null;
  platform_delivery_entity_ids: string | null;
  platform_creative_ids: string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  views: number | string | null;
  reach: number | string | null;
  spend: number | string | null;
  video_views_25: number | string | null;
  video_views_50: number | string | null;
  video_views_75: number | string | null;
  video_views_100: number | string | null;
};

type PostClickGoalFactRow = RowDataPacket & {
  line_key: string | null;
  channel: string | null;
  date: string | null;
  goal_reaches: number | string | null;
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

function isValidIsoDate(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

function resolveAbbottCounterIds(sourceRows: SourceRow[]): string[] {
  const ids = sourceRows.flatMap((source) => {
    if (source.role === "custom_table") {
      return [];
    }
    const schema = loadSchema(source.schema_file);
    const sourceKey = schema.source_key ?? resolveSourceKey(source.platform);
    const sourceType = schema.source_type ?? resolveSourceType(sourceKey);
    if (sourceType !== "analytics" || sourceKey !== "yandex_metrika") {
      return [];
    }
    return parseAccountIds(parseJson(source.source_config).account_ids);
  });

  return Array.from(new Set(ids)).filter(Boolean);
}

function resolveDashboardMetrikaAccountIds(sourceRows: SourceRow[]): string[] {
  const ids = sourceRows.flatMap((source) => {
    if (source.role === "custom_table") {
      return [];
    }
    const schema = loadSchema(source.schema_file);
    const sourceKey = schema.source_key ?? resolveSourceKey(source.platform);
    const sourceType = schema.source_type ?? resolveSourceType(sourceKey);
    if (sourceType !== "analytics" || sourceKey !== "yandex_metrika") {
      return [];
    }
    return parseAccountIds(parseJson(source.source_config).account_ids);
  });

  return Array.from(new Set(ids)).filter(Boolean);
}

function filterManualRowsByBrand(rows: ManualDataRow[], patterns: string[]): ManualDataRow[] {
  if (!patterns.length) return rows;
  return rows.filter((row) => matchesAnyMultibrandPattern(row.channel, patterns));
}

function adaptStoredManualFacts(rows: Awaited<ReturnType<typeof loadDashboardManualFacts>>): ManualDataRow[] {
  return rows.map((row) => ({
    date: row.date,
    platform: row.platform,
    channel: row.channel,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    views: row.views,
    conversions: row.conversions,
    reach: row.reach,
    sessions: row.sessions,
    cr: null,
    ctr: null,
    cpc: null,
    cpm: null,
    cpv: null,
  }));
}

function shiftDate(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveDateRange(
  request: Request,
  config: JsonRecord,
  dashboardType?: string,
): { from: string; to: string } {
  return resolveDashboardDateRange({
    requestUrl: request.url,
    configFrom: config.period_from == null ? null : String(config.period_from),
    configTo: config.period_to == null ? null : String(config.period_to),
    dashboardType,
  });
}

function buildPreviousPeriod(dateFrom: string, dateTo: string): { from: string; to: string } {
  const fromDate = new Date(`${dateFrom}T00:00:00Z`);
  const toDate = new Date(`${dateTo}T00:00:00Z`);
  const spanDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
  const prevTo = shiftDate(dateFrom, -1);
  const prevFrom = shiftDate(prevTo, -(spanDays - 1));
  return { from: prevFrom, to: prevTo };
}

function getCompareRange(request: Request): { from: string; to: string } | null {
  const params = new URL(request.url).searchParams;
  const from = params.get("compare_from");
  const to = params.get("compare_to");
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return null;
  return { from, to };
}

function buildRangeLabel(range: { from: string; to: string }): string {
  return `${range.from} — ${range.to}`;
}

function buildMetricDelta(valueA: number, valueB: number): ComparisonMetricDelta {
  const delta = valueA - valueB;
  const deltaPct = valueB !== 0 ? (delta / valueB) * 100 : valueA !== 0 ? 100 : 0;
  return {
    value_a: valueA,
    value_b: valueB,
    delta,
    delta_pct: Number(deltaPct.toFixed(2)),
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "same",
  };
}

function buildKpiComparison(dataA: DashboardData, dataB: DashboardData): ComparisonData["kpi_comparison"] {
  const totalViewsA = dataA.platforms.reduce((sum, row) => sum + row.views, 0);
  const totalViewsB = dataB.platforms.reduce((sum, row) => sum + row.views, 0);
  const totalReachA = dataA.platforms.reduce((sum, row) => sum + row.reach, 0);
  const totalReachB = dataB.platforms.reduce((sum, row) => sum + row.reach, 0);
  const avgCpcA = dataA.kpi.total_clicks > 0 ? dataA.kpi.total_spend / dataA.kpi.total_clicks : 0;
  const avgCpcB = dataB.kpi.total_clicks > 0 ? dataB.kpi.total_spend / dataB.kpi.total_clicks : 0;
  const avgCpvA = totalViewsA > 0 ? dataA.kpi.total_spend / totalViewsA : 0;
  const avgCpvB = totalViewsB > 0 ? dataB.kpi.total_spend / totalViewsB : 0;
  const avgCpaA = dataA.kpi.total_conversions > 0 ? dataA.kpi.total_spend / dataA.kpi.total_conversions : 0;
  const avgCpaB = dataB.kpi.total_conversions > 0 ? dataB.kpi.total_spend / dataB.kpi.total_conversions : 0;

  return {
    impressions: buildMetricDelta(dataA.kpi.total_impressions, dataB.kpi.total_impressions),
    clicks: buildMetricDelta(dataA.kpi.total_clicks, dataB.kpi.total_clicks),
    spend: buildMetricDelta(dataA.kpi.total_spend, dataB.kpi.total_spend),
    conversions: buildMetricDelta(dataA.kpi.total_conversions, dataB.kpi.total_conversions),
    ctr: buildMetricDelta(dataA.kpi.avg_ctr, dataB.kpi.avg_ctr),
    cpm: buildMetricDelta(dataA.kpi.avg_cpm, dataB.kpi.avg_cpm),
    cpc: buildMetricDelta(avgCpcA, avgCpcB),
    cpv: buildMetricDelta(avgCpvA, avgCpvB),
    cpa: buildMetricDelta(avgCpaA, avgCpaB),
    views: buildMetricDelta(totalViewsA, totalViewsB),
    reach: buildMetricDelta(totalReachA, totalReachB),
  };
}

function buildPlatformsComparison(dataA: DashboardData, dataB: DashboardData): ComparisonPlatformItem[] {
  const mapA = new Map(dataA.platforms.map((row) => [row.id, row]));
  const mapB = new Map(dataB.platforms.map((row) => [row.id, row]));
  const ids = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
  return ids
    .map((id) => {
      const rowA = mapA.get(id);
      const rowB = mapB.get(id);
      const label = rowA?.name ?? rowB?.name ?? id;
      const color = rowA?.color ?? rowB?.color ?? "#94a3b8";
      return {
        platform: id,
        platform_label: label,
        color,
        metrics: {
          impressions: buildMetricDelta(rowA?.impressions ?? 0, rowB?.impressions ?? 0),
          clicks: buildMetricDelta(rowA?.clicks ?? 0, rowB?.clicks ?? 0),
          spend: buildMetricDelta(rowA?.spend ?? 0, rowB?.spend ?? 0),
          conversions: buildMetricDelta(rowA?.conversions ?? 0, rowB?.conversions ?? 0),
          views: buildMetricDelta(rowA?.views ?? 0, rowB?.views ?? 0),
          reach: buildMetricDelta(rowA?.reach ?? 0, rowB?.reach ?? 0),
          ctr: buildMetricDelta(rowA?.ctr ?? 0, rowB?.ctr ?? 0),
          cpm: buildMetricDelta(rowA?.cpm ?? 0, rowB?.cpm ?? 0),
        },
      };
    })
    .sort((left, right) => {
      const spendDelta = Math.abs((right.metrics.spend?.value_a ?? 0) - (right.metrics.spend?.value_b ?? 0))
        - Math.abs((left.metrics.spend?.value_a ?? 0) - (left.metrics.spend?.value_b ?? 0));
      if (spendDelta !== 0) return spendDelta;
      return left.platform_label.localeCompare(right.platform_label);
    });
}

function buildChannelsComparison(dataA: DashboardData, dataB: DashboardData): ComparisonChannelItem[] {
  const mapA = new Map((dataA.channel_performance ?? []).map((row) => [row.channel, row]));
  const mapB = new Map((dataB.channel_performance ?? []).map((row) => [row.channel, row]));
  const channels = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));

  return channels
    .map((channel) => {
      const rowA = mapA.get(channel);
      const rowB = mapB.get(channel);
      const impressionsA = rowA?.metrics.impressions?.fact ?? 0;
      const impressionsB = rowB?.metrics.impressions?.fact ?? 0;
      const clicksA = rowA?.metrics.clicks?.fact ?? 0;
      const clicksB = rowB?.metrics.clicks?.fact ?? 0;
      const spendA = rowA?.metrics.spend?.fact ?? 0;
      const spendB = rowB?.metrics.spend?.fact ?? 0;
      const conversionsA = rowA?.metrics.conversions?.fact ?? 0;
      const conversionsB = rowB?.metrics.conversions?.fact ?? 0;
      const viewsA = rowA?.metrics.views?.fact ?? 0;
      const viewsB = rowB?.metrics.views?.fact ?? 0;
      const reachA = rowA?.metrics.reach?.fact ?? 0;
      const reachB = rowB?.metrics.reach?.fact ?? 0;
      const ctrA = rowA?.metrics.ctr?.fact ?? (impressionsA > 0 ? (clicksA / impressionsA) * 100 : 0);
      const ctrB = rowB?.metrics.ctr?.fact ?? (impressionsB > 0 ? (clicksB / impressionsB) * 100 : 0);
      const cpmA = rowA?.metrics.cpm?.fact ?? (impressionsA > 0 ? (spendA / impressionsA) * 1000 : 0);
      const cpmB = rowB?.metrics.cpm?.fact ?? (impressionsB > 0 ? (spendB / impressionsB) * 1000 : 0);

      return {
        channel,
        instrument: rowA?.instrument ?? rowB?.instrument,
        metrics: {
          impressions: buildMetricDelta(impressionsA, impressionsB),
          clicks: buildMetricDelta(clicksA, clicksB),
          spend: buildMetricDelta(spendA, spendB),
          conversions: buildMetricDelta(conversionsA, conversionsB),
          views: buildMetricDelta(viewsA, viewsB),
          reach: buildMetricDelta(reachA, reachB),
          ctr: buildMetricDelta(ctrA, ctrB),
          cpm: buildMetricDelta(cpmA, cpmB),
        },
      };
    })
    .sort((left, right) => {
      const spendDelta =
        Math.abs((right.metrics.spend?.value_a ?? 0) - (right.metrics.spend?.value_b ?? 0)) -
        Math.abs((left.metrics.spend?.value_a ?? 0) - (left.metrics.spend?.value_b ?? 0));
      if (spendDelta !== 0) return spendDelta;
      return left.channel.localeCompare(right.channel);
    });
}

function buildComparisonTimeseries(points: TimeSeriesPoint[]): ComparisonTimeSeriesPoint[] {
  const sortedDates = [...new Set(points.map((point) => point.date))].sort((a, b) => a.localeCompare(b));
  const byDate = new Map<
    string,
    { impressions: number; clicks: number; spend: number; views: number; conversions: number }
  >();

  for (const point of points) {
    if (!byDate.has(point.date)) {
      byDate.set(point.date, { impressions: 0, clicks: 0, spend: 0, views: 0, conversions: 0 });
    }
    const row = byDate.get(point.date)!;
    row.impressions += point.impressions;
    row.clicks += point.clicks;
    row.spend += point.spend;
    row.views += point.views ?? 0;
    row.conversions += point.conversions ?? 0;
  }

  return sortedDates.map((date, index) => {
    const row = byDate.get(date) ?? { impressions: 0, clicks: 0, spend: 0, views: 0, conversions: 0 };
    return {
      date,
      day_index: index,
      impressions: row.impressions,
      clicks: row.clicks,
      spend: Number(row.spend.toFixed(2)),
      views: row.views,
      conversions: row.conversions,
    };
  });
}

function buildComparison(dataA: DashboardData, dataB: DashboardData): ComparisonData {
  return {
    period_a: {
      from: dataA.dashboard.period.from,
      to: dataA.dashboard.period.to,
      label: buildRangeLabel(dataA.dashboard.period),
    },
    period_b: {
      from: dataB.dashboard.period.from,
      to: dataB.dashboard.period.to,
      label: buildRangeLabel(dataB.dashboard.period),
    },
    kpi_comparison: buildKpiComparison(dataA, dataB),
    platforms_comparison: buildPlatformsComparison(dataA, dataB),
    channels_comparison: buildChannelsComparison(dataA, dataB),
    timeseries_b: buildComparisonTimeseries(dataB.timeseries),
    timeseries_b_raw: dataB.timeseries,
    channel_timeseries_b: dataB.channel_timeseries ?? [],
  };
}

function monthKeyFromDate(dateIso: string): string {
  return dateIso.slice(0, 7);
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
    if (completionPct <= 130) return "yellow";
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

function mergeChannelSummaryFacts(
  row: PlanVsFactItem,
  factSummary: { impressions: number; reach: number; clicks: number; views: number; conversions: number; spend: number },
) {
  return {
    impressions: Math.max(factSummary.impressions, row.impressions_fact),
    reach: Math.max(factSummary.reach, row.reach_fact),
    clicks: Math.max(factSummary.clicks, row.clicks_fact),
    views: Math.max(factSummary.views, row.views_fact),
    conversions: Math.max(factSummary.conversions, row.conversions_fact),
    spend: Math.max(factSummary.spend, row.budget_fact),
  };
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
  return getDefaultKpiCards(type, showSpend);
}

function getVisibleMetrics(
  config: JsonRecord,
  type: DashboardData["dashboard"]["type"],
  showSpend: boolean,
): string[] {
  const raw = config.visible_metrics;
  const allowed = new Set([
    "impressions",
    "clicks",
    "ctr",
    "cpm",
    "cpc",
    "spend",
    "views",
    "cpv",
    "conversions",
    "cpa",
    "roas",
    "reach",
    "frequency",
  ].filter((item) => showSpend || !SPEND_RELATED_METRICS.has(item)));

  if (Array.isArray(raw)) {
    const values = Array.from(new Set(raw
      .map((item) => String(item).trim().toLowerCase())
      .filter((item) => allowed.has(item))));
    if (showSpend && values.includes("views") && !values.includes("cpv")) {
      values.push("cpv");
    }
    if (values.length > 0) {
      return values;
    }
  }

  const fallback = getDefaultKpiCards(type, showSpend);
  if (showSpend && fallback.includes("views") && !fallback.includes("cpv")) {
    return [...fallback, "cpv"];
  }
  return fallback;
}

function getCustomKpiCards(config: JsonRecord, showSpend: boolean): NonNullable<DashboardData["custom_kpi_cards"]> {
  const raw = config.custom_kpi_cards;
  if (!Array.isArray(raw)) return [];
  const allowedTrendSources = new Set(
    getDefaultKpiCards("overview", showSpend).concat([
      "impressions",
      "clicks",
      "ctr",
      "cpm",
      "cpc",
      "spend",
      "views",
      "cpv",
      "conversions",
      "cpa",
      "roas",
      "reach",
      "frequency",
    ]).filter((item) => showSpend || !SPEND_RELATED_METRICS.has(item)),
  );
  return raw
    .map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const id = String(row.id ?? "").trim() || `custom_${index + 1}`;
      const title = String(row.title ?? "").trim();
      const value = Number(row.value ?? 0);
      const trendSource = String(row.trend_source ?? "").trim().toLowerCase();
      if (!title || !Number.isFinite(value) || !trendSource || !allowedTrendSources.has(trendSource)) {
        return null;
      }
      return {
        id,
        title,
        value,
        trend_source: trendSource,
      };
    })
    .filter((item): item is NonNullable<DashboardData["custom_kpi_cards"]>[number] => Boolean(item));
}

function getSectionOrder(
  config: JsonRecord,
  type: DashboardData["dashboard"]["type"],
  showSpend: boolean,
): DashboardSectionId[] {
  if (Array.isArray(config.section_order)) {
    return sanitizeDashboardSectionOrder(config.section_order, type, showSpend, false);
  }
  return sanitizeDashboardSectionOrder(config.section_order, type, showSpend, true);
}

function withOptionalSection(
  sections: DashboardSectionId[],
  sectionId: DashboardSectionId,
  afterSectionId: DashboardSectionId,
): DashboardSectionId[] {
  if (sections.includes(sectionId)) {
    return sections;
  }
  const anchorIndex = sections.indexOf(afterSectionId);
  if (anchorIndex === -1) {
    return [...sections, sectionId];
  }
  return [
    ...sections.slice(0, anchorIndex + 1),
    sectionId,
    ...sections.slice(anchorIndex + 1),
  ];
}

function getFilterScope(config: JsonRecord): "both" | "platform" | "channel" {
  const value = String(config.filter_scope ?? "both");
  if (value === "platform" || value === "channel") return value;
  return "both";
}

function getSectionFieldOverrides(config: JsonRecord) {
  return normalizeDashboardSectionFieldOverrides(config.section_field_overrides);
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
    existing.views = (existing.views ?? 0) + (item.views ?? 0);
    existing.conversions = (existing.conversions ?? 0) + (item.conversions ?? 0);
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergePromopagesTimeseries(items: PromopagesTimeSeriesPoint[]): PromopagesTimeSeriesPoint[] {
  const byDate = new Map<string, PromopagesTimeSeriesPoint>();
  for (const item of items) {
    const existing = byDate.get(item.date);
    if (!existing) {
      byDate.set(item.date, { ...item });
      continue;
    }
    existing.impressions += item.impressions;
    existing.reach += item.reach;
    existing.views += item.views;
    existing.clicks += item.clicks;
    existing.budget += item.budget;
    existing.clickouts += item.clickouts;
    existing.full_reads += item.full_reads;
    existing.metrica_visits += item.metrica_visits;
  }
  return [...byDate.values()]
    .map((item) => ({
      ...item,
      budget: Number(item.budget.toFixed(2)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function mergePromopagesCampaigns(items: PromopagesCampaignItem[]): PromopagesCampaignItem[] {
  return [...items].sort((a, b) => {
    if (b.budget !== a.budget) return b.budget - a.budget;
    if (b.impressions !== a.impressions) return b.impressions - a.impressions;
    return a.campaign_name.localeCompare(b.campaign_name);
  });
}

function mergeCampaignBreakdown(items: CampaignBreakdownItem[]): CampaignBreakdownItem[] {
  const byKey = new Map<string, CampaignBreakdownItem>();

  for (const item of items) {
    const key = `${item.source_key}:${item.campaign_id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item });
      continue;
    }

    existing.impressions += item.impressions;
    existing.clicks += item.clicks;
    existing.spend += item.spend;
    existing.conversions += item.conversions;
    existing.cpc = existing.clicks > 0 ? Number((existing.spend / existing.clicks).toFixed(2)) : 0;
    existing.cpa =
      existing.conversions > 0 ? Number((existing.spend / existing.conversions).toFixed(2)) : 0;
    existing.ctr =
      existing.impressions > 0 ? Number(((existing.clicks / existing.impressions) * 100).toFixed(2)) : 0;
  }

  return [...byKey.values()].sort((a, b) => {
    const aCpa = a.conversions > 0 ? a.cpa : Number.POSITIVE_INFINITY;
    const bCpa = b.conversions > 0 ? b.cpa : Number.POSITIVE_INFINITY;
    if (aCpa !== bCpa) return aCpa - bCpa;
    return b.conversions - a.conversions || b.spend - a.spend;
  });
}

function buildFunnel(impressions: number, clicks: number, conversions: number): FunnelStep[] {
  const steps: FunnelStep[] = [
    {
      id: "impressions",
      label: "Impressions",
      value: impressions,
    },
  ];

  if (clicks > 0) {
    steps.push({
      id: "clicks",
      label: "Clicks",
      value: clicks,
      conversion_rate: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
    });
  }

  if (conversions > 0) {
    steps.push({
      id: "conversions",
      label: "Conversions",
      value: conversions,
      conversion_rate: clicks > 0 ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
    });
  }

  return steps;
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

function mergeTrafficSources(items: TrafficSourceRow[]): TrafficSourceRow[] {
  const map = new Map<string, TrafficSourceRow>();

  for (const item of items) {
    const key = item.traffic_source;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item });
      continue;
    }

    const visits = existing.visits + item.visits;
    existing.users += item.users;
    existing.new_users += item.new_users;
    existing.pageviews += item.pageviews;
    existing.bounce_rate = visits > 0
      ? Number(((existing.bounce_rate * existing.visits + item.bounce_rate * item.visits) / visits).toFixed(2))
      : 0;
    existing.page_depth = visits > 0
      ? Number(((existing.page_depth * existing.visits + item.page_depth * item.visits) / visits).toFixed(2))
      : 0;
    existing.avg_visit_duration = visits > 0
      ? Number(((existing.avg_visit_duration * existing.visits + item.avg_visit_duration * item.visits) / visits).toFixed(2))
      : 0;
    existing.visits = visits;
  }

  return [...map.values()].sort((a, b) => b.visits - a.visits || b.users - a.users);
}

async function loadAdjustedCampaignDailyFacts(
  sourceKey: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
  overrideMap: Map<string, number>,
  isGidrofuril = false,
): Promise<CampaignDailyFactRow[]> {
  const rows = await getCampaignDailyFactsByIds(sourceKey, campaignIds, dateFrom, dateTo);
  return rows.map((row) => {
    const impressions = asNumber(row.impressions);
    let views = asNumber(row.views);

    // TEMPORARY: Gidrofuril VK "views started" approximation
    // views = impressions * 0.89 (until real video.started / views_started
    // is collected from VK Ads API into canonical_fact_ads_daily)
    if (isGidrofuril && sourceKey === "vk_ads_v2") {
      views = Math.round(impressions * 0.89);
    }

    return applyFrequencyOverride(
      sourceKey,
      {
        date: toIsoDate(row.date),
        platform_campaign_id: String(row.platform_campaign_id ?? ""),
        impressions,
        reach: asNumber(row.reach),
        clicks: asNumber(row.clicks),
        spend: Number(asNumber(row.spend).toFixed(2)),
        views,
        conversions: asNumber(row.conversions),
      },
      overrideMap,
    );
  });
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

function sumManualChannels(
  manualChannels: ManualChannelData[],
  platformCampaignIds: string[],
): { impressions: number; reach: number; clicks: number; spend: number; conversions: number; views: number } {
  const ids = new Set(platformCampaignIds.map((id) => id.replace(/^manual:/, "")));
  let impressions = 0;
  let reach = 0;
  let clicks = 0;
  let spend = 0;
  let conversions = 0;
  let views = 0;
  for (const ch of manualChannels) {
    const key = `${ch.platform}|${ch.channel}`;
    if (ids.has(key)) {
      impressions += ch.impressions;
      reach += ch.reach;
      clicks += ch.clicks;
      spend += ch.spend;
      conversions += ch.conversions;
      views += ch.views;
    }
  }
  return { impressions, reach, clicks, spend, conversions, views };
}

async function buildBoundPromopagesOverlay(
  channelGroups: ChannelGroup[],
  bindingsByLineKey: Map<string, Array<{ source_key: string; platform_campaign_id: string }>>,
  dateFrom: string,
  dateTo: string,
): Promise<{
  byChannel: BoundPromopagesChannelOverlay[];
  timeseries: BoundPromopagesTimeSeriesOverlay[];
}> {
  const overlayRows = await Promise.all(
    channelGroups.map(async (group) => {
      const bindings = (bindingsByLineKey.get(group.line_key || group.channel) ?? []).filter(
        (binding) => binding.source_key === "yandex_promopages",
      );
      const campaignIds = Array.from(new Set(bindings.map((binding) => binding.platform_campaign_id).filter(Boolean)));
      if (!campaignIds.length) {
        return null;
      }

      const aggregate = await getPromopagesAggregateByCampaignIds("yandex_promopages", campaignIds, dateFrom, dateTo);
      const timeseries = await getPromopagesTimeseriesByCampaignIds("yandex_promopages", campaignIds, dateFrom, dateTo);

      return {
        totals: {
          channel: group.channel,
          instrument: group.instrument,
          impressions: asNumber(aggregate?.total_impressions),
          reach: asNumber(aggregate?.total_reach),
          clicks: asNumber(aggregate?.total_clickouts),
          spend: Number(asNumber(aggregate?.total_budget).toFixed(2)),
          views: asNumber(aggregate?.total_views),
        },
        timeseries: timeseries.map((row) => ({
          date: row.date,
          channel: group.channel,
          impressions: asNumber(row.impressions),
          reach: asNumber(row.reach),
          clicks: asNumber(row.clickouts),
          spend: Number(asNumber(row.budget).toFixed(2)),
          views: asNumber(row.views),
        })),
      };
    }),
  );

  return {
    byChannel: overlayRows
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => row.totals),
    timeseries: overlayRows
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .flatMap((row) => row.timeseries)
      .sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel)),
  };
}

async function buildPlanVsFactRowsByChannel(
  channelGroups: ChannelGroup[],
  bindingsByLineKey: Map<string, Array<{ source_key: string; platform_campaign_id: string }>>,
  hasExplicitBindings: boolean,
  actualAdsSourceKeys: Set<string>,
  dateFrom: string,
  dateTo: string,
  overrideMap: Map<string, number>,
  manualChannels: ManualChannelData[],
  isGidrofuril = false,
): Promise<PlanVsFactItem[]> {
  const resolveBindingPlatform = (binding: { source_key: string; platform_campaign_id: string }) => {
    if (binding.source_key === "manual_data" && binding.platform_campaign_id.startsWith("manual:")) {
      const payload = binding.platform_campaign_id.slice("manual:".length);
      const platformId = normalizeManualPlatformId(payload.split("|")[0] ?? "");
      const sourceKey = resolveSourceKey(platformId);
      const meta = PLATFORM_COLORS[platformId];
      return {
        source_key: sourceKey,
        label: meta?.label ?? platformId,
        color: meta?.hex ?? "#94a3b8",
      };
    }

    const platformId = resolvePlatformIdFromSourceKey(binding.source_key);
    const meta = PLATFORM_COLORS[platformId];
    return {
      source_key: binding.source_key,
      label: meta?.label ?? binding.source_key,
      color: meta?.hex ?? "#94a3b8",
    };
  };

  const factPromises = channelGroups.map(async (group) => {
    const bindings = bindingsByLineKey.get(group.line_key || group.channel) ?? [];
    if (bindings.length === 0) {
      if (hasExplicitBindings) {
        return null;
      }
      const fallbackSourceKey = resolveSourceKey(group.instrument);
      if (!actualAdsSourceKeys.has(fallbackSourceKey)) {
        return null;
      }
      return getFactByCampaignIds(fallbackSourceKey, [], dateFrom, dateTo);
    }

    const canonicalBindings = bindings.filter((b) => b.source_key !== "manual_data" && b.source_key !== "yandex_promopages");
    const promopagesBindings = bindings.filter((b) => b.source_key === "yandex_promopages");
    const manualBindings = bindings.filter((b) => b.source_key === "manual_data");

    let canonicalTotals = { impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0, views: 0 };
    if (canonicalBindings.length > 0) {
      const bySource = new Map<string, string[]>();
      canonicalBindings.forEach((binding) => {
        if (!bySource.has(binding.source_key)) bySource.set(binding.source_key, []);
        bySource.get(binding.source_key)!.push(binding.platform_campaign_id);
      });
      const results = await Promise.all(
        Array.from(bySource.entries()).map(([sourceKey, ids]) =>
          loadAdjustedCampaignDailyFacts(sourceKey, ids, dateFrom, dateTo, overrideMap, isGidrofuril),
        ),
      );
      canonicalTotals = sumCampaignDailyFacts(results.flat());
    }

    const manualTotals =
      manualBindings.length > 0
        ? sumManualChannels(
            manualChannels,
            manualBindings.map((b) => b.platform_campaign_id),
          )
        : { impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0, views: 0 };

    const promopagesIds = Array.from(
      new Set(promopagesBindings.map((binding) => binding.platform_campaign_id).filter(Boolean)),
    );
    const promopagesAggregate =
      promopagesIds.length > 0
        ? await getPromopagesAggregateByCampaignIds("yandex_promopages", promopagesIds, dateFrom, dateTo)
        : null;
    const promopagesTotals = {
      impressions: asNumber(promopagesAggregate?.total_impressions),
      reach: asNumber(promopagesAggregate?.total_reach),
      clicks: asNumber(promopagesAggregate?.total_clickouts),
      spend: Number(asNumber(promopagesAggregate?.total_budget).toFixed(2)),
      conversions: 0,
      views: asNumber(promopagesAggregate?.total_views),
    };

    return {
      total_impressions: canonicalTotals.impressions + manualTotals.impressions + promopagesTotals.impressions,
      total_reach: canonicalTotals.reach + manualTotals.reach + promopagesTotals.reach,
      total_clicks: canonicalTotals.clicks + manualTotals.clicks + promopagesTotals.clicks,
      total_spend: canonicalTotals.spend + manualTotals.spend + promopagesTotals.spend,
      total_conversions: canonicalTotals.conversions + manualTotals.conversions,
      total_views: canonicalTotals.views + manualTotals.views + promopagesTotals.views,
    };
  });

  const facts = await Promise.all(factPromises);

  return channelGroups.map((group, index) => {
    const fact = facts[index] ?? null;
    const bindings = bindingsByLineKey.get(group.line_key || group.channel) ?? [];
    const platforms =
      bindings.length > 0
        ? Array.from(
            new Map(bindings.map((binding) => {
              const platform = resolveBindingPlatform(binding);
              return [platform.source_key, platform];
            })).values(),
          )
        : (() => {
            if (hasExplicitBindings) return [];
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
      __manual_backed: bindings.some((binding) => binding.source_key === "manual_data"),
    };
  });
}

async function buildChannelTimeseries(
  channelGroups: ChannelGroup[],
  bindingsByLineKey: Map<string, Array<{ source_key: string; platform_campaign_id: string }>>,
  hasExplicitBindings: boolean,
  actualAdsSourceKeys: Set<string>,
  dateFrom: string,
  dateTo: string,
  overrideMap: Map<string, number>,
  boundPromopagesTimeseries?: Map<string, BoundPromopagesTimeSeriesOverlay[]>,
): Promise<DashboardData["channel_timeseries"]> {
  const timeseries = await Promise.all(
    channelGroups.map(async (group) => {
      const bindings = bindingsByLineKey.get(group.line_key || group.channel) ?? [];
      const bySource = new Map<string, string[]>();

      if (bindings.length === 0) {
        if (hasExplicitBindings) {
          return [];
        }
        const fallbackSourceKey = resolveSourceKey(group.instrument);
        if (actualAdsSourceKeys.has(fallbackSourceKey)) {
          bySource.set(fallbackSourceKey, []);
        }
      } else {
        bindings.forEach((binding) => {
          if (binding.source_key === "yandex_promopages") {
            return;
          }
          if (!bySource.has(binding.source_key)) {
            bySource.set(binding.source_key, []);
          }
          bySource.get(binding.source_key)!.push(binding.platform_campaign_id);
        });
      }

      const promoRows = boundPromopagesTimeseries?.get(group.channel) ?? [];
      if (!bySource.size && promoRows.length === 0) return [];

      const sourceResults = await Promise.all(
        Array.from(bySource.entries()).map(([sourceKey, ids]) =>
          ids.length
            ? loadAdjustedCampaignDailyFacts(sourceKey, ids, dateFrom, dateTo, overrideMap, false)
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

      promoRows.forEach((row) => {
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
  configFrom: string,
  configTo: string,
): ChannelPerformanceItem[] {
  const periodMonths = buildNormalizedPeriodMonths(dateFrom, dateTo);
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
    const summaryFacts = mergeChannelSummaryFacts(
      row,
      factRows.length
        ? sumFactRows(factRows)
        : {
            impressions: 0,
            reach: 0,
            clicks: 0,
            spend: 0,
            views: 0,
            conversions: 0,
          },
    );
    const summaryPlan = normalizeChannelPlan(row, dateFrom, dateTo, configFrom, configTo);
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
            const monthlyPlan = normalizeChannelPlan(row, month.from, month.to, configFrom, configTo);
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

async function buildPostClickAnalytics(
  dashboardId: number,
  channelGroups: ChannelGroup[],
  metrikaAccountIds: string[],
  dateFrom: string,
  dateTo: string,
  spendSource: "platform_actual" | "media_plan_derived",
  configFrom: string,
  configTo: string,
  selectedGoalIds: string[],
  goalMode: "all" | "selected",
): Promise<DashboardData["postclick_analytics"] | undefined> {
  if (!metrikaAccountIds.length) {
    return undefined;
  }

  const [utmBindings] = await pool.execute<UtmBindingRow[]>(
    `SELECT line_key, channel, utm_source
     FROM dashboard_utm_source_bindings
     WHERE dashboard_id = ?`,
    [dashboardId],
  );

  const normalizedBindings = utmBindings
    .map((row) => ({
      line_key: String(row.line_key ?? row.channel ?? "").trim(),
      channel: String(row.channel ?? "").trim(),
      utm_source: String(row.utm_source ?? "").trim(),
    }))
    .filter((row) => row.line_key && row.utm_source);

  if (!normalizedBindings.length) {
    return undefined;
  }

  const utmSourcesByLineKey = normalizedBindings.reduce((acc, row) => {
    if (!acc.has(row.line_key)) acc.set(row.line_key, new Set<string>());
    acc.get(row.line_key)!.add(row.utm_source);
    return acc;
  }, new Map<string, Set<string>>());

  const accountPlaceholders = metrikaAccountIds.map(() => "?").join(",");
  const planSpendByLineKey =
    spendSource === "media_plan_derived"
      ? new Map(
          channelGroups.map((group) => {
            const monthlyBudget = Object.fromEntries(
              Object.entries(group.monthly_breakdown ?? {}).map(([month, item]) => [
                month,
                Number(item.budget || 0),
              ]),
            );
            return [
              group.line_key,
              normalizeValueForPeriod({
                total: Number(group.budget_plan || 0),
                monthly: monthlyBudget,
                periodFrom: dateFrom,
                periodTo: dateTo,
                configFrom,
                configTo,
              }),
            ] as const;
          }),
        )
      : new Map<string, number>();

  const [trafficRows] = await pool.execute<PostClickTrafficFactRow[]>(
    `
      SELECT
        b.line_key AS line_key,
        MAX(b.channel) AS channel,
        f.report_date AS date,
        COALESCE(SUM(f.visits), 0) AS visits,
        COALESCE(SUM(f.users), 0) AS users,
        COALESCE(SUM(f.pageviews), 0) AS pageviews,
        CASE
          WHEN COALESCE(SUM(f.visits), 0) > 0
            THEN COALESCE(SUM(COALESCE(f.page_depth, 0) * COALESCE(f.visits, 0)) / SUM(f.visits), 0)
          ELSE 0
        END AS page_depth,
        CASE
          WHEN COALESCE(SUM(f.visits), 0) > 0
            THEN COALESCE(SUM(COALESCE(f.bounce_rate, 0) * COALESCE(f.visits, 0)) / SUM(f.visits), 0)
          ELSE 0
        END AS bounce_rate,
        CASE
          WHEN COALESCE(SUM(f.visits), 0) > 0
            THEN COALESCE(SUM(COALESCE(f.avg_visit_duration_seconds, 0) * COALESCE(f.visits, 0)) / SUM(f.visits), 0)
          ELSE 0
        END AS avg_visit_duration
      FROM dashboard_utm_source_bindings b
      JOIN canonical_fact_site_analytics_daily f
        ON b.dashboard_id = ?
       AND b.utm_source = NULLIF(TRIM(f.utm_source), '')
      WHERE f.source_key = 'yandex_metrika'
        AND f.analytics_scope = 'traffic'
        AND f.report_date >= ?
        AND f.report_date <= ?
        AND f.analytics_account_id IN (${accountPlaceholders})
      GROUP BY b.line_key, f.report_date
      ORDER BY f.report_date, b.line_key
    `,
    [dashboardId, dateFrom, dateTo, ...metrikaAccountIds],
  );

  const [adsRows] = await pool.execute<PostClickAdsFactRow[]>(
    `
      SELECT
        b.line_key AS line_key,
        f.report_date AS date,
        GROUP_CONCAT(DISTINCT b.source_key ORDER BY b.source_key SEPARATOR '|||') AS source_keys,
        GROUP_CONCAT(DISTINCT NULLIF(TRIM(f.platform_account_id), '') ORDER BY f.platform_account_id SEPARATOR '|||') AS platform_account_ids,
        GROUP_CONCAT(DISTINCT NULLIF(TRIM(f.platform_campaign_id), '') ORDER BY f.platform_campaign_id SEPARATOR '|||') AS platform_campaign_ids,
        GROUP_CONCAT(
          DISTINCT NULLIF(TRIM(CASE WHEN f.platform_delivery_entity_id = '__campaign__' THEN '' ELSE f.platform_delivery_entity_id END), '')
          ORDER BY f.platform_delivery_entity_id
          SEPARATOR '|||'
        ) AS platform_delivery_entity_ids,
        GROUP_CONCAT(
          DISTINCT NULLIF(TRIM(CASE WHEN f.platform_creative_id = '__campaign__' THEN '' ELSE f.platform_creative_id END), '')
          ORDER BY f.platform_creative_id
          SEPARATOR '|||'
        ) AS platform_creative_ids,
        COALESCE(SUM(f.impressions), 0) AS impressions,
        COALESCE(SUM(f.clicks), 0) AS clicks,
        COALESCE(SUM(f.views), 0) AS views,
        COALESCE(SUM(f.reach), 0) AS reach,
        COALESCE(SUM(f.spend), 0) AS spend,
        COALESCE(SUM(f.video_views_25), 0) AS video_views_25,
        COALESCE(SUM(f.video_views_50), 0) AS video_views_50,
        COALESCE(SUM(f.video_views_75), 0) AS video_views_75,
        COALESCE(SUM(f.video_views_100), 0) AS video_views_100
      FROM media_plan_bindings b
      JOIN canonical_fact_ads_daily f
        ON f.source_key COLLATE utf8mb4_unicode_ci = b.source_key
       AND f.platform_campaign_id COLLATE utf8mb4_unicode_ci = b.platform_campaign_id
      WHERE b.dashboard_id = ?
        AND f.report_date >= ?
        AND f.report_date <= ?
      GROUP BY b.line_key, f.report_date
      ORDER BY f.report_date, b.line_key
    `,
    [dashboardId, dateFrom, dateTo],
  );

  const [campaignTrafficRows] = await pool.execute<PostClickCampaignTrafficFactRow[]>(
    `
      SELECT
        b.line_key AS line_key,
        MAX(b.channel) AS channel,
        f.report_date AS date,
        NULLIF(TRIM(f.utm_campaign), '') AS utm_campaign,
        COALESCE(SUM(f.visits), 0) AS visits,
        COALESCE(SUM(f.users), 0) AS users,
        COALESCE(SUM(f.pageviews), 0) AS pageviews,
        CASE
          WHEN COALESCE(SUM(f.visits), 0) > 0
            THEN COALESCE(SUM(COALESCE(f.page_depth, 0) * COALESCE(f.visits, 0)) / SUM(f.visits), 0)
          ELSE 0
        END AS page_depth,
        CASE
          WHEN COALESCE(SUM(f.visits), 0) > 0
            THEN COALESCE(SUM(COALESCE(f.bounce_rate, 0) * COALESCE(f.visits, 0)) / SUM(f.visits), 0)
          ELSE 0
        END AS bounce_rate,
        CASE
          WHEN COALESCE(SUM(f.visits), 0) > 0
            THEN COALESCE(SUM(COALESCE(f.avg_visit_duration_seconds, 0) * COALESCE(f.visits, 0)) / SUM(f.visits), 0)
          ELSE 0
        END AS avg_visit_duration
      FROM dashboard_utm_source_bindings b
      JOIN canonical_fact_site_analytics_daily f
        ON b.dashboard_id = ?
       AND b.utm_source = NULLIF(TRIM(f.utm_source), '')
      WHERE f.source_key = 'yandex_metrika'
        AND f.analytics_scope = 'traffic'
        AND f.report_date >= ?
        AND f.report_date <= ?
        AND f.analytics_account_id IN (${accountPlaceholders})
        AND NULLIF(TRIM(f.utm_campaign), '') IS NOT NULL
      GROUP BY b.line_key, f.report_date, NULLIF(TRIM(f.utm_campaign), '')
      ORDER BY f.report_date, b.line_key
    `,
    [dashboardId, dateFrom, dateTo, ...metrikaAccountIds],
  );

  let goalRows: PostClickGoalFactRow[] = [];
  if (!(goalMode === "selected" && selectedGoalIds.length === 0)) {
    const goalPlaceholders = selectedGoalIds.map(() => "?").join(",");
    const goalFilter =
      goalMode === "selected" && selectedGoalIds.length > 0
        ? ` AND f.goal_id IN (${goalPlaceholders})`
        : "";
    const goalParams: Array<string | number> = [dashboardId, dateFrom, dateTo, ...metrikaAccountIds];
    if (goalMode === "selected" && selectedGoalIds.length > 0) {
      goalParams.push(...selectedGoalIds);
    }
    const [rows] = await pool.execute<PostClickGoalFactRow[]>(
      `
        SELECT
          b.line_key AS line_key,
          MAX(b.channel) AS channel,
          f.report_date AS date,
          COALESCE(SUM(f.goal_reaches), 0) AS goal_reaches
        FROM dashboard_utm_source_bindings b
        JOIN canonical_fact_site_analytics_daily f
          ON b.dashboard_id = ?
         AND b.utm_source = NULLIF(TRIM(f.utm_source), '')
        WHERE f.source_key = 'yandex_metrika'
          AND f.analytics_scope = 'goal'
          AND f.report_date >= ?
          AND f.report_date <= ?
          AND f.analytics_account_id IN (${accountPlaceholders})
          ${goalFilter}
        GROUP BY b.line_key, f.report_date
        ORDER BY f.report_date, b.line_key
      `,
      goalParams,
    );
    goalRows = rows;
  }

  let campaignGoalRows: PostClickCampaignGoalFactRow[] = [];
  if (!(goalMode === "selected" && selectedGoalIds.length === 0)) {
    const goalPlaceholders = selectedGoalIds.map(() => "?").join(",");
    const goalFilter =
      goalMode === "selected" && selectedGoalIds.length > 0
        ? ` AND f.goal_id IN (${goalPlaceholders})`
        : "";
    const goalParams: Array<string | number> = [dashboardId, dateFrom, dateTo, ...metrikaAccountIds];
    if (goalMode === "selected" && selectedGoalIds.length > 0) {
      goalParams.push(...selectedGoalIds);
    }
    const [rows] = await pool.execute<PostClickCampaignGoalFactRow[]>(
      `
        SELECT
          b.line_key AS line_key,
          f.report_date AS date,
          NULLIF(TRIM(f.utm_campaign), '') AS utm_campaign,
          COALESCE(SUM(f.goal_reaches), 0) AS goal_reaches
        FROM dashboard_utm_source_bindings b
        JOIN canonical_fact_site_analytics_daily f
          ON b.dashboard_id = ?
         AND b.utm_source = NULLIF(TRIM(f.utm_source), '')
        WHERE f.source_key = 'yandex_metrika'
          AND f.analytics_scope = 'goal'
          AND f.report_date >= ?
          AND f.report_date <= ?
          AND f.analytics_account_id IN (${accountPlaceholders})
          AND NULLIF(TRIM(f.utm_campaign), '') IS NOT NULL
          ${goalFilter}
        GROUP BY b.line_key, f.report_date, NULLIF(TRIM(f.utm_campaign), '')
        ORDER BY f.report_date, b.line_key
      `,
      goalParams,
    );
    campaignGoalRows = rows;
  }

  const [campaignAdsRows] = await pool.execute<PostClickCampaignAdsFactRow[]>(
    `
      SELECT
        b.line_key AS line_key,
        m.report_date AS date,
        NULLIF(TRIM(m.utm_campaign), '') AS utm_campaign,
        GROUP_CONCAT(DISTINCT b.source_key ORDER BY b.source_key SEPARATOR '|||') AS source_keys,
        GROUP_CONCAT(DISTINCT NULLIF(TRIM(f.platform_account_id), '') ORDER BY f.platform_account_id SEPARATOR '|||') AS platform_account_ids,
        GROUP_CONCAT(DISTINCT NULLIF(TRIM(f.platform_campaign_id), '') ORDER BY f.platform_campaign_id SEPARATOR '|||') AS platform_campaign_ids,
        GROUP_CONCAT(
          DISTINCT NULLIF(TRIM(CASE WHEN f.platform_delivery_entity_id = '__campaign__' THEN '' ELSE f.platform_delivery_entity_id END), '')
          ORDER BY f.platform_delivery_entity_id
          SEPARATOR '|||'
        ) AS platform_delivery_entity_ids,
        GROUP_CONCAT(
          DISTINCT NULLIF(TRIM(CASE WHEN f.platform_creative_id = '__campaign__' THEN '' ELSE f.platform_creative_id END), '')
          ORDER BY f.platform_creative_id
          SEPARATOR '|||'
        ) AS platform_creative_ids,
        COALESCE(SUM(f.impressions), 0) AS impressions,
        COALESCE(SUM(f.clicks), 0) AS clicks,
        COALESCE(SUM(f.views), 0) AS views,
        COALESCE(SUM(f.reach), 0) AS reach,
        COALESCE(SUM(f.spend), 0) AS spend,
        COALESCE(SUM(f.video_views_25), 0) AS video_views_25,
        COALESCE(SUM(f.video_views_50), 0) AS video_views_50,
        COALESCE(SUM(f.video_views_75), 0) AS video_views_75,
        COALESCE(SUM(f.video_views_100), 0) AS video_views_100
      FROM dashboard_utm_source_bindings b
      JOIN canonical_fact_site_analytics_daily m
        ON b.dashboard_id = ?
       AND b.utm_source COLLATE utf8mb4_unicode_ci = NULLIF(TRIM(m.utm_source), '') COLLATE utf8mb4_unicode_ci
       AND m.source_key = 'yandex_metrika'
       AND m.analytics_scope = 'traffic'
       AND m.report_date >= ?
       AND m.report_date <= ?
       AND m.analytics_account_id IN (${accountPlaceholders})
       AND NULLIF(TRIM(m.utm_campaign), '') IS NOT NULL
      JOIN media_plan_bindings mp
        ON mp.dashboard_id = b.dashboard_id
       AND mp.line_key COLLATE utf8mb4_unicode_ci = b.line_key COLLATE utf8mb4_unicode_ci
      JOIN canonical_fact_ads_daily f
        ON f.source_key COLLATE utf8mb4_unicode_ci = mp.source_key
       AND f.report_date = m.report_date
       AND (
         f.platform_campaign_id COLLATE utf8mb4_unicode_ci = NULLIF(TRIM(m.utm_campaign), '')
         OR f.platform_delivery_entity_id COLLATE utf8mb4_unicode_ci = NULLIF(TRIM(m.utm_campaign), '')
         OR f.platform_creative_id COLLATE utf8mb4_unicode_ci = NULLIF(TRIM(m.utm_campaign), '')
       )
      GROUP BY b.line_key, m.report_date, NULLIF(TRIM(m.utm_campaign), '')
      ORDER BY m.report_date, b.line_key
    `,
    [dashboardId, dateFrom, dateTo, ...metrikaAccountIds],
  );

  const goalsByLineDate = new Map(
    goalRows.map((row) => [
      `${String(row.line_key ?? "").trim()}::${String(row.date ?? "").slice(0, 10)}`,
      Number(row.goal_reaches ?? 0),
    ] as const),
  );

  const splitPipeValues = (raw: string | null | undefined): string[] =>
    String(raw ?? "")
      .split("|||")
      .map((item) => item.trim())
      .filter(Boolean);

  const rawSpendByLineKey = adsRows.reduce((acc, row) => {
    const lineKey = String(row.line_key ?? "").trim();
    if (!lineKey) return acc;
    acc.set(lineKey, (acc.get(lineKey) ?? 0) + Number(row.spend ?? 0));
    return acc;
  }, new Map<string, number>());

  const reportDatesByLineKey = trafficRows.reduce((acc, row) => {
    const lineKey = String(row.line_key ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    if (!lineKey || !date) return acc;
    if (!acc.has(lineKey)) acc.set(lineKey, new Set<string>());
    acc.get(lineKey)!.add(date);
    return acc;
  }, new Map<string, Set<string>>());
  for (const row of adsRows) {
    const lineKey = String(row.line_key ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    if (!lineKey || !date) continue;
    if (!reportDatesByLineKey.has(lineKey)) reportDatesByLineKey.set(lineKey, new Set<string>());
    reportDatesByLineKey.get(lineKey)!.add(date);
  }

  const resolveDailySpend = (lineKey: string, rawSpend: number): number => {
    if (spendSource !== "media_plan_derived") return rawSpend;
    const planSpend = planSpendByLineKey.get(lineKey);
    if (planSpend === undefined) return rawSpend;
    const rawLineSpend = rawSpendByLineKey.get(lineKey) ?? 0;
    if (rawLineSpend > 0 && rawSpend > 0) {
      return Number(((planSpend * rawSpend) / rawLineSpend).toFixed(2));
    }
    const reportDatesCount = reportDatesByLineKey.get(lineKey)?.size ?? 0;
    return reportDatesCount > 0 ? Number((planSpend / reportDatesCount).toFixed(2)) : 0;
  };

  const dailySpendScaleByLineDate = new Map<string, number>();
  for (const row of adsRows) {
    const lineKey = String(row.line_key ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    const rawSpend = Number(row.spend ?? 0);
    if (!lineKey || !date || rawSpend <= 0) continue;
    dailySpendScaleByLineDate.set(`${lineKey}::${date}`, resolveDailySpend(lineKey, rawSpend) / rawSpend);
  }

  const adsByLineDate = new Map(
    adsRows.map((row) => {
      const lineKey = String(row.line_key ?? "").trim();
      const date = String(row.date ?? "").slice(0, 10);
      const rawSpend = Number(row.spend ?? 0);
      return [
        `${lineKey}::${date}`,
        {
          source_keys: splitPipeValues(row.source_keys),
          platform_account_ids: splitPipeValues(row.platform_account_ids),
          platform_campaign_ids: splitPipeValues(row.platform_campaign_ids),
          platform_delivery_entity_ids: splitPipeValues(row.platform_delivery_entity_ids),
          platform_creative_ids: splitPipeValues(row.platform_creative_ids),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          views: Number(row.views ?? 0),
          reach: Number(row.reach ?? 0),
          spend: resolveDailySpend(lineKey, rawSpend),
          video_views_25: Number(row.video_views_25 ?? 0),
          video_views_50: Number(row.video_views_50 ?? 0),
          video_views_75: Number(row.video_views_75 ?? 0),
          video_views_100: Number(row.video_views_100 ?? 0),
        },
      ] as const;
    }),
  );

  const campaignGoalsByLineDate = new Map(
    campaignGoalRows.map((row) => [
      `${String(row.line_key ?? "").trim()}::${String(row.date ?? "").slice(0, 10)}::${String(row.utm_campaign ?? "").trim()}`,
      Number(row.goal_reaches ?? 0),
    ] as const),
  );

  const campaignAdsByLineDate = new Map(
    campaignAdsRows.map((row) => {
      const lineKey = String(row.line_key ?? "").trim();
      const date = String(row.date ?? "").slice(0, 10);
      const campaign = String(row.utm_campaign ?? "").trim();
      return [
        `${lineKey}::${date}::${campaign}`,
        {
          source_keys: splitPipeValues(row.source_keys),
          platform_account_ids: splitPipeValues(row.platform_account_ids),
          platform_campaign_ids: splitPipeValues(row.platform_campaign_ids),
          platform_delivery_entity_ids: splitPipeValues(row.platform_delivery_entity_ids),
          platform_creative_ids: splitPipeValues(row.platform_creative_ids),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          views: Number(row.views ?? 0),
          reach: Number(row.reach ?? 0),
          spend: Number(row.spend ?? 0),
          video_views_25: Number(row.video_views_25 ?? 0),
          video_views_50: Number(row.video_views_50 ?? 0),
          video_views_75: Number(row.video_views_75 ?? 0),
          video_views_100: Number(row.video_views_100 ?? 0),
        },
      ] as const;
    }),
  );

  const campaignByLineDate = new Map<string, PostClickAnalyticsTimeSeriesPoint["campaign_breakdown"]>();
  for (const row of campaignTrafficRows) {
    const lineKey = String(row.line_key ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    const campaign = String(row.utm_campaign ?? "").trim();
    if (!lineKey || !date || !campaign) continue;
    const visits = Number(row.visits ?? 0);
    const goalReaches = campaignGoalsByLineDate.get(`${lineKey}::${date}::${campaign}`) ?? 0;
    const adsMetrics = campaignAdsByLineDate.get(`${lineKey}::${date}::${campaign}`);
    const impressions = adsMetrics?.impressions ?? 0;
    const clicks = adsMetrics?.clicks ?? 0;
    const rawSpend = adsMetrics?.spend ?? 0;
    const spend =
      spendSource === "media_plan_derived"
        ? Number((rawSpend * (dailySpendScaleByLineDate.get(`${lineKey}::${date}`) ?? 1)).toFixed(2))
        : rawSpend;
    const item = {
      date,
      line_key: lineKey,
      channel: String(row.channel ?? "").trim(),
      utm_campaign: campaign,
      source_keys: adsMetrics?.source_keys ?? [],
      platform_account_ids: adsMetrics?.platform_account_ids ?? [],
      platform_campaign_ids: adsMetrics?.platform_campaign_ids ?? [],
      platform_delivery_entity_ids: adsMetrics?.platform_delivery_entity_ids ?? [],
      platform_creative_ids: adsMetrics?.platform_creative_ids ?? [],
      visits,
      users: Number(row.users ?? 0),
      pageviews: Number(row.pageviews ?? 0),
      page_depth: Number(Number(row.page_depth ?? 0).toFixed(2)),
      goal_reaches: goalReaches,
      bounce_rate: Number(Number(row.bounce_rate ?? 0).toFixed(2)),
      avg_visit_duration: Number(Number(row.avg_visit_duration ?? 0).toFixed(2)),
      conversion_rate: visits > 0 ? Number(((goalReaches / visits) * 100).toFixed(2)) : 0,
      impressions,
      clicks,
      views: adsMetrics?.views ?? 0,
      reach: adsMetrics?.reach ?? 0,
      spend,
      ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      cpm: impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(2)) : 0,
      cpc: clicks > 0 ? Number((spend / clicks).toFixed(2)) : 0,
      video_views_25: adsMetrics?.video_views_25 ?? 0,
      video_views_50: adsMetrics?.video_views_50 ?? 0,
      video_views_75: adsMetrics?.video_views_75 ?? 0,
      video_views_100: adsMetrics?.video_views_100 ?? 0,
    };
    const key = `${lineKey}::${date}`;
    if (!campaignByLineDate.has(key)) campaignByLineDate.set(key, []);
    campaignByLineDate.get(key)!.push(item);
  }

  const dailyByLineKey = new Map<string, PostClickAnalyticsTimeSeriesPoint[]>();
  const channelGroupByLineKey = new Map(channelGroups.map((group) => [group.line_key, group] as const));

  for (const row of trafficRows) {
    const lineKey = String(row.line_key ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    if (!lineKey || !date) continue;
    const visits = Number(row.visits ?? 0);
    const goalReaches = goalsByLineDate.get(`${lineKey}::${date}`) ?? 0;
    const adsMetrics = adsByLineDate.get(`${lineKey}::${date}`);
    const impressions = adsMetrics?.impressions ?? 0;
    const clicks = adsMetrics?.clicks ?? 0;
    const spend = adsMetrics?.spend ?? resolveDailySpend(lineKey, 0);
    const point: PostClickAnalyticsTimeSeriesPoint = {
      date,
      line_key: lineKey,
      channel: String(row.channel ?? "").trim(),
      source_keys: adsMetrics?.source_keys ?? [],
      platform_account_ids: adsMetrics?.platform_account_ids ?? [],
      platform_campaign_ids: adsMetrics?.platform_campaign_ids ?? [],
      platform_delivery_entity_ids: adsMetrics?.platform_delivery_entity_ids ?? [],
      platform_creative_ids: adsMetrics?.platform_creative_ids ?? [],
      visits,
      users: Number(row.users ?? 0),
      pageviews: Number(row.pageviews ?? 0),
      page_depth: Number(Number(row.page_depth ?? 0).toFixed(2)),
      goal_reaches: goalReaches,
      bounce_rate: Number(Number(row.bounce_rate ?? 0).toFixed(2)),
      avg_visit_duration: Number(Number(row.avg_visit_duration ?? 0).toFixed(2)),
      conversion_rate: visits > 0 ? Number(((goalReaches / visits) * 100).toFixed(2)) : 0,
      impressions,
      clicks,
      views: adsMetrics?.views ?? 0,
      reach: adsMetrics?.reach ?? 0,
      spend,
      ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      cpm: impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(2)) : 0,
      cpc: clicks > 0 ? Number((spend / clicks).toFixed(2)) : 0,
      video_views_25: adsMetrics?.video_views_25 ?? 0,
      video_views_50: adsMetrics?.video_views_50 ?? 0,
      video_views_75: adsMetrics?.video_views_75 ?? 0,
      video_views_100: adsMetrics?.video_views_100 ?? 0,
      campaign_breakdown: (campaignByLineDate.get(`${lineKey}::${date}`) ?? []).sort((a, b) => b.visits - a.visits),
    };
    if (!dailyByLineKey.has(lineKey)) dailyByLineKey.set(lineKey, []);
    dailyByLineKey.get(lineKey)!.push(point);
  }

  const existingDailyKeys = new Set(
    Array.from(dailyByLineKey.entries()).flatMap(([lineKey, rows]) =>
      rows.map((row) => `${lineKey}::${row.date}`),
    ),
  );

  for (const row of adsRows) {
    const lineKey = String(row.line_key ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    if (!lineKey || !date || existingDailyKeys.has(`${lineKey}::${date}`)) continue;

    const group = channelGroupByLineKey.get(lineKey);
    if (!group) continue;
    const adsMetrics = adsByLineDate.get(`${lineKey}::${date}`);
    const impressions = adsMetrics?.impressions ?? 0;
    const clicks = adsMetrics?.clicks ?? 0;
    const spend = adsMetrics?.spend ?? resolveDailySpend(lineKey, 0);
    const point: PostClickAnalyticsTimeSeriesPoint = {
      date,
      line_key: lineKey,
      channel: group.channel,
      source_keys: adsMetrics?.source_keys ?? [],
      platform_account_ids: adsMetrics?.platform_account_ids ?? [],
      platform_campaign_ids: adsMetrics?.platform_campaign_ids ?? [],
      platform_delivery_entity_ids: adsMetrics?.platform_delivery_entity_ids ?? [],
      platform_creative_ids: adsMetrics?.platform_creative_ids ?? [],
      visits: 0,
      users: 0,
      pageviews: 0,
      page_depth: 0,
      goal_reaches: 0,
      bounce_rate: 0,
      avg_visit_duration: 0,
      conversion_rate: 0,
      impressions,
      clicks,
      views: adsMetrics?.views ?? 0,
      reach: adsMetrics?.reach ?? 0,
      spend,
      ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      cpm: impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(2)) : 0,
      cpc: clicks > 0 ? Number((spend / clicks).toFixed(2)) : 0,
      video_views_25: adsMetrics?.video_views_25 ?? 0,
      video_views_50: adsMetrics?.video_views_50 ?? 0,
      video_views_75: adsMetrics?.video_views_75 ?? 0,
      video_views_100: adsMetrics?.video_views_100 ?? 0,
      campaign_breakdown: [],
    };
    if (!dailyByLineKey.has(lineKey)) dailyByLineKey.set(lineKey, []);
    dailyByLineKey.get(lineKey)!.push(point);
  }

  const rows: PostClickAnalyticsRow[] = channelGroups
    .map((group) => {
      const lineKey = group.line_key;
      const sources = utmSourcesByLineKey.get(lineKey) ?? new Set<string>();
      const daily = (dailyByLineKey.get(lineKey) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const sourceKeys = new Set<string>();
      const platformAccountIds = new Set<string>();
      const platformCampaignIds = new Set<string>();
      const platformDeliveryEntityIds = new Set<string>();
      const platformCreativeIds = new Set<string>();
      const totals = daily.reduce(
        (acc, item) => {
          item.source_keys.forEach((value) => sourceKeys.add(value));
          item.platform_account_ids.forEach((value) => platformAccountIds.add(value));
          item.platform_campaign_ids.forEach((value) => platformCampaignIds.add(value));
          item.platform_delivery_entity_ids.forEach((value) => platformDeliveryEntityIds.add(value));
          item.platform_creative_ids.forEach((value) => platformCreativeIds.add(value));
          acc.visits += item.visits;
          acc.users += item.users;
          acc.pageviews += item.pageviews;
          acc.page_depth_weighted += item.page_depth * item.visits;
          acc.goal_reaches += item.goal_reaches;
          acc.bounce_weighted += item.bounce_rate * item.visits;
          acc.duration_weighted += item.avg_visit_duration * item.visits;
          acc.impressions += item.impressions;
          acc.clicks += item.clicks;
          acc.views += item.views;
          acc.reach += item.reach;
          acc.spend += item.spend;
          acc.video_views_25 += item.video_views_25;
          acc.video_views_50 += item.video_views_50;
          acc.video_views_75 += item.video_views_75;
          acc.video_views_100 += item.video_views_100;
          return acc;
        },
        {
          visits: 0,
          users: 0,
          pageviews: 0,
          goal_reaches: 0,
          page_depth_weighted: 0,
          bounce_weighted: 0,
          duration_weighted: 0,
          impressions: 0,
          clicks: 0,
          views: 0,
          reach: 0,
          spend: 0,
          video_views_25: 0,
          video_views_50: 0,
          video_views_75: 0,
          video_views_100: 0,
        },
      );

      const spend =
        spendSource === "media_plan_derived"
          ? Number((planSpendByLineKey.get(lineKey) ?? totals.spend).toFixed(2))
          : totals.spend;

      return {
        line_key: lineKey,
        channel: group.channel,
        instrument: group.instrument,
        buy_type: group.buy_type,
        utm_sources: Array.from(sources).sort((a, b) => a.localeCompare(b, "ru")),
        source_keys: Array.from(sourceKeys).sort((a, b) => a.localeCompare(b, "ru")),
        platform_account_ids: Array.from(platformAccountIds).sort((a, b) => a.localeCompare(b, "ru")),
        platform_campaign_ids: Array.from(platformCampaignIds).sort((a, b) => a.localeCompare(b, "ru")),
        platform_delivery_entity_ids: Array.from(platformDeliveryEntityIds).sort((a, b) => a.localeCompare(b, "ru")),
        platform_creative_ids: Array.from(platformCreativeIds).sort((a, b) => a.localeCompare(b, "ru")),
        visits: totals.visits,
        users: totals.users,
        pageviews: totals.pageviews,
        page_depth: totals.visits > 0 ? Number((totals.page_depth_weighted / totals.visits).toFixed(2)) : 0,
        goal_reaches: totals.goal_reaches,
        bounce_rate: totals.visits > 0 ? Number((totals.bounce_weighted / totals.visits).toFixed(2)) : 0,
        avg_visit_duration: totals.visits > 0 ? Number((totals.duration_weighted / totals.visits).toFixed(2)) : 0,
        conversion_rate: totals.visits > 0 ? Number(((totals.goal_reaches / totals.visits) * 100).toFixed(2)) : 0,
        impressions: totals.impressions,
        clicks: totals.clicks,
        views: totals.views,
        reach: totals.reach,
        spend,
        ctr: totals.impressions > 0 ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0,
        cpm: totals.impressions > 0 ? Number(((spend / totals.impressions) * 1000).toFixed(2)) : 0,
        cpc: totals.clicks > 0 ? Number((spend / totals.clicks).toFixed(2)) : 0,
        video_views_25: totals.video_views_25,
        video_views_50: totals.video_views_50,
        video_views_75: totals.video_views_75,
        video_views_100: totals.video_views_100,
      } satisfies PostClickAnalyticsRow;
    })
    .sort((a, b) => b.visits - a.visits || a.channel.localeCompare(b.channel, "ru"));

  if (!rows.length) {
    return undefined;
  }

  return {
    rows,
    timeseries: Array.from(dailyByLineKey.values())
      .flat()
      .sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel, "ru")),
  };
}

function mergeManualChannelPerformance(
  channelPerformance: ChannelPerformanceItem[],
  manualChannels: ManualChannelData[],
  boundManualChannelKeys: Set<string> = new Set(),
): ChannelPerformanceItem[] {
  if (!manualChannels.length) {
    return channelPerformance;
  }

  const existingKeys = new Set<string>();
  channelPerformance.forEach((item) => {
    if (item.platforms.length === 0) {
      existingKeys.add(`${item.channel}|*`);
      return;
    }
    item.platforms.forEach((platform) => {
      existingKeys.add(`${item.channel}|${resolvePlatformIdFromSourceKey(platform.source_key)}`);
    });
  });

  const additions = manualChannels
    .filter((row) => {
      const rowKey = `${row.platform}|${row.channel}`;
      return (
        !boundManualChannelKeys.has(rowKey) &&
        !existingKeys.has(`${row.channel}|${row.platform}`) &&
        !existingKeys.has(`${row.channel}|*`)
      );
    })
    .map((row) => {
      const platformId = row.platform;
      const sourceKey = resolveSourceKey(platformId);
      const meta = PLATFORM_COLORS[platformId];
      const impressions = row.impressions;
      const reach = row.reach;
      const clicks = row.clicks;
      const spend = row.spend;
      const views = row.views;
      const conversions = row.conversions;
      const frequency = reach > 0 ? impressions / reach : 0;

      return {
        channel: row.channel,
        instrument: meta?.label ?? platformId,
        buy_type: "Manual",
        platforms: [
          {
            source_key: sourceKey,
            label: meta?.label ?? platformId,
            color: meta?.hex ?? "#94a3b8",
          },
        ],
        campaign_count: 1,
        plan_only: false,
        metrics: {
          impressions: buildMetricSummary("impressions", impressions, 0),
          reach: buildMetricSummary("reach", reach, 0),
          frequency: buildMetricSummary("frequency", frequency, 0),
          clicks: buildMetricSummary("clicks", clicks, 0),
          views: buildMetricSummary("views", views, 0),
          conversions: buildMetricSummary("conversions", conversions, 0),
          spend: buildMetricSummary("spend", spend, 0),
          ctr: buildMetricSummary("ctr", impressions > 0 ? (clicks / impressions) * 100 : 0, 0),
          cpm: buildMetricSummary("cpm", impressions > 0 ? (spend / impressions) * 1000 : 0, 0),
          cpc: buildMetricSummary("cpc", clicks > 0 ? spend / clicks : 0, 0),
          cpv: buildMetricSummary("cpv", views > 0 ? spend / views : 0, 0),
          cpa: buildMetricSummary("cpa", conversions > 0 ? spend / conversions : 0, 0),
        },
      } satisfies ChannelPerformanceItem;
    });

  return [...channelPerformance, ...additions];
}

function buildPlanBasedPlatformSpend(
  platformStats: PlatformStats[],
  planRows: MediaPlanRow[],
  excludedPlatformIds: Set<string> = new Set(),
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
    if (excludedPlatformIds.has(stat.id)) continue;
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
  excludedPlatformIds: Set<string> = new Set(),
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
    if (excludedPlatformIds.has(point.platform)) return;
    const planPlatformRows = rowsByPlatform.get(point.platform) ?? [];
    if (!planPlatformRows.length) return;

    const totalPlanBudget = planPlatformRows.reduce((sum, row) => sum + asNumber(row.budget_plan), 0);
    const derivedSpend = planPlatformRows.reduce((sum, row) => {
      const budgetShare =
        totalPlanBudget > 0 ? asNumber(row.budget_plan) / totalPlanBudget : 1 / planPlatformRows.length;
      const impressions = point.impressions * budgetShare;
      const clicks = point.clicks * budgetShare;
      const views = asNumber(point.views) * budgetShare;
      const conversions = (point.conversions ?? 0) * budgetShare;

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
      point.spend = Number(derivedSpend.toFixed(2));
    }
  });
}

function applyPlanBasedChannelTimeseriesSpend(
  channelTimeseries: NonNullable<DashboardData["channel_timeseries"]>,
  channelGroups: ChannelGroup[],
): void {
  const groupsByChannel = new Map(channelGroups.map((group) => [group.channel, group] as const));

  channelTimeseries.forEach((point) => {
    const group = groupsByChannel.get(point.channel);
    if (!group) return;

    const cpmPlan = group.impressions_plan > 0 ? (group.budget_plan / group.impressions_plan) * 1000 : 0;
    const cpcPlan = group.clicks_plan > 0 ? group.budget_plan / group.clicks_plan : 0;
    const cpvPlan = group.views_plan > 0 ? group.budget_plan / group.views_plan : 0;
    const cpaPlan = group.conversions_plan > 0 ? group.budget_plan / group.conversions_plan : 0;

    let derivedSpend = 0;
    if (group.buy_type === "CPC" && cpcPlan > 0) {
      derivedSpend = point.clicks * cpcPlan;
    } else if (group.buy_type === "CPV" && cpvPlan > 0) {
      derivedSpend = (point.views ?? 0) * cpvPlan;
    } else if (group.buy_type === "CPA" && cpaPlan > 0) {
      derivedSpend = (point.conversions ?? 0) * cpaPlan;
    } else if (cpmPlan > 0) {
      derivedSpend = (point.impressions / 1000) * cpmPlan;
    }

    if (derivedSpend > 0) {
      point.spend = Number(derivedSpend.toFixed(2));
    }
  });
}

function deriveFactSpendFromPlanRow(row: PlanVsFactItem): number {
  if (row.buy_type === "CPC" && row.cpc_plan > 0) {
    return row.clicks_fact * row.cpc_plan;
  }
  if (row.buy_type === "CPV" && row.cpv_plan > 0) {
    return row.views_fact * row.cpv_plan;
  }
  if (row.buy_type === "CPA" && row.cpa_plan > 0) {
    return row.conversions_fact * row.cpa_plan;
  }
  if (row.cpm_plan > 0) {
    return (row.impressions_fact / 1000) * row.cpm_plan;
  }
  return 0;
}

function applyPlanBasedPlanVsFactSpend(rows: PlanVsFactItem[]): PlanVsFactItem[] {
  return rows.map((row) => {
    const derivedSpend = deriveFactSpendFromPlanRow(row);
    const nextBudgetFact = derivedSpend > 0 ? derivedSpend : row.budget_fact;
    return {
      ...row,
      budget_fact: Number(nextBudgetFact.toFixed(2)),
    };
  });
}

function buildPlatformBudgetFromPlanVsFact(
  rows: PlanVsFactItem[],
  budgetField: "budget_fact" | "budget_plan",
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const platformIds = row.platforms
      .map((platform) => resolvePlatformIdFromSourceKey(platform.source_key))
      .filter(Boolean);

    if (!platformIds.length) continue;

    const split = platformIds.length;
    for (const platformId of platformIds) {
      totals.set(
        platformId,
        Number(((totals.get(platformId) ?? 0) + row[budgetField] / split).toFixed(2)),
      );
    }
  }

  return totals;
}

function applyPlatformConversions(
  rows: PlatformStats[],
  conversionsByPlatform: Record<string, number>,
): void {
  for (const row of rows) {
    const extraConversions = Math.max(0, asNumber(conversionsByPlatform[row.id]));
    if (!extraConversions) continue;
    row.conversions += Math.round(extraConversions);
  }
}

function applyChannelLeadConversions(
  planVsFactRows: PlanVsFactItem[],
  channelTimeseries: NonNullable<DashboardData["channel_timeseries"]>,
  leadRows: ConfirmedLeadChannelRow[],
  spendSource: "platform_actual" | "media_plan_derived",
): void {
  if (!leadRows.length) return;

  const planRowByChannel = new Map(planVsFactRows.map((row) => [row.channel, row] as const));

  for (const leadRow of leadRows) {
    const planRow = planRowByChannel.get(leadRow.bound_channel);
    if (!planRow) continue;

    planRow.conversions_fact += leadRow.leads;

    let factRow = channelTimeseries.find(
      (row) => row.date === leadRow.date && row.channel === leadRow.bound_channel,
    );

    if (!factRow) {
      factRow = {
        date: leadRow.date,
        channel: leadRow.bound_channel,
        instrument: planRow.instrument,
        impressions: 0,
        reach: 0,
        clicks: 0,
        spend: 0,
        views: 0,
        conversions: 0,
      };
      channelTimeseries.push(factRow);
    }

    factRow.conversions += leadRow.leads;

    if (spendSource === "media_plan_derived" && planRow.buy_type === "CPA" && planRow.cpa_plan > 0) {
      factRow.spend = Number((factRow.spend + leadRow.leads * planRow.cpa_plan).toFixed(2));
    }
  }

  channelTimeseries.sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel));
}

export async function invokeDashboardLoaderWithAudience<T>(
  request: Request,
  requestedId: string,
  audience: AbbottDashboardAudience | undefined,
  loader: (
    request: Request,
    requestedId: string,
    audience?: AbbottDashboardAudience,
  ) => Promise<T>,
): Promise<T> {
  return loader(request, requestedId, audience);
}

export async function loadDashboardData(
  request: Request,
  requestedId: string,
  audience?: AbbottDashboardAudience,
): Promise<LoadedDashboardData> {
  const { id: normalizedRequestedId } = { id: requestedId };

  const [dashboardRows] = await pool.execute<DashboardRow[]>(
    "SELECT * FROM dashboards WHERE is_active = TRUE AND (id = ? OR client_id = ?) LIMIT 1",
    [normalizedRequestedId, normalizedRequestedId],
  );

  const dashboard = dashboardRows[0];
  if (!dashboard) {
    throw new Error("Dashboard not found");
  }

  const config = parseJson(dashboard.config);
  const multibrandConfig = normalizeMultibrandConfig(config.multibrand);
  const requestedBrandId = new URL(request.url).searchParams.get("brand");
  const activeBrand = findMultibrandBrand(multibrandConfig, requestedBrandId);
  const frequencyOverrides = normalizeFrequencyOverrides(config);
  const frequencyOverrideMap = buildFrequencyOverrideMap(frequencyOverrides);
  const showSpend = Boolean(config.show_spend ?? true);
  const metrikaSettings = normalizeDashboardMetrikaSettings(config.metrika_settings);
  const aiSummaryEnabled = Boolean(config.show_ai_summary ?? false);
  const aiSummaryAuthoring = normalizeDashboardAiSummaryAuthoring(config.ai_summary_authoring);
  const aiSummaryOverride = aiSummaryAuthoring
    ? buildDashboardAiSummaryFromOverrideText(aiSummaryAuthoring.override_text, aiSummaryAuthoring.updated_at)
    : null;
  const dashboardType = dashboard.dashboard_type;
  const spendSource =
    String(config.spend_source ?? "platform_actual") === "media_plan_derived"
      ? "media_plan_derived"
      : "platform_actual";
  const range = resolveDateRange(request, config, dashboardType);
  const compareRange = getCompareRange(request);
  const previousRange = buildPreviousPeriod(range.from, range.to);

  // TEMPORARY GIDROFURIL VK STUB
  // For VK (vk_ads_v2) on this dashboard we approximate "views started"
  // as impressions * 0.89 because the real metric is not yet collected
  // in canonical_fact_ads_daily (see loadAdjustedCampaignDailyFacts).
  const isGidrofuril = dashboard.client_id === 'gidrofuril';


  const [sourceRows] = await pool.execute<SourceRow[]>(
    `SELECT ds.*, dcf.filter_type, dcf.filter_value
     FROM dashboard_sources ds
     LEFT JOIN dashboard_campaign_filters dcf ON dcf.dashboard_source_id = ds.id
     WHERE ds.dashboard_id = ?`,
    [dashboard.id],
  );
  const storedMediaPlanRows = await loadDashboardMediaPlanRows(pool, dashboard.id);
  const metrikaAccountIds = resolveDashboardMetrikaAccountIds(sourceRows);
  const sectionFieldOverrides = getSectionFieldOverrides(config);

  if (dashboardType === "abbott_bi" || dashboardType === "zaruku_bi") {
    if (dashboardType === "abbott_bi" && audience !== "manager" && audience !== "embed") {
      throw new Error("Abbott trusted audience is required");
    }
    const counterIds = resolveAbbottCounterIds(sourceRows);
    const defaultCounterIds = dashboardType === "zaruku_bi" ? getDefaultZarukuCounterIds() : getDefaultAbbottCounterIds();
    const effectiveCounterIds = counterIds.length > 0 ? counterIds : defaultCounterIds;
    const serverTiming: DashboardServerTiming = {};
    const portalPayload =
      dashboardType === "zaruku_bi"
        ? {
            zaruku_seo: await loadZarukuSeoData(
              effectiveCounterIds,
              range.from,
              range.to,
              { recordTiming: (name, durationMs) => { serverTiming[name] = durationMs; } },
            ),
          }
        : { abbott_bi: await loadAbbottBiData(dashboard.id, effectiveCounterIds, range.from, range.to, audience) };

    const response: DashboardData = {
      dashboard: {
        client_name: dashboard.client_name,
        dashboard_name: dashboard.dashboard_name,
        logo_url: typeof config.logo_url === "string" ? config.logo_url : null,
        type: dashboardType,
        period: {
          from: range.from,
          to: range.to,
        },
        currency: String(config.currency ?? "RUB"),
        language: normalizeDashboardLanguage(config.language),
        show_spend: false,
        filter_scope: "platform",
        section_order: [],
        multibrand: null,
      },
      ai_summary_enabled: aiSummaryEnabled,
      kpi_config: [],
      visible_metrics: [],
      kpi: {
        total_impressions: 0,
        total_clicks: 0,
        total_spend: 0,
        total_conversions: 0,
        avg_ctr: 0,
        avg_cpm: 0,
        prev_impressions: 0,
        prev_clicks: 0,
        prev_spend: 0,
        prev_conversions: 0,
        prev_ctr: 0,
        prev_cpm: 0,
      },
      platforms: [],
      timeseries: [],
      plan_vs_fact: [],
      ...portalPayload,
    };
    const aiSummarySnapshot = getMatchingDashboardAiSummarySnapshot(config.ai_summary_snapshot, response);

    return {
      dashboard_id: dashboard.id,
      data: response,
      previous_platforms: [],
      leads_rows: [],
      ai_summary_enabled: aiSummaryEnabled,
      ai_summary_override_text: aiSummaryAuthoring?.override_text ?? null,
      ai_summary_override: aiSummaryOverride,
      ai_summary_snapshot: aiSummarySnapshot?.summary ?? null,
      server_timing: dashboardType === "zaruku_bi" ? serverTiming : undefined,
    };
  }

  const platformStatsRaw: PlatformStats[] = [];
  const timeseriesRaw: TimeSeriesPoint[] = [];
  const prevStatsRaw: PlatformStats[] = [];
  const campaignBreakdownRaw: CampaignBreakdownItem[] = [];
  const planRows: MediaPlanRow[] = [];
  const analyticsKpiRaw: AnalyticsKPI[] = [];
  const analyticsTimeseriesRaw: AnalyticsTimeSeriesPoint[] = [];
  const trafficSourcesRaw: TrafficSourceRow[] = [];
  const promopagesKpiRaw: Array<{
    total_impressions: number;
    total_reach: number;
    total_views: number;
    total_clicks: number;
    total_budget: number;
    avg_ctr: number;
    avg_cpm: number;
    total_clickouts: number;
    total_full_reads: number;
    total_metrica_visits: number;
  }> = [];
  const promopagesTimeseriesRaw: PromopagesTimeSeriesPoint[] = [];
  const promopagesCampaignsRaw: PromopagesCampaignItem[] = [];
  const actualAdsSourceKeys = new Set<string>();
  const customTables: CustomTableData[] = [];
  const leadsRows: LeadRow[] = [];
  let manualChannels: ManualChannelData[] = [];
  let manualTableTitle = "";

    for (const source of sourceRows) {
      try {
        if (source.platform === "manual_data" && source.role === "actual") {
          const sourceConfig = parseJson(source.source_config);
          const manualSourceKey = String(sourceConfig?.manual_source_key ?? "").trim();
          const hasConfirmedManualData =
            Boolean(manualSourceKey) &&
            Boolean(sourceConfig?.confirmed_manual_data && typeof sourceConfig.confirmed_manual_data === "object");
          const hasManualInput =
            Boolean(String(sourceConfig?.sheet_url ?? "").trim()) ||
            (typeof sourceConfig?.upload_file === "object" && sourceConfig?.upload_file);
          if (hasConfirmedManualData || hasManualInput) {
            try {
              const allRows = hasConfirmedManualData
                ? adaptStoredManualFacts(await loadDashboardManualFacts(dashboard.id, manualSourceKey, previousRange.from, range.to))
                : await fetchManualDataFromSourceConfig(sourceConfig);
              const filtered = filterManualRowsByBrand(
                filterByDateRange(allRows, range.from, range.to),
                activeBrand?.channel_patterns ?? [],
              );

              const byPlatform = aggregateByPlatform(filtered);
              for (const p of byPlatform) {
                const platformId = p.platform;
                const meta = PLATFORM_COLORS[platformId];
                platformStatsRaw.push({
                  id: platformId,
                  name: meta?.label ?? p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
                  color: meta?.hex ?? "#94a3b8",
                  impressions: p.impressions,
                  clicks: p.clicks,
                  spend: p.spend,
                  conversions: p.conversions,
                  views: p.views,
                  reach: p.reach,
                  frequency: p.reach > 0 ? p.impressions / p.reach : 0,
                  ctr: p.impressions > 0 ? Number(((p.clicks / p.impressions) * 100).toFixed(2)) : 0,
                  cpm: p.impressions > 0 ? Number(((p.spend / p.impressions) * 1000).toFixed(2)) : 0,
                });
              }

              const prevFiltered = filterManualRowsByBrand(
                filterByDateRange(allRows, previousRange.from, previousRange.to),
                activeBrand?.channel_patterns ?? [],
              );
              const prevByPlatform = aggregateByPlatform(prevFiltered);
              for (const p of prevByPlatform) {
                const platformId = p.platform;
                const meta = PLATFORM_COLORS[platformId];
                prevStatsRaw.push({
                  id: platformId,
                  name: meta?.label ?? p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
                  color: meta?.hex ?? "#94a3b8",
                  impressions: p.impressions,
                  clicks: p.clicks,
                  spend: p.spend,
                  conversions: p.conversions,
                  views: p.views,
                  reach: p.reach,
                  frequency: p.reach > 0 ? p.impressions / p.reach : 0,
                  ctr: p.impressions > 0 ? Number(((p.clicks / p.impressions) * 100).toFixed(2)) : 0,
                  cpm: p.impressions > 0 ? Number(((p.spend / p.impressions) * 1000).toFixed(2)) : 0,
                });
              }

              const ts = getTimeseriesByPlatform(filtered);
              for (const t of ts) {
                timeseriesRaw.push({
                  date: t.date,
                  platform: t.platform,
                  impressions: t.impressions,
                  clicks: t.clicks,
                  spend: t.spend,
                  views: t.views,
                  conversions: t.conversions,
                });
              }

              const byChannel = aggregateByChannel(filtered);
              manualChannels = [...manualChannels, ...byChannel];
              if (!manualTableTitle && String(sourceConfig?.title ?? "").trim()) {
                manualTableTitle = String(sourceConfig.title).trim();
              }
            } catch (e) {
              console.warn("Manual data fetch failed:", e);
            }
          }
          continue;
        }

        if (source.role === "custom_table") {
          const sourceConfig = parseJson(source.source_config);
          const sheetUrl = String(sourceConfig?.sheet_url ?? "").trim();
          if (sheetUrl) {
            try {
              const table = await fetchCustomTable(sheetUrl);
              customTables.push({
                title: String(sourceConfig?.title ?? "Custom Data").trim() || "Custom Data",
                headers: table.headers,
                rows: table.rows,
              });
            } catch (e) {
              console.warn("Custom table fetch failed:", e);
            }
          }
          continue;
        }

        if (source.platform === "leads" && source.role === "actual") {
          continue;
        }

        const schema = loadSchema(source.schema_file);
        const sourceKey = schema.source_key ?? resolveSourceKey(source.platform);
        const sourceType = schema.source_type ?? resolveSourceType(sourceKey);
        const sourceConfig = parseJson(source.source_config);
        if (source.role === "plan" && storedMediaPlanRows.length) {
          sourceConfig.inline_rows = storedMediaPlanRows.map((row) => ({ ...row }));
        }

        if (sourceType === "leads") {
          continue;
        }

        if (source.role === "plan" && (schema.source === "gsheet" || sourceType === "gsheet")) {
          const rows = await fetchMediaPlanFromSourceConfig(sourceConfig);
          planRows.push(...rows);
          continue;
        }

        if (schema.source !== "mysql") {
          continue;
        }

        const brandSourceFilter = activeBrand?.source_filters.find((item) => item.platform === source.platform);
        const filter: CanonicalFilter = {
          source_key: sourceKey,
          date_from: range.from,
          date_to: range.to,
          account_ids: parseAccountIds(sourceConfig.account_ids),
          campaign_filter: {
            filter_type: brandSourceFilter?.filter_type ?? source.filter_type ?? "all",
            filter_value: brandSourceFilter?.filter_value ?? source.filter_value,
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

          let views = Math.round(asNumber(aggregate?.total_views));
          if (isGidrofuril && sourceKey === "vk_ads_v2") {
            views = Math.round(impressions * 0.89);
          }

          platformStatsRaw.push({
            id: source.platform,
            name: platformMeta?.label ?? schema.display_name,
            color: platformMeta?.hex ?? "#94a3b8",
            impressions,
            clicks,
            spend,
            conversions: Math.round(asNumber(aggregate?.total_conversions)),
            views,
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
          let prevViews = Math.round(asNumber(prevAggregate?.total_views));
          if (isGidrofuril && sourceKey === "vk_ads_v2") {
            prevViews = Math.round(prevImpressionsRaw * 0.89);
          }
          prevStatsRaw.push({
            id: source.platform,
            name: platformMeta?.label ?? schema.display_name,
            color: platformMeta?.hex ?? "#94a3b8",
            impressions: prevImpressionsRaw,
            clicks: prevClicksRaw,
            spend: prevSpendRaw,
            conversions: Math.round(asNumber(prevAggregate?.total_conversions)),
            views: prevViews,
            reach: prevReach,
            frequency: prevReach > 0 ? Number((prevImpressionsRaw / prevReach).toFixed(2)) : 0,
            ctr: Number(asNumber(prevAggregate?.avg_ctr).toFixed(2)),
            cpm: Number(asNumber(prevAggregate?.avg_cpm).toFixed(2)),
          });

          const timeseriesRows = await getAdsTimeseries(filter);
          for (const row of timeseriesRows) {
            let tsViews = Math.round(asNumber(row.views));
            if (isGidrofuril && sourceKey === "vk_ads_v2") {
              tsViews = Math.round(asNumber(row.impressions) * 0.89);
            }
            timeseriesRaw.push({
              date: toIsoDate(row.date),
              platform: source.platform,
              impressions: asNumber(row.impressions),
              clicks: asNumber(row.clicks),
              spend: Number(asNumber(row.spend).toFixed(2)),
              views: tsViews,
              conversions: Math.round(asNumber(row.conversions)),
            });
          }

          if (dashboardType === "performance") {
            const campaignRows = await getCampaignBreakdown(filter);
            const platformMeta = PLATFORM_COLORS[source.platform];
            for (const row of campaignRows) {
              campaignBreakdownRaw.push({
                campaign_id: row.campaign_id,
                campaign_name: row.campaign_name,
                source_key: row.source_key,
                platform_label: platformMeta?.label ?? schema.display_name,
                platform_color: platformMeta?.hex ?? "#94a3b8",
                impressions: row.impressions,
                clicks: row.clicks,
                spend: row.spend,
                conversions: row.conversions,
                cpa: row.cpa,
                cpc: row.cpc,
                ctr: row.ctr,
              });
            }
          }
          continue;
        }

        if (sourceType === "promopages") {
          const promoFilter: PromopagesFilter = {
            source_key: sourceKey,
            date_from: range.from,
            date_to: range.to,
            account_ids: parseAccountIds(sourceConfig.account_ids),
          };

          const aggregate = await getPromopagesAggregate(promoFilter);
          promopagesKpiRaw.push({
            total_impressions: Math.round(asNumber(aggregate?.total_impressions)),
            total_reach: Math.round(asNumber(aggregate?.total_reach)),
            total_views: Math.round(asNumber(aggregate?.total_views)),
            total_clicks: Math.round(asNumber(aggregate?.total_clicks)),
            total_budget: Number(asNumber(aggregate?.total_budget).toFixed(2)),
            avg_ctr: Number(asNumber(aggregate?.avg_ctr).toFixed(2)),
            avg_cpm: Number(asNumber(aggregate?.avg_cpm).toFixed(2)),
            total_clickouts: Math.round(asNumber(aggregate?.total_clickouts)),
            total_full_reads: Math.round(asNumber(aggregate?.total_full_reads)),
            total_metrica_visits: Math.round(asNumber(aggregate?.total_metrica_visits)),
          });

          promopagesTimeseriesRaw.push(...(await getPromopagesTimeseries(promoFilter)));
          promopagesCampaignsRaw.push(...(await getPromopagesCampaignBreakdown(promoFilter)));
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
          const trafficSourceRows = await getAnalyticsTrafficSources(filter);
          for (const row of trafficSourceRows) {
            const trafficSource = String(row.traffic_source ?? "").trim();
            if (!trafficSource) continue;
            trafficSourcesRaw.push({
              traffic_source: trafficSource,
              visits: Math.round(asNumber(row.visits)),
              users: Math.round(asNumber(row.users)),
              new_users: Math.round(asNumber(row.new_users)),
              pageviews: Math.round(asNumber(row.pageviews)),
              bounce_rate: Number(asNumber(row.bounce_rate).toFixed(2)),
              page_depth: Number(asNumber(row.page_depth).toFixed(2)),
              avg_visit_duration: Number(asNumber(row.avg_visit_duration).toFixed(2)),
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
    const campaignBreakdown = dashboardType === "performance"
      ? mergeCampaignBreakdown(campaignBreakdownRaw)
      : [];

    const availablePlatformIds = Array.from(new Set(platformResults.map((row) => row.id)));
    const availablePrevPlatformIds = Array.from(new Set(prevPlatformResults.map((row) => row.id)));

    for (const source of sourceRows) {
      if (source.platform !== "leads" || source.role !== "actual") {
        continue;
      }

      try {
        const sourceConfig = parseJson(source.source_config);
        const parsedLeads = await fetchLeadsFromSourceConfig(sourceConfig);
        leadsRows.push(
          ...parsedLeads.rows.filter((row) => !row.date || (row.date >= range.from && row.date <= range.to)),
        );
        const currentConversions = await aggregateConfirmedLeadsByPlatform(
          sourceConfig,
          availablePlatformIds,
          range.from,
          range.to,
        );
        applyPlatformConversions(platformResults, currentConversions);

        const previousConversions = await aggregateConfirmedLeadsByPlatform(
          sourceConfig,
          availablePrevPlatformIds,
          previousRange.from,
          previousRange.to,
        );
        applyPlatformConversions(prevPlatformResults, previousConversions);
      } catch (leadsError) {
        console.warn("Confirmed leads merge failed:", leadsError);
      }
    }

    if (spendSource === "media_plan_derived") {
      buildPlanBasedTimeseriesSpend(timeseriesResults, planRows);

      const prevPlanSpendByPlatform = buildPlanBasedPlatformSpend(prevPlatformResults, planRows);

      prevPlatformResults.forEach((row) => {
        const derivedSpend = prevPlanSpendByPlatform.get(row.id);
        if (derivedSpend === undefined) return;
        row.spend = derivedSpend;
        row.cpm = row.impressions > 0 ? Number(((derivedSpend / row.impressions) * 1000).toFixed(2)) : 0;
      });
    }

    const planByChannel = groupByChannel(
      activeBrand?.channel_patterns?.length
        ? planRows.filter((row) => matchesAnyMultibrandPattern(row.channel, activeBrand.channel_patterns))
        : planRows,
    );
    const [bindingRows] = await pool.execute<BindingRow[]>(
      `SELECT line_key, channel, source_key, platform_campaign_id
       FROM media_plan_bindings
       WHERE dashboard_id = ?`,
      [dashboard.id],
    );
    const bindingsByLineKey = bindingRows.reduce((acc, row) => {
      const lineKey = String(row.line_key ?? row.channel ?? "");
      if (!acc.has(lineKey)) {
        acc.set(lineKey, []);
      }
      acc.get(lineKey)!.push({
        source_key: String(row.source_key ?? ""),
        platform_campaign_id: String(row.platform_campaign_id ?? ""),
      });
      return acc;
    }, new Map<string, Array<{ source_key: string; platform_campaign_id: string }>>());
    const boundManualChannelKeys = bindingRows.reduce((acc, row) => {
      if (row.source_key !== "manual_data") return acc;
      const payload = String(row.platform_campaign_id ?? "");
      if (!payload.startsWith("manual:")) return acc;
      const raw = payload.slice("manual:".length);
      const [platformRaw, ...channelParts] = raw.split("|");
      const platformId = normalizeManualPlatformId(platformRaw);
      const channel = channelParts.join("|").trim();
      if (platformId && channel) {
        acc.add(`${platformId}|${channel}`);
      }
      return acc;
    }, new Set<string>());
    const hasExplicitBindings = bindingRows.length > 0;
    const boundPromopagesOverlay = await buildBoundPromopagesOverlay(
      planByChannel,
      bindingsByLineKey,
      range.from,
      range.to,
    );
    const boundPromopagesOverlayPrev = await buildBoundPromopagesOverlay(
      planByChannel,
      bindingsByLineKey,
      previousRange.from,
      previousRange.to,
    );
    const boundPromopagesTimeseriesByChannel = boundPromopagesOverlay.timeseries.reduce((acc, row) => {
      if (!acc.has(row.channel)) {
        acc.set(row.channel, []);
      }
      acc.get(row.channel)!.push(row);
      return acc;
    }, new Map<string, BoundPromopagesTimeSeriesOverlay[]>());
    const planVsFactBase = await buildPlanVsFactRowsByChannel(
      planByChannel,
      bindingsByLineKey,
      hasExplicitBindings,
      actualAdsSourceKeys,
      range.from,
      range.to,
      frequencyOverrideMap,
      manualChannels,
      isGidrofuril,
    );
    const channelTimeseries = await buildChannelTimeseries(
      planByChannel,
      bindingsByLineKey,
      hasExplicitBindings,
      actualAdsSourceKeys,
      range.from,
      range.to,
      frequencyOverrideMap,
      boundPromopagesTimeseriesByChannel,
    );

    for (const source of sourceRows) {
      if (source.platform !== "leads" || source.role !== "actual") {
        continue;
      }

      try {
        const sourceConfig = parseJson(source.source_config);
        const currentChannelConversions = await aggregateConfirmedLeadsByCanonicalChannel(
          sourceConfig,
          availablePlatformIds,
          planVsFactBase.map((row) => row.channel),
          range.from,
          range.to,
        );
        applyChannelLeadConversions(planVsFactBase, channelTimeseries ?? [], currentChannelConversions, spendSource);
      } catch (leadsError) {
        console.warn("Confirmed leads channel merge failed:", leadsError);
      }
    }

    if (spendSource === "media_plan_derived" && channelTimeseries) {
      applyPlanBasedChannelTimeseriesSpend(channelTimeseries, planByChannel);
    }

    const planVsFact =
      spendSource === "media_plan_derived"
        ? applyPlanBasedPlanVsFactSpend(planVsFactBase)
        : planVsFactBase;

    if (spendSource === "media_plan_derived") {
      const currentPlanSpendByPlatform = buildPlatformBudgetFromPlanVsFact(planVsFact, "budget_plan");
      platformResults.forEach((row) => {
        const derivedSpend = currentPlanSpendByPlatform.get(row.id);
        if (derivedSpend === undefined) return;
        row.spend = derivedSpend;
        row.cpm = row.impressions > 0 ? Number(((derivedSpend / row.impressions) * 1000).toFixed(2)) : 0;
      });
    }

    const channelPerformance = mergeManualChannelPerformance(buildChannelPerformance(
      planVsFact,
      channelTimeseries,
      range.from,
      range.to,
      String(config.period_from ?? range.from),
      String(config.period_to ?? range.to),
    ), manualChannels, boundManualChannelKeys);
    const analyticsKpi = mergeAnalyticsKpi(analyticsKpiRaw);
    const analyticsTimeseries = mergeAnalyticsTimeseries(analyticsTimeseriesRaw);
    const trafficSources = mergeTrafficSources(trafficSourcesRaw);
    const postclickAnalytics = await buildPostClickAnalytics(
      dashboard.id,
      planByChannel,
      metrikaAccountIds,
      range.from,
      range.to,
      spendSource,
      String(config.period_from ?? range.from),
      String(config.period_to ?? range.to),
      metrikaSettings.selected_goal_ids,
      metrikaSettings.goal_mode,
    );
    let sectionOrder = getSectionOrder(config, dashboardType, showSpend);
    if (postclickAnalytics && postclickAnalytics.rows.length > 0) {
      sectionOrder = withOptionalSection(sectionOrder, "postclick_analytics", "plan_vs_fact");
    }
    if (trafficSources.length > 0) {
      sectionOrder = withOptionalSection(sectionOrder, "traffic_sources", "postclick_analytics");
    }
    const promopagesTimeseries = mergePromopagesTimeseries(promopagesTimeseriesRaw);
    const promopagesCampaigns = mergePromopagesCampaigns(promopagesCampaignsRaw);
    const promopagesKpi =
      promopagesKpiRaw.length > 0
        ? promopagesKpiRaw.reduce(
            (acc, item) => {
              acc.total_impressions += item.total_impressions;
              acc.total_reach += item.total_reach;
              acc.total_views += item.total_views;
              acc.total_clicks += item.total_clicks;
              acc.total_budget += item.total_budget;
              acc.total_clickouts += item.total_clickouts;
              acc.total_full_reads += item.total_full_reads;
              acc.total_metrica_visits += item.total_metrica_visits;
              return acc;
            },
            {
              total_impressions: 0,
              total_reach: 0,
              total_views: 0,
              total_clicks: 0,
              total_budget: 0,
              avg_ctr: 0,
              avg_cpm: 0,
              total_clickouts: 0,
              total_full_reads: 0,
              total_metrica_visits: 0,
            },
          )
        : null;

    if (promopagesKpi) {
      promopagesKpi.total_budget = Number(promopagesKpi.total_budget.toFixed(2));
      promopagesKpi.avg_ctr =
        promopagesKpi.total_impressions > 0
          ? Number(((promopagesKpi.total_clicks / promopagesKpi.total_impressions) * 100).toFixed(2))
          : 0;
      promopagesKpi.avg_cpm =
        promopagesKpi.total_impressions > 0
          ? Number(((promopagesKpi.total_budget / promopagesKpi.total_impressions) * 1000).toFixed(2))
          : 0;
    }

    const totalImpressions = platformResults.reduce((sum, row) => sum + row.impressions, 0);
    const totalClicks = platformResults.reduce((sum, row) => sum + row.clicks, 0);
    const totalSpend = platformResults.reduce((sum, row) => sum + row.spend, 0);
    const totalConversions = platformResults.reduce((sum, row) => sum + row.conversions, 0);
    const boundPromopagesTotals = boundPromopagesOverlay.byChannel.reduce(
      (acc, row) => {
        acc.impressions += row.impressions;
        acc.clicks += row.clicks;
        acc.spend += row.spend;
        return acc;
      },
      { impressions: 0, clicks: 0, spend: 0 },
    );

    const prevImpressions = prevPlatformResults.reduce((sum, row) => sum + row.impressions, 0);
    const prevClicks = prevPlatformResults.reduce((sum, row) => sum + row.clicks, 0);
    const prevSpend = prevPlatformResults.reduce((sum, row) => sum + row.spend, 0);
    const prevConversions = prevPlatformResults.reduce((sum, row) => sum + row.conversions, 0);
    const boundPromopagesPrevTotals = boundPromopagesOverlayPrev.byChannel.reduce(
      (acc, row) => {
        acc.impressions += row.impressions;
        acc.clicks += row.clicks;
        acc.spend += row.spend;
        return acc;
      },
      { impressions: 0, clicks: 0, spend: 0 },
    );

    const kpi = {
      total_impressions: totalImpressions + boundPromopagesTotals.impressions,
      total_clicks: totalClicks + boundPromopagesTotals.clicks,
      total_spend: Number((totalSpend + boundPromopagesTotals.spend).toFixed(2)),
      total_conversions: totalConversions,
      avg_ctr:
        totalImpressions + boundPromopagesTotals.impressions > 0
          ? Number((((totalClicks + boundPromopagesTotals.clicks) / (totalImpressions + boundPromopagesTotals.impressions)) * 100).toFixed(2))
          : 0,
      avg_cpm:
        totalImpressions + boundPromopagesTotals.impressions > 0
          ? Number((((totalSpend + boundPromopagesTotals.spend) / (totalImpressions + boundPromopagesTotals.impressions)) * 1000).toFixed(2))
          : 0,
      prev_impressions: prevImpressions + boundPromopagesPrevTotals.impressions,
      prev_clicks: prevClicks + boundPromopagesPrevTotals.clicks,
      prev_spend: Number((prevSpend + boundPromopagesPrevTotals.spend).toFixed(2)),
      prev_conversions: prevConversions,
      prev_ctr:
        prevImpressions + boundPromopagesPrevTotals.impressions > 0
          ? Number((((prevClicks + boundPromopagesPrevTotals.clicks) / (prevImpressions + boundPromopagesPrevTotals.impressions)) * 100).toFixed(2))
          : 0,
      prev_cpm:
        prevImpressions + boundPromopagesPrevTotals.impressions > 0
          ? Number((((prevSpend + boundPromopagesPrevTotals.spend) / (prevImpressions + boundPromopagesPrevTotals.impressions)) * 1000).toFixed(2))
          : 0,
    };
    const funnel = dashboardType === "performance"
      ? buildFunnel(totalImpressions, totalClicks, totalConversions)
      : undefined;

    const response: DashboardData = {
      dashboard: {
        client_name: dashboard.client_name,
        dashboard_name: dashboard.dashboard_name,
        logo_url: typeof config.logo_url === "string" ? config.logo_url : null,
        type: dashboardType,
        period: {
          from: range.from,
          to: range.to,
        },
        currency: String(config.currency ?? "EUR"),
        language: normalizeDashboardLanguage(config.language),
        show_spend: showSpend,
        filter_scope: getFilterScope(config),
        section_order: sectionOrder,
        multibrand:
          multibrandConfig?.enabled
            ? {
                ...multibrandConfig,
                active_brand_id: activeBrand?.id ?? null,
              }
            : null,
      },
      ai_summary_enabled: aiSummaryEnabled,
      kpi_config: getKpiConfig(config, dashboardType, showSpend),
      visible_metrics: getVisibleMetrics(config, dashboardType, showSpend),
      custom_kpi_cards: getCustomKpiCards(config, showSpend),
      kpi,
      platforms: platformResults,
      timeseries: timeseriesResults,
      plan_vs_fact: planVsFact,
      channel_performance: channelPerformance,
      channel_timeseries: channelTimeseries,
      custom_tables: customTables.length > 0 ? customTables : undefined,
      manual_channels: manualChannels.length > 0 ? manualChannels : undefined,
      manual_table_title: manualChannels.length > 0 ? (manualTableTitle || "Additional sources") : undefined,
      campaign_breakdown: campaignBreakdown.length > 0 ? campaignBreakdown : undefined,
      funnel,
      analytics:
        analyticsKpiRaw.length > 0
          ? {
              kpi: analyticsKpi,
              timeseries: analyticsTimeseries,
              selected_metrics: metrikaSettings.selected_traffic_metrics,
            }
          : undefined,
      traffic_sources: trafficSources.length > 0 ? trafficSources : undefined,
      postclick_analytics: postclickAnalytics
        ? {
            ...postclickAnalytics,
            selected_columns: sectionFieldOverrides.postclick_analytics?.visible_fields,
          }
        : undefined,
      promopages:
        promopagesKpi && (promopagesCampaigns.length > 0 || promopagesTimeseries.length > 0)
          ? {
              kpi: promopagesKpi,
              timeseries: promopagesTimeseries,
              campaigns: promopagesCampaigns,
            }
          : undefined,
      section_field_overrides: {
        trend_chart: {
          visible_metrics: sectionFieldOverrides.trend_chart?.visible_metrics ?? [],
        },
        promopages: {
          visible_metrics: sectionFieldOverrides.promopages?.visible_metrics ?? [],
        },
        platform_table: {
          visible_metrics: sectionFieldOverrides.platform_table?.visible_metrics ?? [],
        },
        plan_vs_fact: {
          visible_metrics: sectionFieldOverrides.plan_vs_fact?.visible_metrics ?? [],
        },
        platform_plan_fact: {
          visible_metrics: sectionFieldOverrides.platform_plan_fact?.visible_metrics ?? [],
        },
        channel_table: {
          visible_metrics: sectionFieldOverrides.channel_table?.visible_metrics ?? [],
        },
      },
      bound_promopages:
        boundPromopagesOverlay.byChannel.length > 0
          ? {
              by_channel: boundPromopagesOverlay.byChannel,
              timeseries: boundPromopagesOverlay.timeseries,
            }
          : undefined,
    };

  if (compareRange) {
    const compareUrl = new URL(request.url);
    compareUrl.searchParams.set("from", compareRange.from);
    compareUrl.searchParams.set("to", compareRange.to);
    compareUrl.searchParams.delete("compare_from");
    compareUrl.searchParams.delete("compare_to");
    const compareRequest = new Request(compareUrl.toString(), { method: "GET" });
    const compareResult = await invokeDashboardLoaderWithAudience(
      compareRequest,
      requestedId,
      audience,
      loadDashboardData,
    );
    response.comparison = buildComparison(response, compareResult.data);
  }

  const aiSummarySnapshot = getMatchingDashboardAiSummarySnapshot(config.ai_summary_snapshot, response);

  return {
    dashboard_id: dashboard.id,
    data: response,
    previous_platforms: prevPlatformResults,
    leads_rows: leadsRows.length > 0 ? leadsRows : undefined,
    ai_summary_enabled: aiSummaryEnabled,
    ai_summary_override_text: aiSummaryAuthoring?.override_text ?? null,
    ai_summary_override: aiSummaryOverride,
    ai_summary_snapshot: aiSummarySnapshot?.summary ?? null,
  };
}

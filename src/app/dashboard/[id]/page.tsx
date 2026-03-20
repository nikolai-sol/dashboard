"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ChannelMix from "@/components/ChannelMix";
import CampaignPerformanceTable from "@/components/CampaignPerformanceTable";
import ChannelPerformanceTable from "@/components/ChannelPerformanceTable";
import ConversionFunnel from "@/components/ConversionFunnel";
import CustomTable from "@/components/CustomTable";
import DashboardHeader from "@/components/DashboardHeader";
import KPICard from "@/components/KPICard";
import PlatformFilter from "@/components/PlatformFilter";
import PlatformPlanVsFact from "@/components/PlatformPlanVsFact";
import PlatformTable from "@/components/PlatformTable";
import PlanVsFact from "@/components/PlanVsFact";
import SpendByPlatform from "@/components/SpendByPlatform";
import SpendConversionsScatter from "@/components/SpendConversionsScatter";
import TrendChart from "@/components/TrendChart";
import { getDashboardI18n } from "@/lib/dashboard-i18n";
import type { DashboardData } from "@/lib/types";
import { resolvePlatformIdFromSourceKey } from "@/lib/source-mapping";

const SPEND_RELATED_KPIS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);

type RenderableKpiCard = {
  key: string;
  title: string;
  value: number;
  prev: number;
  color: string;
  format: (value: number) => string;
  trend: number[];
  deltaOverride?: number | null;
};

function money(value: number, currency = "EUR", locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function compact(value: number, locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(Math.round(value));
}

function formatPeriodDate(isoDate: string, locale = "en-GB") {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

async function getDashboardData(
  id: string,
  range?: { from: string; to: string },
): Promise<{
  data: DashboardData;
  demoMode: boolean;
  errorMessage: string | null;
}> {
  try {
    const params = new URLSearchParams();
    if (range?.from && range?.to) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    const query = params.toString();
    const response = await fetch(`/api/dashboard/${id}${query ? `?${query}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = (await response.json()) as DashboardData;
    return { data, demoMode: false, errorMessage: null };
  } catch (error) {
    console.warn("API unavailable, using mock data:", error);
    const { mockDashboardData } = await import("@/lib/mock-data");
    const message = error instanceof Error ? error.message : "Unknown API error";
    return { data: mockDashboardData, demoMode: true, errorMessage: message };
  }
}

export default function DashboardByIdPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const dashboardId = params?.id ? String(params.id).toLowerCase() : "rag_mp";
  const initialFrom = searchParams.get("from") ?? "";
  const initialTo = searchParams.get("to") ?? "";
  const isPdfMode = searchParams.get("pdf") === "true";
  const isMobileMode = searchParams.get("mobile") === "1";

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"platform" | "channel">("platform");
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: initialFrom, to: initialTo });
  const [draftDateRange, setDraftDateRange] = useState<{ from: string; to: string }>({
    from: initialFrom,
    to: initialTo,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);

      const result = await getDashboardData(
        dashboardId,
        dateRange.from && dateRange.to ? dateRange : undefined,
      );
      if (cancelled) {
        return;
      }

      setDashboard(result.data);
      setIsDemoMode(result.demoMode);
      setApiError(result.errorMessage);

      const availablePlatforms = result.data.platforms.map((platform) => platform.id);
      setSelectedPlatforms(availablePlatforms);
      const availableChannels = (result.data.channel_performance ?? []).map((item) => item.channel);
      setSelectedChannels(availableChannels);
      setFilterMode(result.data.dashboard.filter_scope === "channel" ? "channel" : "platform");
      setDraftDateRange((prev) => ({
        from: prev.from || result.data.dashboard.period.from,
        to: prev.to || result.data.dashboard.period.to,
      }));
      setIsLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [dashboardId, dateRange]);

  const selectedSet = useMemo(() => new Set(selectedPlatforms), [selectedPlatforms]);
  const selectedChannelSet = useMemo(() => new Set(selectedChannels), [selectedChannels]);
  const filterScope = dashboard?.dashboard.filter_scope ?? "both";
  const effectiveFilterMode = filterScope === "both" ? filterMode : filterScope;

  const channelVisiblePlatformIds = useMemo(() => {
    if (!dashboard) return new Set<string>();
    const ids = new Set<string>();
    dashboard.plan_vs_fact.forEach((item) => {
      if (!selectedChannelSet.has(item.channel)) return;
      item.platforms.forEach((platform) => ids.add(resolvePlatformIdFromSourceKey(platform.source_key)));
    });
    return ids;
  }, [dashboard, selectedChannelSet]);

  const filteredPlatforms = useMemo(() => {
    if (!dashboard) return [];
    if (effectiveFilterMode === "channel") {
      return dashboard.platforms.filter((item) => channelVisiblePlatformIds.has(item.id));
    }
    return dashboard.platforms.filter((item) => selectedSet.has(item.id));
  }, [channelVisiblePlatformIds, dashboard, effectiveFilterMode, selectedSet]);

  const filteredTimeseries = useMemo(() => {
    if (!dashboard) return [];
    if (effectiveFilterMode === "channel") {
      return dashboard.timeseries.filter((item) => channelVisiblePlatformIds.has(item.platform));
    }
    return dashboard.timeseries.filter((item) => selectedSet.has(item.platform));
  }, [channelVisiblePlatformIds, dashboard, effectiveFilterMode, selectedSet]);

  const filteredPlanVsFact = useMemo(() => {
    if (!dashboard) return [];
    const platformFiltered = dashboard.plan_vs_fact.filter(
      (item) =>
        item.platforms.length === 0 ||
        item.platforms.some((platform) => selectedSet.has(resolvePlatformIdFromSourceKey(platform.source_key))),
    );
    if (effectiveFilterMode === "channel") {
      return platformFiltered.filter((item) => selectedChannelSet.has(item.channel));
    }
    return platformFiltered;
  }, [dashboard, effectiveFilterMode, selectedChannelSet, selectedSet]);

  const filteredChannelPerformance = useMemo(() => {
    if (!dashboard?.channel_performance) return [];
    const platformFiltered = dashboard.channel_performance.filter(
      (item) =>
        item.platforms.length === 0 ||
        item.platforms.some((platform) => selectedSet.has(resolvePlatformIdFromSourceKey(platform.source_key))),
    );
    if (effectiveFilterMode === "channel") {
      return platformFiltered.filter((item) => selectedChannelSet.has(item.channel));
    }
    return platformFiltered;
  }, [dashboard, effectiveFilterMode, selectedChannelSet, selectedSet]);

  const currencyCode = dashboard?.dashboard.currency || "EUR";
  const dashboardLanguage = dashboard?.dashboard.language ?? "en";
  const i18n = useMemo(() => getDashboardI18n(dashboardLanguage), [dashboardLanguage]);
  const locale = i18n.locale;
  const showSpend = dashboard?.dashboard.show_spend ?? true;
  const sectionOrder = dashboard?.dashboard.section_order ?? [];
  const dashboardType = dashboard?.dashboard.type ?? "awareness";
  const channelOptions = useMemo(
    () =>
      (dashboard?.channel_performance ?? []).map((item) => ({
        id: item.channel,
        name: item.channel,
        color: item.platforms[0]?.color ?? "#94a3b8",
      })),
    [dashboard?.channel_performance],
  );

  const totals = useMemo(() => {
    const totalImpressions = filteredPlatforms.reduce((sum, item) => sum + item.impressions, 0);
    const totalClicks = filteredPlatforms.reduce((sum, item) => sum + item.clicks, 0);
    const totalSpend = filteredPlatforms.reduce((sum, item) => sum + item.spend, 0);
    const totalConversions = filteredPlatforms.reduce((sum, item) => sum + item.conversions, 0);
    const totalViews = filteredPlatforms.reduce((sum, item) => sum + item.views, 0);
    const totalReach = filteredPlatforms.reduce((sum, item) => sum + item.reach, 0);
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const avgCpv = totalViews > 0 ? totalSpend / totalViews : 0;
    const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const avgFrequency = totalReach > 0 ? totalImpressions / totalReach : 0;
    return {
      totalImpressions,
      totalClicks,
      totalSpend,
      totalConversions,
      totalViews,
      totalReach,
      avgCtr,
      avgCpm,
      avgCpc,
      avgCpv,
      avgCpa,
      avgFrequency,
    };
  }, [filteredPlatforms]);

  const scales = useMemo(() => {
    const kpi = dashboard?.kpi;
    if (!kpi) {
      return { impressions: 0.9, clicks: 0.9, spend: 0.95 };
    }

    return {
      impressions: kpi.total_impressions > 0 ? kpi.prev_impressions / kpi.total_impressions : 0.9,
      clicks: kpi.total_clicks > 0 ? kpi.prev_clicks / kpi.total_clicks : 0.9,
      spend: kpi.total_spend > 0 ? kpi.prev_spend / kpi.total_spend : 0.95,
    };
  }, [dashboard?.kpi]);

  const previousTotals = useMemo(() => {
    const prevImpressions = totals.totalImpressions * scales.impressions;
    const prevClicks = totals.totalClicks * scales.clicks;
    const prevSpend = totals.totalSpend * scales.spend;
    const prevViews = totals.totalViews * scales.impressions;
    const prevConversions = totals.totalConversions * scales.clicks;
    const prevReach = totals.totalReach * scales.impressions;
    const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;
    const prevCpm = prevImpressions > 0 ? (prevSpend / prevImpressions) * 1000 : 0;
    const prevCpc = prevClicks > 0 ? prevSpend / prevClicks : 0;
    const prevCpv = prevViews > 0 ? prevSpend / prevViews : 0;
    const prevCpa = prevConversions > 0 ? prevSpend / prevConversions : 0;
    const prevFrequency = prevReach > 0 ? prevImpressions / prevReach : 0;
    return {
      prevImpressions,
      prevClicks,
      prevSpend,
      prevViews,
      prevConversions,
      prevReach,
      prevCtr,
      prevCpm,
      prevCpc,
      prevCpv,
      prevCpa,
      prevFrequency,
    };
  }, [
    scales.clicks,
    scales.impressions,
    scales.spend,
    totals.totalClicks,
    totals.totalConversions,
    totals.totalImpressions,
    totals.totalReach,
    totals.totalSpend,
    totals.totalViews,
  ]);

  const aggregatedDaily = useMemo(() => {
    const byDate = new Map<
      string,
      { impressions: number; clicks: number; spend: number; conversions: number; views: number }
    >();
    const cvByPlatform = new Map(
      filteredPlatforms.map((platform) => [
        platform.id,
        platform.clicks > 0 ? platform.conversions / platform.clicks : 0,
      ]),
    );
    const viewByPlatform = new Map(
      filteredPlatforms.map((platform) => [
        platform.id,
        platform.impressions > 0 ? platform.views / platform.impressions : 0,
      ]),
    );

    filteredTimeseries.forEach((point) => {
      if (!byDate.has(point.date)) {
        byDate.set(point.date, { impressions: 0, clicks: 0, spend: 0, conversions: 0, views: 0 });
      }
      const row = byDate.get(point.date)!;
      row.impressions += point.impressions;
      row.clicks += point.clicks;
      row.spend += point.spend;
      row.conversions += point.clicks * (cvByPlatform.get(point.platform) ?? 0);
      row.views += point.impressions * (viewByPlatform.get(point.platform) ?? 0);
    });

    return [...byDate.entries()]
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredPlatforms, filteredTimeseries]);

  const latestTrend = useMemo(() => aggregatedDaily.slice(-30), [aggregatedDaily]);

  const kpiCards = useMemo<RenderableKpiCard[]>(() => {
    const kpiConfig = (dashboard?.kpi_config?.slice(0, 5) ?? ["impressions", "clicks", "ctr", "cpm", "spend"])
      .filter((metric) => showSpend || !SPEND_RELATED_KPIS.has(metric));

    const metricMap = {
      impressions: {
        key: "impressions",
        title: i18n.metrics.impressions,
        value: totals.totalImpressions,
        prev: previousTotals.prevImpressions,
        color: "#2563eb",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.impressions),
      },
      clicks: {
        key: "clicks",
        title: i18n.metrics.clicks,
        value: totals.totalClicks,
        prev: previousTotals.prevClicks,
        color: "#7c3aed",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.clicks),
      },
      ctr: {
        key: "ctr",
        title: i18n.metrics.ctr,
        value: totals.avgCtr,
        prev: previousTotals.prevCtr,
        color: "#16a34a",
        format: (value: number) => `${value.toFixed(2)}%`,
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0,
        ),
      },
      cpm: {
        key: "cpm",
        title: i18n.metrics.cpm,
        value: totals.avgCpm,
        prev: previousTotals.prevCpm,
        color: "#f97316",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0,
        ),
      },
      cpc: {
        key: "cpc",
        title: i18n.metrics.cpc,
        value: totals.avgCpc,
        prev: previousTotals.prevCpc,
        color: "#6366f1",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) => (item.clicks > 0 ? item.spend / item.clicks : 0)),
      },
      spend: {
        key: "spend",
        title: i18n.metrics.spend,
        value: totals.totalSpend,
        prev: previousTotals.prevSpend,
        color: "#0ea5e9",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) => item.spend),
      },
      views: {
        key: "views",
        title: i18n.metrics.views,
        value: totals.totalViews,
        prev: previousTotals.prevViews,
        color: "#ec4899",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.views),
      },
      cpv: {
        key: "cpv",
        title: i18n.metrics.cpv,
        value: totals.avgCpv,
        prev: previousTotals.prevCpv,
        color: "#d946ef",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) => (item.views > 0 ? item.spend / item.views : 0)),
      },
      conversions: {
        key: "conversions",
        title: i18n.metrics.conversions,
        value: totals.totalConversions,
        prev: previousTotals.prevConversions,
        color: "#059669",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.conversions),
      },
      cpa: {
        key: "cpa",
        title: i18n.metrics.cpa,
        value: totals.avgCpa,
        prev: previousTotals.prevCpa,
        color: "#dc2626",
        format: (value: number) => money(value, currencyCode, locale),
        trend: latestTrend.map((item) =>
          item.conversions > 0 ? item.spend / item.conversions : 0,
        ),
      },
      roas: {
        key: "roas",
        title: i18n.metrics.roas,
        value: 0,
        prev: 0,
        color: "#0f766e",
        format: (value: number) => `${value.toFixed(2)}x`,
        trend: latestTrend.map(() => 0),
      },
      reach: {
        key: "reach",
        title: i18n.metrics.reach,
        value: totals.totalReach,
        prev: previousTotals.prevReach,
        color: "#14b8a6",
        format: (value: number) => compact(value, locale),
        trend: latestTrend.map((item) => item.impressions * 0.35),
      },
      frequency: {
        key: "frequency",
        title: i18n.metrics.frequency,
        value: totals.avgFrequency,
        prev: previousTotals.prevFrequency,
        color: "#f59e0b",
        format: (value: number) => value.toFixed(2),
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? item.impressions / Math.max(item.impressions * 0.35, 1) : 0,
        ),
      },
    } as const;

    const baseCards: RenderableKpiCard[] = kpiConfig
      .map((key) => metricMap[key as keyof typeof metricMap] ?? metricMap.impressions)
      .map((card) => ({
        key: card.key,
        title: card.title,
        value: card.value,
        prev: card.prev,
        color: card.color,
        format: card.format,
        trend: card.trend,
      }))
      .slice(0, 5);

    const customCards: RenderableKpiCard[] = (dashboard?.custom_kpi_cards ?? [])
      .map((card) => {
        const sourceMetric =
          metricMap[card.trend_source as keyof typeof metricMap] ?? metricMap.impressions;
        const deltaOverride =
          sourceMetric.prev !== 0
            ? ((sourceMetric.value - sourceMetric.prev) / sourceMetric.prev) * 100
            : 0;
        return {
          key: card.id,
          title: card.title,
          value: card.value,
          prev: card.value,
          color: sourceMetric.color,
          format: sourceMetric.format,
          trend: sourceMetric.trend,
          deltaOverride,
        };
      });

    return [...baseCards, ...customCards];
  }, [currencyCode, dashboard?.custom_kpi_cards, dashboard?.kpi_config, i18n.metrics, latestTrend, locale, previousTotals, showSpend, totals]);

  const renderSection = (sectionId: string) => {
    if (sectionId === "kpi_grid") {
      return (
        <section
          key={sectionId}
          className="kpi-grid mb-6"
          style={{ ["--kpi-cols" as string]: String(Math.max(1, Math.min(kpiCards.length, 8))) } as CSSProperties}
        >
          {kpiCards.map((card) => (
            <KPICard
              key={card.key}
              title={card.title}
              value={card.value}
              prevValue={card.prev}
              color={card.color}
              format={card.format}
              trend={card.trend}
              pdfMode={isPdfMode}
              deltaOverride={card.deltaOverride}
            />
          ))}
        </section>
      );
    }

    if (sectionId === "spend_section" && showSpend) {
      return (
        <section key={sectionId} className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <SpendByPlatform
              data={filteredPlatforms}
              currencyFormatter={(value) => money(value, currencyCode, locale)}
              pdfMode={isPdfMode}
              forceMobile={isMobileMode}
              labels={{
                title: i18n.sections.spendByPlatform,
                shareOfTotal: i18n.spend.shareOfTotal,
                spend: i18n.spend.spend,
                impressions: i18n.spend.impressions,
                clicks: i18n.spend.clicks,
              }}
            />
          </div>
          <div className="xl:col-span-2">
            <ChannelMix
              data={filteredPlatforms}
              currencyFormatter={(value) => money(value, currencyCode, locale)}
              locale={locale}
              pdfMode={isPdfMode}
              labels={{
                title: i18n.sections.channelMix,
                noData: i18n.common.noDataForSelectedPlatforms,
                totalSpend: i18n.spend.totalSpend,
                spend: i18n.spend.spend,
                impressions: i18n.spend.impressions,
                clicks: i18n.spend.clicks,
              }}
            />
          </div>
        </section>
      );
    }

    if (sectionId === "trend_chart") {
      return (
        <section key={sectionId} className="mb-6">
          <TrendChart
            points={filteredTimeseries}
            selectedPlatforms={selectedPlatforms}
            onTogglePlatform={togglePlatform}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            showSpend={showSpend}
            locale={locale}
            pdfMode={isPdfMode}
            labels={{
              title: i18n.sections.trendByDay,
              metrics: {
                impressions: i18n.metrics.impressions,
                clicks: i18n.metrics.clicks,
                spend: i18n.metrics.spend,
              },
            }}
          />
        </section>
      );
    }

    if (sectionId === "conversion_funnel") {
      if (dashboardType !== "performance" || !dashboard?.funnel?.length) return null;
      return (
        <section key={sectionId} className="mb-6">
          <ConversionFunnel
            data={dashboard.funnel}
            pdfMode={isPdfMode}
            locale={locale}
            labels={{
              title: "Conversion Funnel",
              previousRate: "From previous",
              overallRate: "Overall",
            }}
          />
        </section>
      );
    }

    if (sectionId === "campaign_table") {
      if (dashboardType !== "performance" || !dashboard?.campaign_breakdown?.length) return null;
      return (
        <section key={sectionId} className="mb-6">
          <CampaignPerformanceTable
            campaigns={dashboard.campaign_breakdown}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            locale={locale}
            labels={{
              title: "Campaign Performance",
              noRows: "No campaign rows available.",
              campaign: "Campaign",
              platform: i18n.common.platform,
              spend: i18n.metrics.spend,
              conversions: "Conversions",
              cpa: i18n.metrics.cpa,
              clicks: i18n.metrics.clicks,
              cpc: i18n.metrics.cpc,
              total: i18n.common.total,
            }}
          />
        </section>
      );
    }

    if (sectionId === "scatter_plot") {
      if (dashboardType !== "performance" || !dashboard?.campaign_breakdown?.length) return null;
      return (
        <section key={sectionId} className="mb-6">
          <SpendConversionsScatter
            campaigns={dashboard.campaign_breakdown}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            labels={{
              title: "Spend vs Conversions",
              noRows: "No campaign rows available.",
              spend: i18n.metrics.spend,
              conversions: "Conversions",
              cpa: i18n.metrics.cpa,
            }}
          />
        </section>
      );
    }

    if (sectionId === "plan_vs_fact") {
      return (
        <section key={sectionId} className="mb-6">
          <PlanVsFact
            rows={filteredChannelPerformance}
            selectedMetrics={dashboard?.kpi_config ?? []}
            showSpend={showSpend}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            locale={locale}
            pdfMode={isPdfMode}
            labels={{
              title: i18n.sections.channelPerformancePlanFact,
              noRows: i18n.planFact.noRows,
              total: i18n.common.total,
              channel: i18n.common.channel,
              metrics: i18n.metrics,
              planOnlyTitle: i18n.planFact.planOnlyTitle,
              fact: i18n.planFact.fact,
              plan: i18n.planFact.plan,
              completion: i18n.planFact.completion,
              status: i18n.planFact.status,
              onTrack: i18n.planFact.onTrack,
              watch: i18n.planFact.watch,
              offTrack: i18n.planFact.offTrack,
              noStatus: i18n.planFact.noStatus,
            }}
          />
        </section>
      );
    }

    if (sectionId === "platform_table") {
      return (
        <section key={sectionId} className="pb-4">
          <PlatformTable
            rows={filteredPlatforms}
            timeseries={filteredTimeseries}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            showSpend={showSpend}
            locale={locale}
            pdfMode={isPdfMode}
            labels={{
              title: i18n.sections.platformPerformance,
              platform: i18n.common.platform,
              impressions: i18n.metrics.impressions,
              clicks: i18n.metrics.clicks,
              ctr: i18n.metrics.ctr,
              cpm: i18n.metrics.cpm,
              spend: i18n.metrics.spend,
              trend: i18n.common.trend,
              total: i18n.common.total,
            }}
          />
        </section>
      );
    }

    if (sectionId === "platform_plan_fact") {
      return (
        <section key={sectionId} className="mb-6">
          <PlatformPlanVsFact
            rows={filteredPlanVsFact}
            selectedMetrics={dashboard?.kpi_config ?? []}
            showSpend={showSpend}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            locale={locale}
            labels={{
              title: i18n.sections.platformPerformancePlanFact,
              noRows:
                i18n.language === "ru"
                  ? "Нет доступных строк платформ План / Факт."
                  : "No platform plan/fact rows available.",
              total: i18n.common.total,
              platform: i18n.common.platform,
              metrics: i18n.metrics,
              fact: i18n.planFact.fact,
              plan: i18n.planFact.plan,
              completion: i18n.planFact.completion,
            }}
          />
        </section>
      );
    }

    if (sectionId === "channel_table") {
      return (
        <section key={sectionId} className="pb-4">
          <ChannelPerformanceTable
            rows={filteredPlanVsFact}
            selectedMetrics={dashboard?.kpi_config ?? []}
            currencyFormatter={(value) => money(value, currencyCode, locale)}
            showSpend={showSpend}
            locale={locale}
            labels={{
              title: i18n.sections.channelPerformance,
              noRows: i18n.channelTable.noRows,
              total: i18n.common.total,
              channel: i18n.common.channel,
              instrument: i18n.common.instrument,
              buyType: i18n.common.buyType,
              metrics: i18n.metrics,
            }}
          />
        </section>
      );
    }

    return null;
  };

  const togglePlatform = (platformId: string) => {
    setSelectedPlatforms((prev) => {
      if (prev.includes(platformId)) {
        const next = prev.filter((item) => item !== platformId);
        const fallback = dashboard?.platforms.map((platform) => platform.id) ?? [];
        return next.length ? next : fallback;
      }
      return [...prev, platformId];
    });
  };

  const selectAll = () => {
    setSelectedPlatforms(dashboard?.platforms.map((platform) => platform.id) ?? []);
  };

  const toggleChannel = (channel: string) => {
    setSelectedChannels((prev) => {
      if (prev.includes(channel)) {
        const next = prev.filter((item) => item !== channel);
        const fallback = (dashboard?.channel_performance ?? []).map((item) => item.channel);
        return next.length ? next : fallback;
      }
      return [...prev, channel];
    });
  };

  const selectAllChannels = () => {
    setSelectedChannels((dashboard?.channel_performance ?? []).map((item) => item.channel));
  };

  const exportPdf = () => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    const from = dateRange.from || dashboard?.dashboard.period.from;
    const to = dateRange.to || dashboard?.dashboard.period.to;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    window.open(`/api/dashboard/${dashboardId}/pdf?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const exportExcel = () => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    const from = dateRange.from || dashboard?.dashboard.period.from;
    const to = dateRange.to || dashboard?.dashboard.period.to;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    window.open(`/api/dashboard/${dashboardId}/excel?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const applyDateRange = () => {
    if (!draftDateRange.from || !draftDateRange.to) return;
    setDateRange(draftDateRange);
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", draftDateRange.from);
    params.set("to", draftDateRange.to);
    router.replace(`/dashboard/${dashboardId}?${params.toString()}`, { scroll: false });
  };

  if (isLoading || !dashboard) {
    return (
      <main
        data-dashboard-ready="false"
        className={`mx-auto flex min-h-screen w-full max-w-[1400px] items-center justify-center px-4 py-6 sm:px-6 lg:px-8 ${
          isPdfMode ? "pdf-mode" : ""
        }`}
        style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
      >
        <p className="text-sm text-slate-500">{i18n.common.loadingDashboard}</p>
      </main>
    );
  }

  const periodLabel = `${formatPeriodDate(dashboard.dashboard.period.from, locale)} - ${formatPeriodDate(
    dashboard.dashboard.period.to,
    locale,
  )}`;
  const clientName = dashboard.dashboard.client_name || dashboardId.toUpperCase();

  return (
    <main
      data-dashboard-ready="true"
      className={`mx-auto min-h-screen w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 ${isPdfMode ? "pdf-mode" : ""}`}
      style={isMobileMode ? ({ maxWidth: "430px" } as CSSProperties) : undefined}
    >
      <DashboardHeader
        clientName={clientName}
        title={dashboard.dashboard.dashboard_name}
        periodLabel={periodLabel}
        logoUrl={dashboard.dashboard.logo_url}
        pdfMode={isPdfMode}
        labels={i18n.header}
        dateFrom={draftDateRange.from}
        dateTo={draftDateRange.to}
        onDateFromChange={(value) => setDraftDateRange((prev) => ({ ...prev, from: value }))}
        onDateToChange={(value) => setDraftDateRange((prev) => ({ ...prev, to: value }))}
        onApplyDateRange={applyDateRange}
        isUpdatingRange={isLoading}
        onExportExcel={exportExcel}
        onExportPdf={exportPdf}
      />

      {isDemoMode ? (
        <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {i18n.common.demoMode}
          {apiError ? ` (${apiError})` : ""}
        </div>
      ) : null}

      {!isPdfMode ? (
        <PlatformFilter
          className="no-print"
          options={
            effectiveFilterMode === "channel"
              ? channelOptions
              : dashboard.platforms.map((platform) => ({
                  id: platform.id,
                  name: platform.name,
                  color: platform.color,
                }))
          }
          selected={effectiveFilterMode === "channel" ? selectedChannels : selectedPlatforms}
          onToggle={effectiveFilterMode === "channel" ? toggleChannel : togglePlatform}
          onSelectAll={effectiveFilterMode === "channel" ? selectAllChannels : selectAll}
          labels={i18n.filter}
          mode={filterMode}
          onModeChange={setFilterMode}
          filterScope={channelOptions.length > 0 ? filterScope : "platform"}
        />
      ) : null}

      {sectionOrder.map((sectionId) => renderSection(sectionId))}

      {dashboard?.custom_tables?.map((table, i) => (
        <CustomTable key={i} data={table} locale={locale} pdfMode={isPdfMode} />
      ))}
    </main>
  );
}

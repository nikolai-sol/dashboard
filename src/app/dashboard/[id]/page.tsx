"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ChannelMix from "@/components/ChannelMix";
import ChannelPerformanceTable from "@/components/ChannelPerformanceTable";
import DashboardHeader from "@/components/DashboardHeader";
import KPICard from "@/components/KPICard";
import PlatformFilter from "@/components/PlatformFilter";
import PlatformTable from "@/components/PlatformTable";
import PlanVsFact from "@/components/PlanVsFact";
import SpendByPlatform from "@/components/SpendByPlatform";
import TrendChart from "@/components/TrendChart";
import type { DashboardData } from "@/lib/types";
import { resolvePlatformIdFromSourceKey } from "@/lib/source-mapping";

const SPEND_RELATED_KPIS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);

function money(value: number, currency = "EUR") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

function formatPeriodDate(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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

  const filteredPlatforms = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.platforms.filter((item) => selectedSet.has(item.id));
  }, [dashboard, selectedSet]);

  const filteredTimeseries = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.timeseries.filter((item) => selectedSet.has(item.platform));
  }, [dashboard, selectedSet]);

  const filteredPlanVsFact = useMemo(() => {
    if (!dashboard) return [];
    const platformFiltered = dashboard.plan_vs_fact.filter(
      (item) =>
        item.platforms.length === 0 ||
        item.platforms.some((platform) => selectedSet.has(resolvePlatformIdFromSourceKey(platform.source_key))),
    );
    if (filterMode === "channel") {
      return platformFiltered.filter((item) => selectedChannelSet.has(item.channel));
    }
    return platformFiltered;
  }, [dashboard, filterMode, selectedChannelSet, selectedSet]);

  const filteredChannelPerformance = useMemo(() => {
    if (!dashboard?.channel_performance) return [];
    const platformFiltered = dashboard.channel_performance.filter(
      (item) =>
        item.platforms.length === 0 ||
        item.platforms.some((platform) => selectedSet.has(resolvePlatformIdFromSourceKey(platform.source_key))),
    );
    if (filterMode === "channel") {
      return platformFiltered.filter((item) => selectedChannelSet.has(item.channel));
    }
    return platformFiltered;
  }, [dashboard?.channel_performance, filterMode, selectedChannelSet, selectedSet]);

  const currencyCode = dashboard?.dashboard.currency || "EUR";
  const showSpend = dashboard?.dashboard.show_spend ?? true;
  const sectionOrder = dashboard?.dashboard.section_order ?? [];
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

  const kpiCards = useMemo(() => {
    const kpiConfig = (dashboard?.kpi_config?.slice(0, 5) ?? ["impressions", "clicks", "ctr", "cpm", "spend"])
      .filter((metric) => showSpend || !SPEND_RELATED_KPIS.has(metric));

    const metricMap = {
      impressions: {
        title: "Impressions",
        value: totals.totalImpressions,
        prev: previousTotals.prevImpressions,
        color: "#2563eb",
        format: compact,
        trend: latestTrend.map((item) => item.impressions),
      },
      clicks: {
        title: "Clicks",
        value: totals.totalClicks,
        prev: previousTotals.prevClicks,
        color: "#7c3aed",
        format: compact,
        trend: latestTrend.map((item) => item.clicks),
      },
      ctr: {
        title: "CTR",
        value: totals.avgCtr,
        prev: previousTotals.prevCtr,
        color: "#16a34a",
        format: (value: number) => `${value.toFixed(2)}%`,
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0,
        ),
      },
      cpm: {
        title: "CPM",
        value: totals.avgCpm,
        prev: previousTotals.prevCpm,
        color: "#f97316",
        format: (value: number) => money(value, currencyCode),
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0,
        ),
      },
      cpc: {
        title: "CPC",
        value: totals.avgCpc,
        prev: previousTotals.prevCpc,
        color: "#6366f1",
        format: (value: number) => money(value, currencyCode),
        trend: latestTrend.map((item) => (item.clicks > 0 ? item.spend / item.clicks : 0)),
      },
      spend: {
        title: "Spend",
        value: totals.totalSpend,
        prev: previousTotals.prevSpend,
        color: "#0ea5e9",
        format: (value: number) => money(value, currencyCode),
        trend: latestTrend.map((item) => item.spend),
      },
      views: {
        title: "Views",
        value: totals.totalViews,
        prev: previousTotals.prevViews,
        color: "#ec4899",
        format: compact,
        trend: latestTrend.map((item) => item.views),
      },
      cpv: {
        title: "CPV",
        value: totals.avgCpv,
        prev: previousTotals.prevCpv,
        color: "#d946ef",
        format: (value: number) => money(value, currencyCode),
        trend: latestTrend.map((item) => (item.views > 0 ? item.spend / item.views : 0)),
      },
      conversions: {
        title: "Conversions",
        value: totals.totalConversions,
        prev: previousTotals.prevConversions,
        color: "#059669",
        format: compact,
        trend: latestTrend.map((item) => item.conversions),
      },
      cpa: {
        title: "CPA",
        value: totals.avgCpa,
        prev: previousTotals.prevCpa,
        color: "#dc2626",
        format: (value: number) => money(value, currencyCode),
        trend: latestTrend.map((item) =>
          item.conversions > 0 ? item.spend / item.conversions : 0,
        ),
      },
      roas: {
        title: "ROAS",
        value: 0,
        prev: 0,
        color: "#0f766e",
        format: (value: number) => `${value.toFixed(2)}x`,
        trend: latestTrend.map(() => 0),
      },
      reach: {
        title: "Reach",
        value: totals.totalReach,
        prev: previousTotals.prevReach,
        color: "#14b8a6",
        format: compact,
        trend: latestTrend.map((item) => item.impressions * 0.35),
      },
      frequency: {
        title: "Frequency",
        value: totals.avgFrequency,
        prev: previousTotals.prevFrequency,
        color: "#f59e0b",
        format: (value: number) => value.toFixed(2),
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? item.impressions / Math.max(item.impressions * 0.35, 1) : 0,
        ),
      },
    } as const;

    return kpiConfig
      .map((key) => metricMap[key as keyof typeof metricMap] ?? metricMap.impressions)
      .slice(0, 5);
  }, [currencyCode, dashboard?.kpi_config, latestTrend, previousTotals, showSpend, totals]);

  const renderSection = (sectionId: string) => {
    if (sectionId === "kpi_grid") {
      return (
        <section key={sectionId} className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {kpiCards.map((card) => (
            <KPICard
              key={card.title}
              title={card.title}
              value={card.value}
              prevValue={card.prev}
              color={card.color}
              format={card.format}
              trend={card.trend}
            />
          ))}
        </section>
      );
    }

    if (sectionId === "spend_section" && showSpend) {
      return (
        <section key={sectionId} className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <SpendByPlatform data={filteredPlatforms} currencyFormatter={(value) => money(value, currencyCode)} />
          </div>
          <div className="xl:col-span-2">
            <ChannelMix data={filteredPlatforms} currencyFormatter={(value) => money(value, currencyCode)} />
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
            currencyFormatter={(value) => money(value, currencyCode)}
            showSpend={showSpend}
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
            currencyFormatter={(value) => money(value, currencyCode)}
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
            currencyFormatter={(value) => money(value, currencyCode)}
            showSpend={showSpend}
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
            currencyFormatter={(value) => money(value, currencyCode)}
            showSpend={showSpend}
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
    window.print();
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
      <main className="mx-auto flex min-h-screen w-full max-w-[1400px] items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-sm text-slate-500">Loading dashboard...</p>
      </main>
    );
  }

  const periodLabel = `${formatPeriodDate(dashboard.dashboard.period.from)} - ${formatPeriodDate(
    dashboard.dashboard.period.to,
  )}`;
  const clientName = dashboard.dashboard.client_name || dashboardId.toUpperCase();

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <DashboardHeader
        clientName={clientName}
        title={dashboard.dashboard.dashboard_name}
        periodLabel={periodLabel}
        logoUrl={dashboard.dashboard.logo_url}
        dateFrom={draftDateRange.from}
        dateTo={draftDateRange.to}
        onDateFromChange={(value) => setDraftDateRange((prev) => ({ ...prev, from: value }))}
        onDateToChange={(value) => setDraftDateRange((prev) => ({ ...prev, to: value }))}
        onApplyDateRange={applyDateRange}
        isUpdatingRange={isLoading}
        onExportPdf={exportPdf}
      />

      {isDemoMode ? (
        <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Demo mode: API unavailable, showing mock data.
          {apiError ? ` (${apiError})` : ""}
        </div>
      ) : null}

      <PlatformFilter
        className="no-print"
        options={
          filterMode === "channel"
            ? channelOptions
            : dashboard.platforms.map((platform) => ({
                id: platform.id,
                name: platform.name,
                color: platform.color,
              }))
        }
        selected={filterMode === "channel" ? selectedChannels : selectedPlatforms}
        onToggle={filterMode === "channel" ? toggleChannel : togglePlatform}
        onSelectAll={filterMode === "channel" ? selectAllChannels : selectAll}
        mode={filterMode}
        onModeChange={setFilterMode}
        allowChannelMode={channelOptions.length > 0}
      />

      {sectionOrder.map((sectionId) => renderSection(sectionId))}
    </main>
  );
}

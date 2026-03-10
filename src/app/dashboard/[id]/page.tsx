"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import ChannelMix from "@/components/ChannelMix";
import DashboardHeader from "@/components/DashboardHeader";
import KPICard from "@/components/KPICard";
import PlatformFilter from "@/components/PlatformFilter";
import PlatformTable from "@/components/PlatformTable";
import PlanVsFact from "@/components/PlanVsFact";
import SpendByPlatform from "@/components/SpendByPlatform";
import TrendChart from "@/components/TrendChart";
import { ACTIVE_PLATFORM_IDS, PLATFORM_COLORS } from "@/lib/platform-colors";
import { mockDashboardData } from "@/lib/mock-data";

function money(value: number) {
  return `€${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

function dayLabel(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function DashboardByIdPage() {
  const params = useParams<{ id: string }>();
  const dashboard = mockDashboardData;
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(ACTIVE_PLATFORM_IDS);

  const selectedSet = useMemo(() => new Set(selectedPlatforms), [selectedPlatforms]);

  const filteredPlatforms = useMemo(
    () => dashboard.platforms.filter((item) => selectedSet.has(item.id)),
    [dashboard.platforms, selectedSet],
  );

  const filteredTimeseries = useMemo(
    () => dashboard.timeseries.filter((item) => selectedSet.has(item.platform)),
    [dashboard.timeseries, selectedSet],
  );

  const filteredPlanVsFact = useMemo(
    () => dashboard.plan_vs_fact.filter((item) => selectedSet.has(item.platform)),
    [dashboard.plan_vs_fact, selectedSet],
  );

  const totals = useMemo(() => {
    const totalImpressions = filteredPlatforms.reduce((sum, item) => sum + item.impressions, 0);
    const totalClicks = filteredPlatforms.reduce((sum, item) => sum + item.clicks, 0);
    const totalSpend = filteredPlatforms.reduce((sum, item) => sum + item.spend, 0);
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    return {
      totalImpressions,
      totalClicks,
      totalSpend,
      avgCtr,
      avgCpm,
    };
  }, [filteredPlatforms]);

  const scales = useMemo(() => {
    const kpi = dashboard.kpi;
    return {
      impressions: kpi.total_impressions > 0 ? kpi.prev_impressions / kpi.total_impressions : 0.9,
      clicks: kpi.total_clicks > 0 ? kpi.prev_clicks / kpi.total_clicks : 0.9,
      spend: kpi.total_spend > 0 ? kpi.prev_spend / kpi.total_spend : 0.95,
    };
  }, [dashboard.kpi]);

  const previousTotals = useMemo(() => {
    const prevImpressions = totals.totalImpressions * scales.impressions;
    const prevClicks = totals.totalClicks * scales.clicks;
    const prevSpend = totals.totalSpend * scales.spend;
    const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;
    const prevCpm = prevImpressions > 0 ? (prevSpend / prevImpressions) * 1000 : 0;
    return {
      prevImpressions,
      prevClicks,
      prevSpend,
      prevCtr,
      prevCpm,
    };
  }, [scales.clicks, scales.impressions, scales.spend, totals.totalClicks, totals.totalImpressions, totals.totalSpend]);

  const aggregatedDaily = useMemo(() => {
    const byDate = new Map<
      string,
      { impressions: number; clicks: number; spend: number; conversions: number }
    >();
    const cvByPlatform = new Map(
      filteredPlatforms.map((platform) => [
        platform.id,
        platform.clicks > 0 ? platform.conversions / platform.clicks : 0,
      ]),
    );

    filteredTimeseries.forEach((point) => {
      if (!byDate.has(point.date)) {
        byDate.set(point.date, { impressions: 0, clicks: 0, spend: 0, conversions: 0 });
      }
      const row = byDate.get(point.date)!;
      row.impressions += point.impressions;
      row.clicks += point.clicks;
      row.spend += point.spend;
      row.conversions += point.clicks * (cvByPlatform.get(point.platform) ?? 0);
    });

    return [...byDate.entries()]
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredPlatforms, filteredTimeseries]);

  const latestTrend = useMemo(() => aggregatedDaily.slice(-30), [aggregatedDaily]);

  const kpiCards = useMemo(
    () => [
      {
        title: "Impressions",
        value: totals.totalImpressions,
        prev: previousTotals.prevImpressions,
        color: "#2563eb",
        format: compact,
        trend: latestTrend.map((item) => item.impressions),
      },
      {
        title: "Clicks",
        value: totals.totalClicks,
        prev: previousTotals.prevClicks,
        color: "#7c3aed",
        format: compact,
        trend: latestTrend.map((item) => item.clicks),
      },
      {
        title: "CTR",
        value: totals.avgCtr,
        prev: previousTotals.prevCtr,
        color: "#16a34a",
        format: (value: number) => `${value.toFixed(2)}%`,
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0,
        ),
      },
      {
        title: "CPM",
        value: totals.avgCpm,
        prev: previousTotals.prevCpm,
        color: "#f97316",
        format: (value: number) => money(value),
        trend: latestTrend.map((item) =>
          item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0,
        ),
      },
      {
        title: "Spend",
        value: totals.totalSpend,
        prev: previousTotals.prevSpend,
        color: "#0ea5e9",
        format: money,
        trend: latestTrend.map((item) => item.spend),
      },
    ],
    [
      latestTrend,
      previousTotals.prevClicks,
      previousTotals.prevCpm,
      previousTotals.prevCtr,
      previousTotals.prevImpressions,
      previousTotals.prevSpend,
      totals.avgCpm,
      totals.avgCtr,
      totals.totalClicks,
      totals.totalImpressions,
      totals.totalSpend,
    ],
  );

  const togglePlatform = (platformId: string) => {
    setSelectedPlatforms((prev) => {
      if (prev.includes(platformId)) {
        const next = prev.filter((item) => item !== platformId);
        return next.length ? next : ACTIVE_PLATFORM_IDS;
      }
      return [...prev, platformId];
    });
  };

  const selectAll = () => {
    setSelectedPlatforms(Object.keys(PLATFORM_COLORS));
  };

  const periodLabel = `${dayLabel(dashboard.dashboard.period.from)} 2025 - ${dayLabel(
    dashboard.dashboard.period.to,
  )} 2025`;
  const clientName = params.id ? params.id.toUpperCase() : dashboard.dashboard.client_name;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <DashboardHeader
        clientName={clientName}
        title={dashboard.dashboard.dashboard_name}
        periodLabel={periodLabel}
      />

      <PlatformFilter
        selected={selectedPlatforms}
        onToggle={togglePlatform}
        onSelectAll={selectAll}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <SpendByPlatform data={filteredPlatforms} currencyFormatter={money} />
        </div>
        <div className="xl:col-span-2">
          <ChannelMix data={filteredPlatforms} currencyFormatter={money} />
        </div>
      </section>

      <section className="mb-6">
        <TrendChart
          points={filteredTimeseries}
          selectedPlatforms={selectedPlatforms}
          onTogglePlatform={togglePlatform}
          currencyFormatter={money}
        />
      </section>

      <section className="mb-6">
        <PlanVsFact rows={filteredPlanVsFact} currencyFormatter={money} />
      </section>

      <section className="pb-4">
        <PlatformTable
          rows={filteredPlatforms}
          timeseries={filteredTimeseries}
          currencyFormatter={money}
        />
      </section>
    </main>
  );
}

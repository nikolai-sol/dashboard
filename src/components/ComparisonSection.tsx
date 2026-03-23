"use client";

import { useMemo, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import type { ComparisonData } from "@/lib/types";

const MONEY_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);
const TREND_METRICS = new Set(["impressions", "clicks", "views", "conversions", "spend", "ctr", "cpm", "cpc", "cpv", "cpa"]);

type MetricKey = "impressions" | "clicks" | "views" | "conversions" | "spend" | "ctr" | "cpm" | "cpc" | "cpv" | "cpa";

type ComparisonSectionProps = {
  comparison: ComparisonData;
  detailMode: "platform" | "channel";
  selectedMetrics: string[];
  selectedPlatforms: string[];
  selectedChannels: string[];
  currentTimeseries: ComparisonData["timeseries_b_raw"];
  currentChannelTimeseries: ComparisonData["channel_timeseries_b"];
  currencyFormatter: (value: number) => string;
  locale: string;
  language: "en" | "ru";
  showSpend: boolean;
  labels: {
    title: string;
    metrics: Record<string, string>;
    total: string;
    platform: string;
    channel: string;
    noData: string;
  };
};

type TrendAggregatePoint = {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
};

function compactNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(Math.round(value));
}

function metricFormatter(metric: string, value: number, currencyFormatter: (value: number) => string, locale: string) {
  if (metric === "spend" || metric === "cpm" || metric === "cpc" || metric === "cpv" || metric === "cpa") {
    return currencyFormatter(value);
  }
  if (metric === "ctr") return `${value.toFixed(2)}%`;
  return compactNumber(value, locale);
}

function deltaText(metric: string, delta: number, deltaPct: number) {
  if (metric === "ctr") {
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta.toFixed(2)} pp`;
  }
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${deltaPct.toFixed(1)}%`;
}

function deltaClass(metric: string, delta: number) {
  const positive = delta >= 0;
  if (metric === "spend" || metric === "cpm" || metric === "cpc" || metric === "cpv" || metric === "cpa") {
    return positive ? "text-rose-600" : "text-emerald-600";
  }
  return positive ? "text-emerald-600" : "text-rose-600";
}

function aggregateTrendRows(
  rows:
    | ComparisonSectionProps["currentTimeseries"]
    | ComparisonSectionProps["currentChannelTimeseries"],
) {
  const byDate = new Map<string, { impressions: number; clicks: number; spend: number; views: number; conversions: number }>();
  for (const row of rows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, { impressions: 0, clicks: 0, spend: 0, views: 0, conversions: 0 });
    }
    const item = byDate.get(row.date)!;
    item.impressions += row.impressions;
    item.clicks += row.clicks;
    item.spend += row.spend;
    item.views += row.views ?? 0;
    item.conversions += row.conversions ?? 0;
  }
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, metrics]) => ({ date, ...metrics }));
}

function getTrendMetricValue(
  point:
    | TrendAggregatePoint
    | ComparisonSectionProps["currentTimeseries"][number]
    | ComparisonData["timeseries_b"][number]
    | ComparisonSectionProps["currentChannelTimeseries"][number],
  metric: MetricKey,
) {
  if (metric === "ctr") {
    return point.impressions > 0 ? (point.clicks / point.impressions) * 100 : 0;
  }
  if (metric === "cpm") {
    return point.impressions > 0 ? (point.spend / point.impressions) * 1000 : 0;
  }
  if (metric === "cpc") {
    return point.clicks > 0 ? point.spend / point.clicks : 0;
  }
  if (metric === "cpv") {
    const views = point.views ?? 0;
    return views > 0 ? point.spend / views : 0;
  }
  if (metric === "cpa") {
    const conversions = point.conversions ?? 0;
    return conversions > 0 ? point.spend / conversions : 0;
  }
  return Number(point[metric]);
}

export default function ComparisonSection({
  comparison,
  detailMode,
  selectedMetrics,
  selectedPlatforms,
  selectedChannels,
  currentTimeseries,
  currentChannelTimeseries,
  currencyFormatter,
  locale,
  language,
  showSpend,
  labels,
}: ComparisonSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const availableMetrics = useMemo(() => {
    const preferred = selectedMetrics.length > 0 ? selectedMetrics : ["impressions", "clicks", "ctr", "spend", "conversions"];
    return preferred.filter((metric) => {
      if (!comparison.kpi_comparison[metric]) return false;
      if (!showSpend && MONEY_METRICS.has(metric)) return false;
      return true;
    });
  }, [comparison.kpi_comparison, selectedMetrics, showSpend]);

  const summaryMetrics = useMemo(
    () => availableMetrics.slice(0, 5),
    [availableMetrics],
  );

  const trendMetricOptions = useMemo(() => {
    const selected = availableMetrics.filter((metric): metric is MetricKey => TREND_METRICS.has(metric));
    if (selected.length > 0) {
      return selected;
    }
    return (showSpend
      ? ["impressions", "clicks", "spend"]
      : ["impressions", "clicks", "views", "conversions"]
    ) as MetricKey[];
  }, [availableMetrics, showSpend]);

  const [trendMetric, setTrendMetric] = useState<MetricKey>(showSpend ? "impressions" : "impressions");

  const effectiveTrendMetric = trendMetricOptions.includes(trendMetric) ? trendMetric : trendMetricOptions[0];

  const detailRows = useMemo(() => {
    if (detailMode === "channel") {
      const source = comparison.channels_comparison;
      if (!selectedChannels.length) return source;
      const set = new Set(selectedChannels);
      return source.filter((item) => set.has(item.channel));
    }
    const source = comparison.platforms_comparison;
    if (!selectedPlatforms.length) return source;
    const set = new Set(selectedPlatforms);
    return source.filter((item) => set.has(item.platform));
  }, [comparison.channels_comparison, comparison.platforms_comparison, detailMode, selectedChannels, selectedPlatforms]);

  const currentTrendSource = useMemo(() => {
    if (detailMode === "channel") {
      if (!selectedChannels.length) return currentChannelTimeseries;
      const set = new Set(selectedChannels);
      return currentChannelTimeseries.filter((point) => set.has(point.channel));
    }
    if (!selectedPlatforms.length) return currentTimeseries;
    const set = new Set(selectedPlatforms);
    return currentTimeseries.filter((point) => set.has(point.platform));
  }, [currentChannelTimeseries, currentTimeseries, detailMode, selectedChannels, selectedPlatforms]);

  const compareTrendSource = useMemo(() => {
    if (detailMode === "channel") {
      if (!selectedChannels.length) return comparison.channel_timeseries_b;
      const set = new Set(selectedChannels);
      return comparison.channel_timeseries_b.filter((point) => set.has(point.channel));
    }
    if (!selectedPlatforms.length) return comparison.timeseries_b_raw;
    const set = new Set(selectedPlatforms);
    return comparison.timeseries_b_raw.filter((point) => set.has(point.platform));
  }, [comparison.channel_timeseries_b, comparison.timeseries_b_raw, detailMode, selectedChannels, selectedPlatforms]);

  const normalizedSeries = useMemo(() => {
    const aggregatedA = aggregateTrendRows(currentTrendSource);
    const aggregatedB = aggregateTrendRows(compareTrendSource);
    const pointsA = aggregatedA.map((point, index) => ({
      x: language === "ru" ? `День ${index + 1}` : `Day ${index + 1}`,
      y: getTrendMetricValue(point, effectiveTrendMetric),
      realDate: point.date,
    }));
    const pointsB = aggregatedB.map((point, index) => ({
      x: language === "ru" ? `День ${index + 1}` : `Day ${index + 1}`,
      y: getTrendMetricValue(point, effectiveTrendMetric),
      realDate: point.date,
    }));
    return {
      periodA: {
        id: comparison.period_a.label,
        color: "#0f172a",
        data: pointsA,
      },
      periodB: {
        id: comparison.period_b.label,
        color: "#94a3b8",
        data: pointsB,
      },
    };
  }, [compareTrendSource, comparison.period_a.label, comparison.period_b.label, currentTrendSource, effectiveTrendMetric, language]);

  const toggleLabel = language === "ru" ? (collapsed ? "Развернуть" : "Свернуть") : collapsed ? "Expand" : "Collapse";

  return (
    <section className="card-surface mb-6 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{labels.title}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {comparison.period_a.label} vs {comparison.period_b.label}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {toggleLabel}
        </button>
      </div>

      {!collapsed ? (
        <>
      <div className="mb-6 grid grid-cols-1 gap-3 xl:grid-cols-5">
        {summaryMetrics.map((metric) => {
          const item = comparison.kpi_comparison[metric];
          return (
            <article key={metric} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                {labels.metrics[metric] ?? metric.toUpperCase()}
              </p>
              <p className={`mt-2 text-2xl font-semibold ${deltaClass(metric, item.delta)}`}>
                {deltaText(metric, item.delta, item.delta_pct)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {metricFormatter(metric, item.value_a, currencyFormatter, locale)} →{" "}
                {metricFormatter(metric, item.value_b, currencyFormatter, locale)}
              </p>
            </article>
          );
        })}
      </div>

      <div className="mb-6 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                {detailMode === "channel" ? labels.channel : labels.platform}
              </th>
              {summaryMetrics.map((metric) => (
                <th key={metric} className="px-4 py-3 text-left font-semibold text-slate-700">
                  {labels.metrics[metric] ?? metric}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {detailRows.length === 0 ? (
              <tr>
                <td colSpan={summaryMetrics.length + 1} className="px-4 py-6 text-center text-slate-500">
                  {labels.noData}
                </td>
              </tr>
            ) : (
              detailMode === "channel"
                ? comparison.channels_comparison
                    .filter((row) => !selectedChannels.length || selectedChannels.includes(row.channel))
                    .map((row) => (
                      <tr key={row.channel}>
                        <td className="px-4 py-3 font-medium text-slate-900">{row.channel}</td>
                        {summaryMetrics.map((metric) => {
                          const item = row.metrics[metric];
                          return (
                            <td key={metric} className="px-4 py-3 align-top">
                              <div className={`font-semibold ${deltaClass(metric, item.delta)}`}>
                                {deltaText(metric, item.delta, item.delta_pct)}
                              </div>
                              <div className="text-xs text-slate-500">
                                {metricFormatter(metric, item.value_a, currencyFormatter, locale)} →{" "}
                                {metricFormatter(metric, item.value_b, currencyFormatter, locale)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                : comparison.platforms_comparison
                    .filter((row) => !selectedPlatforms.length || selectedPlatforms.includes(row.platform))
                    .map((row) => (
                      <tr key={row.platform}>
                        <td className="px-4 py-3 font-medium text-slate-900">{row.platform_label}</td>
                        {summaryMetrics.map((metric) => {
                          const item = row.metrics[metric];
                          return (
                            <td key={metric} className="px-4 py-3 align-top">
                              <div className={`font-semibold ${deltaClass(metric, item.delta)}`}>
                                {deltaText(metric, item.delta, item.delta_pct)}
                              </div>
                              <div className="text-xs text-slate-500">
                                {metricFormatter(metric, item.value_a, currencyFormatter, locale)} →{" "}
                                {metricFormatter(metric, item.value_b, currencyFormatter, locale)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))
            )}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-900">{labels.title}</h4>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
            {trendMetricOptions.map((metric) => (
              <button
                key={metric}
                type="button"
                onClick={() => setTrendMetric(metric)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  effectiveTrendMetric === metric
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                {labels.metrics[metric] ?? metric}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[320px]">
          <ResponsiveLine
            data={[normalizedSeries.periodA, normalizedSeries.periodB]}
            margin={{ top: 20, right: 20, bottom: 60, left: 60 }}
            xScale={{ type: "point" }}
            yScale={{ type: "linear", min: 0, max: "auto", stacked: false, reverse: false }}
            axisTop={null}
            axisRight={null}
            axisBottom={{ tickSize: 0, tickPadding: 8 }}
            axisLeft={{
              tickSize: 0,
              tickPadding: 8,
              format: (value) =>
                MONEY_METRICS.has(effectiveTrendMetric)
                  ? currencyFormatter(Number(value))
                  : compactNumber(Number(value), locale),
            }}
            colors={({ color }) => color as string}
            lineWidth={2.5}
            pointSize={4}
            pointBorderWidth={1}
            pointBorderColor={{ from: "serieColor" }}
            enablePoints
            useMesh
            curve="monotoneX"
            enableArea={false}
            theme={{
              axis: {
                ticks: { text: { fill: "#64748b", fontSize: 11 } },
              },
              grid: { line: { stroke: "#e2e8f0", strokeDasharray: "4 4" } },
            }}
            tooltip={({ point }) => (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold text-slate-900">{String(point.seriesId)}</p>
                <p className="text-slate-500">{String(point.data.x)}</p>
                <p className="text-slate-700">
                  {MONEY_METRICS.has(effectiveTrendMetric)
                    ? currencyFormatter(Number(point.data.y))
                    : compactNumber(Number(point.data.y), locale)}
                </p>
              </div>
            )}
            defs={[
              {
                id: "comparisonDashed",
                type: "patternLines",
                background: "inherit",
                color: "#94a3b8",
                rotation: -45,
                lineWidth: 6,
                spacing: 10,
              },
            ]}
            enableSlices={false}
          />
        </div>
      </div>
        </>
      ) : null}
    </section>
  );
}

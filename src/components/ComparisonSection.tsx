"use client";

import { useMemo, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import type { ComparisonData } from "@/lib/types";

type MetricKey = "impressions" | "clicks" | "spend";

type ComparisonSectionProps = {
  comparison: ComparisonData;
  selectedMetrics: string[];
  selectedPlatforms: string[];
  currentTimeseries: Array<{
    date: string;
    impressions: number;
    clicks: number;
    spend: number;
    views: number;
    conversions: number;
  }>;
  currencyFormatter: (value: number) => string;
  locale: string;
  language: "en" | "ru";
  labels: {
    title: string;
    metrics: Record<string, string>;
    total: string;
    platform: string;
    noData: string;
  };
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

export default function ComparisonSection({
  comparison,
  selectedMetrics,
  selectedPlatforms,
  currentTimeseries,
  currencyFormatter,
  locale,
  language,
  labels,
}: ComparisonSectionProps) {
  const [trendMetric, setTrendMetric] = useState<MetricKey>("impressions");
  const summaryMetrics = useMemo(() => {
    const preferred = selectedMetrics.length > 0 ? selectedMetrics : ["impressions", "clicks", "ctr", "spend", "conversions"];
    return preferred.filter((metric) => comparison.kpi_comparison[metric]).slice(0, 5);
  }, [comparison.kpi_comparison, selectedMetrics]);

  const platformRows = useMemo(() => {
    const source = comparison.platforms_comparison;
    if (!selectedPlatforms.length) return source;
    const set = new Set(selectedPlatforms);
    return source.filter((item) => set.has(item.platform));
  }, [comparison.platforms_comparison, selectedPlatforms]);

  const normalizedSeries = useMemo(() => {
    const pointsA = currentTimeseries.map((point, index) => ({
      x: language === "ru" ? `День ${index + 1}` : `Day ${index + 1}`,
      y: Number(point[trendMetric]),
      realDate: point.date,
    }));
    const pointsB = comparison.timeseries_b.map((point) => ({
      x: language === "ru" ? `День ${point.day_index + 1}` : `Day ${point.day_index + 1}`,
      y: Number(point[trendMetric]),
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
  }, [comparison.period_a.label, comparison.period_b.label, comparison.timeseries_b, currentTimeseries, language, trendMetric]);

  return (
    <section className="card-surface mb-6 p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-900">{labels.title}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {comparison.period_a.label} vs {comparison.period_b.label}
        </p>
      </div>

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
              <th className="px-4 py-3 text-left font-semibold text-slate-700">{labels.platform}</th>
              {summaryMetrics.map((metric) => (
                <th key={metric} className="px-4 py-3 text-left font-semibold text-slate-700">
                  {labels.metrics[metric] ?? metric}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {platformRows.length === 0 ? (
              <tr>
                <td colSpan={summaryMetrics.length + 1} className="px-4 py-6 text-center text-slate-500">
                  {labels.noData}
                </td>
              </tr>
            ) : (
              platformRows.map((row) => (
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
            {(["impressions", "clicks", "spend"] as MetricKey[]).map((metric) => (
              <button
                key={metric}
                type="button"
                onClick={() => setTrendMetric(metric)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  trendMetric === metric
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
                trendMetric === "spend"
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
                  {trendMetric === "spend"
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
    </section>
  );
}

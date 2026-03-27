"use client";

import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { PlatformStats, TimeSeriesPoint } from "@/lib/types";

type MetricKey =
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpm"
  | "spend"
  | "views"
  | "conversions"
  | "reach"
  | "frequency"
  | "cpc"
  | "cpv"
  | "cpa";
type SortKey = "name" | MetricKey;

type PlatformTableProps = {
  rows: PlatformStats[];
  timeseries: TimeSeriesPoint[];
  selectedMetrics?: string[];
  currencyFormatter: (value: number) => string;
  currencyCode?: string;
  showSpend?: boolean;
  locale?: string;
  pdfMode?: boolean;
  labels?: {
    title: string;
    platform: string;
    metrics: Record<string, string>;
    trend: string;
    total: string;
  };
};

const SUPPORTED_METRICS: MetricKey[] = [
  "impressions",
  "clicks",
  "ctr",
  "cpm",
  "spend",
  "views",
  "conversions",
  "reach",
  "frequency",
  "cpc",
  "cpv",
  "cpa",
];
const MONEY_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa"]);

function resolveMetrics(selectedMetrics: string[], showSpend: boolean): MetricKey[] {
  const metrics = Array.from(
    new Set(
      selectedMetrics
        .filter((metric): metric is MetricKey => SUPPORTED_METRICS.includes(metric as MetricKey))
        .filter((metric) => (showSpend ? true : !MONEY_METRICS.has(metric))),
    ),
  );
  if (showSpend && metrics.includes("views") && !metrics.includes("cpv")) {
    metrics.push("cpv");
  }
  return metrics.length > 0
    ? metrics
    : showSpend
      ? ["impressions", "clicks", "ctr", "cpm", "spend"]
      : ["impressions", "clicks", "ctr", "views", "conversions"];
}

function metricValue(row: PlatformStats, metric: MetricKey) {
  switch (metric) {
    case "impressions":
      return row.impressions;
    case "clicks":
      return row.clicks;
    case "ctr":
      return row.ctr;
    case "cpm":
      return row.cpm;
    case "spend":
      return row.spend;
    case "views":
      return row.views;
    case "conversions":
      return row.conversions;
    case "reach":
      return row.reach;
    case "frequency":
      return row.frequency;
    case "cpc":
      return row.clicks > 0 ? row.spend / row.clicks : 0;
    case "cpv":
      return row.views > 0 ? row.spend / row.views : 0;
    case "cpa":
      return row.conversions > 0 ? row.spend / row.conversions : 0;
    default:
      return 0;
  }
}

function formatMetricValue(
  value: number,
  metric: MetricKey,
  currencyFormatter: (value: number) => string,
  currencyCode: string,
  locale: string,
) {
  if (metric === "cpv") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (metric === "ctr") return `${value.toFixed(2)}%`;
  if (metric === "frequency") return value.toFixed(2);
  if (MONEY_METRICS.has(metric)) return currencyFormatter(value);
  return Math.round(value).toLocaleString(locale);
}

export default function PlatformTable({
  rows,
  timeseries,
  selectedMetrics = [],
  currencyFormatter,
  currencyCode = "EUR",
  showSpend = true,
  locale = "en-US",
  pdfMode = false,
  labels,
}: PlatformTableProps) {
  const copy = labels ?? {
    title: "Platform Performance",
    platform: "Platform",
    metrics: {},
    trend: "Trend",
    total: "Total",
  };
  const metrics = useMemo(() => resolveMetrics(selectedMetrics, showSpend), [selectedMetrics, showSpend]);
  const [sortKey, setSortKey] = useState<SortKey>(showSpend ? "spend" : "impressions");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const effectiveSortKey: SortKey =
    sortKey === "name" || metrics.includes(sortKey as MetricKey) ? sortKey : metrics[0] ?? "impressions";

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const aVal = effectiveSortKey === "name" ? a.name : metricValue(a, effectiveSortKey);
      const bVal = effectiveSortKey === "name" ? b.name : metricValue(b, effectiveSortKey);
      if (effectiveSortKey === "name") {
        return direction === "asc"
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      }
      const diff = Number(aVal) - Number(bVal);
      return direction === "asc" ? diff : -diff;
    });
    return list;
  }, [direction, effectiveSortKey, rows]);

  const sparklineMap = useMemo(() => {
    const map = new Map<string, { x: string; y: number }[]>();
    rows.forEach((row) => {
      const data = timeseries
        .filter((point) => point.platform === row.id)
        .slice(-30)
        .map((point) => ({ x: point.date.slice(5), y: point.impressions }));
      map.set(row.id, data);
    });
    return map;
  }, [rows, timeseries]);

  const totals = rows.reduce(
    (acc, row) => {
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.spend += row.spend;
      acc.conversions += row.conversions;
      acc.views += row.views;
      acc.reach += row.reach;
      return acc;
    },
    { impressions: 0, clicks: 0, spend: 0, conversions: 0, views: 0, reach: 0 },
  );

  const totalCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const totalCpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  const totalFrequency = totals.reach > 0 ? totals.impressions / totals.reach : 0;
  const totalCpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const totalCpv = totals.views > 0 ? totals.spend / totals.views : 0;
  const totalCpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0;

  const handleSort = (key: SortKey) => {
    if (key === effectiveSortKey) {
      setDirection(direction === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setDirection("desc");
  };

  const sortIcon = (key: SortKey) => {
    if (key !== effectiveSortKey) return null;
    return direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-xs sm:min-w-[930px] sm:text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] uppercase tracking-[0.08em] text-slate-500 sm:text-xs">
              <th className="px-2 py-2 text-left sm:px-3">
                <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1">
                  {copy.platform} {sortIcon("name")}
                </button>
              </th>
              {metrics.map((metric) => (
                <th key={metric} className="px-2 py-2 text-right sm:px-3">
                  <button type="button" onClick={() => handleSort(metric)} className="inline-flex items-center gap-1">
                    {copy.metrics[metric] ?? metric.toUpperCase()} {sortIcon(metric)}
                  </button>
                </th>
              ))}
              <th className="px-2 py-2 text-right sm:px-3">{copy.trend}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="px-2 py-2 sm:px-3">
                  <div className="flex items-center gap-2 font-medium text-slate-800">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                    {row.name}
                  </div>
                </td>
                {metrics.map((metric) => (
                  <td key={`${row.id}-${metric}`} className="px-2 py-2 text-right sm:px-3">
                    {formatMetricValue(metricValue(row, metric), metric, currencyFormatter, currencyCode, locale)}
                  </td>
                ))}
                <td className="px-2 py-2 sm:px-3">
                  <div className="ml-auto h-10 w-20 sm:w-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sparklineMap.get(row.id) ?? []}>
                        <RechartsTooltip
                          formatter={(value) => Number(value).toLocaleString(locale)}
                          labelStyle={{ color: "#64748b" }}
                          contentStyle={{
                            borderRadius: "10px",
                            borderColor: "#e2e8f0",
                            fontSize: "12px",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="y"
                          stroke={row.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={!pdfMode}
                          animationDuration={pdfMode ? 0 : 700}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </td>
              </tr>
            ))}

            <tr className="bg-slate-50 font-semibold">
              <td className="px-2 py-2 text-slate-900 sm:px-3">{copy.total}</td>
              {metrics.map((metric) => {
                const totalValue =
                  metric === "impressions"
                    ? totals.impressions
                    : metric === "clicks"
                      ? totals.clicks
                      : metric === "ctr"
                        ? totalCtr
                        : metric === "cpm"
                          ? totalCpm
                          : metric === "spend"
                            ? totals.spend
                            : metric === "views"
                              ? totals.views
                              : metric === "conversions"
                                ? totals.conversions
                                : metric === "reach"
                                  ? totals.reach
                                  : metric === "frequency"
                                    ? totalFrequency
                                    : metric === "cpc"
                                      ? totalCpc
                                      : metric === "cpv"
                                        ? totalCpv
                                        : totalCpa;
                return (
                  <td key={`total-${metric}`} className="px-2 py-2 text-right text-slate-900 sm:px-3">
                    {formatMetricValue(totalValue, metric, currencyFormatter, currencyCode, locale)}
                  </td>
                );
              })}
              <td className="px-2 py-2 text-right text-slate-400 sm:px-3">-</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

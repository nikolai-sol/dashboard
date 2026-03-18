"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { PlanVsFactItem } from "@/lib/types";

const SUPPORTED_METRICS = [
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "views",
  "conversions",
  "ctr",
  "cpm",
  "cpc",
  "cpv",
  "cpa",
  "spend",
] as const;

type MetricKey = (typeof SUPPORTED_METRICS)[number];
type SortKey = "name" | MetricKey;
type SortableRow = { row: PlanVsFactItem; name: string } & Record<MetricKey, number>;

type ChannelPerformanceTableProps = {
  rows: PlanVsFactItem[];
  selectedMetrics: string[];
  currencyFormatter: (value: number) => string;
  showSpend?: boolean;
  locale?: string;
  labels?: {
    title: string;
    noRows: string;
    total: string;
    channel: string;
    instrument: string;
    buyType: string;
    metrics: Record<string, string>;
  };
};

const MONEY_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa"]);

function resolveMetrics(selectedMetrics: string[], showSpend: boolean) {
  const filtered = selectedMetrics.filter((metric) =>
    SUPPORTED_METRICS.includes(metric as MetricKey),
  ) as MetricKey[];
  const metrics = filtered.filter((metric) => (showSpend ? true : !MONEY_METRICS.has(metric)));
  if (metrics.length) return metrics;
  return showSpend
    ? (["impressions", "clicks", "ctr", "spend"] as MetricKey[])
    : (["impressions", "clicks", "ctr", "reach", "frequency"] as MetricKey[]);
}

function metricLabel(metric: MetricKey) {
  return metric.toUpperCase();
}

function metricValue(row: PlanVsFactItem, metric: MetricKey) {
  switch (metric) {
    case "impressions":
      return row.impressions_fact;
    case "reach":
      return row.reach_fact;
    case "frequency":
      return row.frequency_fact;
    case "clicks":
      return row.clicks_fact;
    case "views":
      return row.views_fact;
    case "conversions":
      return row.conversions_fact;
    case "ctr":
      return row.impressions_fact > 0 ? (row.clicks_fact / row.impressions_fact) * 100 : 0;
    case "cpm":
      return row.cpm_fact;
    case "cpc":
      return row.cpc_fact;
    case "cpv":
      return row.cpv_fact;
    case "cpa":
      return row.cpa_fact;
    case "spend":
      return row.budget_fact;
    default:
      return 0;
  }
}

function formatMetricValue(
  value: number,
  metric: MetricKey,
  currencyFormatter: (value: number) => string,
  locale: string,
) {
  if (metric === "ctr") return `${value.toFixed(2)}%`;
  if (metric === "frequency") return value.toFixed(2);
  if (MONEY_METRICS.has(metric)) return currencyFormatter(value);
  return Math.round(value).toLocaleString(locale);
}

function sumMetric(rows: PlanVsFactItem[], metric: MetricKey) {
  const impressions = rows.reduce((sum, row) => sum + row.impressions_fact, 0);
  const reach = rows.reduce((sum, row) => sum + row.reach_fact, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks_fact, 0);
  const views = rows.reduce((sum, row) => sum + row.views_fact, 0);
  const conversions = rows.reduce((sum, row) => sum + row.conversions_fact, 0);
  const spend = rows.reduce((sum, row) => sum + row.budget_fact, 0);

  switch (metric) {
    case "impressions":
      return impressions;
    case "reach":
      return reach;
    case "frequency":
      return reach > 0 ? impressions / reach : 0;
    case "clicks":
      return clicks;
    case "views":
      return views;
    case "conversions":
      return conversions;
    case "ctr":
      return impressions > 0 ? (clicks / impressions) * 100 : 0;
    case "cpm":
      return impressions > 0 ? (spend / impressions) * 1000 : 0;
    case "cpc":
      return clicks > 0 ? spend / clicks : 0;
    case "cpv":
      return views > 0 ? spend / views : 0;
    case "cpa":
      return conversions > 0 ? spend / conversions : 0;
    case "spend":
      return spend;
    default:
      return 0;
  }
}

export default function ChannelPerformanceTable({
  rows,
  selectedMetrics,
  currencyFormatter,
  showSpend = true,
  locale = "en-US",
  labels,
}: ChannelPerformanceTableProps) {
  const copy = labels ?? {
    title: "Channel Performance",
    noRows: "No media plan channels available for channel performance.",
    total: "Total",
    channel: "Channel",
    instrument: "Instrument",
    buyType: "Buy type",
    metrics: {},
  };
  const metrics = useMemo(() => resolveMetrics(selectedMetrics, showSpend), [selectedMetrics, showSpend]);
  const [sortKey, setSortKey] = useState<SortKey>(showSpend ? "spend" : "impressions");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  const sortedRows = useMemo(() => {
    const list: SortableRow[] = rows.map((row) => ({
      row,
      name: row.channel,
      ...Object.fromEntries(metrics.map((metric) => [metric, metricValue(row, metric)])),
    })) as SortableRow[];
    list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const diff = Number(aVal) - Number(bVal);
      return direction === "asc" ? diff : -diff;
    });
    return list;
  }, [direction, metrics, rows, sortKey]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection(direction === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setDirection("desc");
  };

  const sortIcon = (key: SortKey) => {
    if (key !== sortKey) return null;
    return direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {copy.noRows}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.08em] text-slate-500">
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1">
                    {copy.channel} {sortIcon("name")}
                  </button>
                </th>
                <th className="px-3 py-2 text-left">{copy.instrument}</th>
                <th className="px-3 py-2 text-left">{copy.buyType}</th>
                {metrics.map((metric) => (
                  <th key={metric} className="px-3 py-2 text-right">
                    <button type="button" onClick={() => handleSort(metric)} className="inline-flex items-center gap-1">
                      {copy.metrics[metric] ?? metricLabel(metric)} {sortIcon(metric)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(({ row }) => (
                <tr key={`${row.channel}-${row.buy_type}`} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{row.channel}</td>
                  <td className="px-3 py-2 text-slate-600">{row.instrument || "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{row.buy_type.toUpperCase()}</td>
                  {metrics.map((metric) => (
                    <td key={`${row.channel}-${metric}`} className="px-3 py-2 text-right">
                      {formatMetricValue(metricValue(row, metric), metric, currencyFormatter, locale)}
                    </td>
                  ))}
                </tr>
              ))}

              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-900">{copy.total}</td>
                <td className="px-3 py-2 text-slate-400">-</td>
                <td className="px-3 py-2 text-slate-400">-</td>
                {metrics.map((metric) => (
                  <td key={`total-${metric}`} className="px-3 py-2 text-right text-slate-900">
                    {formatMetricValue(sumMetric(rows, metric), metric, currencyFormatter, locale)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

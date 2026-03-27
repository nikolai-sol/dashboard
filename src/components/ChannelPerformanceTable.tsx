"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import type { DashboardData, PlanVsFactItem } from "@/lib/types";

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
  channelTimeseries?: DashboardData["channel_timeseries"];
  selectedMetrics: string[];
  currencyFormatter: (value: number) => string;
  currencyCode?: string;
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
  if (showSpend && metrics.includes("views") && !metrics.includes("cpv")) {
    metrics.push("cpv");
  }
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
  channelTimeseries = [],
  selectedMetrics,
  currencyFormatter,
  currencyCode = "EUR",
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
  const [expandedChannels, setExpandedChannels] = useState<Record<string, boolean>>({});

  const dailyRowsByChannel = useMemo(() => {
    const grouped = new Map<string, NonNullable<DashboardData["channel_timeseries"]>>();
    for (const row of channelTimeseries ?? []) {
      if (!grouped.has(row.channel)) {
        grouped.set(row.channel, []);
      }
      grouped.get(row.channel)!.push(row);
    }
    for (const rowsForChannel of grouped.values()) {
      rowsForChannel.sort((a, b) => a.date.localeCompare(b.date));
    }
    return grouped;
  }, [channelTimeseries]);

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

  const toggleExpanded = (channel: string) => {
    setExpandedChannels((prev) => ({ ...prev, [channel]: !prev[channel] }));
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
          <table className="w-full min-w-[760px] border-collapse text-xs sm:min-w-[820px] sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-[0.08em] text-slate-500 sm:text-xs">
                <th className="px-2 py-2 text-left sm:px-3">
                  <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1">
                    {copy.channel} {sortIcon("name")}
                  </button>
                </th>
                <th className="px-2 py-2 text-left sm:px-3">{copy.instrument}</th>
                <th className="px-2 py-2 text-left sm:px-3">{copy.buyType}</th>
                {metrics.map((metric) => (
                  <th key={metric} className="px-2 py-2 text-right sm:px-3">
                    <button type="button" onClick={() => handleSort(metric)} className="inline-flex items-center gap-1">
                      {copy.metrics[metric] ?? metricLabel(metric)} {sortIcon(metric)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(({ row }) => {
                const dailyRows = dailyRowsByChannel.get(row.channel) ?? [];
                const isExpanded = Boolean(expandedChannels[row.channel]);

                return (
                  <Fragment key={`${row.channel}-${row.buy_type}`}>
                    <tr key={`${row.channel}-${row.buy_type}`} className="border-b border-slate-100">
                      <td className="px-2 py-2 font-medium text-slate-800 sm:px-3">
                        <div className="flex items-center gap-2">
                          {dailyRows.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(row.channel)}
                              className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                              aria-label={isExpanded ? "Collapse channel days" : "Expand channel days"}
                            >
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          ) : (
                            <span className="inline-block h-5 w-5" />
                          )}
                          <span>{row.channel}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-slate-600 sm:px-3">{row.instrument || "-"}</td>
                      <td className="px-2 py-2 text-slate-600 sm:px-3">{row.buy_type.toUpperCase()}</td>
                      {metrics.map((metric) => (
                        <td key={`${row.channel}-${metric}`} className="px-2 py-2 text-right sm:px-3">
                          {formatMetricValue(metricValue(row, metric), metric, currencyFormatter, currencyCode, locale)}
                        </td>
                      ))}
                    </tr>

                    {isExpanded
                      ? dailyRows.map((daily) => {
                          const dailyMetricValue = (metric: MetricKey) => {
                            switch (metric) {
                              case "impressions":
                                return daily.impressions;
                              case "reach":
                                return daily.reach ?? 0;
                              case "frequency":
                                return (daily.reach ?? 0) > 0 ? daily.impressions / (daily.reach ?? 1) : 0;
                              case "clicks":
                                return daily.clicks;
                              case "views":
                                return daily.views;
                              case "conversions":
                                return daily.conversions;
                              case "ctr":
                                return daily.impressions > 0 ? (daily.clicks / daily.impressions) * 100 : 0;
                              case "cpm":
                                return daily.impressions > 0 ? (daily.spend / daily.impressions) * 1000 : 0;
                              case "cpc":
                                return daily.clicks > 0 ? daily.spend / daily.clicks : 0;
                              case "cpv":
                                return daily.views > 0 ? daily.spend / daily.views : 0;
                              case "cpa":
                                return daily.conversions > 0 ? daily.spend / daily.conversions : 0;
                              case "spend":
                                return daily.spend;
                              default:
                                return 0;
                            }
                          };

                          return (
                            <tr key={`${row.channel}-${daily.date}`} className="border-b border-slate-100 bg-slate-50/70">
                              <td className="px-2 py-2 text-slate-700 sm:px-3">
                                <div className="pl-7 text-xs sm:text-sm">{daily.date}</div>
                              </td>
                              <td className="px-2 py-2 text-slate-400 sm:px-3">-</td>
                              <td className="px-2 py-2 text-slate-400 sm:px-3">-</td>
                              {metrics.map((metric) => (
                                <td key={`${row.channel}-${daily.date}-${metric}`} className="px-2 py-2 text-right text-slate-700 sm:px-3">
                                  {formatMetricValue(dailyMetricValue(metric), metric, currencyFormatter, currencyCode, locale)}
                                </td>
                              ))}
                            </tr>
                          );
                        })
                      : null}
                  </Fragment>
                );
              })}

              <tr className="bg-slate-50 font-semibold">
                <td className="px-2 py-2 text-slate-900 sm:px-3">{copy.total}</td>
                <td className="px-2 py-2 text-slate-400 sm:px-3">-</td>
                <td className="px-2 py-2 text-slate-400 sm:px-3">-</td>
                {metrics.map((metric) => (
                  <td key={`total-${metric}`} className="px-2 py-2 text-right text-slate-900 sm:px-3">
                    {formatMetricValue(sumMetric(rows, metric), metric, currencyFormatter, currencyCode, locale)}
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

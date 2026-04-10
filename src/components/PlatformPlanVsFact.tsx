"use client";

import { useMemo } from "react";
import type { PlanVsFactItem } from "@/lib/types";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import { resolvePlatformIdFromSourceKey } from "@/lib/source-mapping";

const SUPPORTED_METRICS = [
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "views",
  "conversions",
  "spend",
  "ctr",
  "cpm",
  "cpc",
  "cpv",
  "cpa",
] as const;

type MetricKey = (typeof SUPPORTED_METRICS)[number];

type PlatformAggregate = {
  id: string;
  label: string;
  color: string;
  impressions_plan: number;
  impressions_fact: number;
  reach_plan: number;
  reach_fact: number;
  clicks_plan: number;
  clicks_fact: number;
  views_plan: number;
  views_fact: number;
  conversions_plan: number;
  conversions_fact: number;
  spend_plan: number;
  spend_fact: number;
};

type PlatformPlanVsFactProps = {
  rows: PlanVsFactItem[];
  selectedMetrics: string[];
  showSpend?: boolean;
  currencyFormatter: (value: number) => string;
  currencyCode?: string;
  locale?: string;
  labels?: {
    title: string;
    noRows: string;
    total: string;
    platform: string;
    metrics: Record<string, string>;
    fact: string;
    plan: string;
    completion: string;
  };
};

type MetricSummary = {
  fact: number;
  plan: number;
  completion_pct: number | null;
  status?: "green" | "yellow" | "red" | null;
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
  if (MONEY_METRICS.has(metric)) return currencyFormatter(value);
  if (metric === "ctr") return `${value.toFixed(2)}%`;
  if (metric === "frequency") return value.toFixed(2);
  return Math.round(value).toLocaleString(locale);
}

function buildCompletionStatus(metric: MetricKey, completionPct: number | null): MetricSummary["status"] {
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

function statusDotClass(status?: MetricSummary["status"]) {
  if (status === "green") return "bg-emerald-500";
  if (status === "yellow") return "bg-amber-400";
  if (status === "red") return "bg-rose-500";
  return "bg-slate-300";
}

function summarizeMetric(row: PlatformAggregate, metric: MetricKey): MetricSummary {
  if (metric === "impressions") {
    const completion_pct = row.impressions_plan > 0 ? (row.impressions_fact / row.impressions_plan) * 100 : null;
    return {
      fact: row.impressions_fact,
      plan: row.impressions_plan,
      completion_pct,
      status: buildCompletionStatus(metric, completion_pct),
    };
  }
  if (metric === "reach") {
    const completion_pct = row.reach_plan > 0 ? (row.reach_fact / row.reach_plan) * 100 : null;
    return {
      fact: row.reach_fact,
      plan: row.reach_plan,
      completion_pct,
      status: buildCompletionStatus(metric, completion_pct),
    };
  }
  if (metric === "frequency") {
    const fact = row.reach_fact > 0 ? row.impressions_fact / row.reach_fact : 0;
    const plan = row.reach_plan > 0 ? row.impressions_plan / row.reach_plan : 0;
    return {
      fact,
      plan,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "clicks") {
    const completion_pct = row.clicks_plan > 0 ? (row.clicks_fact / row.clicks_plan) * 100 : null;
    return {
      fact: row.clicks_fact,
      plan: row.clicks_plan,
      completion_pct,
      status: buildCompletionStatus(metric, completion_pct),
    };
  }
  if (metric === "views") {
    const completion_pct = row.views_plan > 0 ? (row.views_fact / row.views_plan) * 100 : null;
    return {
      fact: row.views_fact,
      plan: row.views_plan,
      completion_pct,
      status: buildCompletionStatus(metric, completion_pct),
    };
  }
  if (metric === "conversions") {
    const completion_pct = row.conversions_plan > 0 ? (row.conversions_fact / row.conversions_plan) * 100 : null;
    return {
      fact: row.conversions_fact,
      plan: row.conversions_plan,
      completion_pct,
      status: buildCompletionStatus(metric, completion_pct),
    };
  }
  if (metric === "spend") {
    const completion_pct = row.spend_plan > 0 ? (row.spend_fact / row.spend_plan) * 100 : null;
    return {
      fact: row.spend_fact,
      plan: row.spend_plan,
      completion_pct,
      status: buildCompletionStatus(metric, completion_pct),
    };
  }
  if (metric === "ctr") {
    return {
      fact: row.impressions_fact > 0 ? (row.clicks_fact / row.impressions_fact) * 100 : 0,
      plan: row.impressions_plan > 0 ? (row.clicks_plan / row.impressions_plan) * 100 : 0,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "cpm") {
    return {
      fact: row.impressions_fact > 0 ? (row.spend_fact / row.impressions_fact) * 1000 : 0,
      plan: row.impressions_plan > 0 ? (row.spend_plan / row.impressions_plan) * 1000 : 0,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "cpc") {
    return {
      fact: row.clicks_fact > 0 ? row.spend_fact / row.clicks_fact : 0,
      plan: row.clicks_plan > 0 ? row.spend_plan / row.clicks_plan : 0,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "cpv") {
    return {
      fact: row.views_fact > 0 ? row.spend_fact / row.views_fact : 0,
      plan: row.views_plan > 0 ? row.spend_plan / row.views_plan : 0,
      completion_pct: null,
      status: null,
    };
  }
  return {
    fact: row.conversions_fact > 0 ? row.spend_fact / row.conversions_fact : 0,
    plan: row.conversions_plan > 0 ? row.spend_plan / row.conversions_plan : 0,
    completion_pct: null,
    status: null,
  };
}

function aggregateRows(rows: PlanVsFactItem[]): PlatformAggregate[] {
  const grouped = new Map<string, PlatformAggregate>();

  for (const row of rows) {
    const platformIds = row.platforms
      .map((platform) => resolvePlatformIdFromSourceKey(platform.source_key))
      .filter(Boolean);
    if (!platformIds.length) continue;

    const split = platformIds.length;
    for (const platformId of platformIds) {
      if (!grouped.has(platformId)) {
        const meta = PLATFORM_COLORS[platformId];
        grouped.set(platformId, {
          id: platformId,
          label: meta?.label ?? platformId,
          color: meta?.hex ?? "#94a3b8",
          impressions_plan: 0,
          impressions_fact: 0,
          reach_plan: 0,
          reach_fact: 0,
          clicks_plan: 0,
          clicks_fact: 0,
          views_plan: 0,
          views_fact: 0,
          conversions_plan: 0,
          conversions_fact: 0,
          spend_plan: 0,
          spend_fact: 0,
        });
      }
      const item = grouped.get(platformId)!;
      item.impressions_plan += row.impressions_plan / split;
      item.impressions_fact += row.impressions_fact / split;
      item.reach_plan += row.reach_plan / split;
      item.reach_fact += row.reach_fact / split;
      item.clicks_plan += row.clicks_plan / split;
      item.clicks_fact += row.clicks_fact / split;
      item.views_plan += row.views_plan / split;
      item.views_fact += row.views_fact / split;
      item.conversions_plan += row.conversions_plan / split;
      item.conversions_fact += row.conversions_fact / split;
      item.spend_plan += row.budget_plan / split;
      item.spend_fact += row.budget_fact / split;
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.spend_fact - a.spend_fact || b.clicks_fact - a.clicks_fact);
}

export default function PlatformPlanVsFact({
  rows,
  selectedMetrics,
  showSpend = true,
  currencyFormatter,
  currencyCode = "EUR",
  locale = "en-US",
  labels,
}: PlatformPlanVsFactProps) {
  const copy = labels ?? {
    title: "Platform Performance Plan / Fact",
    noRows: "No platform plan/fact rows available.",
    total: "Total",
    platform: "Platform",
    metrics: {},
    fact: "Fact",
    plan: "Plan",
    completion: "Completion",
  };

  const metrics = useMemo(() => resolveMetrics(selectedMetrics, showSpend), [selectedMetrics, showSpend]);
  const platformRows = useMemo(() => aggregateRows(rows), [rows]);

  const totalRow = useMemo(() => {
    const total: PlatformAggregate = {
      id: "total",
      label: copy.total,
      color: "#94a3b8",
      impressions_plan: 0,
      impressions_fact: 0,
      reach_plan: 0,
      reach_fact: 0,
      clicks_plan: 0,
      clicks_fact: 0,
      views_plan: 0,
      views_fact: 0,
      conversions_plan: 0,
      conversions_fact: 0,
      spend_plan: 0,
      spend_fact: 0,
    };
    platformRows.forEach((row) => {
      total.impressions_plan += row.impressions_plan;
      total.impressions_fact += row.impressions_fact;
      total.reach_plan += row.reach_plan;
      total.reach_fact += row.reach_fact;
      total.clicks_plan += row.clicks_plan;
      total.clicks_fact += row.clicks_fact;
      total.views_plan += row.views_plan;
      total.views_fact += row.views_fact;
      total.conversions_plan += row.conversions_plan;
      total.conversions_fact += row.conversions_fact;
      total.spend_plan += row.spend_plan;
      total.spend_fact += row.spend_fact;
    });
    return total;
  }, [copy.total, platformRows]);

  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>

      {platformRows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {copy.noRows}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-xs sm:min-w-[860px] sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-[0.08em] text-slate-500 sm:text-xs">
                <th className="px-2 py-2 text-left sm:px-3">{copy.platform}</th>
                {metrics.map((metric) => (
                  <th key={metric} className="px-2 py-2 text-right sm:px-3">
                    {copy.metrics[metric] ?? metric.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {platformRows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-medium text-slate-800 sm:px-3">{row.label}</td>
                  {metrics.map((metric) => {
                    const summary = summarizeMetric(row, metric);
                    const fact = formatMetricValue(summary.fact, metric, currencyFormatter, currencyCode, locale);
                    const plan = formatMetricValue(summary.plan, metric, currencyFormatter, currencyCode, locale);
                    const completion =
                      summary.completion_pct === null ? null : `${summary.completion_pct.toFixed(0)}%`;
                    return (
                      <td key={`${row.id}-${metric}`} className="px-2 py-2 text-right sm:px-3">
                        <div className="text-sm font-semibold text-slate-800 sm:text-base">{fact}</div>
                        <div className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                          <span className="inline-flex items-center gap-1">
                            {summary.completion_pct !== null ? (
                              <span className={`h-2 w-2 rounded-full ${statusDotClass(summary.status)}`} />
                            ) : null}
                            <span>{plan}</span>
                          </span>
                          {completion ? <span className="text-slate-400"> · {completion}</span> : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-2 py-2 text-slate-900 sm:px-3">{copy.total}</td>
                {metrics.map((metric) => {
                  const summary = summarizeMetric(totalRow, metric);
                  const fact = formatMetricValue(summary.fact, metric, currencyFormatter, currencyCode, locale);
                  const plan = formatMetricValue(summary.plan, metric, currencyFormatter, currencyCode, locale);
                  const completion =
                    summary.completion_pct === null ? null : `${summary.completion_pct.toFixed(0)}%`;
                  return (
                    <td key={`total-${metric}`} className="px-2 py-2 text-right text-slate-900 sm:px-3">
                      <div>{fact}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                        {plan}
                        {completion ? <span className="text-slate-400"> · {completion}</span> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

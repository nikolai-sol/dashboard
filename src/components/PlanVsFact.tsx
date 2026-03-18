"use client";

import { Fragment, useState } from "react";
import type { ChannelPerformanceItem, ChannelPerformanceMetric } from "@/lib/types";

type PlanVsFactProps = {
  rows: ChannelPerformanceItem[];
  selectedMetrics: string[];
  showSpend?: boolean;
  currencyFormatter: (value: number) => string;
  locale?: string;
  labels?: {
    title: string;
    noRows: string;
    total: string;
    channel: string;
    metrics: Record<string, string>;
    planOnlyTitle: string;
    fact: string;
    plan: string;
    completion: string;
    status: string;
    onTrack: string;
    watch: string;
    offTrack: string;
    noStatus: string;
  };
};

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
const MONEY_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa"]);

function resolveMetrics(selectedMetrics: string[], showSpend: boolean) {
  const filtered = selectedMetrics.filter((metric) =>
    SUPPORTED_METRICS.includes(metric as MetricKey),
  );
  const metrics = filtered.filter((metric) => (showSpend ? true : !MONEY_METRICS.has(metric))) as MetricKey[];
  if (metrics.length) return metrics;
  return showSpend ? (["impressions", "clicks", "ctr", "spend"] as MetricKey[]) : (["impressions", "clicks", "ctr"] as MetricKey[]);
}

function metricLabel(metric: MetricKey) {
  return metric.toUpperCase();
}

function isMoneyMetric(metric: MetricKey) {
  return MONEY_METRICS.has(metric);
}

function isRateMetric(metric: MetricKey) {
  return metric === "ctr" || metric === "cpm" || metric === "cpc" || metric === "cpv" || metric === "cpa";
}

function formatMetricValue(
  value: number,
  metric: MetricKey,
  currencyFormatter: (value: number) => string,
  locale: string,
) {
  if (isMoneyMetric(metric)) return currencyFormatter(value);
  if (metric === "ctr") return `${value.toFixed(2)}%`;
  if (metric === "frequency") return value.toFixed(2);
  if (metric === "cpm" || metric === "cpc" || metric === "cpv" || metric === "cpa") {
    return currencyFormatter(value);
  }
  return Math.round(value).toLocaleString(locale);
}

function statusDotClass(status?: ChannelPerformanceMetric["status"] | null) {
  if (status === "green") return "bg-emerald-500";
  if (status === "yellow") return "bg-amber-400";
  if (status === "red") return "bg-rose-500";
  return "bg-slate-300";
}

function statusHint(status?: ChannelPerformanceMetric["status"] | null) {
  if (status === "green") return "On track";
  if (status === "yellow") return "Watch";
  if (status === "red") return "Off track";
  return "No status";
}

function metricTooltip(
  metric: MetricKey,
  summary: ChannelPerformanceMetric | undefined,
  currencyFormatter: (value: number) => string,
  locale: string,
  labels: NonNullable<PlanVsFactProps["labels"]>,
) {
  if (!summary) return "";
  const fact = formatMetricValue(summary.fact, metric, currencyFormatter, locale);
  const plan = formatMetricValue(summary.plan, metric, currencyFormatter, locale);
  const completion = summary.completion_pct === null ? "n/a" : `${summary.completion_pct.toFixed(1)}%`;
  const status =
    summary.status === "green"
      ? labels.onTrack
      : summary.status === "yellow"
        ? labels.watch
        : summary.status === "red"
          ? labels.offTrack
          : labels.noStatus;
  return `${labels.fact}: ${fact}\n${labels.plan}: ${plan}\n${labels.completion}: ${completion}\n${labels.status}: ${status}`;
}

function sumMetric(rows: ChannelPerformanceItem[], metric: MetricKey): ChannelPerformanceMetric {
  if (metric === "ctr") {
    const clicksFact = rows.reduce((sum, row) => sum + (row.metrics.clicks?.fact ?? 0), 0);
    const impressionsFact = rows.reduce((sum, row) => sum + (row.metrics.impressions?.fact ?? 0), 0);
    const clicksPlan = rows.reduce((sum, row) => sum + (row.metrics.clicks?.plan ?? 0), 0);
    const impressionsPlan = rows.reduce((sum, row) => sum + (row.metrics.impressions?.plan ?? 0), 0);
    return {
      fact: impressionsFact > 0 ? (clicksFact / impressionsFact) * 100 : 0,
      plan: impressionsPlan > 0 ? (clicksPlan / impressionsPlan) * 100 : 0,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "cpm") {
    const spendFact = rows.reduce((sum, row) => sum + (row.metrics.spend?.fact ?? 0), 0);
    const impressionsFact = rows.reduce((sum, row) => sum + (row.metrics.impressions?.fact ?? 0), 0);
    const spendPlan = rows.reduce((sum, row) => sum + (row.metrics.spend?.plan ?? 0), 0);
    const impressionsPlan = rows.reduce((sum, row) => sum + (row.metrics.impressions?.plan ?? 0), 0);
    return {
      fact: impressionsFact > 0 ? (spendFact / impressionsFact) * 1000 : 0,
      plan: impressionsPlan > 0 ? (spendPlan / impressionsPlan) * 1000 : 0,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "cpc") {
    const spendFact = rows.reduce((sum, row) => sum + (row.metrics.spend?.fact ?? 0), 0);
    const clicksFact = rows.reduce((sum, row) => sum + (row.metrics.clicks?.fact ?? 0), 0);
    const spendPlan = rows.reduce((sum, row) => sum + (row.metrics.spend?.plan ?? 0), 0);
    const clicksPlan = rows.reduce((sum, row) => sum + (row.metrics.clicks?.plan ?? 0), 0);
    return {
      fact: clicksFact > 0 ? spendFact / clicksFact : 0,
      plan: clicksPlan > 0 ? spendPlan / clicksPlan : 0,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "cpv") {
    const spendFact = rows.reduce((sum, row) => sum + (row.metrics.spend?.fact ?? 0), 0);
    const viewsFact = rows.reduce((sum, row) => sum + (row.metrics.views?.fact ?? 0), 0);
    const spendPlan = rows.reduce((sum, row) => sum + (row.metrics.spend?.plan ?? 0), 0);
    const viewsPlan = rows.reduce((sum, row) => sum + (row.metrics.views?.plan ?? 0), 0);
    return {
      fact: viewsFact > 0 ? spendFact / viewsFact : 0,
      plan: viewsPlan > 0 ? spendPlan / viewsPlan : 0,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "cpa") {
    const spendFact = rows.reduce((sum, row) => sum + (row.metrics.spend?.fact ?? 0), 0);
    const conversionsFact = rows.reduce((sum, row) => sum + (row.metrics.conversions?.fact ?? 0), 0);
    const spendPlan = rows.reduce((sum, row) => sum + (row.metrics.spend?.plan ?? 0), 0);
    const conversionsPlan = rows.reduce((sum, row) => sum + (row.metrics.conversions?.plan ?? 0), 0);
    return {
      fact: conversionsFact > 0 ? spendFact / conversionsFact : 0,
      plan: conversionsPlan > 0 ? spendPlan / conversionsPlan : 0,
      completion_pct: null,
      status: null,
    };
  }
  if (metric === "frequency") {
    const impressionsFact = rows.reduce((sum, row) => sum + (row.metrics.impressions?.fact ?? 0), 0);
    const reachFact = rows.reduce((sum, row) => sum + (row.metrics.reach?.fact ?? 0), 0);
    const impressionsPlan = rows.reduce((sum, row) => sum + (row.metrics.impressions?.plan ?? 0), 0);
    const reachPlan = rows.reduce((sum, row) => sum + (row.metrics.reach?.plan ?? 0), 0);
    return {
      fact: reachFact > 0 ? impressionsFact / reachFact : 0,
      plan: reachPlan > 0 ? impressionsPlan / reachPlan : 0,
      completion_pct: reachPlan > 0 ? ((reachFact > 0 ? impressionsFact / reachFact : 0) / (impressionsPlan / reachPlan)) * 100 : null,
      status: null,
    };
  }
  const fact = rows.reduce((sum, row) => sum + (row.metrics[metric]?.fact ?? 0), 0);
  const plan = rows.reduce((sum, row) => sum + (row.metrics[metric]?.plan ?? 0), 0);
  const completion = plan > 0 ? (fact / plan) * 100 : null;
  return {
    fact,
    plan,
    completion_pct: completion === null ? null : Number(completion.toFixed(1)),
    status: null,
  };
}

function MetricCell({
  metric,
  summary,
  currencyFormatter,
  muted = false,
  locale,
  labels,
}: {
  metric: MetricKey;
  summary?: ChannelPerformanceMetric;
  currencyFormatter: (value: number) => string;
  muted?: boolean;
  locale: string;
  labels: NonNullable<PlanVsFactProps["labels"]>;
}) {
  if (!summary) {
    return <div className="text-right text-sm text-slate-300">-</div>;
  }

  const fact = formatMetricValue(summary.fact, metric, currencyFormatter, locale);
  const plan = formatMetricValue(summary.plan, metric, currencyFormatter, locale);
  const completionText =
    summary.completion_pct === null ? null : `${summary.completion_pct.toFixed(0)}%`;

  return (
    <div
      className={`text-right ${muted ? "text-slate-400" : "text-slate-700"}`}
      title={metricTooltip(metric, summary, currencyFormatter, locale, labels)}
    >
      <div className={`text-base font-semibold ${muted ? "text-slate-400" : "text-slate-800"}`}>{fact}</div>
      <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px]">
        {summary.completion_pct !== null ? <span className={`h-2 w-2 rounded-full ${statusDotClass(summary.status)}`} /> : null}
        <span>{plan}</span>
        {completionText ? <span className="text-slate-400">· {completionText}</span> : null}
      </div>
    </div>
  );
}

export default function PlanVsFact({
  rows,
  selectedMetrics,
  showSpend = true,
  currencyFormatter,
  locale = "en-US",
  labels,
}: PlanVsFactProps) {
  const copy = labels ?? {
    title: "Channel Performance Plan / Fact",
    noRows: "No media plan rows connected. Add a published Google Sheets URL or CSV URL in dashboard sources.",
    total: "Total",
    channel: "Channel",
    metrics: {},
    planOnlyTitle: "Plan-only row: no campaign bindings yet.",
    fact: "Fact",
    plan: "Plan",
    completion: "Completion",
    status: "Status",
    onTrack: "On track",
    watch: "Watch",
    offTrack: "Off track",
    noStatus: "No status",
  };
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const metrics = resolveMetrics(selectedMetrics, showSpend);

  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {copy.noRows}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.08em] text-slate-500">
                <th className="px-3 py-2 text-left">{copy.channel}</th>
                {metrics.map((metric) => (
                  <th key={metric} className="px-3 py-2 text-right">
                    {copy.metrics[metric] ?? metricLabel(metric)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expandable = (row.months?.length ?? 0) > 1;
                const expanded = Boolean(expandedRows[row.channel]);
                return (
                  <Fragment key={`${row.channel}-group`}>
                    <tr
                      className={`border-b border-slate-100 ${row.plan_only ? "bg-slate-50" : ""}`}
                    >
                      <td className="px-3 py-3 font-medium text-slate-800">
                        <button
                          type="button"
                          disabled={!expandable}
                          onClick={() =>
                            expandable &&
                            setExpandedRows((prev) => ({ ...prev, [row.channel]: !prev[row.channel] }))
                          }
                          className="flex items-center gap-2 text-left disabled:cursor-default"
                          title={row.plan_only ? copy.planOnlyTitle : row.channel}
                        >
                          {expandable ? <span className="text-slate-400">{expanded ? "−" : "+"}</span> : null}
                          <span className={row.plan_only ? "text-slate-500" : ""}>{row.channel}</span>
                        </button>
                      </td>
                      {metrics.map((metric) => (
                        <td key={`${row.channel}-${metric}`} className="px-3 py-3 align-top">
                          <MetricCell
                            metric={metric}
                            summary={row.metrics[metric]}
                            currencyFormatter={currencyFormatter}
                            muted={row.plan_only}
                            locale={locale}
                            labels={copy}
                          />
                        </td>
                      ))}
                    </tr>
                    {expanded && row.months?.map((month) => (
                      <tr key={`${row.channel}-${month.month}`} className="border-b border-slate-100 bg-slate-50/60">
                        <td className="px-3 py-2 pl-8 text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                          {month.month}
                        </td>
                        {metrics.map((metric) => (
                          <td key={`${row.channel}-${month.month}-${metric}`} className="px-3 py-2 align-top">
                            <MetricCell
                              metric={metric}
                              summary={month.metrics[metric]}
                              currencyFormatter={currencyFormatter}
                              muted={row.plan_only}
                            locale={locale}
                            labels={copy}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-3 text-slate-900">{copy.total}</td>
                {metrics.map((metric) => (
                  <td key={`total-${metric}`} className="px-3 py-3 align-top">
                    <MetricCell
                      metric={metric}
                      summary={sumMetric(rows, metric)}
                      currencyFormatter={currencyFormatter}
                      locale={locale}
                      labels={copy}
                    />
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

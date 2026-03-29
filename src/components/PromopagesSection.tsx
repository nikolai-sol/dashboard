"use client";

import type { PromopagesData } from "@/lib/types";

const MONEY_METRICS = new Set(["budget", "cpm", "clickout_cost", "metrica_visit_cost"]);

type PromopagesSectionProps = {
  data: PromopagesData;
  selectedMetrics: string[];
  currencyFormatter: (value: number) => string;
  locale: string;
  labels: {
    title: string;
    noRows: string;
    metrics: Record<string, string>;
    campaign: string;
    date: string;
    account: string;
  };
};

function compact(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(Math.round(value));
}

function formatValue(
  metric: string,
  value: number,
  locale: string,
  currencyFormatter: (value: number) => string,
) {
  if (MONEY_METRICS.has(metric)) return currencyFormatter(value);
  if (metric.includes("percent") || metric === "ctr") return `${value.toFixed(2)}%`;
  if (metric.includes("time_sec")) return `${value.toFixed(0)}s`;
  return compact(value, locale);
}

function metricLabel(metric: string, labels: Record<string, string>) {
  if (metric === "budget") return labels.spend ?? "Budget";
  if (metric === "full_reads") return "Full Reads";
  if (metric === "clickouts") return "Clickouts";
  if (metric === "metrica_visits") return "Metrica Visits";
  return labels[metric] ?? metric;
}

export default function PromopagesSection({
  data,
  selectedMetrics,
  currencyFormatter,
  locale,
  labels,
}: PromopagesSectionProps) {
  const selected = selectedMetrics.length > 0 ? selectedMetrics : ["impressions", "views", "clicks", "spend", "ctr", "cpm"];
  const summaryMetrics = Array.from(
    new Set(
      [
        ...selected.map((metric) => (metric === "spend" ? "budget" : metric)),
        "clickouts",
        "full_reads",
        "metrica_visits",
      ].filter((metric) =>
        [
          "impressions",
          "reach",
          "views",
          "clicks",
          "budget",
          "ctr",
          "cpm",
          "clickouts",
          "full_reads",
          "metrica_visits",
        ].includes(metric),
      ),
    ),
  );

  const summaryMap: Record<string, number> = {
    impressions: data.kpi.total_impressions,
    reach: data.kpi.total_reach,
    views: data.kpi.total_views,
    clicks: data.kpi.total_clicks,
    budget: data.kpi.total_budget,
    ctr: data.kpi.avg_ctr,
    cpm: data.kpi.avg_cpm,
    clickouts: data.kpi.total_clickouts,
    full_reads: data.kpi.total_full_reads,
    metrica_visits: data.kpi.total_metrica_visits,
  };

  return (
    <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900">{labels.title}</h2>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {summaryMetrics.map((metric) => (
          <div key={metric} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-[0.15em] text-slate-500">
              {metricLabel(metric, labels.metrics)}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {formatValue(metric, summaryMap[metric] ?? 0, locale, currencyFormatter)}
            </div>
          </div>
        ))}
      </div>

      {data.campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">
          {labels.noRows}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="px-3 py-3">{labels.account}</th>
                <th className="px-3 py-3">{labels.campaign}</th>
                <th className="px-3 py-3">{labels.date}</th>
                <th className="px-3 py-3">{metricLabel("impressions", labels.metrics)}</th>
                <th className="px-3 py-3">{metricLabel("reach", labels.metrics)}</th>
                <th className="px-3 py-3">{metricLabel("views", labels.metrics)}</th>
                <th className="px-3 py-3">{metricLabel("clicks", labels.metrics)}</th>
                <th className="px-3 py-3">{metricLabel("budget", labels.metrics)}</th>
                <th className="px-3 py-3">{metricLabel("cpm", labels.metrics)}</th>
                <th className="px-3 py-3">{metricLabel("clickouts", labels.metrics)}</th>
                <th className="px-3 py-3">{metricLabel("full_reads", labels.metrics)}</th>
                <th className="px-3 py-3">{metricLabel("metrica_visits", labels.metrics)}</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((row, index) => (
                <tr
                  key={`${row.platform_account_id}:${row.platform_campaign_id}:${row.report_date ?? index}`}
                  className={index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                >
                  <td className="px-3 py-3 text-slate-700">{row.account_name}</td>
                  <td className="px-3 py-3 font-medium text-slate-900">{row.campaign_name}</td>
                  <td className="px-3 py-3 text-slate-700">{row.report_date}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.impressions, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.reach, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.views, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.clicks, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{currencyFormatter(row.budget)}</td>
                  <td className="px-3 py-3 text-slate-700">{currencyFormatter(row.cpm)}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.clickouts, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.full_reads, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.metrica_visits, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

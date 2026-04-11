"use client";

import type { DashboardMetrikaTrafficMetricId } from "@/lib/admin-ui-types";
import type { AnalyticsKPI, AnalyticsTimeSeriesPoint } from "@/lib/types";

type AnalyticsSectionProps = {
  kpi: AnalyticsKPI;
  timeseries: AnalyticsTimeSeriesPoint[];
  selectedMetrics?: DashboardMetrikaTrafficMetricId[];
  locale: string;
  labels: {
    title: string;
    date: string;
    visits: string;
    users: string;
    pageviews: string;
    bounceRate: string;
    avgVisitDuration: string;
    total: string;
  };
};

function compact(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(Math.round(value));
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0s";
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function AnalyticsSection({ kpi, timeseries, selectedMetrics, locale, labels }: AnalyticsSectionProps) {
  const metrics = selectedMetrics?.length
    ? selectedMetrics
    : ["visits", "users", "pageviews", "bounce_rate", "avg_visit_duration"];
  const showVisits = metrics.includes("visits");
  const showUsers = metrics.includes("users");
  const showPageviews = metrics.includes("pageviews");
  const showBounceRate = metrics.includes("bounce_rate");
  const showAvgVisitDuration = metrics.includes("avg_visit_duration");
  const visibleCardCount = [showVisits, showUsers, showPageviews, showBounceRate, showAvgVisitDuration].filter(Boolean).length;

  return (
    <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900">{labels.title}</h2>
      </div>

      <div className={`mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 ${visibleCardCount >= 4 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
        {showVisits ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.visits}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{compact(kpi.total_visits, locale)}</div>
        </div>
        ) : null}
        {showUsers ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.users}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{compact(kpi.total_users, locale)}</div>
        </div>
        ) : null}
        {showPageviews ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.pageviews}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{compact(kpi.total_pageviews, locale)}</div>
        </div>
        ) : null}
        {showBounceRate ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.bounceRate}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{kpi.avg_bounce_rate.toFixed(2)}%</div>
        </div>
        ) : null}
        {showAvgVisitDuration ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.avgVisitDuration}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{formatSeconds(kpi.avg_visit_duration)}</div>
        </div>
        ) : null}
      </div>

      {timeseries.length > 0 && (showVisits || showUsers || showPageviews || showBounceRate) ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="px-3 py-3">{labels.date}</th>
                {showVisits ? <th className="px-3 py-3">{labels.visits}</th> : null}
                {showUsers ? <th className="px-3 py-3">{labels.users}</th> : null}
                {showPageviews ? <th className="px-3 py-3">{labels.pageviews}</th> : null}
                {showBounceRate ? <th className="px-3 py-3">{labels.bounceRate}</th> : null}
              </tr>
            </thead>
            <tbody>
              {timeseries.map((row, index) => (
                <tr key={`${row.date}-${index}`} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                  <td className="px-3 py-3 text-slate-700">{row.date}</td>
                  {showVisits ? <td className="px-3 py-3 text-slate-700">{compact(row.visits, locale)}</td> : null}
                  {showUsers ? <td className="px-3 py-3 text-slate-700">{compact(row.users, locale)}</td> : null}
                  {showPageviews ? <td className="px-3 py-3 text-slate-700">{compact(row.pageviews, locale)}</td> : null}
                  {showBounceRate ? <td className="px-3 py-3 text-slate-700">{row.bounce_rate.toFixed(2)}%</td> : null}
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td className="px-3 py-3">{labels.total}</td>
                {showVisits ? <td className="px-3 py-3">{compact(kpi.total_visits, locale)}</td> : null}
                {showUsers ? <td className="px-3 py-3">{compact(kpi.total_users, locale)}</td> : null}
                {showPageviews ? <td className="px-3 py-3">{compact(kpi.total_pageviews, locale)}</td> : null}
                {showBounceRate ? <td className="px-3 py-3">{kpi.avg_bounce_rate.toFixed(2)}%</td> : null}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

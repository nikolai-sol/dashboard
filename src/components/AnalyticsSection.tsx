"use client";

import type { AnalyticsKPI, AnalyticsTimeSeriesPoint } from "@/lib/types";

type AnalyticsSectionProps = {
  kpi: AnalyticsKPI;
  timeseries: AnalyticsTimeSeriesPoint[];
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

export default function AnalyticsSection({ kpi, timeseries, locale, labels }: AnalyticsSectionProps) {
  return (
    <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900">{labels.title}</h2>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.visits}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{compact(kpi.total_visits, locale)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.users}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{compact(kpi.total_users, locale)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.pageviews}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{compact(kpi.total_pageviews, locale)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.bounceRate}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{kpi.avg_bounce_rate.toFixed(2)}%</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-[0.15em] text-slate-500">{labels.avgVisitDuration}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{formatSeconds(kpi.avg_visit_duration)}</div>
        </div>
      </div>

      {timeseries.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="px-3 py-3">{labels.date}</th>
                <th className="px-3 py-3">{labels.visits}</th>
                <th className="px-3 py-3">{labels.users}</th>
                <th className="px-3 py-3">{labels.pageviews}</th>
                <th className="px-3 py-3">{labels.bounceRate}</th>
              </tr>
            </thead>
            <tbody>
              {timeseries.map((row, index) => (
                <tr key={`${row.date}-${index}`} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                  <td className="px-3 py-3 text-slate-700">{row.date}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.visits, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.users, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{compact(row.pageviews, locale)}</td>
                  <td className="px-3 py-3 text-slate-700">{row.bounce_rate.toFixed(2)}%</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td className="px-3 py-3">{labels.total}</td>
                <td className="px-3 py-3">{compact(kpi.total_visits, locale)}</td>
                <td className="px-3 py-3">{compact(kpi.total_users, locale)}</td>
                <td className="px-3 py-3">{compact(kpi.total_pageviews, locale)}</td>
                <td className="px-3 py-3">{kpi.avg_bounce_rate.toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

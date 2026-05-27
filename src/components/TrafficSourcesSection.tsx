"use client";

import type { TrafficSourceRow } from "@/lib/types";

type Props = {
  rows: TrafficSourceRow[];
  locale: string;
  labels: {
    title: string;
    source: string;
    visits: string;
    users: string;
    newUsers: string;
    pageviews: string;
    bounceRate: string;
    pageDepth: string;
    avgVisitDuration: string;
    noRows: string;
  };
};

const TRAFFIC_SOURCE_RU: Record<string, string> = {
  "Ad traffic": "Рекламный трафик",
  "Direct traffic": "Прямые заходы",
  "Link traffic": "Переходы по ссылкам",
  "Search engine traffic": "Переходы из поисковых систем",
  "Social network traffic": "Переходы из соцсетей",
  "Internal traffic": "Внутренние переходы",
  "Recommended systems": "Переходы из рекомендательных систем",
  "Messenger traffic": "Переходы из мессенджеров",
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

function localizeTrafficSource(name: string, locale: string) {
  if (!locale.toLowerCase().startsWith("ru")) return name;
  return TRAFFIC_SOURCE_RU[name] ?? name;
}

export default function TrafficSourcesSection({ rows, locale, labels }: Props) {
  if (!rows.length) {
    return (
      <section className="card-surface overflow-hidden p-5">
        <h3 className="mb-4 text-base font-semibold text-slate-900">{labels.title}</h3>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {labels.noRows}
        </div>
      </section>
    );
  }

  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{labels.title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500 sm:text-xs">
              <th className="px-2 py-2 sm:px-3">{labels.source}</th>
              <th className="px-2 py-2 text-right sm:px-3">{labels.visits}</th>
              <th className="px-2 py-2 text-right sm:px-3">{labels.users}</th>
              <th className="px-2 py-2 text-right sm:px-3">{labels.newUsers}</th>
              <th className="px-2 py-2 text-right sm:px-3">{labels.pageviews}</th>
              <th className="px-2 py-2 text-right sm:px-3">{labels.bounceRate}</th>
              <th className="px-2 py-2 text-right sm:px-3">{labels.pageDepth}</th>
              <th className="px-2 py-2 text-right sm:px-3">{labels.avgVisitDuration}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.traffic_source} className="border-b border-slate-100">
                <td className="px-2 py-2 text-slate-800 sm:px-3">{localizeTrafficSource(row.traffic_source, locale)}</td>
                <td className="px-2 py-2 text-right sm:px-3">{compact(row.visits, locale)}</td>
                <td className="px-2 py-2 text-right sm:px-3">{compact(row.users, locale)}</td>
                <td className="px-2 py-2 text-right sm:px-3">{compact(row.new_users, locale)}</td>
                <td className="px-2 py-2 text-right sm:px-3">{compact(row.pageviews, locale)}</td>
                <td className="px-2 py-2 text-right sm:px-3">{row.bounce_rate.toFixed(2)}%</td>
                <td className="px-2 py-2 text-right sm:px-3">{row.page_depth.toFixed(2)}</td>
                <td className="px-2 py-2 text-right sm:px-3">{formatSeconds(row.avg_visit_duration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

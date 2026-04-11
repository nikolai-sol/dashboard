"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { PostClickAnalyticsRow, PostClickAnalyticsTimeSeriesPoint } from "@/lib/types";
import type { DashboardPostClickFieldId } from "@/lib/admin-ui-types";

type Props = {
  rows: PostClickAnalyticsRow[];
  timeseries?: PostClickAnalyticsTimeSeriesPoint[];
  selectedColumns?: DashboardPostClickFieldId[];
  locale: string;
  labels: {
    title: string;
    sourceNote?: string;
    noRows: string;
    total: string;
    channel: string;
    instrument: string;
    visits: string;
    users: string;
    pageviews: string;
    goalReaches: string;
    conversionRate: string;
    bounceRate: string;
    avgVisitDuration: string;
    utmSources: string;
  };
};

const DEFAULT_COLUMNS: DashboardPostClickFieldId[] = [
  "visits",
  "users",
  "pageviews",
  "goal_reaches",
  "conversion_rate",
  "bounce_rate",
  "avg_visit_duration",
];

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

function sumRows(rows: PostClickAnalyticsRow[]) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.visits += row.visits;
      acc.users += row.users;
      acc.pageviews += row.pageviews;
      acc.goal_reaches += row.goal_reaches;
      acc.bounce_weighted += row.bounce_rate * row.visits;
      acc.duration_weighted += row.avg_visit_duration * row.visits;
      return acc;
    },
    { visits: 0, users: 0, pageviews: 0, goal_reaches: 0, bounce_weighted: 0, duration_weighted: 0 },
  );

  return {
    visits: totals.visits,
    users: totals.users,
    pageviews: totals.pageviews,
    goal_reaches: totals.goal_reaches,
    conversion_rate: totals.visits > 0 ? (totals.goal_reaches / totals.visits) * 100 : 0,
    bounce_rate: totals.visits > 0 ? totals.bounce_weighted / totals.visits : 0,
    avg_visit_duration: totals.visits > 0 ? totals.duration_weighted / totals.visits : 0,
  };
}

export default function PostClickAnalyticsTable({
  rows,
  timeseries = [],
  selectedColumns = DEFAULT_COLUMNS,
  locale,
  labels,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.visits - a.visits || a.channel.localeCompare(b.channel, "ru")),
    [rows],
  );

  const dailyRowsByLineKey = useMemo(() => {
    const grouped = new Map<string, PostClickAnalyticsTimeSeriesPoint[]>();
    for (const row of timeseries) {
      if (!grouped.has(row.line_key)) grouped.set(row.line_key, []);
      grouped.get(row.line_key)!.push(row);
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => a.date.localeCompare(b.date));
    }
    return grouped;
  }, [timeseries]);

  const totals = useMemo(() => sumRows(rows), [rows]);

  const toggleExpanded = (lineKey: string) => {
    setExpanded((prev) => ({ ...prev, [lineKey]: !prev[lineKey] }));
  };

  const visible = new Set<DashboardPostClickFieldId>(
    selectedColumns.length ? selectedColumns : DEFAULT_COLUMNS,
  );

  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{labels.title}</h3>
      {labels.sourceNote ? (
        <p className="mb-4 max-w-4xl text-sm text-slate-500">{labels.sourceNote}</p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {labels.noRows}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500 sm:text-xs">
                <th className="px-2 py-2 sm:px-3">{labels.channel}</th>
                {visible.has("visits") ? <th className="px-2 py-2 text-right sm:px-3">{labels.visits}</th> : null}
                {visible.has("users") ? <th className="px-2 py-2 text-right sm:px-3">{labels.users}</th> : null}
                {visible.has("pageviews") ? <th className="px-2 py-2 text-right sm:px-3">{labels.pageviews}</th> : null}
                {visible.has("goal_reaches") ? (
                  <th className="px-2 py-2 text-right sm:px-3">{labels.goalReaches}</th>
                ) : null}
                {visible.has("conversion_rate") ? (
                  <th className="px-2 py-2 text-right sm:px-3">{labels.conversionRate}</th>
                ) : null}
                {visible.has("bounce_rate") ? (
                  <th className="px-2 py-2 text-right sm:px-3">{labels.bounceRate}</th>
                ) : null}
                {visible.has("avg_visit_duration") ? (
                  <th className="px-2 py-2 text-right sm:px-3">{labels.avgVisitDuration}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const dailyRows = dailyRowsByLineKey.get(row.line_key) ?? [];
                const isExpanded = Boolean(expanded[row.line_key]);
                return (
                  <Fragment key={row.line_key}>
                    <tr className="border-b border-slate-100">
                      <td className="px-2 py-2 font-medium text-slate-800 sm:px-3">
                        <div className="flex items-start gap-2">
                          {dailyRows.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(row.line_key)}
                              className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                              aria-label={isExpanded ? "Collapse days" : "Expand days"}
                            >
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          ) : (
                            <span className="inline-block h-5 w-5" />
                          )}
                          <div>
                            <div>{row.channel}</div>
                          </div>
                        </div>
                      </td>
                      {visible.has("visits") ? (
                        <td className="px-2 py-2 text-right sm:px-3">{compact(row.visits, locale)}</td>
                      ) : null}
                      {visible.has("users") ? (
                        <td className="px-2 py-2 text-right sm:px-3">{compact(row.users, locale)}</td>
                      ) : null}
                      {visible.has("pageviews") ? (
                        <td className="px-2 py-2 text-right sm:px-3">{compact(row.pageviews, locale)}</td>
                      ) : null}
                      {visible.has("goal_reaches") ? (
                        <td className="px-2 py-2 text-right sm:px-3">{compact(row.goal_reaches, locale)}</td>
                      ) : null}
                      {visible.has("conversion_rate") ? (
                        <td className="px-2 py-2 text-right sm:px-3">{row.conversion_rate.toFixed(2)}%</td>
                      ) : null}
                      {visible.has("bounce_rate") ? (
                        <td className="px-2 py-2 text-right sm:px-3">{row.bounce_rate.toFixed(2)}%</td>
                      ) : null}
                      {visible.has("avg_visit_duration") ? (
                        <td className="px-2 py-2 text-right sm:px-3">{formatSeconds(row.avg_visit_duration)}</td>
                      ) : null}
                    </tr>

                    {isExpanded
                      ? dailyRows.map((daily) => (
                          <tr key={`${row.line_key}-${daily.date}`} className="border-b border-slate-100 bg-slate-50/70">
                            <td className="px-2 py-2 text-slate-700 sm:px-3">
                              <div className="pl-7 text-xs sm:text-sm">{daily.date}</div>
                            </td>
                            {visible.has("visits") ? (
                              <td className="px-2 py-2 text-right sm:px-3">{compact(daily.visits, locale)}</td>
                            ) : null}
                            {visible.has("users") ? (
                              <td className="px-2 py-2 text-right sm:px-3">{compact(daily.users, locale)}</td>
                            ) : null}
                            {visible.has("pageviews") ? (
                              <td className="px-2 py-2 text-right sm:px-3">{compact(daily.pageviews, locale)}</td>
                            ) : null}
                            {visible.has("goal_reaches") ? (
                              <td className="px-2 py-2 text-right sm:px-3">{compact(daily.goal_reaches, locale)}</td>
                            ) : null}
                            {visible.has("conversion_rate") ? (
                              <td className="px-2 py-2 text-right sm:px-3">{daily.conversion_rate.toFixed(2)}%</td>
                            ) : null}
                            {visible.has("bounce_rate") ? (
                              <td className="px-2 py-2 text-right sm:px-3">{daily.bounce_rate.toFixed(2)}%</td>
                            ) : null}
                            {visible.has("avg_visit_duration") ? (
                              <td className="px-2 py-2 text-right sm:px-3">{formatSeconds(daily.avg_visit_duration)}</td>
                            ) : null}
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}

              <tr className="bg-slate-50 font-semibold">
                <td className="px-2 py-2 text-slate-900 sm:px-3">{labels.total}</td>
                {visible.has("visits") ? (
                  <td className="px-2 py-2 text-right text-slate-900 sm:px-3">{compact(totals.visits, locale)}</td>
                ) : null}
                {visible.has("users") ? (
                  <td className="px-2 py-2 text-right text-slate-900 sm:px-3">{compact(totals.users, locale)}</td>
                ) : null}
                {visible.has("pageviews") ? (
                  <td className="px-2 py-2 text-right text-slate-900 sm:px-3">{compact(totals.pageviews, locale)}</td>
                ) : null}
                {visible.has("goal_reaches") ? (
                  <td className="px-2 py-2 text-right text-slate-900 sm:px-3">{compact(totals.goal_reaches, locale)}</td>
                ) : null}
                {visible.has("conversion_rate") ? (
                  <td className="px-2 py-2 text-right text-slate-900 sm:px-3">{totals.conversion_rate.toFixed(2)}%</td>
                ) : null}
                {visible.has("bounce_rate") ? (
                  <td className="px-2 py-2 text-right text-slate-900 sm:px-3">{totals.bounce_rate.toFixed(2)}%</td>
                ) : null}
                {visible.has("avg_visit_duration") ? (
                  <td className="px-2 py-2 text-right text-slate-900 sm:px-3">{formatSeconds(totals.avg_visit_duration)}</td>
                ) : null}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

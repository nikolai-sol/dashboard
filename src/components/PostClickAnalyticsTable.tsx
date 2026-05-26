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
    pageDepth: string;
    goalReaches: string;
    conversionRate: string;
    bounceRate: string;
    avgVisitDuration: string;
    utmSources: string;
    sourceKeys: string;
    platformAccountIds: string;
    platformCampaignIds: string;
    platformDeliveryEntityIds: string;
    platformCreativeIds: string;
    impressions: string;
    clicks: string;
    views: string;
    reach: string;
    spend: string;
    ctr: string;
    cpm: string;
    cpc: string;
    videoViews25: string;
    videoViews50: string;
    videoViews75: string;
    videoViews100: string;
  };
};

const DEFAULT_COLUMNS: DashboardPostClickFieldId[] = [
  "visits",
  "users",
  "pageviews",
  "page_depth",
  "goal_reaches",
  "conversion_rate",
  "bounce_rate",
  "avg_visit_duration",
];

const ALL_COLUMNS: DashboardPostClickFieldId[] = [
  "source_keys",
  "platform_account_ids",
  "platform_campaign_ids",
  "platform_delivery_entity_ids",
  "platform_creative_ids",
  "visits",
  "users",
  "pageviews",
  "page_depth",
  "goal_reaches",
  "conversion_rate",
  "bounce_rate",
  "avg_visit_duration",
  "impressions",
  "clicks",
  "views",
  "reach",
  "spend",
  "ctr",
  "cpm",
  "cpc",
  "video_views_25",
  "video_views_50",
  "video_views_75",
  "video_views_100",
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

function formatList(values: string[]) {
  if (!values.length) return "-";
  return values.join(", ");
}

function isListColumn(column: DashboardPostClickFieldId) {
  return (
    column === "source_keys" ||
    column === "platform_account_ids" ||
    column === "platform_campaign_ids" ||
    column === "platform_delivery_entity_ids" ||
    column === "platform_creative_ids"
  );
}

function getListValue(
  row: PostClickAnalyticsRow | PostClickAnalyticsTimeSeriesPoint | ReturnType<typeof sumRows>,
  column: DashboardPostClickFieldId,
) {
  if (!isListColumn(column)) return [];
  const value = (row as Partial<Record<DashboardPostClickFieldId, unknown>>)[column];
  return Array.isArray(value) ? (value as string[]) : [];
}

function sumRows(rows: PostClickAnalyticsRow[]) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.visits += row.visits;
      acc.users += row.users;
      acc.pageviews += row.pageviews;
      acc.page_depth_weighted += row.page_depth * row.visits;
      acc.goal_reaches += row.goal_reaches;
      acc.bounce_weighted += row.bounce_rate * row.visits;
      acc.duration_weighted += row.avg_visit_duration * row.visits;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.views += row.views;
      acc.reach += row.reach;
      acc.spend += row.spend;
      acc.video_views_25 += row.video_views_25;
      acc.video_views_50 += row.video_views_50;
      acc.video_views_75 += row.video_views_75;
      acc.video_views_100 += row.video_views_100;
      return acc;
    },
    {
      visits: 0,
      users: 0,
      pageviews: 0,
      page_depth_weighted: 0,
      goal_reaches: 0,
      bounce_weighted: 0,
      duration_weighted: 0,
      impressions: 0,
      clicks: 0,
      views: 0,
      reach: 0,
      spend: 0,
      video_views_25: 0,
      video_views_50: 0,
      video_views_75: 0,
      video_views_100: 0,
    },
  );

  return {
    visits: totals.visits,
    users: totals.users,
    pageviews: totals.pageviews,
    page_depth: totals.visits > 0 ? totals.page_depth_weighted / totals.visits : 0,
    goal_reaches: totals.goal_reaches,
    conversion_rate: totals.visits > 0 ? (totals.goal_reaches / totals.visits) * 100 : 0,
    bounce_rate: totals.visits > 0 ? totals.bounce_weighted / totals.visits : 0,
    avg_visit_duration: totals.visits > 0 ? totals.duration_weighted / totals.visits : 0,
    impressions: totals.impressions,
    clicks: totals.clicks,
    views: totals.views,
    reach: totals.reach,
    spend: totals.spend,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
    video_views_25: totals.video_views_25,
    video_views_50: totals.video_views_50,
    video_views_75: totals.video_views_75,
    video_views_100: totals.video_views_100,
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
  const [dailyExpanded, setDailyExpanded] = useState<Record<string, boolean>>({});

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
  const toggleDailyExpanded = (lineKey: string, date: string) => {
    const key = `${lineKey}::${date}`;
    setDailyExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const visible = new Set<DashboardPostClickFieldId>(
    selectedColumns.length ? selectedColumns : DEFAULT_COLUMNS,
  );
  const orderedColumns = useMemo(() => {
    const preferred = selectedColumns.length ? selectedColumns : DEFAULT_COLUMNS;
    const uniquePreferred = preferred.filter((column, index) => preferred.indexOf(column) === index);
    const filtered = uniquePreferred.filter((column) => ALL_COLUMNS.includes(column));
    return ALL_COLUMNS.filter((column) => visible.has(column)).sort(
      (a, b) => filtered.indexOf(a) - filtered.indexOf(b),
    );
  }, [selectedColumns, visible]);

  const labelByColumn: Record<DashboardPostClickFieldId, string> = {
    source_keys: labels.sourceKeys,
    platform_account_ids: labels.platformAccountIds,
    platform_campaign_ids: labels.platformCampaignIds,
    platform_delivery_entity_ids: labels.platformDeliveryEntityIds,
    platform_creative_ids: labels.platformCreativeIds,
    visits: labels.visits,
    users: labels.users,
    pageviews: labels.pageviews,
    page_depth: labels.pageDepth,
    goal_reaches: labels.goalReaches,
    conversion_rate: labels.conversionRate,
    bounce_rate: labels.bounceRate,
    avg_visit_duration: labels.avgVisitDuration,
    impressions: labels.impressions,
    clicks: labels.clicks,
    views: labels.views,
    reach: labels.reach,
    spend: labels.spend,
    ctr: labels.ctr,
    cpm: labels.cpm,
    cpc: labels.cpc,
    video_views_25: labels.videoViews25,
    video_views_50: labels.videoViews50,
    video_views_75: labels.videoViews75,
    video_views_100: labels.videoViews100,
  };

  const renderColumnValue = (
    row: PostClickAnalyticsRow | PostClickAnalyticsTimeSeriesPoint | ReturnType<typeof sumRows>,
    column: DashboardPostClickFieldId,
    isTotal = false,
  ) => {
    if (isTotal && isListColumn(column)) return "-";
    switch (column) {
      case "source_keys":
      case "platform_account_ids":
      case "platform_campaign_ids":
      case "platform_delivery_entity_ids":
      case "platform_creative_ids":
        return formatList(getListValue(row, column));
      case "visits":
      case "users":
      case "pageviews":
      case "goal_reaches":
      case "impressions":
      case "clicks":
      case "views":
      case "reach":
      case "video_views_25":
      case "video_views_50":
      case "video_views_75":
      case "video_views_100":
        return compact(row[column] as number, locale);
      case "conversion_rate":
      case "bounce_rate":
      case "ctr":
        return `${Number(row[column] ?? 0).toFixed(2)}%`;
      case "avg_visit_duration":
        return formatSeconds(Number(row[column] ?? 0));
      case "page_depth":
        return Number(row[column] ?? 0).toFixed(2);
      case "spend":
      case "cpm":
      case "cpc":
        return Number(row[column] ?? 0).toFixed(2);
      default:
        return "-";
    }
  };

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
                {orderedColumns.map((column) => (
                  <th
                    key={`header-${column}`}
                    className={`px-2 py-2 sm:px-3 ${isListColumn(column) ? "" : "text-right"}`}
                  >
                    {labelByColumn[column]}
                  </th>
                ))}
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
                      {orderedColumns.map((column) => (
                        <td
                          key={`${row.line_key}-${column}`}
                          className={`px-2 py-2 sm:px-3 ${isListColumn(column) ? "" : "text-right"}`}
                        >
                          {renderColumnValue(row, column)}
                        </td>
                      ))}
                    </tr>

                    {isExpanded
                      ? dailyRows.flatMap((daily) => {
                          const dailyKey = `${row.line_key}::${daily.date}`;
                          const campaigns = daily.campaign_breakdown ?? [];
                          const dailyRow = (
                            <tr key={`${row.line_key}-${daily.date}`} className="border-b border-slate-100 bg-slate-50/70">
                              <td className="px-2 py-2 text-slate-700 sm:px-3">
                                <div className="flex items-center gap-2 pl-7 text-xs sm:text-sm">
                                  {campaigns.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleDailyExpanded(row.line_key, daily.date)}
                                      className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                                      aria-label={dailyExpanded[dailyKey] ? "Collapse campaigns" : "Expand campaigns"}
                                    >
                                      {dailyExpanded[dailyKey] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    </button>
                                  ) : (
                                    <span className="inline-block h-5 w-5" />
                                  )}
                                  <span>{daily.date}</span>
                                </div>
                              </td>
                              {orderedColumns.map((column) => (
                                <td
                                  key={`${dailyKey}-${column}`}
                                  className={`px-2 py-2 sm:px-3 ${isListColumn(column) ? "" : "text-right"}`}
                                >
                                  {renderColumnValue(daily, column)}
                                </td>
                              ))}
                            </tr>
                          );
                          const campaignRows = dailyExpanded[dailyKey]
                            ? campaigns.map((campaign) => (
                                <tr
                                  key={`${row.line_key}-${daily.date}-${campaign.utm_campaign}`}
                                  className="border-b border-slate-100 bg-indigo-50/30"
                                >
                                  <td className="px-2 py-2 text-slate-700 sm:px-3">
                                    <div className="pl-14 text-xs sm:text-sm">
                                      {daily.date} / <span className="font-medium">{campaign.utm_campaign}</span>
                                    </div>
                                  </td>
                                  {orderedColumns.map((column) => (
                                    <td
                                      key={`${dailyKey}-${campaign.utm_campaign}-${column}`}
                                      className={`px-2 py-2 sm:px-3 ${isListColumn(column) ? "" : "text-right"}`}
                                    >
                                      {renderColumnValue(campaign, column)}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            : [];
                          return [dailyRow, ...campaignRows];
                        })
                      : null}
                  </Fragment>
                );
              })}

              <tr className="bg-slate-50 font-semibold">
                <td className="px-2 py-2 text-slate-900 sm:px-3">{labels.total}</td>
                {orderedColumns.map((column) => (
                  <td
                    key={`total-${column}`}
                    className={`px-2 py-2 text-slate-900 sm:px-3 ${isListColumn(column) ? "" : "text-right"}`}
                  >
                    {renderColumnValue(totals, column, true)}
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

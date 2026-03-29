"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ManualChannelData } from "@/lib/types";
import { PLATFORM_COLORS } from "@/lib/platform-colors";

type ManualDataTableProps = {
  title: string;
  rows: ManualChannelData[];
  currencyFormatter: (value: number) => string;
  locale?: string;
  pdfMode?: boolean;
  labels?: {
    source: string;
    impressions: string;
    reach: string;
    clicks: string;
    sessions: string;
    ctr: string;
    cr: string;
    conversions: string;
    spend: string;
    total: string;
  };
};

function formatNumber(value: number, locale = "en-US"): string {
  return value.toLocaleString(locale, { maximumFractionDigits: 0 });
}

function formatPct(value: number, locale = "en-US"): string {
  return `${value.toLocaleString(locale, { maximumFractionDigits: 2 })}%`;
}

export default function ManualDataTable({
  title,
  rows,
  currencyFormatter,
  locale = "en-US",
  pdfMode = false,
  labels,
}: ManualDataTableProps) {
  const [collapsedPlatforms, setCollapsedPlatforms] = useState<Set<string>>(() => new Set());

  const copy = useMemo(
    () =>
      labels ?? {
        source: "Source / Channel",
        impressions: "Impressions",
        reach: "Reach",
        clicks: "Clicks",
        sessions: "Sessions",
        ctr: "CTR",
        cr: "CR",
        conversions: "Conversions",
        spend: "Spend",
        total: "Total",
      },
    [labels],
  );

  const { grouped, columns, totals } = useMemo(() => {
    const byPlatform = new Map<string, ManualChannelData[]>();
    for (const r of rows) {
      if (!byPlatform.has(r.platform)) {
        byPlatform.set(r.platform, []);
      }
      byPlatform.get(r.platform)!.push(r);
    }

    const hasImpressions = rows.some((r) => r.impressions > 0);
    const hasReach = rows.some((r) => r.reach > 0);
    const hasClicks = rows.some((r) => r.clicks > 0);
    const hasSessions = rows.some((r) => r.sessions > 0);
    const hasCtr = rows.some((r) => r.impressions > 0 && r.clicks > 0);
    const hasCr = rows.some((r) => r.sessions > 0 && r.conversions > 0);
    const hasConversions = rows.some((r) => r.conversions > 0);
    const hasSpend = rows.some((r) => r.spend > 0);

    const cols: Array<{ key: string; label: string; format: "num" | "pct" | "currency" }> = [];
    if (hasImpressions) cols.push({ key: "impressions", label: copy.impressions, format: "num" });
    if (hasReach) cols.push({ key: "reach", label: copy.reach, format: "num" });
    if (hasClicks) cols.push({ key: "clicks", label: copy.clicks, format: "num" });
    if (hasSessions) cols.push({ key: "sessions", label: copy.sessions, format: "num" });
    if (hasCtr) cols.push({ key: "ctr", label: copy.ctr, format: "pct" });
    if (hasCr) cols.push({ key: "cr", label: copy.cr, format: "pct" });
    if (hasConversions) cols.push({ key: "conversions", label: copy.conversions, format: "num" });
    if (hasSpend) cols.push({ key: "spend", label: copy.spend, format: "currency" });

    const sorted = Array.from(byPlatform.entries()).sort((a, b) => {
      const aSum = a[1].reduce((s, r) => s + r.clicks + r.impressions, 0);
      const bSum = b[1].reduce((s, r) => s + r.clicks + r.impressions, 0);
      return bSum - aSum;
    });

    const groupedData: Array<{
      platform: string;
      channels: ManualChannelData[];
      platformTotals: ManualChannelData;
    }> = [];

    for (const [platform, channels] of sorted) {
      const sortedChannels = [...channels].sort(
        (a, b) => b.clicks + b.impressions - (a.clicks + a.impressions),
      );
      const platformTotals: ManualChannelData = {
        platform,
        channel: "",
        impressions: sortedChannels.reduce((s, r) => s + r.impressions, 0),
        reach: sortedChannels.reduce((s, r) => s + r.reach, 0),
        clicks: sortedChannels.reduce((s, r) => s + r.clicks, 0),
        spend: sortedChannels.reduce((s, r) => s + r.spend, 0),
        views: sortedChannels.reduce((s, r) => s + r.views, 0),
        conversions: sortedChannels.reduce((s, r) => s + r.conversions, 0),
        sessions: sortedChannels.reduce((s, r) => s + (r.sessions ?? 0), 0),
      };
      groupedData.push({ platform, channels: sortedChannels, platformTotals });
    }

    const totals: ManualChannelData = {
      platform: "",
      channel: "",
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
      reach: rows.reduce((s, r) => s + r.reach, 0),
      clicks: rows.reduce((s, r) => s + r.clicks, 0),
      spend: rows.reduce((s, r) => s + r.spend, 0),
      views: rows.reduce((s, r) => s + r.views, 0),
      conversions: rows.reduce((s, r) => s + r.conversions, 0),
      sessions: rows.reduce((s, r) => s + r.sessions, 0),
    };

    return { grouped: groupedData, columns: cols, totals };
  }, [rows, copy]);

  const togglePlatform = (platform: string) => {
    if (pdfMode) return;
    setCollapsedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const formatCell = (
    row: ManualChannelData,
    col: (typeof columns)[number],
  ): string | number => {
    if (col.key === "impressions") return row.impressions;
    if (col.key === "reach") return row.reach;
    if (col.key === "clicks") return row.clicks;
    if (col.key === "sessions") return row.sessions;
    if (col.key === "ctr")
      return row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0;
    if (col.key === "cr") {
      return row.sessions > 0 && row.conversions > 0
        ? (row.conversions / row.sessions) * 100
        : 0;
    }
    if (col.key === "conversions") return row.conversions;
    if (col.key === "spend") return row.spend;
    return 0;
  };

  const renderCell = (row: ManualChannelData, col: (typeof columns)[number]) => {
    const val = formatCell(row, col);
    if (col.format === "num") return formatNumber(val as number, locale);
    if (col.format === "pct") return formatPct(val as number, locale);
    if (col.format === "currency") return val ? currencyFormatter(val as number) : "";
    return "";
  };

  if (!rows.length) return null;

  return (
    <section className="mb-6">
      <h3 className="mb-3 text-base font-semibold text-slate-900">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead>
            <tr>
              <th className="bg-slate-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">
                {copy.source}
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="bg-slate-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-600"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {grouped.map(({ platform, channels, platformTotals }) => {
              const meta = PLATFORM_COLORS[platform];
              const label = meta?.label ?? platform.charAt(0).toUpperCase() + platform.slice(1);
              const isExpanded = pdfMode || !collapsedPlatforms.has(platform);

              return (
                <Fragment key={platform}>
                  <tr
                    className={
                      pdfMode
                        ? "bg-slate-50"
                        : "cursor-pointer bg-slate-50 transition-colors hover:bg-slate-100"
                    }
                    onClick={() => togglePlatform(platform)}
                  >
                    <td className="px-4 py-2 font-medium text-slate-900">
                      <span className="inline-flex items-center gap-1">
                        {!pdfMode &&
                          (isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-slate-500" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-500" />
                          ))}
                        {label}
                      </span>
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className="px-4 py-2 text-right font-mono tabular-nums text-slate-700"
                      >
                        {renderCell(platformTotals, col)}
                      </td>
                    ))}
                  </tr>
                  {isExpanded &&
                    channels.map((ch) => (
                      <tr
                        key={`${platform}-${ch.channel}`}
                        className={pdfMode ? "" : "transition-colors hover:bg-slate-50"}
                      >
                        <td className="px-4 py-2 pl-10 text-slate-600">{ch.channel}</td>
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className="px-4 py-2 text-right font-mono tabular-nums text-slate-700"
                          >
                            {renderCell(ch, col)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              );
            })}
            <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
              <td className="px-4 py-3 text-slate-900">{copy.total}</td>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="px-4 py-3 text-right font-mono tabular-nums text-slate-900"
                >
                  {renderCell(totals, col)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

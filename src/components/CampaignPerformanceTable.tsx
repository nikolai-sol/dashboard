"use client";

import { useMemo, useState } from "react";
import type { CampaignBreakdownItem } from "@/lib/types";

type SortKey = "cpa" | "spend" | "conversions" | "clicks";

type CampaignPerformanceTableProps = {
  campaigns: CampaignBreakdownItem[];
  currencyFormatter: (value: number) => string;
  locale?: string;
  labels?: {
    title: string;
    noRows: string;
    campaign: string;
    platform: string;
    spend: string;
    conversions: string;
    cpa: string;
    clicks: string;
    cpc: string;
    total: string;
  };
};

function compact(value: number, locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(Math.round(value));
}

export default function CampaignPerformanceTable({
  campaigns,
  currencyFormatter,
  locale = "en-US",
  labels,
}: CampaignPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("cpa");
  const [ascending, setAscending] = useState(true);

  const sortedRows = useMemo(() => {
    const rows = [...campaigns];
    rows.sort((a, b) => {
      const aValue = sortKey === "cpa" && a.conversions === 0 ? Number.POSITIVE_INFINITY : a[sortKey];
      const bValue = sortKey === "cpa" && b.conversions === 0 ? Number.POSITIVE_INFINITY : b[sortKey];
      if (aValue !== bValue) {
        return ascending ? aValue - bValue : bValue - aValue;
      }
      return b.conversions - a.conversions || b.spend - a.spend;
    });
    return rows;
  }, [ascending, campaigns, sortKey]);

  const totals = useMemo(() => {
    const spend = campaigns.reduce((sum, item) => sum + item.spend, 0);
    const conversions = campaigns.reduce((sum, item) => sum + item.conversions, 0);
    const clicks = campaigns.reduce((sum, item) => sum + item.clicks, 0);
    return {
      spend,
      conversions,
      clicks,
      cpa: conversions > 0 ? spend / conversions : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
    };
  }, [campaigns]);

  const benchmarkCpa = totals.conversions > 0 ? totals.cpa : 0;

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setAscending((prev) => !prev);
      return;
    }
    setSortKey(nextKey);
    setAscending(nextKey === "cpa");
  };

  if (!campaigns.length) {
    return (
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
        <h3 className="font-display text-2xl text-slate-900">{labels?.title ?? "Campaign Performance"}</h3>
        <p className="mt-4 text-sm text-slate-500">{labels?.noRows ?? "No campaign rows available."}</p>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="font-display text-2xl text-slate-900">{labels?.title ?? "Campaign Performance"}</h3>
        <div className="text-sm text-slate-500">Sort: {sortKey.toUpperCase()} {ascending ? "↑" : "↓"}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-3 py-3 font-medium">{labels?.campaign ?? "Campaign"}</th>
              <th className="px-3 py-3 font-medium">{labels?.platform ?? "Platform"}</th>
              <th className="px-3 py-3 font-medium text-right">
                <button type="button" onClick={() => toggleSort("spend")} className="hover:text-slate-900">{labels?.spend ?? "Spend"}</button>
              </th>
              <th className="px-3 py-3 font-medium text-right">
                <button type="button" onClick={() => toggleSort("conversions")} className="hover:text-slate-900">{labels?.conversions ?? "Conv."}</button>
              </th>
              <th className="px-3 py-3 font-medium text-right">
                <button type="button" onClick={() => toggleSort("cpa")} className="hover:text-slate-900">{labels?.cpa ?? "CPA"}</button>
              </th>
              <th className="px-3 py-3 font-medium text-right">
                <button type="button" onClick={() => toggleSort("clicks")} className="hover:text-slate-900">{labels?.clicks ?? "Clicks"}</button>
              </th>
              <th className="px-3 py-3 font-medium text-right">{labels?.cpc ?? "CPC"}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => {
              const cpaTone = row.conversions === 0
                ? "text-slate-400"
                : row.cpa <= benchmarkCpa
                  ? "text-emerald-600"
                  : "text-rose-600";
              return (
                <tr key={`${row.source_key}:${row.campaign_id}`} className={index % 2 === 0 ? "bg-slate-50/60" : "bg-white"}>
                  <td className="px-3 py-3 align-top">
                    <div className="font-medium text-slate-900">{row.campaign_name || row.campaign_id}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.campaign_id}</div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.platform_color }} />
                      {row.platform_label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-slate-900">{currencyFormatter(row.spend)}</td>
                  <td className="px-3 py-3 text-right text-slate-900">{compact(row.conversions, locale)}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${cpaTone}`}>
                    {row.conversions > 0 ? currencyFormatter(row.cpa) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-900">{compact(row.clicks, locale)}</td>
                  <td className="px-3 py-3 text-right text-slate-900">{row.clicks > 0 ? currencyFormatter(row.cpc) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-100 font-semibold text-slate-900">
              <td className="px-3 py-3">{labels?.total ?? "Total"}</td>
              <td className="px-3 py-3" />
              <td className="px-3 py-3 text-right">{currencyFormatter(totals.spend)}</td>
              <td className="px-3 py-3 text-right">{compact(totals.conversions, locale)}</td>
              <td className="px-3 py-3 text-right">{totals.conversions > 0 ? currencyFormatter(totals.cpa) : "—"}</td>
              <td className="px-3 py-3 text-right">{compact(totals.clicks, locale)}</td>
              <td className="px-3 py-3 text-right">{totals.clicks > 0 ? currencyFormatter(totals.cpc) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

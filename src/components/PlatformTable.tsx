"use client";

import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { PlatformStats, TimeSeriesPoint } from "@/lib/types";

type SortKey = "name" | "impressions" | "clicks" | "ctr" | "cpm" | "spend";

type PlatformTableProps = {
  rows: PlatformStats[];
  timeseries: TimeSeriesPoint[];
  currencyFormatter: (value: number) => string;
  showSpend?: boolean;
  locale?: string;
  pdfMode?: boolean;
  labels?: {
    title: string;
    platform: string;
    impressions: string;
    clicks: string;
    ctr: string;
    cpm: string;
    spend: string;
    trend: string;
    total: string;
  };
};

export default function PlatformTable({
  rows,
  timeseries,
  currencyFormatter,
  showSpend = true,
  locale = "en-US",
  pdfMode = false,
  labels,
}: PlatformTableProps) {
  const copy = labels ?? {
    title: "Platform Performance",
    platform: "Platform",
    impressions: "Impressions",
    clicks: "Clicks",
    ctr: "CTR",
    cpm: "CPM",
    spend: "Spend",
    trend: "Trend",
    total: "Total",
  };
  const [sortKey, setSortKey] = useState<SortKey>(showSpend ? "spend" : "impressions");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const diff = Number(aVal) - Number(bVal);
      return direction === "asc" ? diff : -diff;
    });
    return list;
  }, [direction, rows, sortKey]);

  const sparklineMap = useMemo(() => {
    const map = new Map<string, { x: string; y: number }[]>();
    rows.forEach((row) => {
      const data = timeseries
        .filter((point) => point.platform === row.id)
        .slice(-30)
        .map((point) => ({ x: point.date.slice(5), y: point.impressions }));
      map.set(row.id, data);
    });
    return map;
  }, [rows, timeseries]);

  const totals = rows.reduce(
    (acc, row) => {
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.spend += row.spend;
      acc.conversions += row.conversions;
      return acc;
    },
    { impressions: 0, clicks: 0, spend: 0, conversions: 0 },
  );

  const totalCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const totalCpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection(direction === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setDirection("desc");
  };

  const sortIcon = (key: SortKey) => {
    if (key !== sortKey) return null;
    return direction === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5" />
    );
  };

  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[930px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.08em] text-slate-500">
              <th className="px-3 py-2 text-left">
                <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1">
                  {copy.platform} {sortIcon("name")}
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button type="button" onClick={() => handleSort("impressions")} className="inline-flex items-center gap-1">
                  {copy.impressions} {sortIcon("impressions")}
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button type="button" onClick={() => handleSort("clicks")} className="inline-flex items-center gap-1">
                  {copy.clicks} {sortIcon("clicks")}
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button type="button" onClick={() => handleSort("ctr")} className="inline-flex items-center gap-1">
                  {copy.ctr} {sortIcon("ctr")}
                </button>
              </th>
              {showSpend ? (
                <>
                  <th className="px-3 py-2 text-right">
                    <button type="button" onClick={() => handleSort("cpm")} className="inline-flex items-center gap-1">
                      {copy.cpm} {sortIcon("cpm")}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <button type="button" onClick={() => handleSort("spend")} className="inline-flex items-center gap-1">
                      {copy.spend} {sortIcon("spend")}
                    </button>
                  </th>
                </>
              ) : null}
              <th className="px-3 py-2 text-right">{copy.trend}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 font-medium text-slate-800">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                    {row.name}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{row.impressions.toLocaleString(locale)}</td>
                <td className="px-3 py-2 text-right">{row.clicks.toLocaleString(locale)}</td>
                <td className="px-3 py-2 text-right">{row.ctr.toFixed(2)}%</td>
                {showSpend ? (
                  <>
                    <td className="px-3 py-2 text-right">{currencyFormatter(row.cpm)}</td>
                    <td className="px-3 py-2 text-right font-mono">{currencyFormatter(row.spend)}</td>
                  </>
                ) : null}
                <td className="px-3 py-2">
                  <div className="ml-auto h-10 w-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sparklineMap.get(row.id) ?? []}>
                        <RechartsTooltip
                          formatter={(value) => Number(value).toLocaleString(locale)}
                          labelStyle={{ color: "#64748b" }}
                          contentStyle={{
                            borderRadius: "10px",
                            borderColor: "#e2e8f0",
                            fontSize: "12px",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="y"
                          stroke={row.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={!pdfMode}
                          animationDuration={pdfMode ? 0 : 700}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </td>
              </tr>
            ))}

            <tr className="bg-slate-50 font-semibold">
              <td className="px-3 py-2 text-slate-900">{copy.total}</td>
              <td className="px-3 py-2 text-right text-slate-900">{totals.impressions.toLocaleString(locale)}</td>
              <td className="px-3 py-2 text-right text-slate-900">{totals.clicks.toLocaleString(locale)}</td>
              <td className="px-3 py-2 text-right text-slate-900">{totalCtr.toFixed(2)}%</td>
              {showSpend ? (
                <>
                  <td className="px-3 py-2 text-right text-slate-900">{currencyFormatter(totalCpm)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-900">{currencyFormatter(totals.spend)}</td>
                </>
              ) : null}
              <td className="px-3 py-2 text-right text-slate-400">-</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

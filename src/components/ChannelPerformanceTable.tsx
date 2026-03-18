"use client";

import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { DashboardData, PlanVsFactItem } from "@/lib/types";

type SortKey = "name" | "impressions" | "clicks" | "ctr" | "cpm" | "spend" | "campaigns";

type ChannelPerformanceTableProps = {
  rows: PlanVsFactItem[];
  timeseries?: DashboardData["channel_timeseries"];
  currencyFormatter: (value: number) => string;
  showSpend?: boolean;
};

function trendValue(row: PlanVsFactItem, point: NonNullable<DashboardData["channel_timeseries"]>[number]) {
  const buyType = row.buy_type.toUpperCase();
  if (buyType === "CPV") return point.views;
  if (buyType === "CPA") return point.conversions;
  if (buyType === "CPC") return point.clicks;
  return point.impressions;
}

export default function ChannelPerformanceTable({
  rows,
  timeseries,
  currencyFormatter,
  showSpend = true,
}: ChannelPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>(showSpend ? "spend" : "impressions");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  const sortedRows = useMemo(() => {
    const list = rows.map((row) => ({
      row,
      name: row.channel,
      impressions: row.impressions_fact,
      clicks: row.clicks_fact,
      ctr: row.impressions_fact > 0 ? (row.clicks_fact / row.impressions_fact) * 100 : 0,
      cpm: row.cpm_fact,
      spend: row.budget_fact,
      campaigns: row.campaign_count,
    }));
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
      const data = (timeseries ?? [])
        .filter((point) => point.channel === row.channel)
        .slice(-30)
        .map((point) => ({ x: point.date.slice(5), y: trendValue(row, point) }));
      map.set(row.channel, data);
    });
    return map;
  }, [rows, timeseries]);

  const totals = rows.reduce(
    (acc, row) => {
      acc.impressions += row.impressions_fact;
      acc.clicks += row.clicks_fact;
      acc.spend += row.budget_fact;
      acc.campaigns += row.campaign_count;
      return acc;
    },
    { impressions: 0, clicks: 0, spend: 0, campaigns: 0 },
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
    return direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">Channel Performance</h3>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          No media plan channels available for channel performance.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.08em] text-slate-500">
                <th className="px-3 py-2 text-left">
                  <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1">
                    Channel {sortIcon("name")}
                  </button>
                </th>
                <th className="px-3 py-2 text-left">Instrument</th>
                <th className="px-3 py-2 text-left">Buy type</th>
                <th className="px-3 py-2 text-right">
                  <button type="button" onClick={() => handleSort("impressions")} className="inline-flex items-center gap-1">
                    Impressions {sortIcon("impressions")}
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <button type="button" onClick={() => handleSort("clicks")} className="inline-flex items-center gap-1">
                    Clicks {sortIcon("clicks")}
                  </button>
                </th>
                <th className="px-3 py-2 text-right">
                  <button type="button" onClick={() => handleSort("ctr")} className="inline-flex items-center gap-1">
                    CTR {sortIcon("ctr")}
                  </button>
                </th>
                {showSpend ? (
                  <>
                    <th className="px-3 py-2 text-right">
                      <button type="button" onClick={() => handleSort("cpm")} className="inline-flex items-center gap-1">
                        CPM {sortIcon("cpm")}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <button type="button" onClick={() => handleSort("spend")} className="inline-flex items-center gap-1">
                        Spend {sortIcon("spend")}
                      </button>
                    </th>
                  </>
                ) : null}
                <th className="px-3 py-2 text-right">
                  <button type="button" onClick={() => handleSort("campaigns")} className="inline-flex items-center gap-1">
                    Campaigns {sortIcon("campaigns")}
                  </button>
                </th>
                <th className="px-3 py-2 text-right">Trend</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(({ row, impressions, clicks, ctr, cpm, spend, campaigns }) => (
                <tr key={`${row.channel}-${row.buy_type}`} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{row.channel}</td>
                  <td className="px-3 py-2 text-slate-600">{row.instrument || "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{row.buy_type.toUpperCase()}</td>
                  <td className="px-3 py-2 text-right">{Math.round(impressions).toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-right">{Math.round(clicks).toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-right">{ctr.toFixed(2)}%</td>
                  {showSpend ? (
                    <>
                      <td className="px-3 py-2 text-right">{currencyFormatter(cpm)}</td>
                      <td className="px-3 py-2 text-right font-mono">{currencyFormatter(spend)}</td>
                    </>
                  ) : null}
                  <td className="px-3 py-2 text-right">{campaigns}</td>
                  <td className="px-3 py-2">
                    <div className="ml-auto h-10 w-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={sparklineMap.get(row.channel) ?? []}>
                          <RechartsTooltip
                            formatter={(value) => Number(value).toLocaleString("en-US")}
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
                            stroke={row.platforms[0]?.color ?? "#64748b"}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive
                            animationDuration={700}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </td>
                </tr>
              ))}

              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-900">Total</td>
                <td className="px-3 py-2 text-slate-400">-</td>
                <td className="px-3 py-2 text-slate-400">-</td>
                <td className="px-3 py-2 text-right text-slate-900">{Math.round(totals.impressions).toLocaleString("en-US")}</td>
                <td className="px-3 py-2 text-right text-slate-900">{Math.round(totals.clicks).toLocaleString("en-US")}</td>
                <td className="px-3 py-2 text-right text-slate-900">{totalCtr.toFixed(2)}%</td>
                {showSpend ? (
                  <>
                    <td className="px-3 py-2 text-right text-slate-900">{currencyFormatter(totalCpm)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-900">{currencyFormatter(totals.spend)}</td>
                  </>
                ) : null}
                <td className="px-3 py-2 text-right text-slate-900">{totals.campaigns}</td>
                <td className="px-3 py-2 text-right text-slate-400">-</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

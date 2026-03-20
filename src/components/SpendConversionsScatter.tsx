"use client";

import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import type { CampaignBreakdownItem } from "@/lib/types";

type SpendConversionsScatterProps = {
  campaigns: CampaignBreakdownItem[];
  currencyFormatter: (value: number) => string;
  labels?: {
    title: string;
    noRows: string;
    spend: string;
    conversions: string;
    cpa: string;
  };
};

export default function SpendConversionsScatter({
  campaigns,
  currencyFormatter,
  labels,
}: SpendConversionsScatterProps) {
  if (!campaigns.length) {
    return (
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
        <h3 className="font-display text-2xl text-slate-900">{labels?.title ?? "Spend vs Conversions"}</h3>
        <p className="mt-4 text-sm text-slate-500">{labels?.noRows ?? "No campaign rows available."}</p>
      </section>
    );
  }

  const groups = new Map<string, { id: string; color: string; data: Array<{ x: number; y: number; campaign: string; cpa: number }> }>();
  for (const row of campaigns) {
    if (!groups.has(row.platform_label)) {
      groups.set(row.platform_label, {
        id: row.platform_label,
        color: row.platform_color,
        data: [],
      });
    }
    groups.get(row.platform_label)!.data.push({
      x: row.spend,
      y: row.conversions,
      campaign: row.campaign_name || row.campaign_id,
      cpa: row.cpa,
    });
  }

  const series = Array.from(groups.values());

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      <h3 className="mb-4 font-display text-2xl text-slate-900">{labels?.title ?? "Spend vs Conversions"}</h3>
      <div className="h-[420px]">
        <ResponsiveScatterPlot
          data={series}
          margin={{ top: 20, right: 24, bottom: 64, left: 72 }}
          xScale={{ type: "linear", min: 0, max: "auto" }}
          yScale={{ type: "linear", min: 0, max: "auto" }}
          blendMode="normal"
          axisBottom={{
            legend: labels?.spend ?? "Spend",
            legendOffset: 46,
            legendPosition: "middle",
          }}
          axisLeft={{
            legend: labels?.conversions ?? "Conversions",
            legendOffset: -52,
            legendPosition: "middle",
          }}
          colors={(serie) => groups.get(String(serie.serieId))?.color ?? "#2563eb"}
          nodeSize={(node) => {
            const cpa = Number((node.data as { cpa?: number }).cpa ?? 0);
            if (!Number.isFinite(cpa) || cpa <= 0) return 10;
            return Math.max(8, Math.min(22, cpa / 8));
          }}
          tooltip={({ node }) => {
            const data = node.data as { campaign: string; cpa: number; x: number; y: number };
            return (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-xl">
                <div className="font-semibold text-slate-900">{data.campaign}</div>
                <div className="mt-1 text-slate-600">{labels?.spend ?? "Spend"}: {currencyFormatter(Number(data.x ?? 0))}</div>
                <div className="text-slate-600">{labels?.conversions ?? "Conversions"}: {Number(data.y ?? 0)}</div>
                <div className="text-slate-600">{labels?.cpa ?? "CPA"}: {data.cpa > 0 ? currencyFormatter(data.cpa) : "—"}</div>
              </div>
            );
          }}
          useMesh
        />
      </div>
    </section>
  );
}

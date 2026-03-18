"use client";

import { ResponsiveBar } from "@nivo/bar";
import type { PlatformStats } from "@/lib/types";

type SpendByPlatformProps = {
  data: PlatformStats[];
  currencyFormatter: (value: number) => string;
  labels?: {
    title: string;
    shareOfTotal: string;
  };
};

export default function SpendByPlatform({
  data,
  currencyFormatter,
  labels,
}: SpendByPlatformProps) {
  const copy = labels ?? {
    title: "Spend by Platform",
    shareOfTotal: "% of total",
  };
  const sorted = [...data].sort((a, b) => b.spend - a.spend);
  const total = sorted.reduce((sum, item) => sum + item.spend, 0);
  const chartData = sorted.map((item) => ({
    platform: item.name,
    spend: item.spend,
    color: item.color,
  }));

  return (
    <section className="card-surface p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>
      <div className="h-[320px]">
        <ResponsiveBar
          data={chartData}
          keys={["spend"]}
          indexBy="platform"
          layout="horizontal"
          margin={{ top: 10, right: 90, bottom: 20, left: 110 }}
          valueScale={{ type: "linear" }}
          indexScale={{ type: "band", round: true }}
          colors={({ data: row }) => String(row.color)}
          borderRadius={8}
          labelSkipWidth={12}
          labelSkipHeight={12}
          labelTextColor="#0f172a"
          animate
          motionConfig="wobbly"
          axisTop={null}
          axisRight={null}
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            format: (value) => currencyFormatter(Number(value)),
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 10,
          }}
          tooltip={({ value, indexValue, color }) => {
            const spend = Number(value);
            const share = total > 0 ? (spend / total) * 100 : 0;
            return (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold text-slate-900" style={{ color }}>
                  {String(indexValue)}
                </p>
                <p className="text-slate-700">{currencyFormatter(spend)}</p>
                <p className="text-slate-500">{share.toFixed(1)}{copy.shareOfTotal}</p>
              </div>
            );
          }}
        />
      </div>
    </section>
  );
}

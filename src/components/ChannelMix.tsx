"use client";

import { useMemo, useState } from "react";
import { ResponsivePie } from "@nivo/pie";
import type { PlatformStats } from "@/lib/types";

type ChannelMixProps = {
  data: PlatformStats[];
  currencyFormatter: (value: number) => string;
};

export default function ChannelMix({ data, currencyFormatter }: ChannelMixProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const pieData = useMemo(() => {
    return data
      .filter((item) => item.spend > 0)
      .map((item) => ({
        id: item.id,
        label: item.name,
        value: item.spend,
        color: item.color,
        impressions: item.impressions,
        clicks: item.clicks,
      }));
  }, [data]);

  const totalSpend = pieData.reduce((sum, item) => sum + Number(item.value), 0);
  const active =
    pieData.length === 0
      ? null
      : pieData.find((item) => item.id === activeId) ??
        pieData.reduce((max, item) => (item.value > max.value ? item : max), pieData[0]);

  if (pieData.length === 0) {
    return (
      <section className="card-surface p-5">
        <h3 className="mb-4 text-base font-semibold text-slate-900">Channel Mix</h3>
        <div className="flex h-[320px] items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-sm text-slate-500">
          No data for selected platforms
        </div>
      </section>
    );
  }

  return (
    <section className="card-surface p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">Channel Mix</h3>

      <div className="relative h-[320px]">
        <ResponsivePie
          data={pieData}
          margin={{ top: 10, right: 20, bottom: 20, left: 20 }}
          innerRadius={0.55}
          padAngle={0.7}
          cornerRadius={4}
          activeOuterRadiusOffset={8}
          colors={({ data: item }) => String(item.color)}
          borderColor={{ from: "color", modifiers: [["darker", 0.2]] }}
          arcLabel={(arc) => `${arc.label} ${arc.formattedValue}`}
          arcLabelsSkipAngle={7}
          arcLabelsTextColor="#0f172a"
          onClick={(datum) => setActiveId(String(datum.id))}
          animate
          motionConfig="wobbly"
          tooltip={({ datum }) => (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
              <p className="font-semibold text-slate-900">{String(datum.label)}</p>
              <p className="text-slate-700">{currencyFormatter(Number(datum.value))}</p>
            </div>
          )}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Total Spend</p>
          <p className="font-mono text-xl font-semibold text-slate-900">
            {currencyFormatter(totalSpend)}
          </p>
        </div>
      </div>

      {active ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-slate-900">{active.label}</p>
          <p className="text-slate-600">Spend: {currencyFormatter(Number(active.value))}</p>
          <p className="text-slate-600">Impressions: {active.impressions.toLocaleString("en-US")}</p>
          <p className="text-slate-600">Clicks: {active.clicks.toLocaleString("en-US")}</p>
        </div>
      ) : null}
    </section>
  );
}

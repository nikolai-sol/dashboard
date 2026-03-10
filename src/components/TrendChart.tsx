"use client";

import { useMemo, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import type { TimeSeriesPoint } from "@/lib/types";

type MetricType = "impressions" | "clicks" | "spend";

type TrendChartProps = {
  points: TimeSeriesPoint[];
  selectedPlatforms: string[];
  onTogglePlatform: (platformId: string) => void;
  currencyFormatter: (value: number) => string;
};

function formatMetric(metric: MetricType, value: number, currencyFormatter: (v: number) => string) {
  if (metric === "spend") {
    return currencyFormatter(value);
  }
  return value.toLocaleString("en-US");
}

export default function TrendChart({
  points,
  selectedPlatforms,
  onTogglePlatform,
  currencyFormatter,
}: TrendChartProps) {
  const [metric, setMetric] = useState<MetricType>("impressions");

  const dates = useMemo(
    () => [...new Set(points.map((point) => point.date))].sort((a, b) => a.localeCompare(b)),
    [points],
  );

  const data = useMemo(() => {
    return selectedPlatforms
      .map((platformId) => {
        const platformPoints = points.filter((point) => point.platform === platformId);
        const byDate = new Map(platformPoints.map((point) => [point.date, point]));
        const series = dates.map((date) => {
          const row = byDate.get(date);
          return {
            x: date,
            y: row ? Number(row[metric]) : 0,
          };
        });
        return {
          id: PLATFORM_COLORS[platformId]?.label ?? platformId,
          color: PLATFORM_COLORS[platformId]?.hex ?? "#64748b",
          platformId,
          data: series,
        };
      })
      .filter((item) => item.data.some((point) => point.y > 0));
  }, [dates, metric, points, selectedPlatforms]);

  return (
    <section className="card-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900">Trend by Day</h3>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {(["impressions", "clicks", "spend"] as MetricType[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMetric(item)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                item === metric
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[360px]">
        <ResponsiveLine
          data={data}
          margin={{ top: 20, right: 20, bottom: 70, left: 60 }}
          xScale={{ type: "point" }}
          yScale={{ type: "linear", min: 0, max: "auto", stacked: false, reverse: false }}
          axisTop={null}
          axisRight={null}
          axisBottom={{
            tickValues: dates.filter((_, idx) => idx % 12 === 0),
            tickSize: 0,
            tickPadding: 8,
            format: (value) => String(value).slice(5),
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
            format: (value) => {
              const n = Number(value);
              if (metric === "spend") {
                return currencyFormatter(n);
              }
              if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
              if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
              return `${n}`;
            },
          }}
          colors={({ color }) => color as string}
          lineWidth={2.5}
          pointSize={4}
          pointBorderWidth={1}
          pointBorderColor={{ from: "serieColor" }}
          enableArea
          areaOpacity={0.08}
          useMesh
          curve="monotoneX"
          animate
          motionConfig="gentle"
          tooltip={({ point }) => {
            const label = String(point.data.x);
            const value = Number(point.data.y);
            return (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold text-slate-900">{point.seriesId}</p>
                <p className="text-slate-500">{label}</p>
                <p className="text-slate-700">{formatMetric(metric, value, currencyFormatter)}</p>
              </div>
            );
          }}
          theme={{
            axis: {
              ticks: { text: { fill: "#64748b", fontSize: 11 } },
            },
            grid: { line: { stroke: "#e2e8f0", strokeDasharray: "4 4" } },
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {selectedPlatforms.map((platformId) => {
          const meta = PLATFORM_COLORS[platformId];
          if (!meta) return null;
          return (
            <button
              key={platformId}
              type="button"
              onClick={() => onTogglePlatform(platformId)}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.hex }} />
              {meta.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

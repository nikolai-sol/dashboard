"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveBar } from "@nivo/bar";
import type { PlatformStats } from "@/lib/types";
import { PLATFORM_COLORS } from "@/lib/platform-colors";

type SpendByPlatformProps = {
  data: PlatformStats[];
  currencyFormatter: (value: number) => string;
  pdfMode?: boolean;
  forceMobile?: boolean;
  locale?: string;
  labels?: {
    title: string;
    shareOfTotal: string;
    spend: string;
    impressions: string;
    clicks: string;
  };
};

function resolveBrandColor(platformId: string, fallback: string) {
  return PLATFORM_COLORS[platformId]?.hex ?? fallback;
}

function compactCurrencyTick(
  value: number,
  currencyFormatter: (value: number) => string,
  locale: string,
) {
  const sample = currencyFormatter(0);
  const match = sample.match(/^([^\d-]*)(?:-?[\d\s.,\u00A0\u202F]+)([^\d]*)$/u);
  const prefix = match?.[1] ?? "";
  const suffix = match?.[2] ?? "";
  const compactNumber = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
  return `${prefix}${compactNumber}${suffix}`;
}

export default function SpendByPlatform({
  data,
  currencyFormatter,
  pdfMode = false,
  forceMobile = false,
  locale = "en-US",
  labels,
}: SpendByPlatformProps) {
  const copy = labels ?? {
    title: "Spend by Platform",
    shareOfTotal: "% of total",
    spend: "Spend",
    impressions: "Impressions",
    clicks: "Clicks",
  };

  const sorted = useMemo(() => [...data].sort((a, b) => b.spend - a.spend), [data]);
  const total = useMemo(() => sorted.reduce((sum, item) => sum + item.spend, 0), [sorted]);
  const [viewportWidth, setViewportWidth] = useState(1280);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const isMobile = forceMobile || viewportWidth < 640;
  const chartMargin = isMobile
    ? { top: 10, right: 10, bottom: 28, left: 94 }
    : { top: 10, right: 90, bottom: 20, left: 110 };
  const axisTickFormatter = (value: number) =>
    isMobile ? compactCurrencyTick(Number(value), currencyFormatter, locale) : currencyFormatter(Number(value));
  const chartData = useMemo(
    () =>
      sorted.map((item) => ({
        id: item.id,
        platform: item.name,
        spend: Number(item.spend.toFixed(2)),
        color: resolveBrandColor(item.id, item.color),
        impressions: item.impressions,
        clicks: item.clicks,
      })),
    [sorted],
  );

  return (
    <section className="card-surface p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>
      <div className="h-[320px]">
        <ResponsiveBar
          data={chartData}
          keys={["spend"]}
          indexBy="platform"
          layout="horizontal"
          margin={chartMargin}
          valueScale={{ type: "linear" }}
          indexScale={{ type: "band", round: true }}
          colors={({ data: row }) => String(row.color)}
          colorBy="indexValue"
          borderRadius={8}
          labelSkipWidth={isMobile ? 42 : 12}
          labelSkipHeight={12}
          label={(item) => currencyFormatter(Number(item.value))}
          labelTextColor="#FFFFFF"
          animate={!pdfMode}
          motionConfig={pdfMode ? "default" : "gentle"}
          axisTop={null}
          axisRight={null}
          axisBottom={{
            tickSize: 0,
            tickPadding: isMobile ? 4 : 8,
            tickValues: isMobile ? 4 : undefined,
            format: axisTickFormatter,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: isMobile ? 8 : 10,
          }}
          tooltip={({ value, indexValue, color }) => {
            const spend = Number(value);
            const share = total > 0 ? (spend / total) * 100 : 0;
            const row = chartData.find((item) => item.platform === String(indexValue));
            return (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-[0_12px_32px_rgba(15,23,42,0.15)]">
                <p className="font-semibold text-slate-900" style={{ color }}>
                  {String(indexValue)}
                </p>
                <div className="space-y-0.5 text-slate-700">
                  <p>
                    {copy.spend}: {currencyFormatter(spend)}
                  </p>
                  <p>
                    {share.toFixed(1)} {copy.shareOfTotal}
                  </p>
                  <p>
                    {copy.impressions}: {(row?.impressions ?? 0).toLocaleString(locale)}
                  </p>
                  <p>
                    {copy.clicks}: {(row?.clicks ?? 0).toLocaleString(locale)}
                  </p>
                </div>
              </div>
            );
          }}
          theme={{
            axis: {
              ticks: {
                text: {
                  fill: "#64748B",
                  fontSize: isMobile ? 8 : 12,
                },
              },
            },
            labels: {
              text: {
                fontSize: isMobile ? 9 : 11,
                fontWeight: 700,
              },
            },
            tooltip: {
              container: {
                background: "transparent",
                boxShadow: "none",
              },
            },
          }}
        />
      </div>
    </section>
  );
}

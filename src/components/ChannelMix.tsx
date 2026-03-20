"use client";

import { useMemo } from "react";
import { ResponsivePie, type PieCustomLayerProps, type PieSvgProps } from "@nivo/pie";
import type { ComputedDatum } from "@nivo/pie";
import type { PlatformStats } from "@/lib/types";
import { PLATFORM_COLORS } from "@/lib/platform-colors";

type ChannelMixProps = {
  data: PlatformStats[];
  currencyFormatter: (value: number) => string;
  locale?: string;
  pdfMode?: boolean;
  labels?: {
    title: string;
    noData: string;
    totalSpend: string;
    spend: string;
    impressions: string;
    clicks: string;
  };
};

type PieDatum = {
  id: string;
  label: string;
  value: number;
  color: string;
  impressions: number;
  clicks: number;
  sharePct: number;
};

const OTHER_ID = "other";
const OTHER_COLOR = "#94A3B8";

const PLATFORM_BADGE_LABELS: Record<string, string> = {
  linkedin: "in",
  reddit: "rd",
  google: "go",
  google_ads: "go",
  vk: "vk",
  meta: "me",
  yandex: "ya",
  x: "x",
  git: "gi",
  dv360: "dv",
  hybrid: "hy",
  telegram: "tg",
  other: "…",
};

function resolveBrandColor(platformId: string, fallbackColor: string) {
  return PLATFORM_COLORS[platformId]?.hex ?? fallbackColor;
}

function buildPieData(data: PlatformStats[]): PieDatum[] {
  const base = data
    .filter((item) => item.spend > 0)
    .map((item) => ({
      id: item.id,
      label: item.name,
      value: Number(item.spend),
      color: resolveBrandColor(item.id, item.color),
      impressions: item.impressions,
      clicks: item.clicks,
      sharePct: 0,
    }))
    .sort((a, b) => b.value - a.value);

  const total = base.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];

  const major: PieDatum[] = [];
  let otherValue = 0;
  let otherImpressions = 0;
  let otherClicks = 0;

  for (const item of base) {
    const sharePct = (item.value / total) * 100;
    if (sharePct < 3) {
      otherValue += item.value;
      otherImpressions += item.impressions;
      otherClicks += item.clicks;
      continue;
    }
    major.push({ ...item, sharePct: Number(sharePct.toFixed(2)) });
  }

  if (otherValue > 0) {
    major.push({
      id: OTHER_ID,
      label: "Другие",
      value: Number(otherValue.toFixed(2)),
      color: OTHER_COLOR,
      impressions: otherImpressions,
      clicks: otherClicks,
      sharePct: Number(((otherValue / total) * 100).toFixed(2)),
    });
  }

  return major.sort((a, b) => b.value - a.value);
}

function badgeText(id: string, label: string) {
  const known = PLATFORM_BADGE_LABELS[id];
  if (known) return known.toUpperCase();
  const trimmed = label.trim();
  if (!trimmed) return "•";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function CenterLayer({
  centerX,
  centerY,
  totalSpend,
  currencyFormatter,
  labels,
}: {
  centerX: number;
  centerY: number;
  totalSpend: number;
  currencyFormatter: (value: number) => string;
  labels: ChannelMixProps["labels"];
}) {
  const copy = labels ?? {
    title: "Channel Mix",
    noData: "No data for selected platforms",
    totalSpend: "TOTAL SPEND",
    spend: "Spend",
    impressions: "Impressions",
    clicks: "Clicks",
  };
  const totalLabel = currencyFormatter(totalSpend);
  const amountFontSize = totalLabel.length >= 10 ? 18 : totalLabel.length >= 8 ? 20 : 22;

  return (
    <g transform={`translate(${centerX}, ${centerY})`}>
      <text
        textAnchor="middle"
        dominantBaseline="central"
        y={-12}
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fill: "#64748B",
        }}
      >
        {copy.totalSpend}
      </text>
      <text
        textAnchor="middle"
        dominantBaseline="central"
        y={12}
        style={{
          fontSize: amountFontSize,
          fontWeight: 700,
          fill: "#0F172A",
        }}
      >
        {totalLabel}
      </text>
    </g>
  );
}

function CustomTooltip({
  datum,
  currencyFormatter,
  locale,
  labels,
}: {
  datum: ComputedDatum<PieDatum>;
  currencyFormatter: (value: number) => string;
  locale: string;
  labels: ChannelMixProps["labels"];
}) {
  const copy = labels ?? {
    title: "Channel Mix",
    noData: "No data for selected platforms",
    totalSpend: "Total Spend",
    spend: "Spend",
    impressions: "Impressions",
    clicks: "Clicks",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-[0_12px_32px_rgba(15,23,42,0.15)]">
      <p className="mb-1 font-semibold text-slate-900">{datum.data.label}</p>
      <div className="space-y-0.5 text-slate-700">
        <p>
          {copy.spend}: {currencyFormatter(Number(datum.value))}
        </p>
        <p>{datum.data.sharePct.toFixed(1)}%</p>
        <p>
          {copy.impressions}: {datum.data.impressions.toLocaleString(locale)}
        </p>
        <p>
          {copy.clicks}: {datum.data.clicks.toLocaleString(locale)}
        </p>
      </div>
    </div>
  );
}

export default function ChannelMix({
  data,
  currencyFormatter,
  locale = "en-US",
  pdfMode = false,
  labels,
}: ChannelMixProps) {
  const copy = labels ?? {
    title: "Channel Mix",
    noData: "No data for selected platforms",
    totalSpend: "TOTAL SPEND",
    spend: "Spend",
    impressions: "Impressions",
    clicks: "Clicks",
  };

  const pieData = useMemo(() => buildPieData(data), [data]);
  const totalSpend = useMemo(
    () => pieData.reduce((sum, item) => sum + Number(item.value), 0),
    [pieData],
  );

  if (pieData.length === 0) {
    return (
      <section className="card-surface p-5">
        <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>
        <div className="flex h-[360px] items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-sm text-slate-500">
          {copy.noData}
        </div>
      </section>
    );
  }

  const layers: PieSvgProps<PieDatum>["layers"] = [
    "arcs",
    (props: PieCustomLayerProps<PieDatum>) => (
      <CenterLayer
        centerX={props.centerX}
        centerY={props.centerY}
        totalSpend={totalSpend}
        currencyFormatter={currencyFormatter}
        labels={copy}
      />
    ),
  ];

  return (
    <section className="card-surface p-5">
      <h3 className="mb-4 text-base font-semibold text-slate-900">{copy.title}</h3>

      <div className="relative h-[320px]">
        <ResponsivePie
          data={pieData}
          margin={{ top: 12, right: 20, bottom: 20, left: 20 }}
          sortByValue
          innerRadius={0.55}
          padAngle={1.5}
          cornerRadius={4}
          activeOuterRadiusOffset={6}
          colors={({ data: item }) => String(item.color)}
          borderWidth={1}
          borderColor={{ from: "color", modifiers: [["darker", 0.18]] }}
          arcLabel={() => ""}
          enableArcLabels={false}
          arcLabelsSkipAngle={360}
          arcLabelsTextColor="#FFFFFF"
          enableArcLinkLabels={false}
          arcLinkLabelsSkipAngle={360}
          tooltip={(input) => (
            <CustomTooltip
              datum={input.datum as ComputedDatum<PieDatum>}
              currencyFormatter={currencyFormatter}
              locale={locale}
              labels={copy}
            />
          )}
          animate={!pdfMode}
          motionConfig={pdfMode ? "default" : "gentle"}
          layers={layers}
          theme={{
            labels: {
              text: {
                fontSize: 11,
                fontWeight: 700,
              },
            },
            legends: {
              text: {
                fontSize: 12,
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pieData.map((item) => (
          <div
            key={item.id}
            title={item.label}
            aria-label={item.label}
            className="flex h-8 min-w-10 items-center justify-center rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-700 shadow-sm"
          >
            <span
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span>{badgeText(item.id, item.label)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

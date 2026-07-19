"use client";

import { useMemo, useState } from "react";
import { NaturalEarth } from "@visx/geo";
import type { ZarukuSeoMetricRow } from "@/lib/types";
import {
  RUSSIA_FEATURE,
  selectRussiaDemandCities,
  type RussiaDemandCity,
} from "@/components/zaruku-russia-map-data";
import { separateMapMarkers } from "@/components/zaruku-russia-map-layout";

type Props = {
  rows: ZarukuSeoMetricRow[];
  locale: string;
};

const WIDTH = 1000;
const HEIGHT = 430;
const LABEL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-68, 38],
  [-100, -36],
  [-90, 58],
  [30, -14],
  [26, -28],
];

function formatNumber(value: number, locale: string) {
  return Math.round(value).toLocaleString(locale);
}

function formatPercent(value: number | null | undefined, locale: string, digits: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })}%`;
}

function markerRadius(visits: number, maxVisits: number) {
  return 5 + Math.sqrt(visits / Math.max(1, maxVisits)) * 14;
}

function CityTooltip({ city, locale }: { city: RussiaDemandCity; locale: string }) {
  return (
    <div className="pointer-events-none absolute right-4 top-4 z-10 min-w-44 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm" role="status">
      <div className="text-sm font-semibold text-slate-800">{city.row.label}</div>
      <div className="mt-1 flex items-center justify-between gap-5 text-xs text-slate-500">
        <span>{formatNumber(city.row.visits, locale)} визитов</span>
        <span>{formatPercent(city.row.share, locale, 1)}</span>
      </div>
    </div>
  );
}

export default function ZarukuRussiaDemandMap({ rows, locale }: Props) {
  const cities = useMemo(() => selectRussiaDemandCities(rows), [rows]);
  const [activeCityLabel, setActiveCityLabel] = useState<string | null>(null);
  const activeCity = cities.find((city) => city.row.label === activeCityLabel) ?? null;

  if (rows.length === 0) {
    return <div className="rounded-md bg-slate-50 px-4 py-5 text-sm text-slate-500">Нет данных по городам для /map за выбранный период.</div>;
  }

  if (cities.length === 0) {
    return <div className="rounded-md bg-slate-50 px-4 py-5 text-sm text-slate-500">Полученные названия городов нельзя разместить на карте России.</div>;
  }

  const maxVisits = Math.max(1, ...cities.map((city) => city.row.visits));
  const unplacedCount = rows.length - cities.length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(270px,0.55fr)]">
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>Россия · визиты на раздел `/map/`</span>
          <span>размер круга = визиты</span>
        </div>
        <p className="mb-1 max-w-3xl text-xs leading-relaxed text-slate-500">
          Это не весь гео-трафик сайта: карта показывает только города, откуда начались визиты на раздел `/map/` с картой организаций.
        </p>
        {unplacedCount > 0 ? (
          <p className="text-[11px] text-slate-400">Не размещено на карте: {unplacedCount} {unplacedCount === 1 ? "город" : "города"} без координат РФ.</p>
        ) : null}
        {activeCity ? <CityTooltip city={activeCity} locale={locale} /> : null}
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Географическая карта России с городами и числом визитов на /map/"
          className="mt-2 h-[350px] w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <NaturalEarth
            data={[RUSSIA_FEATURE]}
            fitExtent={[[[30, 28], [970, 402]], RUSSIA_FEATURE]}
          >
            {({ features, projection }) => {
              const projectedCities = cities.flatMap((city, index) => {
                const point = projection([...city.coordinates]);
                if (!point) return [];
                return [{
                  city,
                  index,
                  x: point[0],
                  y: point[1],
                  radius: markerRadius(city.row.visits, maxVisits),
                }];
              });
              const markerLayouts = separateMapMarkers(
                projectedCities.map(({ city, x, y, radius }) => ({ id: city.row.label, x, y, radius })),
                { width: WIDTH, height: HEIGHT, gap: 5 },
              );

              return (
                <>
                <path
                  d={features[0]?.path ?? ""}
                  fill="#f8fafc"
                  stroke="#94a3b8"
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                />
                {projectedCities.map(({ city, index }, markerIndex) => {
                  const marker = markerLayouts[markerIndex];
                  const cx = marker.x;
                  const cy = marker.y;
                  const radius = marker.radius;
                  const labelOffset = LABEL_OFFSETS[index] ?? [26, -20];
                  const labelX = cx + labelOffset[0];
                  const labelY = cy + labelOffset[1];
                  const isActive = city.row.label === activeCityLabel;
                  const isDisplaced = Math.hypot(cx - marker.anchorX, cy - marker.anchorY) > 2;

                  return (
                    <g
                      key={city.row.label}
                      role="button"
                      tabIndex={0}
                      aria-label={`${city.row.label}: ${formatNumber(city.row.visits, locale)} визитов, ${formatPercent(city.row.share, locale, 1)}`}
                      onPointerEnter={() => setActiveCityLabel(city.row.label)}
                      onPointerLeave={() => setActiveCityLabel(null)}
                      onFocus={() => setActiveCityLabel(city.row.label)}
                      onBlur={() => setActiveCityLabel(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setActiveCityLabel(null);
                      }}
                      className="cursor-pointer outline-none"
                    >
                      <title>{`${city.row.label}: ${formatNumber(city.row.visits, locale)} визитов, ${formatPercent(city.row.share, locale, 1)}`}</title>
                      {isDisplaced ? (
                        <>
                          <line
                            x1={marker.anchorX}
                            y1={marker.anchorY}
                            x2={cx}
                            y2={cy}
                            stroke="#64748b"
                            strokeWidth={1}
                            strokeDasharray="3 3"
                            opacity={0.5}
                          />
                          <circle cx={marker.anchorX} cy={marker.anchorY} r={2.5} fill="#64748b" opacity={0.65} />
                        </>
                      ) : null}
                      <circle cx={cx} cy={cy} r={radius + 5} fill="#14b8a6" opacity={isActive ? 0.24 : 0.12} />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill="#0d9488"
                        opacity={isActive ? 0.95 : 0.76}
                        stroke="#ffffff"
                        strokeWidth={2.5}
                      />
                      {city.showLabel ? (
                        <g className="pointer-events-none">
                          <line x1={cx} y1={cy} x2={labelX} y2={labelY + 3} stroke="#64748b" strokeWidth={1} opacity={0.55} />
                          <text x={labelX} y={labelY} className="fill-slate-700 text-[14px] font-semibold" paintOrder="stroke" stroke="#ffffff" strokeWidth={4}>
                            {city.row.label}
                          </text>
                          <text x={labelX} y={labelY + 17} className="fill-slate-500 text-[12px]" paintOrder="stroke" stroke="#ffffff" strokeWidth={3}>
                            {formatNumber(city.row.visits, locale)} · {formatPercent(city.row.share, locale, 1)}
                          </text>
                        </g>
                      ) : null}
                    </g>
                  );
                })}
                </>
              );
            }}
          </NaturalEarth>
        </svg>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
        <div className="mb-3 text-sm font-semibold text-slate-800">Города · визиты на /map/</div>
        <div className="max-h-[26rem] space-y-2 overflow-auto pr-1">
          {cities.map((city, index) => (
            <button
              type="button"
              key={`${city.row.label}-legend-${index}`}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg bg-white px-3 py-2 text-left shadow-sm shadow-slate-100 transition hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              onPointerEnter={() => setActiveCityLabel(city.row.label)}
              onPointerLeave={() => setActiveCityLabel(null)}
              onFocus={() => setActiveCityLabel(city.row.label)}
              onBlur={() => setActiveCityLabel(null)}
            >
              <span className="min-w-0 truncate text-sm font-medium text-slate-700" title={city.row.label}>{city.row.label}</span>
              <span className="text-right">
                <span className="block text-sm font-semibold text-slate-800">{formatNumber(city.row.visits, locale)}</span>
                <span className="block text-xs text-slate-500">{formatPercent(city.row.share, locale, 1)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

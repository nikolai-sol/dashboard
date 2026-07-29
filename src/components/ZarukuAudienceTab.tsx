"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ZarukuPanelState, { isZarukuDatasetVisible } from "@/components/ZarukuPanelState";
import ZarukuRussiaDemandMap from "@/components/ZarukuRussiaDemandMap";
import ZarukuTableFrame from "@/components/ZarukuTableFrame";
import type { ZarukuDatasetKey, ZarukuDatasetMeta, ZarukuSeoData, ZarukuSeoMetricRow } from "@/lib/types";

type Props = { data: ZarukuSeoData; locale?: string };

const AUDIENCE_DATASET_KEYS = [
  "map_city_demand",
  "devices",
  "source_devices",
  "browsers",
  "operating_systems",
  "age",
  "gender",
  "interests",
] as const satisfies readonly ZarukuDatasetKey[];

export function isZarukuAudienceVisible(data: Pick<ZarukuSeoData, "dataset_meta">): boolean {
  return AUDIENCE_DATASET_KEYS.some((key) => isZarukuDatasetVisible(data.dataset_meta[key].state));
}

function formatNumber(value: number, locale: string) {
  return Math.round(value).toLocaleString(locale);
}

function formatPercent(value: number | null | undefined, locale: string) {
  return value == null || !Number.isFinite(value) ? "" : `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

export function formatAudienceUsers(row: ZarukuSeoMetricRow, meta: ZarukuDatasetMeta, locale: string) {
  return meta.metrics.users && row.users_available !== false ? formatNumber(row.users, locale) : "—";
}

function AudiencePanel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card-surface zaruku-panel">
      <header className="zaruku-panel-header"><div><h3 className="text-base font-semibold text-slate-900">{title}</h3>{note ? <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{note}</p> : null}</div></header>
      <div className="zaruku-panel-body">{children}</div>
    </section>
  );
}

function AudienceBars({ rows, meta, locale }: { rows: ZarukuSeoMetricRow[]; meta: ZarukuDatasetMeta; locale: string }) {
  const max = Math.max(1, ...rows.map((row) => row.visits));
  return (
    <ZarukuPanelState meta={meta} hasRows={rows.length > 0}>
      <div className="space-y-2.5">
        {rows.map((row, index) => (
          <AudienceBarRow
            key={`${row.label}-${row.secondary_label ?? ""}-${index}`}
            row={row}
            locale={locale}
            max={max}
          />
        ))}
      </div>
    </ZarukuPanelState>
  );
}

function AudienceBarRow({ row, locale, max }: { row: ZarukuSeoMetricRow; locale: string; max: number }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [showPercentInside, setShowPercentInside] = useState(true);
  const share = row.share != null && Number.isFinite(row.share) ? row.share : (Math.max(0, row.visits) / max) * 100;
  const sharePercent = Math.max(0, Math.min(100, share));
  const percentText = formatPercent(sharePercent, locale);
  const fillPercent = Math.max(4, sharePercent);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const label = labelRef.current;
    if (!track || !label) return;

    const evaluate = () => {
      const trackWidth = Math.max(1, track.clientWidth);
      const fillWidth = (fillPercent / 100) * trackWidth;
      const labelWidth = Math.ceil(label.getBoundingClientRect().width);
      const requiredGap = 8;
      setShowPercentInside(fillWidth >= labelWidth + requiredGap);
    };

    evaluate();
    const observer = new ResizeObserver(evaluate);
    observer.observe(track);
    return () => observer.disconnect();
  }, [fillPercent, percentText]);

  return (
    <div className="grid grid-cols-[minmax(92px,128px)_minmax(84px,1fr)_64px] items-center gap-2.5 sm:grid-cols-[minmax(110px,160px)_minmax(0,1fr)_72px] sm:gap-3">
      <div className="truncate text-sm text-slate-600" title={row.label}>{row.label}</div>
      <div ref={trackRef} className="relative h-6 overflow-visible rounded-md bg-slate-50">
        <div className="absolute inset-y-0 left-0 overflow-hidden rounded-md bg-teal-600" style={{ width: `${fillPercent}%` }}>
          <span
            ref={labelRef}
            className="pointer-events-none absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center whitespace-nowrap px-2 text-xs font-medium opacity-0"
            aria-hidden="true"
          >
            {percentText}
          </span>
          {showPercentInside ? (
            <span className="pointer-events-none absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center justify-center whitespace-nowrap px-2 text-xs font-medium text-white">
              {percentText}
            </span>
          ) : null}
        </div>
        {!showPercentInside ? (
          <span
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-medium text-slate-600"
            style={{ left: `calc(${fillPercent}% + 6px)` }}
          >
            {percentText}
          </span>
        ) : null}
      </div>
      <div className="text-right text-sm tabular-nums text-slate-500">{formatNumber(row.visits, locale)}</div>
    </div>
  );
}

function SourceDeviceTable({ rows, meta, locale }: { rows: ZarukuSeoMetricRow[]; meta: ZarukuDatasetMeta; locale: string }) {
  return (
    <ZarukuPanelState meta={meta} hasRows={rows.length > 0}>
      <ZarukuTableFrame mode="standard" label="Источники трафика по устройствам">
        <table className="zaruku-table min-w-[560px]">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="px-4 py-2.5 font-medium">Источник</th>
              <th className="px-4 py-2.5 font-medium">Устройство</th>
              <th className="px-4 py-2.5 text-right font-medium">Визиты</th>
              <th className="px-4 py-2.5 text-right font-medium">Пользователи</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, 20).map((row, index) => (
              <tr key={`${row.label}-${row.secondary_label}-${index}`}>
                <td className="px-4 py-2.5 font-medium text-slate-700">{row.label}</td>
                <td className="px-4 py-2.5 text-slate-500">{row.secondary_label ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.visits, locale)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatAudienceUsers(row, meta, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ZarukuTableFrame>
    </ZarukuPanelState>
  );
}

export default function ZarukuAudienceTab({ data, locale = "ru-RU" }: Props) {
  return (
    <div className="zaruku-section-stack">
      <AudiencePanel title="Города и каталог онкоцентров" note="Продуктовый срез город × /map/: показывает, где пользователи входят в каталог онкоцентров, а не общую демографию сайта.">
        <ZarukuPanelState meta={data.dataset_meta.map_city_demand} hasRows={data.map_city_demand.length > 0}>
          <ZarukuRussiaDemandMap rows={data.map_city_demand} locale={locale} />
        </ZarukuPanelState>
      </AudiencePanel>

      <AudiencePanel title="Устройства" note="Сначала общее распределение по устройствам, затем связь источника трафика с устройством.">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2"><div className="min-w-0"><h4 className="mb-3 text-sm font-semibold text-slate-800">Типы устройств</h4><AudienceBars rows={data.devices} meta={data.dataset_meta.devices} locale={locale} /></div><div className="min-w-0"><h4 className="mb-3 text-sm font-semibold text-slate-800">Источник × устройство</h4><SourceDeviceTable rows={data.source_devices} meta={data.dataset_meta.source_devices} locale={locale} /></div></div>
      </AudiencePanel>

      <AudiencePanel title="Техническая среда" note="Браузеры и операционные системы вынесены во второй уровень детализации.">
        <div className="grid gap-4 lg:grid-cols-2"><details className="rounded-lg border border-slate-200 p-4" open><summary className="cursor-pointer text-sm font-semibold text-slate-800">Браузеры</summary><div className="mt-4"><AudienceBars rows={data.browsers.slice(0, 10)} meta={data.dataset_meta.browsers} locale={locale} /></div></details><details className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Операционные системы</summary><div className="mt-4"><AudienceBars rows={data.operating_systems.slice(0, 10)} meta={data.dataset_meta.operating_systems} locale={locale} /></div></details></div>
      </AudiencePanel>

      <AudiencePanel title="Демография и интересы" note="Оценочные срезы Яндекс Метрики показываются только при доступном источнике и не используются как география продукта.">
        <div className="grid gap-5 xl:grid-cols-2"><div><h4 className="mb-3 text-sm font-semibold text-slate-800">Возраст</h4><AudienceBars rows={data.age} meta={data.dataset_meta.age} locale={locale} /></div><div><h4 className="mb-3 text-sm font-semibold text-slate-800">Пол</h4><AudienceBars rows={data.gender} meta={data.dataset_meta.gender} locale={locale} /></div></div><div className="mt-5 border-t border-slate-100 pt-5"><h4 className="mb-3 text-sm font-semibold text-slate-800">Интересы</h4><AudienceBars rows={data.interests.slice(0, 12)} meta={data.dataset_meta.interests} locale={locale} /></div>
      </AudiencePanel>
    </div>
  );
}

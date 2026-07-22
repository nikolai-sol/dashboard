"use client";

import { useMemo, useState } from "react";
import type { UnifiedSeoPageRow } from "@/components/zaruku-seo-workspace";
import { filterAndPaginate } from "@/components/zaruku-table-pagination";
import { resolveZarukuContentUrl } from "@/lib/zaruku-url";

const PAGE_SIZE = 50;
type SeoPageSortKey = "google_impressions" | "webmaster_impressions" | "visits" | "label";
type SeoPageSort = { key: SeoPageSortKey; direction: "asc" | "desc" };

type Props = {
  rows: UnifiedSeoPageRow[];
  seoWeek: string | null;
  sourceWeeks: {
    google: string | null;
    webmaster: string | null;
    seoOs: string | null;
  };
  sourceAvailability?: { google: boolean; webmaster: boolean; seoOs: boolean };
  trafficPeriod: { from: string; to: string };
  locale?: string;
};

function formatNumber(value: number | null | undefined, locale: string): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : Math.round(value).toLocaleString(locale);
}

function formatDecimal(value: number | null | undefined, locale: string, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString(locale, { maximumFractionDigits: digits });
}

function formatPercent(value: number | null | undefined, locale: string): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${formatDecimal(value, locale)}%`;
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value, "https://zaruku.ru");
    return url.pathname || "/";
  } catch {
    return value;
  }
}

function SourceHeading({ label, period, dot }: { label: string; period: string | null; dot: string }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
      <span className="font-normal normal-case text-slate-400">{period ?? "нет данных"}</span>
    </div>
  );
}

function PageSortButton({ label, sortKey, sort, onChange }: { label: string; sortKey: SeoPageSortKey; sort: SeoPageSort; onChange: (key: SeoPageSortKey) => void }) {
  const active = sort.key === sortKey;
  return (
    <button type="button" aria-pressed={active} onClick={() => onChange(sortKey)} className={active ? "rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white" : "rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600"}>
      {label}{active ? (sort.direction === "desc" ? " ↓" : " ↑") : ""}
    </button>
  );
}

export default function ZarukuSeoPageComparison({ rows, seoWeek, sourceWeeks, sourceAvailability = { google: true, webmaster: true, seoOs: true }, trafficPeriod, locale = "ru-RU" }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SeoPageSort>({ key: "visits", direction: "desc" });
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const factor = sort.direction === "asc" ? 1 : -1;
    const values: Record<Exclude<SeoPageSortKey, "label">, (row: UnifiedSeoPageRow) => number> = {
      google_impressions: (row) => row.google?.impressions ?? -1,
      webmaster_impressions: (row) => row.webmaster?.impressions ?? -1,
      visits: (row) => row.post_click?.visits ?? -1,
    };
    if (sort.key === "label") return factor * left.label.localeCompare(right.label, locale);
    return factor * (values[sort.key](left) - values[sort.key](right)) || left.label.localeCompare(right.label, locale);
  }), [locale, rows, sort]);
  const paginated = useMemo(
    () => filterAndPaginate(sortedRows, query, page, PAGE_SIZE, (row) => `${row.label} ${row.url}`),
    [page, query, sortedRows],
  );
  const changeQuery = (value: string) => { setQuery(value); setPage(1); };
  const changeSort = (key: SeoPageSortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "label" ? "asc" : "desc" });
    setPage(1);
  };
  const unavailableSources = [
    !sourceAvailability.google ? "Google" : null,
    !sourceAvailability.webmaster ? "Яндекс Вебмастер" : null,
    !sourceAvailability.seoOs ? "SEO OS" : null,
  ].filter((value): value is string => Boolean(value));
  const allSourcesUnavailable = unavailableSources.length === 3;

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-100/60" aria-labelledby="seo-page-comparison-title">
      <header className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h3 id="seo-page-comparison-title" className="text-base font-semibold text-slate-900">Посадочные страницы: спрос и поведение</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
              До клика и после клика показаны раздельно. Строки объединяются только по точному нормализованному URL.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium tabular-nums text-slate-500">
            <span className="rounded-md bg-slate-50 px-2.5 py-1.5">SEO-неделя {seoWeek ?? "—"}</span>
            <span className="rounded-md bg-slate-50 px-2.5 py-1.5">Поведение на сайте {trafficPeriod.from} — {trafficPeriod.to}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <label className="block w-full max-w-xl text-xs font-medium text-slate-600">
            Поиск по странице или URL
            <input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Название или /path/" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-400" />
          </label>
          <div className="flex flex-wrap gap-2" aria-label="Сортировка страниц">
            <PageSortButton label="Google: показы" sortKey="google_impressions" sort={sort} onChange={changeSort} />
            <PageSortButton label="Яндекс: показы" sortKey="webmaster_impressions" sort={sort} onChange={changeSort} />
            <PageSortButton label="Визиты" sortKey="visits" sort={sort} onChange={changeSort} />
            <PageSortButton label="Название" sortKey="label" sort={sort} onChange={changeSort} />
          </div>
        </div>
        {unavailableSources.length > 0 && !allSourcesUnavailable ? <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">Частичные данные: недоступны {unavailableSources.join(", ")}.</div> : null}
      </header>

      <div className="max-h-[42rem] overflow-auto">
        <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e2e8f0]">
            <tr className="text-xs font-semibold text-slate-600">
              <th rowSpan={2} className="w-[300px] border-r border-slate-100 bg-white px-4 py-3 text-left align-bottom">Страница</th>
              <th colSpan={4} className="border-r border-slate-100 bg-blue-50/70 px-3 py-2 text-center">
                <SourceHeading label="Google RF" period={sourceWeeks.google} dot="bg-blue-500" />
              </th>
              <th colSpan={4} className="border-r border-slate-100 bg-amber-50/70 px-3 py-2 text-center">
                <SourceHeading label="Яндекс Вебмастер" period={sourceWeeks.webmaster} dot="bg-amber-400" />
              </th>
              <th colSpan={4} className="border-r border-slate-100 bg-violet-50/70 px-3 py-2 text-center">
                <SourceHeading label="Метрика" period={`${trafficPeriod.from} — ${trafficPeriod.to}`} dot="bg-violet-500" />
              </th>
              <th rowSpan={2} className="w-[110px] bg-teal-50/70 px-3 py-3 text-right align-bottom">
                <div>Запросы SEO OS</div>
                <div className="mt-1 font-normal text-slate-400">{sourceWeeks.seoOs ?? "нет данных"}</div>
              </th>
            </tr>
            <tr className="text-[11px] text-slate-500">
              <th className="bg-blue-50/70 px-2 py-2 text-right">Показы</th>
              <th className="bg-blue-50/70 px-2 py-2 text-right">Клики</th>
              <th className="bg-blue-50/70 px-2 py-2 text-right">CTR</th>
              <th className="border-r border-slate-100 bg-blue-50/70 px-2 py-2 text-right">Позиция</th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">Показы</th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">Клики</th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">CTR</th>
              <th className="border-r border-slate-100 bg-amber-50/70 px-2 py-2 text-right">Позиция</th>
              <th className="bg-violet-50/70 px-2 py-2 text-right">Визиты</th>
              <th className="bg-violet-50/70 px-2 py-2 text-right">Пользователи</th>
              <th className="bg-violet-50/70 px-2 py-2 text-right">Отказы</th>
              <th className="border-r border-slate-100 bg-violet-50/70 px-2 py-2 text-right">Время</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.rows.map((row) => {
              const href = resolveZarukuContentUrl(row.url);
              return (
              <tr key={row.key} className="align-top transition hover:bg-slate-50/70">
                <td className="border-r border-slate-100 px-4 py-3">
                  <div className="font-medium leading-snug text-slate-800">{row.label}</div>
                  {href ? <a href={href} target="_blank" rel="noreferrer" className="mt-1 block max-w-[270px] truncate text-xs text-slate-400 hover:text-teal-700" title={href}>{shortUrl(href)}</a> : <span className="mt-1 block max-w-[270px] truncate text-xs text-slate-400">{shortUrl(row.url)}</span>}
                </td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.impressions, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.clicks, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.google?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-2 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.google?.average_position, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.impressions, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.clicks, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.webmaster?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-2 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.webmaster?.average_position, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.post_click?.visits, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.post_click?.users, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.post_click?.bounce_rate, locale)}</td>
                <td className="border-r border-slate-100 px-2 py-3 text-right tabular-nums text-slate-500">{formatDuration(row.post_click?.avg_duration_seconds)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-teal-800">{formatNumber(row.seo_os_tracked_queries, locale)}</td>
              </tr>
              );
            })}
            {paginated.totalRows === 0 ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-sm text-slate-500">{allSourcesUnavailable ? "Источник недоступен: Google, Яндекс Вебмастер и SEO OS." : "Нет страниц для выбранных периодов."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <button type="button" disabled={paginated.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Предыдущая</button>
        <span>{paginated.totalRows.toLocaleString(locale)} найдено · Страница {paginated.page} из {paginated.totalPages}</span>
        <button type="button" disabled={paginated.page >= paginated.totalPages} onClick={() => setPage((value) => Math.min(paginated.totalPages, value + 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Следующая</button>
      </footer>
    </section>
  );
}

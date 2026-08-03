"use client";

import { useMemo, useState } from "react";
import { ZARUKU_SEO_COMPARISON_FILTERS, type SeoComparisonFilter, type UnifiedSeoPageRow } from "@/components/zaruku-seo-workspace";
import { filterAndPaginate } from "@/components/zaruku-table-pagination";
import { resolveZarukuContentUrl } from "@/lib/zaruku-url";
import ZarukuTableFrame from "@/components/ZarukuTableFrame";
import { ZARUKU_CLIENT_COPY } from "@/components/zaruku-client-copy";
import {
  formatSourceWeekFallback,
  hasSourceWeekFallback,
  type SourceWeekDisplay,
} from "@/components/zaruku-seo-source-week";

const PAGE_SIZE = 50;
type SeoPageSortKey =
  | "google_impressions"
  | "google_clicks"
  | "google_ctr"
  | "google_position"
  | "webmaster_impressions"
  | "webmaster_clicks"
  | "webmaster_ctr"
  | "webmaster_position"
  | "visits"
  | "users"
  | "bounce_rate"
  | "avg_duration_seconds"
  | "seo_os_tracked_queries"
  | "label";
type SeoPageSort = { key: SeoPageSortKey; direction: "asc" | "desc" };
type SeoPageFilter = SeoComparisonFilter;

type Props = {
  rows: UnifiedSeoPageRow[];
  sourceWeekSelections: {
    google: SourceWeekDisplay;
    webmaster: SourceWeekDisplay;
    metrika: SourceWeekDisplay;
    seoOs: SourceWeekDisplay;
  };
  sourceAvailability?: { google: boolean; webmaster: boolean; metrika: boolean; seoOs: boolean };
  defaultFilter?: SeoPageFilter;
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

function normalizePosition(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value > 0 ? value : null;
}

function pagePositions(row: UnifiedSeoPageRow): Array<number | null> {
  return [
    normalizePosition(row.google?.average_position),
    normalizePosition(row.webmaster?.average_position),
    normalizePosition(row.seo_os_best_position),
  ];
}

function filterPageRows(rows: UnifiedSeoPageRow[], filter: SeoPageFilter): UnifiedSeoPageRow[] {
  if (filter === "all") return rows;
  if (filter === "confirmed_landing") {
    return rows.filter((row) => Boolean(row.google || row.webmaster || row.seo_os_tracked_queries > 0));
  }
  if (filter === "improved") return rows.filter((row) => row.seo_os_has_improved);
  if (filter === "declined") return rows.filter((row) => row.seo_os_has_declined);
  if (filter === "not_found") return rows.filter((row) => pagePositions(row).every((position) => position === null));

  const limit = filter === "top3" ? 3 : filter === "top10" ? 10 : 20;
  return rows.filter((row) => pagePositions(row).some((position) => position !== null && position <= limit));
}

function SourceHeading({ label, selection, dot }: { label: string; selection: SourceWeekDisplay; dot: string }) {
  const fallbackNote = formatSourceWeekFallback(selection);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
      <span className="hidden font-normal normal-case text-slate-400 2xl:inline">{selection.actualWeek ?? "нет данных"}</span>
      {fallbackNote ? <span className="w-full font-normal normal-case text-amber-700">{fallbackNote}</span> : null}
    </div>
  );
}

function PageSortButton({ label, sortKey, sort, onChange }: { label: string; sortKey: SeoPageSortKey; sort: SeoPageSort; onChange: (key: SeoPageSortKey) => void }) {
  const active = sort.key === sortKey;
  const directionLabel = active ? (sort.direction === "desc" ? "↓" : "↑") : "";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Сортировать: ${label}. ${active ? `Сейчас ${directionLabel}` : "Изменить сортировку"}`}
      onClick={() => onChange(sortKey)}
      className={`inline-flex max-w-full items-center justify-center gap-0.5 rounded px-1.5 py-1 text-center text-[11px] font-semibold transition ${
        active ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span>{label}</span>
      <span className={active ? "text-slate-300" : "text-slate-400"}>{directionLabel}</span>
    </button>
  );
}

export default function ZarukuSeoPageComparison({ rows, sourceWeekSelections, sourceAvailability = { google: true, webmaster: true, metrika: true, seoOs: true }, defaultFilter = "all", locale = "ru-RU" }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SeoPageSort>({ key: "visits", direction: "desc" });
  const [filter, setFilter] = useState<SeoPageFilter>(defaultFilter);
  const filteredRows = useMemo(() => filterPageRows(rows, filter), [filter, rows]);
  const sortedRows = useMemo(() => [...filteredRows].sort((left, right) => {
    const factor = sort.direction === "asc" ? 1 : -1;
    const values: Record<Exclude<SeoPageSortKey, "label">, (row: UnifiedSeoPageRow) => number | null> = {
      google_impressions: (row) => row.google?.impressions ?? null,
      google_clicks: (row) => row.google?.clicks ?? null,
      google_ctr: (row) => row.google?.ctr ?? null,
      google_position: (row) => normalizePosition(row.google?.average_position),
      webmaster_impressions: (row) => row.webmaster?.impressions ?? null,
      webmaster_clicks: (row) => row.webmaster?.clicks ?? null,
      webmaster_ctr: (row) => row.webmaster?.ctr ?? null,
      webmaster_position: (row) => normalizePosition(row.webmaster?.average_position),
      visits: (row) => row.post_click?.visits ?? null,
      users: (row) => row.post_click?.users_available === false ? null : row.post_click?.users ?? null,
      bounce_rate: (row) => row.post_click?.bounce_rate ?? null,
      avg_duration_seconds: (row) => row.post_click?.avg_duration_seconds ?? null,
      seo_os_tracked_queries: (row) => row.seo_os_tracked_queries,
    };
    if (sort.key === "label") return factor * left.label.localeCompare(right.label, locale);
    const leftValue = values[sort.key](left);
    const rightValue = values[sort.key](right);
    if (leftValue === null && rightValue === null) return left.label.localeCompare(right.label, locale);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return factor * (leftValue - rightValue) || left.label.localeCompare(right.label, locale);
  }), [filteredRows, locale, sort]);
  const paginated = useMemo(
    () => filterAndPaginate(sortedRows, query, page, PAGE_SIZE, (row) => `${row.label} ${row.url}`),
    [page, query, sortedRows],
  );
  const changeQuery = (value: string) => { setQuery(value); setPage(1); };
  const changeFilter = (value: SeoPageFilter) => { setFilter(value); setPage(1); };
  const changeSort = (key: SeoPageSortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "label" ? "asc" : "desc" });
    setPage(1);
  };
  const unavailableSources = [
    !sourceAvailability.google ? "Google" : null,
    !sourceAvailability.webmaster ? "Яндекс Вебмастер" : null,
    !sourceAvailability.metrika ? "Яндекс Метрика" : null,
    !sourceAvailability.seoOs ? "SEO OS" : null,
  ].filter((value): value is string => Boolean(value));
  const allSourcesUnavailable = unavailableSources.length === 4;
  const hasPeriodMismatch = hasSourceWeekFallback(Object.values(sourceWeekSelections));

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
          <span className="shrink-0 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs font-medium tabular-nums text-slate-500">
            {paginated.totalRows.toLocaleString(locale)} найдено · Страница {paginated.page} из {paginated.totalPages}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Фильтр посадочных страниц">
          {ZARUKU_SEO_COMPARISON_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => changeFilter(item.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filter === item.id
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-500">
          Подтверждённые посадочные найдены в Google, Яндексе или SEO OS; топы считаются по лучшей доступной позиции страницы.
        </p>
        <label className="mt-3 block max-w-xl text-xs font-medium text-slate-600">
          Поиск по странице или URL
          <input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Название или /path/" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-400" />
        </label>
        {hasPeriodMismatch ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            Периоды источников различаются: сравнивайте показатели внутри каждого источника, а не как одну синхронную выборку.
          </div>
        ) : null}
        {unavailableSources.length > 0 && !allSourcesUnavailable ? <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">Частичные данные: недоступны {unavailableSources.join(", ")}.</div> : null}
      </header>

      <ZarukuTableFrame mode="comparison" label="Сравнение посадочных страниц" className="rounded-none border-x-0 border-y-0">
        <table className="w-full min-w-[900px] table-fixed border-separate border-spacing-0 text-xs xl:text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_var(--border)]">
            <tr className="text-xs font-semibold text-slate-600">
              <th rowSpan={2} className="w-[23%] border-r border-slate-100 bg-white px-3 py-3 text-left align-bottom">
                <PageSortButton label="Страница" sortKey="label" sort={sort} onChange={changeSort} />
              </th>
              <th colSpan={4} className="w-[21%] border-r border-slate-100 bg-blue-50/70 px-2 py-2 text-center">
                <SourceHeading label="Google RF" selection={sourceWeekSelections.google} dot="bg-blue-500" />
              </th>
              <th colSpan={4} className="w-[21%] border-r border-slate-100 bg-amber-50/70 px-2 py-2 text-center">
                <SourceHeading label="Яндекс Вебмастер" selection={sourceWeekSelections.webmaster} dot="bg-amber-400" />
              </th>
              <th colSpan={4} className="w-[25%] border-r border-slate-100 bg-violet-50/70 px-2 py-2 text-center">
                <SourceHeading label="Метрика" selection={sourceWeekSelections.metrika} dot="bg-violet-500" />
              </th>
              <th rowSpan={2} className="w-[10%] bg-teal-50/70 px-2 py-3 text-center align-bottom">
                <PageSortButton label="Запросы SEO OS" sortKey="seo_os_tracked_queries" sort={sort} onChange={changeSort} />
                <div className="mt-1 hidden font-normal text-slate-400 2xl:block">{sourceWeekSelections.seoOs.actualWeek ?? "нет данных"}</div>
                {formatSourceWeekFallback(sourceWeekSelections.seoOs) ? (
                  <div className="mt-1 font-normal text-amber-700">{formatSourceWeekFallback(sourceWeekSelections.seoOs)}</div>
                ) : null}
              </th>
            </tr>
            <tr className="text-[11px] text-slate-500">
              <th className="bg-blue-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Показы" sortKey="google_impressions" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-blue-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Клики" sortKey="google_clicks" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-blue-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="CTR" sortKey="google_ctr" sort={sort} onChange={changeSort} />
              </th>
              <th className="border-r border-slate-100 bg-blue-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Позиция" sortKey="google_position" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-amber-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Показы" sortKey="webmaster_impressions" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-amber-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Клики" sortKey="webmaster_clicks" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-amber-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="CTR" sortKey="webmaster_ctr" sort={sort} onChange={changeSort} />
              </th>
              <th className="border-r border-slate-100 bg-amber-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Позиция" sortKey="webmaster_position" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-violet-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Визиты" sortKey="visits" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-violet-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Польз." sortKey="users" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-violet-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Отказы" sortKey="bounce_rate" sort={sort} onChange={changeSort} />
              </th>
              <th className="border-r border-slate-100 bg-violet-50/70 px-1.5 py-2 text-center">
                <PageSortButton label="Время" sortKey="avg_duration_seconds" sort={sort} onChange={changeSort} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.rows.map((row) => {
              const href = resolveZarukuContentUrl(row.url);
              return (
              <tr key={row.key} className="align-top transition hover:bg-slate-50/70">
                <td className="border-r border-slate-100 px-3 py-3">
                  <div className="min-w-0 max-w-full overflow-hidden [overflow-wrap:anywhere] font-medium leading-snug text-slate-800">{row.label}</div>
                  {href ? <a href={href} target="_blank" rel="noreferrer" className="mt-1 block min-w-0 max-w-full truncate text-xs text-slate-400 hover:text-teal-700" title={href}>{shortUrl(href)}</a> : <span className="mt-1 block min-w-0 max-w-full truncate text-xs text-slate-400" title={row.url}>{shortUrl(row.url)}</span>}
                </td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.impressions, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.clicks, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.google?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-1.5 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.google?.average_position, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.impressions, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.clicks, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.webmaster?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-1.5 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.webmaster?.average_position, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.post_click?.visits, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{row.post_click?.users_available === false ? "—" : formatNumber(row.post_click?.users, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.post_click?.bounce_rate, locale)}</td>
                <td className="border-r border-slate-100 px-1.5 py-3 text-right tabular-nums text-slate-500">{formatDuration(row.post_click?.avg_duration_seconds)}</td>
                <td className="px-2 py-3 text-right font-semibold tabular-nums text-teal-800">{formatNumber(row.seo_os_tracked_queries, locale)}</td>
              </tr>
              );
            })}
            {paginated.totalRows === 0 ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-sm text-slate-500">{allSourcesUnavailable ? "Источник недоступен: Google, Яндекс Вебмастер, Яндекс Метрика и SEO OS." : ZARUKU_CLIENT_COPY.emptyPages}</td></tr>
            ) : null}
          </tbody>
        </table>
      </ZarukuTableFrame>
      <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <button type="button" disabled={paginated.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Предыдущая</button>
        <span>{paginated.totalRows.toLocaleString(locale)} найдено · Страница {paginated.page} из {paginated.totalPages}</span>
        <button type="button" disabled={paginated.page >= paginated.totalPages} onClick={() => setPage((value) => Math.min(paginated.totalPages, value + 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Следующая</button>
      </footer>
    </section>
  );
}

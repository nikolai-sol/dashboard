"use client";

import { useMemo, useState } from "react";
import { filterAndPaginate } from "@/components/zaruku-table-pagination";
import { resolveZarukuContentUrl } from "@/lib/zaruku-url";
import ZarukuTableFrame from "@/components/ZarukuTableFrame";
import { ZARUKU_CLIENT_COPY } from "@/components/zaruku-client-copy";
import {
  filterUnifiedSeoQueryRows,
  sortUnifiedSeoQueryRows,
  ZARUKU_SEO_COMPARISON_FILTERS,
  type SeoQueryFilter,
  type SeoQuerySort,
  type SeoQuerySortKey,
  type UnifiedSeoQueryRow,
} from "@/components/zaruku-seo-workspace";
import {
  formatSourceWeekFallback,
  hasSourceWeekFallback,
  type SourceWeekDisplay,
} from "@/components/zaruku-seo-source-week";

type SourceWeekSelections = {
  google: SourceWeekDisplay;
  webmaster: SourceWeekDisplay;
  seoOs: SourceWeekDisplay;
};

type Props = {
  rows: UnifiedSeoQueryRow[];
  sourceWeekSelections: SourceWeekSelections;
  sourceAvailability?: { google: boolean; webmaster: boolean; seoOs: boolean };
  defaultSort?: SeoQuerySort;
  defaultFilter?: SeoQueryFilter;
  locale?: string;
};

const PAGE_SIZE = 50;

export function toggleSeoSort(current: SeoQuerySort, key: SeoQuerySortKey): SeoQuerySort {
  const defaultDirection: Record<SeoQuerySortKey, "asc" | "desc"> = {
    google_position: "asc",
    webmaster_position: "asc",
    seo_os_position: "asc",
    google_impressions: "desc",
    google_clicks: "desc",
    google_ctr: "desc",
    webmaster_impressions: "desc",
    webmaster_clicks: "desc",
    webmaster_ctr: "desc",
  };

  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: defaultDirection[key] ?? "asc" };
}

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
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${formatDecimal(value, locale)}%`;
}

function shortUrl(value: string): string {
  try {
    const parsed = new URL(value, "https://zaruku.ru");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
}

function SortButton({
  label,
  sortKey,
  sort,
  onChange,
}: {
  label: string;
  sortKey: SeoQuerySortKey;
  sort: SeoQuerySort;
  onChange: (key: SeoQuerySortKey) => void;
}) {
  const active = sort.key === sortKey;
  const directionLabel = active ? (sort.direction === "desc" ? "↓" : "↑") : "";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Сортировать: ${label}. ${active ? `Сейчас ${directionLabel}` : "Изменить сортировку"}`}
      onClick={() => onChange(sortKey)}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-semibold transition ${
        active ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span>{label}</span>
      <span className={active ? "text-slate-300" : "text-slate-400"}>{directionLabel}</span>
    </button>
  );
}

function SourceHeading({ label, selection, className }: { label: string; selection: SourceWeekDisplay; className: string }) {
  const fallbackNote = formatSourceWeekFallback(selection);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      <span>{label}</span>
      <span className="hidden font-normal normal-case text-slate-400 2xl:inline">{selection.actualWeek ?? "нет данных"}</span>
      {fallbackNote ? <span className="w-full font-normal normal-case text-amber-700">{fallbackNote}</span> : null}
    </div>
  );
}

function PositionDelta({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span className="text-slate-400">—</span>;
  const improved = value < 0;
  return (
    <span className={improved ? "font-medium text-emerald-700" : "font-medium text-red-600"}>
      {improved ? "↑" : "↓"} {Math.abs(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}
    </span>
  );
}

function SafePageLink({ value, prefix = "" }: { value: string; prefix?: string }) {
  const href = resolveZarukuContentUrl(value);
  if (!href) return <span className="max-w-full truncate text-slate-400">{prefix}{shortUrl(value)}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="max-w-full truncate whitespace-nowrap hover:text-blue-600" title={href}>
      {prefix}{shortUrl(href)}
    </a>
  );
}

export default function ZarukuSeoQueryComparison({
  rows,
  sourceWeekSelections,
  sourceAvailability = { google: true, webmaster: true, seoOs: true },
  defaultSort = { key: "google_position", direction: "asc" },
  defaultFilter = "all",
  locale = "ru-RU",
}: Props) {
  const [sort, setSort] = useState<SeoQuerySort>(defaultSort);
  const [filter, setFilter] = useState<SeoQueryFilter>(defaultFilter);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const visibleRows = useMemo(
    () => sortUnifiedSeoQueryRows(filterUnifiedSeoQueryRows(rows, filter), sort),
    [filter, rows, sort],
  );
  const paginated = useMemo(
    () => filterAndPaginate(
      visibleRows,
      query,
      page,
      PAGE_SIZE,
      (row) => `${row.query} ${row.section ?? ""} ${row.google_pages.join(" ")} ${row.webmaster_pages.join(" ")}`,
    ),
    [page, query, visibleRows],
  );
  const changeFilter = (value: SeoQueryFilter) => { setFilter(value); setPage(1); };
  const changeQuery = (value: string) => { setQuery(value); setPage(1); };
  const changeSort = (key: SeoQuerySortKey) => { setSort((current) => toggleSeoSort(current, key)); setPage(1); };
  const hasPeriodMismatch = hasSourceWeekFallback(Object.values(sourceWeekSelections));
  const unavailableSources = [
    !sourceAvailability.google ? "Google" : null,
    !sourceAvailability.webmaster ? "Яндекс Вебмастер" : null,
    !sourceAvailability.seoOs ? "SEO OS" : null,
  ].filter((value): value is string => Boolean(value));
  const allSourcesUnavailable = unavailableSources.length === 3;

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-100/60" aria-labelledby="seo-query-comparison-title">
      <header className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h3 id="seo-query-comparison-title" className="text-base font-semibold text-slate-900">Запросы: Google, Яндекс и SEO OS</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
              Одна строка — точное совпадение нормализованной фразы. Средние позиции поисковиков и отслеживаемая позиция SEO OS остаются отдельными метриками.
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs font-medium tabular-nums text-slate-500">
            {paginated.totalRows.toLocaleString(locale)} найдено · Страница {paginated.page} из {paginated.totalPages}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Фильтр запросов">
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
          Подтверждённая посадочная берётся из строки query + page самого источника: Google Search Console или Яндекс Вебмастер. SEO OS и представительская страница Яндекса фильтр не подтверждают.
        </p>
        <label className="mt-3 block max-w-xl text-xs font-medium text-slate-600">
          Поиск по фразе или разделу
          <input
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Например, онкоцентр"
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-400"
          />
        </label>

        {hasPeriodMismatch ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            Периоды источников различаются: сравнивайте показатели внутри каждого источника, а не как одну синхронную выборку.
          </div>
        ) : null}
        {unavailableSources.length > 0 && !allSourcesUnavailable ? (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            Частичные данные: недоступны {unavailableSources.join(", ")}.
          </div>
        ) : null}
      </header>

      <ZarukuTableFrame mode="comparison" label="Сравнение поисковых запросов" className="rounded-none border-x-0 border-y-0">
        <table className="w-full min-w-[900px] table-fixed border-separate border-spacing-0 text-xs xl:text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_var(--border)]">
            <tr className="text-xs font-semibold text-slate-600">
              <th rowSpan={2} className="w-[24%] border-r border-slate-100 bg-white px-3 py-3 text-left align-bottom">Фраза</th>
              <th rowSpan={2} className="w-[9%] border-r border-slate-100 bg-white px-2 py-3 text-left align-bottom">Раздел</th>
              <th colSpan={4} className="w-[24%] border-r border-slate-100 bg-blue-50/70 px-2 py-2 text-center">
                <SourceHeading label="Google RF" selection={sourceWeekSelections.google} className="bg-blue-500" />
              </th>
              <th colSpan={4} className="w-[24%] border-r border-slate-100 bg-amber-50/70 px-2 py-2 text-center">
                <SourceHeading label="Яндекс Вебмастер" selection={sourceWeekSelections.webmaster} className="bg-amber-400" />
              </th>
              <th colSpan={3} className="w-[19%] bg-teal-50/70 px-2 py-2 text-center">
                <SourceHeading label="SEO OS" selection={sourceWeekSelections.seoOs} className="bg-teal-500" />
              </th>
            </tr>
            <tr className="border-t border-slate-100 text-[11px] text-slate-500">
              <th className="bg-blue-50/70 px-1.5 py-2 text-right">
                <SortButton label="Показы" sortKey="google_impressions" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-blue-50/70 px-1.5 py-2 text-right">
                <SortButton label="Клики" sortKey="google_clicks" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-blue-50/70 px-1.5 py-2 text-right">
                <SortButton label="CTR" sortKey="google_ctr" sort={sort} onChange={changeSort} />
              </th>
              <th className="border-r border-slate-100 bg-blue-50/70 px-1.5 py-2 text-right">
                <SortButton label="Позиция" sortKey="google_position" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-amber-50/70 px-1.5 py-2 text-right">
                <SortButton label="Показы" sortKey="webmaster_impressions" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-amber-50/70 px-1.5 py-2 text-right">
                <SortButton label="Клики" sortKey="webmaster_clicks" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-amber-50/70 px-1.5 py-2 text-right">
                <SortButton label="CTR" sortKey="webmaster_ctr" sort={sort} onChange={changeSort} />
              </th>
              <th className="border-r border-slate-100 bg-amber-50/70 px-1.5 py-2 text-right">
                <SortButton label="Позиция" sortKey="webmaster_position" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-teal-50/70 px-1.5 py-2 text-right">
                <SortButton label="Позиция" sortKey="seo_os_position" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-teal-50/70 px-1.5 py-2 text-right">Δ</th>
              <th className="bg-teal-50/70 px-1.5 py-2 text-left">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.rows.map((row) => (
              <tr key={row.key} className="align-top transition hover:bg-slate-50/70">
                <td className="border-r border-slate-100 px-3 py-3">
                  <div className="min-w-0 truncate font-medium leading-snug text-slate-800" title={row.query}>{row.query}</div>
                  {row.google_pages.length > 0 || row.webmaster_pages.length > 0 || row.seo_os?.matched_url ? (
                    <div className="mt-1.5 flex max-w-full flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-400">
                      {row.google_pages.map((page) => (
                        <SafePageLink key={`g-${page}`} value={page} prefix="Google: " />
                      ))}
                      {row.webmaster_pages.map((page) => (
                        <SafePageLink key={`y-${page}`} value={page} prefix="Яндекс: " />
                      ))}
                      {row.seo_os?.matched_url ? (
                        <SafePageLink value={row.seo_os.matched_url} prefix="SEO OS: " />
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td className="border-r border-slate-100 px-2 py-3 text-xs text-slate-500">
                  <span className="block min-w-0 truncate" title={row.section ?? undefined}>{row.section ?? "—"}</span>
                </td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.impressions, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.clicks, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.google?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-1.5 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.google?.average_position, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.impressions, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.clicks, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.webmaster?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-1.5 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.webmaster?.average_position, locale)}</td>
                <td className="px-1.5 py-3 text-right font-semibold tabular-nums text-teal-800">{formatDecimal(row.seo_os?.tracked_position, locale)}</td>
                <td className="px-1.5 py-3 text-right tabular-nums"><PositionDelta value={row.seo_os?.delta_prev ?? null} /></td>
                <td className="px-1.5 py-3 text-xs text-slate-500">
                  {row.seo_os ? (row.seo_os.status === "found" ? "Найдена" : "Нет данных") : "—"}
                </td>
              </tr>
            ))}
            {paginated.totalRows === 0 ? (
              <tr><td colSpan={13} className="px-4 py-12 text-center text-sm text-slate-500">{
                allSourcesUnavailable
                  ? "Источник недоступен: Google, Яндекс Вебмастер и SEO OS."
                  : filter === "confirmed_landing"
                    ? "Нет запросов с подтверждённой посадочной за выбранный период."
                    : ZARUKU_CLIENT_COPY.emptyQueries
              }</td></tr>
            ) : null}
          </tbody>
        </table>
      </ZarukuTableFrame>
      <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <button type="button" disabled={paginated.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Предыдущая</button>
        <span>Страница {paginated.page} из {paginated.totalPages}</span>
        <button type="button" disabled={paginated.page >= paginated.totalPages} onClick={() => setPage((value) => Math.min(paginated.totalPages, value + 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Следующая</button>
      </footer>
    </section>
  );
}

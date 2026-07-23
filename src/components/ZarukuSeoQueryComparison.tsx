"use client";

import { useMemo, useState } from "react";
import { filterAndPaginate } from "@/components/zaruku-table-pagination";
import { resolveZarukuContentUrl } from "@/lib/zaruku-url";
import {
  filterUnifiedSeoQueryRows,
  sortUnifiedSeoQueryRows,
  type SeoQueryFilter,
  type SeoQuerySort,
  type SeoQuerySortKey,
  type UnifiedSeoQueryRow,
} from "@/components/zaruku-seo-workspace";

type SourceWeeks = {
  google: string | null;
  webmaster: string | null;
  seoOs: string | null;
};

type Props = {
  rows: UnifiedSeoQueryRow[];
  sourceWeeks: SourceWeeks;
  sourceAvailability?: { google: boolean; webmaster: boolean; seoOs: boolean };
  defaultSort?: SeoQuerySort;
  locale?: string;
};

const FILTERS: Array<{ id: SeoQueryFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "top3", label: "Топ-3" },
  { id: "top10", label: "Топ-10" },
  { id: "top20", label: "Топ-20" },
  { id: "improved", label: "Выросли" },
  { id: "declined", label: "Снизились" },
  { id: "not_found", label: "Нет позиции" },
];
const PAGE_SIZE = 50;

export function toggleSeoSort(current: SeoQuerySort, key: SeoQuerySortKey): SeoQuerySort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
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
  const directionLabel = active && sort.direction === "desc" ? "100 → 1" : "1 → 100";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Сортировать: ${label}. ${active ? `Сейчас ${directionLabel}` : "Сначала 1 → 100"}`}
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

function SourceHeading({ label, week, className }: { label: string; week: string | null; className: string }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      <span>{label}</span>
      <span className="font-normal normal-case text-slate-400">{week ?? "нет данных"}</span>
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
    <a href={href} target="_blank" rel="noreferrer" className="max-w-full truncate hover:text-blue-600" title={href}>
      {prefix}{shortUrl(href)}
    </a>
  );
}

export default function ZarukuSeoQueryComparison({
  rows,
  sourceWeeks,
  sourceAvailability = { google: true, webmaster: true, seoOs: true },
  defaultSort = { key: "google_position", direction: "asc" },
  locale = "ru-RU",
}: Props) {
  const [sort, setSort] = useState<SeoQuerySort>(defaultSort);
  const [filter, setFilter] = useState<SeoQueryFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const visibleRows = useMemo(
    () => sortUnifiedSeoQueryRows(filterUnifiedSeoQueryRows(rows, filter), sort),
    [filter, rows, sort],
  );
  const paginated = useMemo(
    () => filterAndPaginate(visibleRows, query, page, PAGE_SIZE, (row) => `${row.query} ${row.section ?? ""}`),
    [page, query, visibleRows],
  );
  const changeFilter = (value: SeoQueryFilter) => { setFilter(value); setPage(1); };
  const changeQuery = (value: string) => { setQuery(value); setPage(1); };
  const changeSort = (key: SeoQuerySortKey) => { setSort((current) => toggleSeoSort(current, key)); setPage(1); };
  const actualWeeks = [sourceWeeks.google, sourceWeeks.webmaster, sourceWeeks.seoOs].filter(
    (week): week is string => Boolean(week),
  );
  const hasPeriodMismatch = new Set(actualWeeks).size > 1;
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
          {FILTERS.map((item) => (
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

      <div className="max-h-[42rem] overflow-auto">
        <table className="min-w-[1180px] w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e2e8f0]">
            <tr className="text-xs font-semibold text-slate-600">
              <th rowSpan={2} className="w-[300px] border-r border-slate-100 bg-white px-4 py-3 text-left align-bottom">Фраза</th>
              <th rowSpan={2} className="w-[140px] border-r border-slate-100 bg-white px-3 py-3 text-left align-bottom">Раздел</th>
              <th colSpan={4} className="border-r border-slate-100 bg-blue-50/70 px-3 py-2 text-center">
                <SourceHeading label="Google RF" week={sourceWeeks.google} className="bg-blue-500" />
              </th>
              <th colSpan={4} className="border-r border-slate-100 bg-amber-50/70 px-3 py-2 text-center">
                <SourceHeading label="Яндекс Вебмастер" week={sourceWeeks.webmaster} className="bg-amber-400" />
              </th>
              <th colSpan={3} className="bg-teal-50/70 px-3 py-2 text-center">
                <SourceHeading label="SEO OS" week={sourceWeeks.seoOs} className="bg-teal-500" />
              </th>
            </tr>
            <tr className="border-t border-slate-100 text-[11px] text-slate-500">
              <th className="bg-blue-50/70 px-2 py-2 text-right">Показы</th>
              <th className="bg-blue-50/70 px-2 py-2 text-right">Клики</th>
              <th className="bg-blue-50/70 px-2 py-2 text-right">CTR</th>
              <th className="border-r border-slate-100 bg-blue-50/70 px-2 py-2 text-right">
                <SortButton label="Позиция" sortKey="google_position" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">Показы</th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">Клики</th>
              <th className="bg-amber-50/70 px-2 py-2 text-right">CTR</th>
              <th className="border-r border-slate-100 bg-amber-50/70 px-2 py-2 text-right">
                <SortButton label="Позиция" sortKey="webmaster_position" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-teal-50/70 px-2 py-2 text-right">
                <SortButton label="Позиция" sortKey="seo_os_position" sort={sort} onChange={changeSort} />
              </th>
              <th className="bg-teal-50/70 px-2 py-2 text-right">Δ</th>
              <th className="bg-teal-50/70 px-2 py-2 text-left">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.rows.map((row) => (
              <tr key={row.key} className="align-top transition hover:bg-slate-50/70">
                <td className="border-r border-slate-100 px-4 py-3">
                  <div className="font-medium leading-snug text-slate-800">{row.query}</div>
                  {row.google_pages.length > 0 || row.seo_os?.matched_url ? (
                    <div className="mt-1.5 flex max-w-[280px] flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-400">
                      {row.google_pages.map((page) => (
                        <SafePageLink key={`g-${page}`} value={page} />
                      ))}
                      {row.seo_os?.matched_url ? (
                        <SafePageLink value={row.seo_os.matched_url} prefix="SEO OS: " />
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td className="border-r border-slate-100 px-3 py-3 text-xs text-slate-500">{row.section ?? "—"}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.impressions, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.google?.clicks, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.google?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-2 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.google?.average_position, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.impressions, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster?.clicks, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-500">{formatPercent(row.webmaster?.ctr, locale)}</td>
                <td className="border-r border-slate-100 px-2 py-3 text-right font-medium tabular-nums text-slate-700">{formatDecimal(row.webmaster?.average_position, locale)}</td>
                <td className="px-2 py-3 text-right font-semibold tabular-nums text-teal-800">{formatDecimal(row.seo_os?.tracked_position, locale)}</td>
                <td className="px-2 py-3 text-right tabular-nums"><PositionDelta value={row.seo_os?.delta_prev ?? null} /></td>
                <td className="px-2 py-3 text-xs text-slate-500">
                  {row.seo_os ? (row.seo_os.status === "found" ? "Найдена" : "Нет данных") : "—"}
                </td>
              </tr>
            ))}
            {paginated.totalRows === 0 ? (
              <tr><td colSpan={13} className="px-4 py-12 text-center text-sm text-slate-500">{allSourcesUnavailable ? "Источник недоступен: Google, Яндекс Вебмастер и SEO OS." : "По выбранному фильтру запросов нет."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <button type="button" disabled={paginated.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Предыдущая</button>
        <span>Страница {paginated.page} из {paginated.totalPages}</span>
        <button type="button" disabled={paginated.page >= paginated.totalPages} onClick={() => setPage((value) => Math.min(paginated.totalPages, value + 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Следующая</button>
      </footer>
    </section>
  );
}

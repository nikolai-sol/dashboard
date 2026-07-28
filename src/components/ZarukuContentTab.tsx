"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { ZARUKU_CLIENT_COPY } from "@/components/zaruku-client-copy";
import ZarukuPanelState from "@/components/ZarukuPanelState";
import ZarukuSectionState from "@/components/ZarukuSectionState";
import ZarukuTrafficVisibility from "@/components/ZarukuTrafficVisibility";
import ZarukuTableFrame, { type ZarukuTableFrameMode } from "@/components/ZarukuTableFrame";
import { availableMetricColumns, sortContentRows, type ContentSort, type ContentSortKey } from "@/components/zaruku-content-table";
import { filterAndPaginate } from "@/components/zaruku-table-pagination";
import { resolveZarukuContentUrl } from "@/lib/zaruku-url";
import type { ZarukuDatasetMeta, ZarukuMetricColumn, ZarukuSeoData, ZarukuSeoMetricRow } from "@/lib/types";

const PAGE_SIZE = 50;

type Props = {
  data: ZarukuSeoData;
  locale?: string;
  primaryWeek: string | null;
  comparisonWeek: string | null;
};

function formatNumber(value: number | null | undefined, locale: string) {
  return value == null || !Number.isFinite(value) ? "—" : Math.round(value).toLocaleString(locale);
}

function formatPercent(value: number | null | undefined, locale: string) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

function formatDuration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function shortUrl(value: string) {
  try {
    return new URL(value, "https://zaruku.ru").pathname || "/";
  } catch {
    return value;
  }
}

function formatSummaryDate(value: string | null | undefined) {
  if (!value) return "—";
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 10) : "—";
}

function formatMetric(row: ZarukuSeoMetricRow, key: ZarukuMetricColumn, locale: string) {
  if (key === "bounce_rate") return formatPercent(row.bounce_rate, locale);
  if (key === "avg_duration_seconds") return formatDuration(row.avg_duration_seconds);
  if (key === "page_depth") return row.page_depth == null ? "—" : row.page_depth.toLocaleString(locale, { maximumFractionDigits: 1 });
  return formatNumber(row[key], locale);
}

function ContentPanel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card-surface zaruku-panel">
      <header className="zaruku-panel-header">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {note ? <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{note}</p> : null}
        </div>
      </header>
      <div className="zaruku-panel-body">{children}</div>
    </section>
  );
}

function SectionPatternInfo({
  label,
  contentSummary,
  locale,
}: {
  label: string;
  contentSummary: {
    section_pattern_count: number;
    unmatched_pageviews: number;
    unmatched_share: number;
    section_patterns_updated_at: string | null;
  };
  locale: string;
}) {
  const id = useId();
  const warning = contentSummary.unmatched_share > 10;
  const matchedPercent = formatPercent(contentSummary.unmatched_share, locale);
  return (
    <span className="group relative inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-slate-500 transition hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
      >
        ⓘ
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-6 z-50 hidden w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg group-hover:block group-focus-within:block"
      >
        <span className="block text-sm font-semibold text-slate-900">{ZARUKU_CLIENT_COPY.contentMap.title}</span>
        <span className="mt-1.5 block text-xs leading-relaxed text-slate-600">
          Шаблонов разделов: {contentSummary.section_pattern_count}
          <br />
          Просмотров вне карты: {formatNumber(contentSummary.unmatched_pageviews, locale)} · доля: {matchedPercent}
          <br />
          Обновлено: {formatSummaryDate(contentSummary.section_patterns_updated_at)}
        </span>
      </span>
      {warning ? <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">вне карты {matchedPercent}</span> : null}
    </span>
  );
}

function MetricTable({
  rows,
  meta,
  locale,
  mode = "standard",
}: {
  rows: ZarukuSeoMetricRow[];
  meta: ZarukuDatasetMeta;
  locale: string;
  mode?: ZarukuTableFrameMode;
}) {
  const columns = availableMetricColumns(meta.metrics);
  return (
    <ZarukuTableFrame mode={mode} label="Метрики страниц">
      <table className="zaruku-table min-w-[680px]">
        <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Страница или раздел</th>{columns.map((column) => <th key={column.key} className="pb-2 text-right font-medium">{column.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => {
            const href = row.url ? resolveZarukuContentUrl(row.url) : null;
            return <tr key={`${row.url ?? row.label}-${index}`} className="align-top"><td className="max-w-[560px] py-2.5 pr-5"><div className="font-medium leading-snug text-slate-700">{row.label}</div>{row.url ? href ? <a href={href} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-slate-400 hover:text-teal-700" title={href}>{shortUrl(href)}</a> : <span className="mt-1 block truncate text-xs text-slate-400">{shortUrl(row.url)}</span> : null}</td>{columns.map((column) => <td key={column.key} className="whitespace-nowrap py-2.5 text-right tabular-nums text-slate-600">{formatMetric(row, column.key, locale)}</td>)}</tr>;
          })}
        </tbody>
      </table>
    </ZarukuTableFrame>
  );
}

function ReturningTable({ rows, meta, locale }: { rows: ZarukuSeoMetricRow[]; meta: ZarukuDatasetMeta; locale: string }) {
  const userMetricLabel = meta.metrics.users ? "Пользователи" : "Пользователь-дни";
  return (
    <ZarukuTableFrame mode="standard" label="Таблица возвратов">
      <table className="zaruku-table min-w-[760px]">
        <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Страница</th><th className="pb-2 text-right font-medium">Визиты</th><th className="pb-2 text-right font-medium">1 день · {userMetricLabel}</th><th className="pb-2 text-right font-medium">2–7 дней · {userMetricLabel}</th><th className="pb-2 text-right font-medium">8–31 день · {userMetricLabel}</th><th className="pb-2 text-right font-medium">Доля возвратов</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((row, index) => {
          const rawUrl = row.url ?? row.label;
          const href = resolveZarukuContentUrl(rawUrl);
          return <tr key={`${rawUrl}-${index}`}><td className="max-w-[460px] py-2.5 pr-5">{href ? <a href={href} target="_blank" rel="noreferrer" className="font-medium text-slate-700 hover:text-teal-700">{shortUrl(href)}</a> : <span className="font-medium text-slate-700">{shortUrl(rawUrl)}</span>}</td><td className="py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.visits, locale)}</td><td className="py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.returning_1_day_users, locale)}</td><td className="py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.returning_2_7_days_users, locale)}</td><td className="py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.returning_8_31_days_users, locale)}</td><td className="py-2.5 text-right tabular-nums text-slate-500">{formatPercent(row.share, locale)}</td></tr>;
        })}</tbody>
      </table>
    </ZarukuTableFrame>
  );
}

function SortButton({ label, sortKey, sort, onChange }: { label: string; sortKey: ContentSortKey; sort: ContentSort; onChange: (key: ContentSortKey) => void }) {
  const active = sort.key === sortKey;
  return <button type="button" aria-pressed={active} onClick={() => onChange(sortKey)} className={active ? "rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white" : "rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600"}>{label}{active ? (sort.direction === "desc" ? " ↓" : " ↑") : ""}</button>;
}

export default function ZarukuContentTab({ data, locale = "ru-RU", primaryWeek, comparisonWeek }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ContentSort>({ key: "pageviews", direction: "desc" });
  const pageMeta = data.dataset_meta.top_pages;
  const pageColumns = availableMetricColumns(pageMeta.metrics);
  const supportedSort = sort.key === "label" || pageColumns.some((column) => column.key === sort.key) ? sort : { key: "label", direction: "asc" } satisfies ContentSort;
  const sortedPages = useMemo(() => sortContentRows(data.top_pages, supportedSort, locale), [data.top_pages, locale, supportedSort]);
  const paginated = useMemo(() => filterAndPaginate(sortedPages, query, page, PAGE_SIZE, (row) => `${row.label} ${row.url ?? ""}`), [page, query, sortedPages]);
  const sectionSummary = data.content_sections_summary ?? {
    section_pattern_count: data.seo_os.section_patterns.length,
    unmatched_pageviews: 0,
    unmatched_share: 0,
    section_patterns_updated_at: null,
  };
  const changeQuery = (value: string) => { setQuery(value); setPage(1); };
  const changeSort = (key: ContentSortKey) => { setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "label" ? "asc" : "desc" }); setPage(1); };
  return (
    <div className="zaruku-section-stack">
      <ContentPanel title="Состояние контента">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 px-4 py-3"><div className="text-xs text-slate-500">Страниц в доступном срезе</div><div className="zaruku-kpi-value mt-1 text-xl font-semibold text-slate-900">{data.top_pages.length.toLocaleString(locale)}</div></div>
          <div className="rounded-lg bg-slate-50 px-4 py-3"><div className="text-xs text-slate-500">Нативные метрики страниц</div><div className="mt-1 text-sm font-semibold text-slate-800">{pageColumns.map((column) => column.label).join(" · ") || "Нет"}</div></div>
        </div>
        {pageMeta.message ? <p className="mt-3 text-xs leading-relaxed text-slate-500">{pageMeta.message}</p> : null}
      </ContentPanel>

      <section aria-labelledby="content-sections-title" className="min-w-0 space-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 id="content-sections-title" className="text-base font-semibold text-slate-900">Разделы сайта</h3>
            <SectionPatternInfo label={ZARUKU_CLIENT_COPY.contentMap.label} contentSummary={sectionSummary} locale={locale} />
          </div>
          <p className="mt-1 text-xs text-slate-500">Просмотры и позиции сопоставлены по единой карте разделов сайта.</p>
        </div>
        <ZarukuTrafficVisibility seoOs={data.seo_os} primaryWeek={primaryWeek} comparisonWeek={comparisonWeek} source={data.sources.find((source) => source.id === "seo_os")} />
      </section>

      <ZarukuSectionState panels={[
        { meta: pageMeta, hasRows: data.top_pages.length > 0 },
        { meta: data.dataset_meta.best_engagement_pages, hasRows: data.best_engagement_pages.length > 0 },
        { meta: data.dataset_meta.high_bounce_pages, hasRows: data.high_bounce_pages.length > 0 },
        { meta: data.dataset_meta.returning_pages, hasRows: data.returning_pages.length > 0 },
      ]}>
        <ContentPanel title="Популярные страницы" note="Топ-10 страниц по просмотрам за период"><ZarukuPanelState meta={pageMeta} hasRows={data.top_pages.length > 0}><MetricTable rows={sortContentRows(data.top_pages, { key: "pageviews", direction: "desc" }, locale).slice(0, 10)} meta={pageMeta} locale={locale} /></ZarukuPanelState></ContentPanel>

        <ContentPanel title="Лучшее удержание" note="Входные страницы с сильным удержанием; показываются только при достаточном числе входов на страницу."><ZarukuPanelState meta={data.dataset_meta.best_engagement_pages} hasRows={data.best_engagement_pages.length > 0}><MetricTable rows={data.best_engagement_pages} meta={data.dataset_meta.best_engagement_pages} locale={locale} /></ZarukuPanelState></ContentPanel>

        <ContentPanel title="Риск отказов" note="Входные страницы с высоким риском отказа; нулевые значения не подменяют отсутствующий источник."><ZarukuPanelState meta={data.dataset_meta.high_bounce_pages} hasRows={data.high_bounce_pages.length > 0}><MetricTable rows={data.high_bounce_pages} meta={data.dataset_meta.high_bounce_pages} locale={locale} /></ZarukuPanelState></ContentPanel>

      <ContentPanel
        title="Возврат к контенту"
        note={data.dataset_meta.returning_pages.metrics.users
          ? "Канонические интервалы повторного визита за один день."
          : "Сумма дневных значений показана как пользователь-дни; это не уникальные пользователи за период."}
      ><ZarukuPanelState meta={data.dataset_meta.returning_pages} hasRows={data.returning_pages.length > 0}><ReturningTable rows={data.returning_pages.slice(0, 20)} meta={data.dataset_meta.returning_pages} locale={locale} /></ZarukuPanelState></ContentPanel>

        <ContentPanel title="Все страницы" note="Доступные страницы с поиском, сортировкой и постраничным просмотром.">
          <ZarukuPanelState meta={pageMeta} hasRows={data.top_pages.length > 0}>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><label className="block w-full max-w-xl text-xs font-medium text-slate-600">Поиск по странице или URL<input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Название или /path/" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-400" /></label><div className="flex flex-wrap gap-2" aria-label="Сортировка страниц"><SortButton label="Название" sortKey="label" sort={supportedSort} onChange={changeSort} />{pageColumns.map((column) => <SortButton key={column.key} label={column.label} sortKey={column.key} sort={supportedSort} onChange={changeSort} />)}</div></div>
            <MetricTable rows={paginated.rows} meta={pageMeta} locale={locale} mode="operational" />
            <footer className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500"><button type="button" disabled={paginated.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Предыдущая</button><span>{paginated.totalRows.toLocaleString(locale)} найдено · Страница {paginated.page} из {paginated.totalPages}</span><button type="button" disabled={paginated.page >= paginated.totalPages} onClick={() => setPage((value) => Math.min(paginated.totalPages, value + 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Следующая</button></footer>
          </ZarukuPanelState>
        </ContentPanel>
      </ZarukuSectionState>
    </div>
  );
}

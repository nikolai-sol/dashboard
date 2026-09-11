"use client";

import type { SiteProfile } from "@reportingdash/site-seo-contract";
import { useMemo, useState } from "react";
import type { MetrikaCanonicalData, MetrikaContentPageRow, MetrikaTrafficMetrics } from "../lib/db.ts";
import { EmptyNotice, Kpi, KpiStrip, Panel, TableFrame } from "./DashboardPrimitives.tsx";

const PAGE_SIZE = 50;
const number = new Intl.NumberFormat("ru-RU");

export type ContentSortKey = "title" | "pageviews" | "visits" | "bounceRate" | "avgVisitDurationSeconds" | "pageDepth";
export type ContentSort = Readonly<{ key: ContentSortKey; direction: "asc" | "desc" }>;

export type ContentSectionRow = MetrikaTrafficMetrics & Readonly<{ id: string; label: string }>;

function pathFromUrl(value: string): string {
  try { return new URL(value, "https://site-seo.local").pathname; }
  catch { return value.split(/[?#]/, 1)[0] || "/"; }
}

function matchesPrefix(path: string, prefix: string): boolean {
  const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
  const directory = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return path === directory.slice(0, -1) || path.startsWith(directory);
}

export function aggregateContentSections(
  sections: NonNullable<SiteProfile["seoSections"]>,
  pages: readonly MetrikaContentPageRow[],
): ContentSectionRow[] {
  const prefixes = sections.flatMap((section) => section.pathPrefixes.map((prefix) => ({ section, prefix })))
    .sort((left, right) => right.prefix.length - left.prefix.length);
  const grouped = new Map<string, MetrikaContentPageRow[]>();
  for (const page of pages) {
    const match = prefixes.find(({ prefix }) => matchesPrefix(pathFromUrl(page.url), prefix));
    if (!match) continue;
    grouped.set(match.section.id, [...(grouped.get(match.section.id) ?? []), page]);
  }
  return sections.flatMap((section) => {
    const rows = grouped.get(section.id) ?? [];
    if (rows.length === 0) return [];
    const pageviews = rows.reduce((sum, row) => sum + row.pageviews, 0);
    const visits = rows.reduce((sum, row) => sum + row.visits, 0);
    const weighted = (key: "bounceRate" | "avgVisitDurationSeconds" | "pageDepth") => {
      const measured = rows.filter((row) => row[key] !== null && row.visits > 0);
      const measuredVisits = measured.reduce((sum, row) => sum + row.visits, 0);
      return measuredVisits > 0 ? measured.reduce((sum, row) => sum + row[key]! * row.visits, 0) / measuredVisits : null;
    };
    return [{
      id: section.id,
      label: section.label,
      pageviews,
      visits,
      bounceRate: weighted("bounceRate"),
      avgVisitDurationSeconds: weighted("avgVisitDurationSeconds"),
      pageDepth: weighted("pageDepth"),
    }];
  });
}

function sortValue(row: MetrikaContentPageRow, key: ContentSortKey): string | number | null {
  if (key === "title") return row.title?.trim() || row.url;
  return row[key];
}

export function filterSortPaginateContentPages(
  pages: readonly MetrikaContentPageRow[],
  query: string,
  sort: ContentSort,
  requestedPage: number,
) {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  const filtered = normalized
    ? pages.filter((row) => `${row.title ?? ""} ${row.url}`.toLocaleLowerCase("ru-RU").includes(normalized))
    : [...pages];
  const direction = sort.direction === "asc" ? 1 : -1;
  filtered.sort((left, right) => {
    const leftValue = sortValue(left, sort.key);
    const rightValue = sortValue(right, sort.key);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) return (leftValue - rightValue) * direction;
    return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "ru-RU") * direction || left.url.localeCompare(right.url, "ru-RU");
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return { rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, totalPages, totalRows: filtered.length };
}

function displayNumber(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : number.format(Math.round(value));
}

function displayDecimal(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function displayPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${displayDecimal(value)}%`;
}

function displayDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function contentHref(domain: string, url: string): string | null {
  try {
    const parsed = new URL(url, `https://${domain}`);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch { return null; }
}

function ContentTable({ rows, domain, label }: Readonly<{
  rows: readonly (MetrikaContentPageRow | ContentSectionRow)[];
  domain: string;
  label: string;
}>) {
  return <TableFrame label={label}>
    <table className="site-seo-table-bounded site-seo-content-table">
      <thead><tr><th>Страница или раздел</th><th>Просмотры</th><th>Визиты</th><th>Отказы</th><th>Ср. время</th><th>Глубина</th></tr></thead>
      <tbody>{rows.map((row) => {
        const page = "url" in row ? row : null;
        const section = "label" in row ? row : null;
        const text = page?.title?.trim() || page?.url || section!.label;
        const href = page ? contentHref(domain, page.url) : null;
        return <tr key={page?.url ?? section!.id}>
          <th scope="row" className="site-seo-url-cell">{href ? <><a href={href} target="_blank" rel="noreferrer">{text}</a>{page!.title ? <small>{pathFromUrl(page!.url)}</small> : null}</> : text}</th>
          <td>{displayNumber(row.pageviews)}</td><td>{displayNumber(row.visits)}</td><td>{displayPercent(row.bounceRate)}</td><td>{displayDuration(row.avgVisitDurationSeconds)}</td><td>{displayDecimal(row.pageDepth)}</td>
        </tr>;
      })}</tbody>
    </table>
  </TableFrame>;
}

function bestEngagementPages(rows: readonly MetrikaContentPageRow[]): MetrikaContentPageRow[] {
  const score = (row: MetrikaContentPageRow) => row.visits * (100 - (row.bounceRate ?? 100)) / 100 * (Math.min(row.avgVisitDurationSeconds ?? 0, 300) / 60 + (row.pageDepth ?? 1));
  return rows.filter((row) => row.visits >= 10 && (row.bounceRate ?? 100) <= 40).sort((left, right) => score(right) - score(left) || right.visits - left.visits).slice(0, 12);
}

function highBouncePages(rows: readonly MetrikaContentPageRow[]): MetrikaContentPageRow[] {
  return rows.filter((row) => row.visits >= 10 && (row.bounceRate ?? 0) >= 50)
    .sort((left, right) => right.visits * (right.bounceRate ?? 0) - left.visits * (left.bounceRate ?? 0) || (right.bounceRate ?? 0) - (left.bounceRate ?? 0))
    .slice(0, 12);
}

function SortButton({ label, sortKey, sort, onChange }: Readonly<{ label: string; sortKey: ContentSortKey; sort: ContentSort; onChange: (key: ContentSortKey) => void }>) {
  const active = sort.key === sortKey;
  return <button type="button" className="site-seo-content-sort-button" data-active={active} aria-pressed={active} onClick={() => onChange(sortKey)}>{label}{active ? (sort.direction === "desc" ? " ↓" : " ↑") : ""}</button>;
}

export function Content({ id, profile, data }: Readonly<{ id: string; profile: SiteProfile; data: MetrikaCanonicalData | null }>) {
  const pages = data?.contentPages ?? [];
  const sections = useMemo(() => aggregateContentSections(profile.seoSections ?? [], pages), [pages, profile.seoSections]);
  const popular = useMemo(() => [...pages].sort((left, right) => right.pageviews - left.pageviews || right.visits - left.visits || left.url.localeCompare(right.url, "ru-RU")).slice(0, 10), [pages]);
  const engagement = useMemo(() => bestEngagementPages(pages), [pages]);
  const bounceRisk = useMemo(() => highBouncePages(pages), [pages]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ContentSort>({ key: "pageviews", direction: "desc" });
  const paginated = useMemo(() => filterSortPaginateContentPages(pages, query, sort, page), [page, pages, query, sort]);
  const changeSort = (key: ContentSortKey) => {
    setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "title" ? "asc" : "desc" });
    setPage(1);
  };
  const totalPageviews = pages.reduce((sum, row) => sum + row.pageviews, 0);
  const totalVisits = pages.reduce((sum, row) => sum + row.visits, 0);

  return <div id={id} className="site-seo-section-stack">
    <Panel panelId="content.state" title="Состояние контента" subtitle={data?.period ? `${data.period.from} — ${data.period.to}` : undefined}>
      <KpiStrip><Kpi label="Страницы" value={number.format(pages.length)} /><Kpi label="Просмотры" value={number.format(totalPageviews)} /><Kpi label="Входные визиты" value={number.format(totalVisits)} /></KpiStrip>
      {pages.length === 0 ? <EmptyNotice>Нет канонических метрик страниц за выбранную неделю.</EmptyNotice> : null}
    </Panel>
    {pages.length > 0 ? <>
      <Panel panelId="content.sections" title="Разделы сайта" subtitle="Раздел определяется по самому длинному совпавшему префиксу из профиля сайта.">
        {sections.length > 0 ? <ContentTable rows={sections} domain={profile.domain} label="Метрики разделов сайта" /> : <EmptyNotice>Ни одна страница не совпала с настроенными разделами сайта.</EmptyNotice>}
      </Panel>
      <Panel panelId="content.popular" title="Популярные страницы" subtitle="Топ-10 страниц по просмотрам за выбранную неделю."><ContentTable rows={popular} domain={profile.domain} label="Популярные страницы" /></Panel>
      <Panel panelId="content.engagement" title="Лучшее удержание" subtitle="Входные страницы: не менее 10 визитов и не более 40% отказов.">
        {engagement.length > 0 ? <ContentTable rows={engagement} domain={profile.domain} label="Страницы с лучшим удержанием" /> : <EmptyNotice>Нет страниц, отвечающих порогу удержания.</EmptyNotice>}
      </Panel>
      <Panel panelId="content.bounce-risk" title="Риск отказов" subtitle="Входные страницы: не менее 10 визитов и от 50% отказов.">
        {bounceRisk.length > 0 ? <ContentTable rows={bounceRisk} domain={profile.domain} label="Страницы с риском отказов" /> : <EmptyNotice>Нет страниц, отвечающих порогу риска отказов.</EmptyNotice>}
      </Panel>
      <Panel panelId="content.all" title="Все страницы" subtitle="Поиск, сортировка и постраничный просмотр по 50 строк.">
        <div className="site-seo-content-controls">
          <label>Поиск по странице или URL<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Название или /path/" /></label>
          <div className="site-seo-content-sort-buttons" aria-label="Сортировка страниц">
            <SortButton label="Название" sortKey="title" sort={sort} onChange={changeSort} />
            <SortButton label="Просмотры" sortKey="pageviews" sort={sort} onChange={changeSort} />
            <SortButton label="Визиты" sortKey="visits" sort={sort} onChange={changeSort} />
            <SortButton label="Отказы" sortKey="bounceRate" sort={sort} onChange={changeSort} />
            <SortButton label="Ср. время" sortKey="avgVisitDurationSeconds" sort={sort} onChange={changeSort} />
            <SortButton label="Глубина" sortKey="pageDepth" sort={sort} onChange={changeSort} />
          </div>
        </div>
        {paginated.totalRows > 0 ? <ContentTable rows={paginated.rows} domain={profile.domain} label="Все страницы" /> : <EmptyNotice>По запросу ничего не найдено.</EmptyNotice>}
        <footer className="site-seo-content-pagination"><button type="button" disabled={paginated.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Предыдущая</button><span>{number.format(paginated.totalRows)} найдено · Страница {paginated.page} из {paginated.totalPages}</span><button type="button" disabled={paginated.page >= paginated.totalPages} onClick={() => setPage((current) => Math.min(paginated.totalPages, current + 1))}>Следующая</button></footer>
      </Panel>
    </> : null}
  </div>;
}

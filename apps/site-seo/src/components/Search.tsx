"use client";

import type { SiteProfile } from "@reportingdash/site-seo-contract";
import { useMemo, useState } from "react";
import type { WebmasterCanonicalMetrics } from "../lib/db.ts";
import type { DashboardReadModel } from "../lib/read-model.ts";
import { EmptyNotice, Kpi, KpiStrip, Panel, TableFrame } from "./DashboardPrimitives.tsx";

const number = new Intl.NumberFormat("ru-RU");

function metric(value: number | null | undefined, maximumFractionDigits = 2): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits });
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${metric(value)}%`;
}

type SectionAggregate = Readonly<{
  id: string;
  label: string;
  metrics: WebmasterCanonicalMetrics | null;
}>;

function pathname(value: string): string {
  try { return new URL(value, "https://site-seo.local").pathname; }
  catch { return value.split(/[?#]/, 1)[0] ?? value; }
}

export function aggregateWebmasterSections(
  sections: NonNullable<SiteProfile["seoSections"]>,
  pages: NonNullable<DashboardReadModel["webmaster"]>["topPages"],
): SectionAggregate[] {
  const prefixes = sections.flatMap((section) => section.pathPrefixes.map((prefix) => ({ section, prefix })))
    .sort((left, right) => right.prefix.length - left.prefix.length);
  const grouped = new Map<string, typeof pages>();
  for (const page of pages) {
    const path = pathname(page.page);
    const match = prefixes.find(({ prefix }) => path === prefix.slice(0, -1) || path.startsWith(prefix));
    if (match) grouped.set(match.section.id, [...(grouped.get(match.section.id) ?? []), page]);
  }
  return sections.map((section) => {
    const rows = grouped.get(section.id) ?? [];
    if (rows.length === 0) return { id: section.id, label: section.label, metrics: null };
    const clicks = rows.reduce((sum, row) => sum + row.metrics.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.metrics.impressions, 0);
    const positioned = rows.filter((row) => row.metrics.averagePosition !== null && (row.metrics.positionedImpressions ?? row.metrics.impressions) > 0);
    const positionedImpressions = positioned.reduce((sum, row) => sum + (row.metrics.positionedImpressions ?? row.metrics.impressions), 0);
    return {
      id: section.id,
      label: section.label,
      metrics: {
        clicks,
        impressions,
        ctrPct: impressions > 0 ? clicks / impressions * 100 : null,
        averagePosition: positionedImpressions > 0
          ? positioned.reduce((sum, row) => sum + row.metrics.averagePosition! * (row.metrics.positionedImpressions ?? row.metrics.impressions), 0) / positionedImpressions
          : null,
        positionedImpressions,
      },
    };
  });
}

export type UnifiedQuery = Readonly<{
  phrase: string;
  google: WebmasterCanonicalMetrics | null;
  yandex: WebmasterCanonicalMetrics | null;
}>;

export type QuerySortKey =
  | "google_impressions" | "google_clicks" | "google_ctr" | "google_position"
  | "yandex_impressions" | "yandex_clicks" | "yandex_ctr" | "yandex_position"
  | "seo_os_position";

export type QuerySort = Readonly<{ key: QuerySortKey; direction: "asc" | "desc" }>;

function querySortValue(row: UnifiedQuery, key: QuerySortKey): number | null {
  const [source, field] = key.split("_") as ["google" | "yandex" | "seo", string];
  if (source === "seo") return null;
  const metrics = row[source];
  if (!metrics) return null;
  if (field === "impressions") return metrics.impressions;
  if (field === "clicks") return metrics.clicks;
  if (field === "ctr") return metrics.ctrPct;
  return metrics.averagePosition;
}

export function sortUnifiedQueries(rows: readonly UnifiedQuery[], sort: QuerySort): UnifiedQuery[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = querySortValue(left, sort.key);
    const rightValue = querySortValue(right, sort.key);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) return (leftValue - rightValue) * direction;
    return left.phrase.localeCompare(right.phrase, "ru-RU");
  });
}

export function toggleQuerySort(current: QuerySort, key: QuerySortKey): QuerySort {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: key.endsWith("position") ? "asc" : "desc" };
}

function mergeQueryMetrics(current: WebmasterCanonicalMetrics | null, next: WebmasterCanonicalMetrics): WebmasterCanonicalMetrics {
  if (!current) return next;
  const clicks = current.clicks + next.clicks;
  const impressions = current.impressions + next.impressions;
  const positioned = [current, next].filter((metrics) => metrics.averagePosition !== null && (metrics.positionedImpressions ?? metrics.impressions) > 0);
  const positionedImpressions = positioned.reduce((sum, metrics) => sum + (metrics.positionedImpressions ?? metrics.impressions), 0);
  return {
    clicks,
    impressions,
    ctrPct: impressions > 0 ? clicks / impressions * 100 : null,
    averagePosition: positionedImpressions > 0
      ? positioned.reduce((sum, metrics) => sum + metrics.averagePosition! * (metrics.positionedImpressions ?? metrics.impressions), 0) / positionedImpressions
      : null,
    positionedImpressions,
  };
}

function unifiedQueries(model: DashboardReadModel, showGsc: boolean, showWebmaster: boolean): UnifiedQuery[] {
  const rows = new Map<string, UnifiedQuery>();
  const add = (phrase: string, source: "google" | "yandex", metrics: WebmasterCanonicalMetrics) => {
    const normalized = phrase.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
    if (!normalized) return;
    const current = rows.get(normalized) ?? { phrase: phrase.trim().replace(/\s+/g, " "), google: null, yandex: null };
    rows.set(normalized, { ...current, [source]: mergeQueryMetrics(current[source], metrics) });
  };
  if (showGsc) {
    for (const row of model.gsc.dimensions) if (row.dimension === "query") add(row.value, "google", row.metrics);
  }
  if (showWebmaster) {
    for (const row of model.webmaster?.queryFacts ?? []) add(row.query, "yandex", row.metrics);
  }
  // Server HTML intentionally renders a deterministic top 100 by maximum source impressions.
  return [...rows.values()]
    .sort((left, right) => Math.max(right.google?.impressions ?? 0, right.yandex?.impressions ?? 0) - Math.max(left.google?.impressions ?? 0, left.yandex?.impressions ?? 0) || left.phrase.localeCompare(right.phrase, "ru"))
    .slice(0, 100);
}

function SourceCells({ metrics }: Readonly<{ metrics: WebmasterCanonicalMetrics | null }>) {
  return <><td>{metrics ? number.format(metrics.impressions) : "—"}</td><td>{metrics ? number.format(metrics.clicks) : "—"}</td><td>{percent(metrics?.ctrPct)}</td><td>{metric(metrics?.averagePosition)}</td></>;
}

function SortButton({ label, sourceLabel, sortKey, sort, onChange }: Readonly<{
  label: string;
  sourceLabel: string;
  sortKey: QuerySortKey;
  sort: QuerySort;
  onChange: (key: QuerySortKey) => void;
}>) {
  const active = sort.key === sortKey;
  const direction = active ? (sort.direction === "asc" ? "↑" : "↓") : "";
  return <button
    type="button"
    className="site-seo-sort-button"
    data-active={active}
    aria-pressed={active}
    aria-label={`Сортировать: ${label} ${sourceLabel}. ${active ? `Сейчас ${sort.direction === "asc" ? "от меньшего к большему" : "от большего к меньшему"}` : "Нажмите для сортировки"}`}
    onClick={() => onChange(sortKey)}
  ><span>{label}</span><span aria-hidden="true">{direction}</span></button>;
}

function sectionPositionTicks(maxPosition: number): number[] {
  const upper = Math.max(2, Math.ceil(maxPosition) + 1);
  const count = Math.min(5, upper);
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round(1 + (upper - 1) * index / Math.max(1, count - 1))))];
}

function SectionPositionChart({ sections }: Readonly<{ sections: readonly SectionAggregate[] }>) {
  const positioned = sections.flatMap((section, index) => section.metrics?.averagePosition == null ? [] : [{ ...section, index, position: section.metrics.averagePosition }]);
  if (positioned.length === 0) return <EmptyNotice>Нет опубликованных позиций по настроенным разделам.</EmptyNotice>;
  const width = 760;
  const height = 280;
  const margin = { top: 20, right: 22, bottom: 58, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxPosition = Math.max(...positioned.map((row) => row.position));
  const ticks = sectionPositionTicks(maxPosition);
  const domainMax = ticks.at(-1) ?? 2;
  const x = (index: number) => sections.length === 1 ? margin.left + plotWidth / 2 : margin.left + index * plotWidth / (sections.length - 1);
  const y = (position: number) => margin.top + (position - 1) / Math.max(1, domainMax - 1) * plotHeight;
  const points = positioned.map((row) => `${x(row.index)},${y(row.position)}`).join(" ");
  return <div className="site-seo-section-position-chart" data-chart-kind="section-position-line" data-y-axis="reversed">
    <p className="site-seo-chart-legend"><span aria-hidden="true" />Средняя позиция · Яндекс Вебмастер</p>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Средняя позиция сайта по разделам; позиция 1 находится сверху">
      {ticks.map((tick) => <g key={tick}>
        <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="site-seo-chart-grid-line" />
        <text x={margin.left - 10} y={y(tick) + 4} textAnchor="end" className="site-seo-chart-axis-label">{tick}</text>
      </g>)}
      {positioned.length > 1 ? <polyline points={points} className="site-seo-section-position-line" /> : null}
      {positioned.map((row) => <g key={row.id}>
        <circle cx={x(row.index)} cy={y(row.position)} r="5" className="site-seo-section-position-dot"><title>{`${row.label}: позиция ${metric(row.position, 1)}`}</title></circle>
        <text x={x(row.index)} y={y(row.position) - 10} textAnchor="middle" className="site-seo-section-position-value">{metric(row.position, 1)}</text>
      </g>)}
      {sections.map((section, index) => <text key={section.id} x={x(index)} y={height - 22} textAnchor="middle" className="site-seo-chart-x-label">{section.label}</text>)}
      <text transform={`translate(15 ${margin.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="site-seo-chart-axis-title">Позиция</text>
    </svg>
    <table className="site-seo-sr-only"><caption>Позиции по разделам</caption><thead><tr><th>Раздел</th><th>Позиция</th></tr></thead><tbody>{sections.map((section) => <tr key={section.id}><th scope="row">{section.label}</th><td>{metric(section.metrics?.averagePosition)}</td></tr>)}</tbody></table>
  </div>;
}

export function Search({ id, model, profile, showGsc, showWebmaster = true }: Readonly<{
  id: string;
  model: DashboardReadModel;
  profile?: SiteProfile;
  showGsc: boolean;
  showWebmaster?: boolean;
  comparison?: DashboardReadModel["trafficComparison"]["yandex_webmaster"];
  comparisonKey?: string;
}>) {
  const sections = useMemo(
    () => aggregateWebmasterSections(profile?.seoSections ?? [], showWebmaster ? model.webmaster?.topPages ?? [] : []),
    [model.webmaster?.topPages, profile?.seoSections, showWebmaster],
  );
  const queries = useMemo(() => unifiedQueries(model, showGsc, showWebmaster), [model, showGsc, showWebmaster]);
  const [querySearch, setQuerySearch] = useState("");
  const [querySort, setQuerySort] = useState<QuerySort>({ key: "yandex_impressions", direction: "desc" });
  const visibleQueries = useMemo(() => {
    const normalized = querySearch.trim().toLocaleLowerCase("ru-RU");
    const filtered = normalized ? queries.filter((row) => row.phrase.toLocaleLowerCase("ru-RU").includes(normalized)) : queries;
    return sortUnifiedQueries(filtered, querySort);
  }, [queries, querySearch, querySort]);
  const changeSort = (key: QuerySortKey) => setQuerySort((current) => toggleQuerySort(current, key));

  return (
    <div id={id} className="site-seo-section-stack">
      <div className="site-seo-seo-summary-grid">
        <Panel panelId="seo.alice" title="ИИ-видимость в Алисе AI">
          <KpiStrip>
            <Kpi label="Официальный SOV" value={model.alice?.officialSovPct == null ? "—" : percent(model.alice.officialSovPct)} />
            <Kpi label="Присутствие" value={model.alice?.samplePresencePct == null ? "—" : percent(model.alice.samplePresencePct)} />
          </KpiStrip>
          {!model.alice ? <EmptyNotice>Нет опубликованной выгрузки за выбранный месяц.</EmptyNotice> : null}
        </Panel>

        <Panel panelId="seo.sections" title="Позиции по разделам">
          {sections.length ? <SectionPositionChart sections={sections} /> : <EmptyNotice>Разделы не настроены.</EmptyNotice>}
        </Panel>
      </div>

      <Panel panelId="seo.queries" title="Запросы: Google, Яндекс и SEO OS" subtitle="Топ-100 фраз по показам в доступных поисковых источниках">
        <div className="site-seo-query-controls">
          <label>Поиск по фразе<input type="search" value={querySearch} onChange={(event) => setQuerySearch(event.target.value)} placeholder="Поиск по фразе" /></label>
          <span>{visibleQueries.length.toLocaleString("ru-RU")} из {queries.length.toLocaleString("ru-RU")}</span>
        </div>
        <TableFrame label="Объединённые поисковые запросы">
          <table className="site-seo-table site-seo-table-bounded site-seo-query-comparison">
            <thead>
              <tr><th rowSpan={2}>Запрос</th><th colSpan={4} data-source-group="google"><span className="site-seo-source-marker" aria-hidden="true" />Google</th><th colSpan={4} data-source-group="yandex"><span className="site-seo-source-marker" aria-hidden="true" />Яндекс Вебмастер</th><th colSpan={3} data-source-group="seo-os"><span className="site-seo-source-marker" aria-hidden="true" />SEO OS</th></tr>
              <tr>
                <th data-source-group="google"><SortButton label="Показы" sourceLabel="Google" sortKey="google_impressions" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="google"><SortButton label="Клики" sourceLabel="Google" sortKey="google_clicks" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="google"><SortButton label="CTR" sourceLabel="Google" sortKey="google_ctr" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="google"><SortButton label="Позиция" sourceLabel="Google" sortKey="google_position" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="yandex"><SortButton label="Показы" sourceLabel="Яндекс" sortKey="yandex_impressions" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="yandex"><SortButton label="Клики" sourceLabel="Яндекс" sortKey="yandex_clicks" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="yandex"><SortButton label="CTR" sourceLabel="Яндекс" sortKey="yandex_ctr" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="yandex"><SortButton label="Позиция" sourceLabel="Яндекс" sortKey="yandex_position" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="seo-os"><SortButton label="Позиция" sourceLabel="SEO OS" sortKey="seo_os_position" sort={querySort} onChange={changeSort} /></th>
                <th data-source-group="seo-os">Дельта</th><th data-source-group="seo-os">Статус</th>
              </tr>
            </thead>
            <tbody>{visibleQueries.length ? visibleQueries.map((row) => <tr key={row.phrase}><th scope="row" className="site-seo-wrap-cell">{row.phrase}</th><SourceCells metrics={row.google} /><SourceCells metrics={row.yandex} /><td>—</td><td>—</td><td>—</td></tr>) : <tr><td colSpan={12} className="site-seo-empty-row">{queries.length ? "Нет запросов, соответствующих поиску." : "Нет опубликованных запросов за выбранные периоды."}</td></tr>}</tbody>
          </table>
        </TableFrame>
      </Panel>
    </div>
  );
}

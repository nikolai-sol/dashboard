"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ZarukuTableFrame from "@/components/ZarukuTableFrame";
import {
  aliceDetailState,
  filterAliceQueries,
  monthlySovDelta,
  paginateAliceQueries,
  selectAliceSnapshot,
  type AlicePresenceFilter,
} from "@/components/zaruku-alice-visibility-view";
import { resolveSafeExternalUrl } from "@/components/zaruku-seo-analytics";
import { ZARUKU_CHART_PALETTE } from "@/lib/chart-palette";
import { resolveZarukuContentUrl } from "@/lib/zaruku-url";
import type { ZarukuAliceVisibilityQuery, ZarukuAliceVisibilitySnapshot, ZarukuSeoData } from "@/lib/types";

type Props = { data: ZarukuSeoData["alice_visibility"]; locale?: string };

function formatNumber(value: number | null | undefined, locale: string) {
  return value == null || !Number.isFinite(value) ? "—" : Math.round(value).toLocaleString(locale);
}

function formatPercent(value: number | null | undefined, locale: string, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toLocaleString(locale, { maximumFractionDigits: digits })}%`;
}

function formatMonth(month: string, locale: string) {
  const parsed = new Date(`${month}-01T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? month
    : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function shortUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return value;
  }
}

function ExternalLink({ value, children }: { value: string | null; children: string }) {
  const href = resolveSafeExternalUrl(value);
  return href ? <a href={href} target="_blank" rel="noreferrer" title={href} className="max-w-full truncate text-teal-700 hover:text-teal-900 hover:underline">{children}</a> : <span className="max-w-full truncate text-slate-400">{children}</span>;
}

function PortalLink({ value }: { value: string | null }) {
  const href = resolveZarukuContentUrl(value);
  return href ? <a href={href} target="_blank" rel="noreferrer" title={href} className="max-w-full truncate text-teal-700 hover:text-teal-900 hover:underline">{shortUrl(href)}</a> : <span className="text-slate-400">—</span>;
}

function SourceList({ row }: { row: ZarukuAliceVisibilityQuery }) {
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Все источники в ответе ({row.sourceCount})</summary>
      <ol className="mt-2 space-y-1 pl-5 marker:text-slate-400">
        {row.sources.map((source) => <li key={source.id} className="min-w-0">
          <span className="mr-1 text-slate-400">{source.sourceRank}.</span>
          {source.isPortal ? <PortalLink value={source.sourceUrl} /> : <ExternalLink value={source.sourceUrl}>{shortUrl(source.sourceUrl)}</ExternalLink>}
        </li>)}
      </ol>
    </details>
  );
}

function KpiCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-lg bg-slate-50 px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className="zaruku-kpi-value mt-1 text-xl font-semibold text-slate-900">{value}</div>{note ? <div className="mt-1 text-xs text-slate-500">{note}</div> : null}</div>;
}

function QueryTable({ snapshot, locale }: { snapshot: ZarukuAliceVisibilitySnapshot; locale: string }) {
  const [text, setText] = useState("");
  const [presence, setPresence] = useState<AlicePresenceFilter>("all");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterAliceQueries(snapshot.queries, { text, presence }), [presence, snapshot.queries, text]);
  const paginated = useMemo(() => paginateAliceQueries(filtered, page), [filtered, page]);
  const setFilterText = (value: string) => { setText(value); setPage(1); };
  const setPresenceFilter = (value: AlicePresenceFilter) => { setPresence(value); setPage(1); };

  return (
    <section className="card-surface zaruku-panel">
      <header className="zaruku-panel-header">
        <div><h3 className="text-base font-semibold text-slate-900">Запросы и позиция Zaruku</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">Строки из переданной выгрузки. Первые три внешних источника показаны рядом с запросом, полный список раскрывается ниже.</p></div>
      </header>
      <div className="zaruku-panel-body">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="block w-full max-w-xl text-xs font-medium text-slate-600">Поиск по запросу<input type="search" value={text} onChange={(event) => setFilterText(event.target.value)} placeholder="Введите запрос" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-400" /></label>
          <label className="block shrink-0 text-xs font-medium text-slate-600">Присутствие Zaruku<select value={presence} onChange={(event) => setPresenceFilter(event.target.value as AlicePresenceFilter)} className="mt-1.5 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-400"><option value="all">Все</option><option value="present">Есть</option><option value="absent">Нет</option></select></label>
        </div>
        <ZarukuTableFrame mode="operational" label="Запросы и позиция Zaruku">
          <table className="zaruku-table min-w-[920px]">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Запрос</th><th className="pb-2 font-medium">Zaruku</th><th className="pb-2 font-medium">Место</th><th className="pb-2 font-medium">Страница</th><th className="pb-2 font-medium">Первые источники</th><th className="pb-2 font-medium">Ответ Алисы</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{paginated.rows.map((row) => {
              const competitors = row.sources.filter((source) => !source.isPortal).slice(0, 3);
              return <tr key={row.id} className="align-top"><td className="max-w-[280px] py-3 pr-4 font-medium leading-snug text-slate-700"><div>{row.queryText}</div><SourceList row={row} /></td><td className="whitespace-nowrap py-3 pr-4"><span className={row.portalPresent ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700" : "rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"}>{row.portalPresent ? "Есть" : "Нет"}</span></td><td className="whitespace-nowrap py-3 pr-4 tabular-nums text-slate-600">{formatNumber(row.portalPosition, locale)}</td><td className="max-w-[170px] py-3 pr-4"><PortalLink value={row.portalUrl} /></td><td className="max-w-[260px] py-3 pr-4"><div className="space-y-1">{competitors.length ? competitors.map((source) => <div key={source.id}><ExternalLink value={source.sourceUrl}>{shortUrl(source.sourceUrl)}</ExternalLink></div>) : <span className="text-slate-400">—</span>}</div></td><td className="whitespace-nowrap py-3"><ExternalLink value={row.aliceAnswerUrl}>Открыть</ExternalLink></td></tr>;
            })}</tbody>
          </table>
        </ZarukuTableFrame>
        <footer className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500"><button type="button" disabled={paginated.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Предыдущая</button><span>{paginated.totalRows.toLocaleString(locale)} найдено · Страница {paginated.page} из {paginated.totalPages}</span><button type="button" disabled={paginated.page >= paginated.totalPages} onClick={() => setPage((current) => Math.min(paginated.totalPages, current + 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Следующая</button></footer>
      </div>
    </section>
  );
}

function CompetitorPanels({ snapshot, locale }: { snapshot: ZarukuAliceVisibilitySnapshot; locale: string }) {
  return <div className="grid gap-4 xl:grid-cols-2"><section className="card-surface zaruku-panel"><header className="zaruku-panel-header"><div><h3 className="text-base font-semibold text-slate-900">Конкуренты в выгрузке</h3><p className="mt-1 text-xs text-slate-500">Домен считается один раз для каждого запроса, где он встретился среди источников Алисы.</p></div></header><div className="zaruku-panel-body"><ZarukuTableFrame mode="standard" label="Конкуренты в выгрузке"><table className="zaruku-table min-w-[360px]"><thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Домен</th><th className="pb-2 text-right font-medium">Запросов</th><th className="pb-2 text-right font-medium">Доля</th></tr></thead><tbody className="divide-y divide-slate-100">{snapshot.competitors.map((competitor) => <tr key={competitor.domain}><td className="py-2.5 font-medium text-slate-700">{competitor.domain}</td><td className="py-2.5 text-right tabular-nums text-slate-600">{formatNumber(competitor.queryCount, locale)}</td><td className="py-2.5 text-right tabular-nums text-slate-600">{formatPercent(competitor.sharePct, locale)}</td></tr>)}</tbody></table></ZarukuTableFrame>{snapshot.competitors.length === 0 ? <p className="mt-3 text-sm text-slate-500">В выгрузке нет внешних источников для подсчёта.</p> : null}</div></section><section className="card-surface zaruku-panel"><header className="zaruku-panel-header"><div><h3 className="text-base font-semibold text-slate-900">Примеры заметных сайтов по данным Яндекса</h3><p className="mt-1 text-xs text-slate-500">Это примеры из переданного списка. Порядок показа не является рейтингом.</p></div></header><div className="zaruku-panel-body"><ul className="space-y-2">{snapshot.featuredSites.map((site) => <li key={site.id} className="min-w-0"><ExternalLink value={site.siteUrl}>{site.siteDomain || shortUrl(site.siteUrl)}</ExternalLink></li>)}</ul>{snapshot.featuredSites.length === 0 ? <p className="text-sm text-slate-500">Яндекс не передал примеры заметных сайтов для этого месяца.</p> : null}</div></section></div>;
}

export default function ZarukuAliceVisibilityTab({ data, locale = "ru-RU" }: Props) {
  const [month, setMonth] = useState<string | null>(data.latestMonth);
  const snapshot = selectAliceSnapshot(data.snapshots, month);
  const detailState = aliceDetailState(snapshot);
  const chartRows = useMemo(() => [...data.snapshots].sort((left, right) => left.month.localeCompare(right.month)).map((row) => ({ month: row.month, sov: row.officialSovPct })), [data.snapshots]);
  const delta = monthlySovDelta(data.snapshots, snapshot?.month ?? null);

  if (!snapshot) return <section className="card-surface zaruku-panel"><div className="zaruku-panel-body text-sm text-slate-500"><h3 className="text-base font-semibold text-slate-900">ИИ-видимость и конкуренты</h3><p className="mt-2">Пока нет опубликованных снимков ИИ-видимости. Передайте месячную выгрузку из Яндекс Вебмастера, чтобы показать официальный показатель, запросы и источники.</p></div></section>;

  const hasQueryDetail = detailState === "ready";
  const hasExampleCoverage = snapshot.exportedQueryCount != null
    && snapshot.portalPresentQueryCount != null
    && snapshot.samplePresencePct != null;
  const detailMessage = snapshot.month === "2026-07"
    ? "Детализация запросов за июль не была сохранена."
    : `Детализация запросов за ${formatMonth(snapshot.month, locale)} пока недоступна.`;

  return <div className="zaruku-section-stack"><section className="card-surface zaruku-panel"><header className="zaruku-panel-header"><div><h3 className="text-base font-semibold text-slate-900">ИИ-видимость и конкуренты</h3><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">Ручная месячная выгрузка из Яндекс Вебмастера. Официальная доля и строки выгрузки сохраняются раздельно.</p></div><label className="text-xs font-medium text-slate-600">Месяц<select value={snapshot.month} onChange={(event) => setMonth(event.target.value)} className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-400">{[...data.snapshots].sort((left, right) => right.month.localeCompare(left.month)).map((item) => <option key={item.month} value={item.month}>{formatMonth(item.month, locale)}</option>)}</select></label></header><div className="zaruku-panel-body"><div className="h-52 min-w-0"><ResponsiveContainer width="100%" height={208} minWidth={0} minHeight={208}><LineChart data={chartRows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ZARUKU_CHART_PALETTE.grid} /><XAxis dataKey="month" tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} unit="%" /><Tooltip formatter={(value) => formatPercent(typeof value === "number" ? value : null, locale)} /><Line type="monotone" dataKey="sov" name="Официальная доля" stroke={ZARUKU_CHART_PALETTE.seo} strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Официальная доля в Алисе AI" value={formatPercent(snapshot.officialSovPct, locale)} note={delta == null ? "Первый опубликованный месяц" : `Δ ${delta > 0 ? "+" : ""}${formatPercent(delta, locale)} п.п.`} />{hasExampleCoverage ? <><KpiCard label="Запросов в выгрузке" value={formatNumber(snapshot.exportedQueryCount, locale)} /><KpiCard label="Zaruku присутствует" value={formatNumber(snapshot.portalPresentQueryCount, locale)} /><KpiCard label="Доля в примерах" value={formatPercent(snapshot.samplePresencePct, locale)} /></> : null}</div>{hasExampleCoverage ? <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">Официальная доля рассчитана Яндексом: {formatPercent(snapshot.officialSovPct, locale)} — это общий показатель видимости сайта. Доля в примерах рассчитана только по выгруженным строкам: {formatPercent(snapshot.samplePresencePct, locale)} среди {formatNumber(snapshot.exportedQueryCount, locale)} примеров.</p> : null}{hasQueryDetail ? null : <p role="status" className="mt-4 text-sm text-slate-500">{detailMessage}</p>}</div></section>{hasQueryDetail ? <><QueryTable snapshot={snapshot} locale={locale} /><CompetitorPanels snapshot={snapshot} locale={locale} /></> : null}</div>;
}

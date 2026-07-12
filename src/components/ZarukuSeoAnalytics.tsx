"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ZarukuSeoClusterStatus, ZarukuSeoOsData, ZarukuSeoSource } from "@/lib/types";
import {
  buildPositionComparisonRows,
  filterClusterRows,
  formatPositionDelta,
  resolveSafeExternalUrl,
  type PositionComparisonRow,
} from "@/components/zaruku-seo-analytics";

type Props = {
  seoOs: ZarukuSeoOsData;
  primaryWeek: string | null;
  comparisonWeek: string | null;
  source?: ZarukuSeoSource;
};

type StatusFilter = "all" | ZarukuSeoClusterStatus;

function formatPosition(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function formatCoverage(foundRows: number | null, trackedRows: number | null) {
  if (foundRows == null || trackedRows == null || trackedRows === 0) return "0 / 0";
  return `${foundRows} / ${trackedRows}`;
}

function coverageSummary(rows: PositionComparisonRow[], scope: "primary" | "comparison") {
  const values = rows.reduce(
    (total, row) => ({
      found: total.found + (scope === "primary" ? row.primary_found_rows : row.comparison_found_rows ?? 0),
      tracked: total.tracked + (scope === "primary" ? row.primary_tracked_rows : row.comparison_tracked_rows ?? 0),
    }),
    { found: 0, tracked: 0 },
  );
  return formatCoverage(values.found, values.tracked);
}

function PositionTooltip({ active, payload, comparisonWeek }: { active?: boolean; payload?: Array<{ payload: PositionComparisonRow }>; comparisonWeek: string | null }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-slate-800">{row.section}</div>
      <div className="mt-1 text-teal-700">A: {formatPosition(row.primary_position)} · покрытие {formatCoverage(row.primary_found_rows, row.primary_tracked_rows)}</div>
      {comparisonWeek ? (
        <div className="mt-1 text-slate-500">B: {formatPosition(row.comparison_position)} · покрытие {formatCoverage(row.comparison_found_rows, row.comparison_tracked_rows)}</div>
      ) : null}
    </div>
  );
}

function MatchedUrl({ value }: { value: string | null }) {
  const url = resolveSafeExternalUrl(value);
  if (!url) return <span className="text-slate-400">—</span>;
  const parsed = new URL(url);
  const label = `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 truncate text-teal-700 hover:text-teal-900 hover:underline"
      title={url}
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

export default function ZarukuSeoAnalytics({ seoOs, primaryWeek, comparisonWeek, source }: Props) {
  const [section, setSection] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const chartRows = useMemo(
    () => buildPositionComparisonRows(seoOs.position_trend, primaryWeek, comparisonWeek),
    [comparisonWeek, primaryWeek, seoOs.position_trend],
  );
  const plottedRows = useMemo(
    () => chartRows.filter((row) => row.primary_position != null || row.comparison_position != null),
    [chartRows],
  );
  const sections = useMemo(
    () => [...new Set(seoOs.clusters.filter((row) => row.week === primaryWeek).map((row) => row.section))].sort((left, right) => left.localeCompare(right)),
    [primaryWeek, seoOs.clusters],
  );
  const filteredRows = useMemo(
    () => filterClusterRows(seoOs.clusters, { week: primaryWeek, section, status }, comparisonWeek),
    [comparisonWeek, primaryWeek, section, seoOs.clusters, status],
  );
  const primaryCoverage = coverageSummary(chartRows, "primary");
  const comparisonCoverage = comparisonWeek ? coverageSummary(chartRows, "comparison") : null;

  if (!seoOs.data_availability.positions) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white px-5 py-8">
        <h3 className="text-base font-semibold text-slate-900">Позиции SEO временно недоступны</h3>
        <p className="mt-2 text-sm text-slate-500">Не удалось загрузить данные позиций. Повторите попытку позже.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Позиции по разделам</h3>
          <p className="mt-1 text-xs text-slate-500">SEO OS: отслеживаемые позиции в выдаче Яндекса</p>
        </div>
        {source ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />
            {source.label}
          </span>
        ) : null}
      </header>

      <div className="border-b border-slate-100 px-5 py-4">
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span><span className="font-medium text-teal-700">A {primaryWeek ?? "—"}</span> · покрытие {primaryCoverage}</span>
          {comparisonWeek ? <span><span className="font-medium text-slate-700">B {comparisonWeek}</span> · покрытие {comparisonCoverage}</span> : null}
        </div>
        {plottedRows.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={plottedRows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="section" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis
                domain={[1, "dataMax + 1"]}
                reversed
                allowDecimals={false}
                tick={{ fontSize: 12, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                label={{ value: "Позиция", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 12 }}
              />
              <Tooltip content={<PositionTooltip comparisonWeek={comparisonWeek} />} />
              <Line type="linear" dataKey="primary_position" name={`A ${primaryWeek ?? ""}`} stroke="#0d9488" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} />
              {comparisonWeek ? <Line type="linear" dataKey="comparison_position" name={`B ${comparisonWeek}`} stroke="#64748b" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2 }} connectNulls={false} /> : null}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[280px] items-center justify-center text-sm text-slate-500">Нет найденных позиций для выбранной недели.</div>
        )}
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Кластеры запросов</h4>
            <p className="mt-1 text-xs text-slate-500">{primaryWeek ?? "Выберите основную неделю"} · {filteredRows.length} строк</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="grid gap-1 text-xs font-medium text-slate-500">
              Раздел
              <select value={section} onChange={(event) => setSection(event.target.value)} className="h-8 min-w-36 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-teal-600">
                <option value="all">Все разделы</option>
                {sections.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-500">
              Статус
              <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="h-8 min-w-32 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-teal-600">
                <option value="all">Все статусы</option>
                <option value="found">Найдено</option>
                <option value="no_data">Не найдено</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-3 max-h-[34rem] overflow-auto rounded-md border border-slate-100">
          <table className="w-full min-w-[960px] table-fixed text-sm">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[30%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[23%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-400 shadow-[0_1px_0_0_rgb(241_245_249)]">
              <tr>
                <th className="px-3 py-2.5 font-medium">Раздел</th>
                <th className="px-3 py-2.5 font-medium">Запрос</th>
                <th className="px-3 py-2.5 text-right font-medium">Позиция</th>
                <th className="px-3 py-2.5 text-right font-medium">Изменение</th>
                <th className="px-3 py-2.5 font-medium">URL</th>
                <th className="px-3 py-2.5 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((row) => {
                const delta = formatPositionDelta(row.display_delta);
                return (
                  <tr key={`${row.week}-${row.cluster_id}`} className="align-top hover:bg-slate-50/70">
                    <td className="truncate px-3 py-2.5 text-slate-500" title={row.section}>{row.section}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-700" title={row.query}><div className="line-clamp-2">{row.query}</div></td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-700">{formatPosition(row.serp_position)}</td>
                    <td className={delta.tone === "improved" ? "px-3 py-2.5 text-right font-medium text-emerald-600" : delta.tone === "declined" ? "px-3 py-2.5 text-right font-medium text-red-600" : "px-3 py-2.5 text-right text-slate-400"}>
                      <span className="inline-flex items-center gap-1">
                        {delta.tone === "improved" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                        {delta.tone === "declined" ? <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                        {delta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5"><MatchedUrl value={row.matched_url} /></td>
                    <td className="px-3 py-2.5">
                      {row.status === "no_data" ? <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">не найдено</span> : <span className="text-slate-600">найдено</span>}
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">Нет кластеров для выбранных фильтров.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

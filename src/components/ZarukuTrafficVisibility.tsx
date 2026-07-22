"use client";

import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { ZarukuSeoOsData, ZarukuSeoSource } from "@/lib/types";
import { buildTrafficVisibilityRows } from "@/components/zaruku-traffic-visibility";

type Props = {
  seoOs: ZarukuSeoOsData;
  primaryWeek: string | null;
  comparisonWeek: string | null;
  source?: ZarukuSeoSource;
};

function formatNumber(value: number | null) {
  return value == null ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function positionDelta(value: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function isoWeekRange(week: string | null) {
  const match = /^(\d{4})-W(\d{2})$/.exec(week ?? "");
  if (!match) return week;
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const day = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - day + 1 + (weekNumber - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const now = new Date();
  const end = now >= monday && now <= sunday ? now : sunday;
  const from = monday.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);
  return from === to ? `${week} · факт ${from}` : `${week} · ${from} — ${to}`;
}

export default function ZarukuTrafficVisibility({ seoOs, primaryWeek, comparisonWeek, source }: Props) {
  const rows = useMemo(
    () => buildTrafficVisibilityRows(seoOs.traffic_visibility, seoOs.section_patterns, primaryWeek, comparisonWeek),
    [comparisonWeek, primaryWeek, seoOs.section_patterns, seoOs.traffic_visibility],
  );
  const chartRows = rows.map((row) => ({
    section: row.section,
    primary_pageviews: row.primary.pageviews,
    comparison_pageviews: row.comparison?.pageviews ?? null,
    primary_position: row.primary.average_position,
    comparison_position: row.comparison?.average_position ?? null,
  }));
  const primaryPeriodLabel = isoWeekRange(primaryWeek);
  const comparisonPeriodLabel = isoWeekRange(comparisonWeek);

  if (!seoOs.data_availability.section_patterns || !seoOs.data_availability.traffic_visibility) {
    return <section className="rounded-lg border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500">SEO-видимость временно недоступна. Повторите попытку позже.</section>;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div><h3 className="text-base font-semibold text-slate-900">Трафик и видимость по разделам</h3><p className="mt-1 text-xs text-slate-500">A {primaryPeriodLabel ?? "не выбрана"}{comparisonWeek ? ` · B ${comparisonPeriodLabel ?? comparisonWeek}` : ""}. Разделы только из словаря SEO-паттернов. Позиция 1 находится сверху.</p></div>
        {source ? <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600"><span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />{source.label}</span> : null}
      </header>
      <div className="border-b border-slate-100 px-5 py-4">
        {chartRows.length ? <ResponsiveContainer width="100%" height={300}><ComposedChart data={chartRows} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}><CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="section" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} /><YAxis yAxisId="traffic" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} /><YAxis yAxisId="position" orientation="right" domain={[1, "dataMax + 1"]} reversed allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} label={{ value: "Позиция", angle: 90, position: "insideRight", fill: "#64748b", fontSize: 12 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar yAxisId="traffic" dataKey="primary_pageviews" name={`A ${primaryWeek ?? ""} просмотры`} fill="#0d9488" radius={[4, 4, 0, 0]} />{comparisonWeek ? <Bar yAxisId="traffic" dataKey="comparison_pageviews" name={`B ${comparisonWeek} просмотры`} fill="#94a3b8" radius={[4, 4, 0, 0]} /> : null}<Scatter yAxisId="position" dataKey="primary_position" name={`A ${primaryWeek ?? ""} позиция`} fill="#9333ea" shape="circle" />{comparisonWeek ? <Scatter yAxisId="position" dataKey="comparison_position" name={`B ${comparisonWeek} позиция`} fill="#64748b" shape="diamond" /> : null}</ComposedChart></ResponsiveContainer> : <div className="flex h-[300px] items-center justify-center text-sm text-slate-500">Нет трафика или видимости для выбранной недели.</div>}
      </div>
      <div className="max-h-[360px] overflow-auto px-5 py-4">
        <table className="w-full min-w-[920px] text-sm"><thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Раздел</th><th className="pb-2 text-right font-medium">A просмотры</th>{comparisonWeek ? <><th className="pb-2 text-right font-medium">B просмотры</th><th className="pb-2 text-right font-medium">Изменение</th></> : null}<th className="pb-2 text-right font-medium">A позиция</th>{comparisonWeek ? <><th className="pb-2 text-right font-medium">B позиция</th><th className="pb-2 text-right font-medium">Изменение</th></> : null}<th className="pb-2 text-right font-medium">Покрытие A</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.section}><td className="py-2.5 font-medium text-slate-700">{row.section}</td><td className="py-2.5 text-right text-slate-600">{formatNumber(row.primary.pageviews)}</td>{comparisonWeek ? <><td className="py-2.5 text-right text-slate-600">{formatNumber(row.comparison?.pageviews ?? null)}</td><td className={row.pageviews_delta != null && row.pageviews_delta < 0 ? "py-2.5 text-right text-red-700" : "py-2.5 text-right text-teal-700"}>{row.pageviews_delta == null ? "—" : `${row.pageviews_delta > 0 ? "+" : ""}${formatNumber(row.pageviews_delta)}`}</td></> : null}<td className="py-2.5 text-right text-slate-600">{formatNumber(row.primary.average_position)}</td>{comparisonWeek ? <><td className="py-2.5 text-right text-slate-600">{formatNumber(row.comparison?.average_position ?? null)}</td><td className={row.position_delta != null && row.position_delta > 0 ? "py-2.5 text-right text-red-700" : "py-2.5 text-right text-teal-700"}>{positionDelta(row.position_delta)}</td></> : null}<td className="py-2.5 text-right text-slate-600">{row.primary.coverage == null ? "—" : `${formatNumber(row.primary.coverage * 100)}%`}</td></tr>)}{rows.length === 0 ? <tr><td colSpan={comparisonWeek ? 8 : 4} className="py-6 text-center text-sm text-slate-500">Нет строк из словаря разделов.</td></tr> : null}</tbody></table>
      </div>
    </section>
  );
}

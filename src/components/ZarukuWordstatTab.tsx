"use client";

import { useMemo, useState } from "react";
import ZarukuInfoPopover from "@/components/ZarukuInfoPopover";
import ZarukuTableFrame from "@/components/ZarukuTableFrame";
import { filterAndPaginate } from "@/components/zaruku-table-pagination";
import type {
  ZarukuSourceFreshnessRow,
  ZarukuWordstatAction,
  ZarukuWordstatClassification,
  ZarukuWordstatData,
  ZarukuWordstatHistoricalRow,
  ZarukuWordstatOpportunity,
  ZarukuWordstatQueryRow,
  ZarukuWordstatRegionRow,
  ZarukuWordstatScopeStatus,
} from "@/lib/types";

type Props = { data: ZarukuWordstatData; locale?: string };
type QuerySortKey = "query" | "count" | "classification" | "action";
type QuerySort = { key: QuerySortKey; direction: "asc" | "desc" };
type QueryActionFilter = "all" | ZarukuWordstatAction | "review" | "exclude";

const QUERY_PAGE_SIZE = 12;

const CLASSIFICATION_LABELS: Record<ZarukuWordstatClassification, string> = {
  medical: "Медицинский",
  adjacent: "Смежный",
  irrelevant: "Нерелевантный",
  unreviewed: "Не проверен",
};

const OPPORTUNITY_LABELS: Record<ZarukuWordstatOpportunity, string> = {
  high: "Высокая возможность",
  medium: "Средняя возможность",
  covered: "Уже охвачено",
  watch: "Наблюдать",
};

const ACTION_LABELS: Record<ZarukuWordstatAction, string> = {
  strengthen_page: "Усилить страницу",
  create_material: "Создать материал",
  clarify_wording: "Уточнить формулировку",
};

function formatNumber(value: number | null | undefined, locale: string) {
  return value == null || !Number.isFinite(value) ? "—" : Math.round(value).toLocaleString(locale);
}

function formatPercentPoints(value: number | null | undefined, locale: string) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

/** Provider shares arrive as fractions, for example 0.25 means 25%. */
function formatProviderShare(value: number | null | undefined, locale: string) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

function formatPosition(value: number | null | undefined, locale: string) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

function formatDate(date: string, locale: string) {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function formatDateTime(date: string, locale: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(parsed);
}

function formatPeriod(period: { from: string; to: string } | null, locale: string) {
  return period ? `${formatDate(period.from, locale)}–${formatDate(period.to, locale)}` : "Период пока не подтверждён";
}

function formatHistoricalPeriod(period: { from: string; to: string } | null, locale: string) {
  if (!period) return "Период пока не подтверждён";
  const from = new Date(`${period.from}T12:00:00Z`);
  const to = new Date(`${period.to}T12:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return formatPeriod(period, locale);
  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) {
    const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatToParts(to);
    const month = parts.find((part) => part.type === "month")?.value ?? formatDate(period.to, locale);
    const year = parts.find((part) => part.type === "year")?.value ?? String(from.getUTCFullYear());
    return `${from.getUTCDate()}–${to.getUTCDate()} ${month} ${year}`;
  }
  return formatPeriod(period, locale);
}

function samePeriod(left: { from: string; to: string } | null, right: { from: string; to: string } | null) {
  return left?.from === right?.from && left?.to === right?.to;
}

function sourceStatus(data: ZarukuWordstatData) {
  if (data.source_freshness?.freshness_status === "failed") return "Ошибка обновления";
  if (data.status === "partial" || data.source_freshness?.freshness_status === "delayed") return "Частично";
  if (data.status === "available") return "Актуально";
  return "Нет данных";
}

function sourceStatusClass(status: ReturnType<typeof sourceStatus>) {
  if (status === "Ошибка обновления") return "bg-red-50 text-red-700";
  if (status === "Частично") return "bg-amber-50 text-amber-700";
  if (status === "Актуально") return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-600";
}

function sourceStateNote(data: ZarukuWordstatData, source: ZarukuSourceFreshnessRow | null) {
  if (source?.freshness_status === "failed") {
    return "Новое обновление завершилось ошибкой. Если показан прошлый снимок, его фактические даты сохранены выше и он не выдан за текущий.";
  }
  if (data.status === "partial") return "Доступна только подтверждённая часть Wordstat. Периоды запросов и регионов показаны отдельно.";
  if (data.status === "empty") return "Сбор завершился успешно, но для подтверждённого периода строк нет.";
  if (data.status === "unavailable") return "Канонические факты Wordstat пока недоступны; значения не подставлены.";
  return "Данные Wordstat читаются из канонического хранилища и не управляются календарём трафика или SEO-неделей.";
}

function queryAction(row: ZarukuWordstatQueryRow) {
  if (row.classification === "unreviewed") return "Нужна медицинская проверка";
  if (row.classification === "adjacent") return "Нужна медицинская проверка";
  if (row.classification === "irrelevant") return "Исключение или наблюдение";
  if (!row.seo_os_eligible) return "Нет подготовленного действия для SEO OS";
  return row.action ? ACTION_LABELS[row.action] : "Нет подготовленного действия для SEO OS";
}

function reviewState(row: ZarukuWordstatQueryRow) {
  if (row.seo_os_eligible && row.action) return "Можно передать на одобрение в SEO OS";
  if (row.classification === "medical" && row.review_status === "reviewed" && !row.seo_os_eligible) {
    return "Классификация не активна. Не создаёт задачу SEO OS";
  }
  if (row.classification === "medical" && row.review_status === "reviewed") return "Нет подготовленного действия для SEO OS";
  return "Не создаёт задачу SEO OS";
}

function regionOpportunity(row: ZarukuWordstatRegionRow) {
  if (row.metrika_visits == null) return "Нет сопоставимых данных";
  if ((row.affinity_index ?? 0) > 1 && row.metrika_visits <= 0) return "Высокая возможность";
  if ((row.affinity_index ?? 0) > 1) return "Средняя возможность";
  return "Наблюдать";
}

function affinityLabel(row: ZarukuWordstatRegionRow) {
  if (row.affinity_index == null) return "—";
  if (row.affinity_index > 1) return "выше";
  if (row.affinity_index < 1) return "ниже";
  return "на уровне среднего";
}

function scopeMessage(status: ZarukuWordstatScopeStatus, subject: "темам" | "запросам" | "регионам") {
  if (status === "partial") return `Данные по ${subject} доступны частично. Показан сохранённый подтверждённый снимок, но итоговые показатели не публикуются.`;
  if (status === "empty") return subject === "запросам"
    ? "Сбор запросов завершился успешно, но строк нет."
    : subject === "регионам"
      ? "Сбор регионов завершился успешно, но строк нет."
      : "Сбор тем завершился успешно, но строк нет.";
  if (status === "unavailable") return subject === "регионам"
    ? "Региональная разбивка Wordstat пока недоступна."
    : subject === "запросам"
      ? "Текущие запросы Wordstat пока недоступны."
      : "Историческое сопоставление тем пока недоступно.";
  return null;
}

function indicatorValue(status: ZarukuWordstatScopeStatus, value: string) {
  return status === "available" ? value : "—";
}

function sortQueries(rows: ZarukuWordstatQueryRow[], sort: QuerySort, locale: string) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const values: Record<QuerySortKey, [string | number, string | number]> = {
      query: [left.query, right.query],
      count: [left.count, right.count],
      classification: [CLASSIFICATION_LABELS[left.classification], CLASSIFICATION_LABELS[right.classification]],
      action: [queryAction(left), queryAction(right)],
    };
    const [leftValue, rightValue] = values[sort.key];
    return typeof leftValue === "number" && typeof rightValue === "number"
      ? direction * (leftValue - rightValue)
      : direction * String(leftValue).localeCompare(String(rightValue), locale);
  });
}

function matchesActionFilter(row: ZarukuWordstatQueryRow, action: QueryActionFilter) {
  if (action === "all") return true;
  if (action === "review") return row.classification === "unreviewed" || row.classification === "adjacent";
  if (action === "exclude") return row.classification === "irrelevant";
  return row.seo_os_eligible && row.action === action;
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card-surface zaruku-panel">
      <header className="zaruku-panel-header">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {note ? <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-500">{note}</p> : null}
      </header>
      <div className="zaruku-panel-body">{children}</div>
    </section>
  );
}

function Indicator({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3">
      <div className="flex items-start gap-1.5 text-xs text-slate-500">
        <span>{label}</span>
        <ZarukuInfoPopover label={`О показателе «${label}»`}><p className="text-xs leading-relaxed">{note}</p></ZarukuInfoPopover>
      </div>
      <div className="zaruku-kpi-value mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function SortButton({ label, sortKey, sort, onChange }: { label: string; sortKey: QuerySortKey; sort: QuerySort; onChange: (key: QuerySortKey) => void }) {
  const active = sort.key === sortKey;
  return <button type="button" onClick={() => onChange(sortKey)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">{label}{active ? (sort.direction === "desc" ? " ↓" : " ↑") : ""}</button>;
}

function HistoricalTable({ rows, locale, period, status }: { rows: ZarukuWordstatHistoricalRow[]; locale: string; period: { from: string; to: string } | null; status: ZarukuWordstatScopeStatus }) {
  const message = scopeMessage(status, "темам");
  if (status === "unavailable" || status === "empty" || !rows.length) return <p role="status" className="py-2 text-sm text-slate-500">{message ?? "Нет подтверждённых медицинских тем для этого периода."}</p>;
  return (
    <>
      {message ? <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">{message}</p> : null}
      <ZarukuTableFrame mode="comparison" label={`${formatHistoricalPeriod(period, locale)}: спрос и присутствие Zaruku`}>
      <table className="zaruku-table min-w-[960px]">
        <thead><tr><th className="px-4 py-2.5 text-left font-medium">Медицинская тема</th><th className="px-4 py-2.5 text-right font-medium">Спрос Wordstat</th><th className="px-4 py-2.5 text-right font-medium">Изменение спроса</th><th className="px-4 py-2.5 text-right font-medium">Показы Zaruku</th><th className="px-4 py-2.5 text-right font-medium">Клики Zaruku</th><th className="px-4 py-2.5 text-right font-medium">Средняя позиция</th><th className="px-4 py-2.5 text-left font-medium"><span className="inline-flex items-center gap-1">Вывод<ZarukuInfoPopover label="Как формируется вывод по теме"><p className="text-xs leading-relaxed">Тема получает категорию только после медицинской проверки: спрос входит в верхнюю половину показанных тем, а показы Zaruku или позиция — в более слабую половину.</p></ZarukuInfoPopover></span></th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => <tr key={row.seed_hash}><td className="px-4 py-3 font-medium text-slate-700"><div>{row.topic ?? row.phrase}</div>{row.topic && row.topic !== row.phrase ? <div className="mt-0.5 text-xs font-normal text-slate-500">{row.phrase}</div> : null}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.wordstat_count, locale)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{row.demand_change == null ? "—" : `${row.demand_change > 0 ? "+" : ""}${formatNumber(row.demand_change, locale)}`}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster_impressions, locale)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.webmaster_clicks, locale)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatPosition(row.webmaster_average_position, locale)}</td><td className="px-4 py-3 text-slate-600">{row.opportunity ? OPPORTUNITY_LABELS[row.opportunity] : "—"}</td></tr>)}
        </tbody>
      </table>
      </ZarukuTableFrame>
    </>
  );
}

function QueryDiscovery({ data, locale = "ru-RU" }: Props) {
  const queryRows = data.current.queries;
  const [query, setQuery] = useState("");
  const [classification, setClassification] = useState<"all" | ZarukuWordstatClassification>("all");
  const [action, setAction] = useState<QueryActionFilter>("all");
  const [sort, setSort] = useState<QuerySort>({ key: "count", direction: "desc" });
  const [page, setPage] = useState(1);
  const sortedRows = useMemo(() => sortQueries(queryRows, sort, locale), [locale, queryRows, sort]);
  const matchingRows = useMemo(() => sortedRows.filter((row) => (classification === "all" || row.classification === classification) && matchesActionFilter(row, action)), [action, classification, sortedRows]);
  const paginated = useMemo(() => filterAndPaginate(matchingRows, query, page, QUERY_PAGE_SIZE, (row) => `${row.query} ${row.topic ?? ""} ${queryAction(row)}`), [matchingRows, page, query]);
  const changeSort = (key: QuerySortKey) => { setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "query" ? "asc" : "desc" }); setPage(1); };
  const changeQuery = (value: string) => { setQuery(value); setPage(1); };

  const scopeStatus = data.current.query_status;
  const message = scopeMessage(scopeStatus, "запросам");
  if (scopeStatus === "unavailable" || scopeStatus === "empty" || !queryRows.length) return <p role="status" className="py-2 text-sm text-slate-500">{message ?? "Нет подтверждённых новых запросов для показа."}</p>;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <label className="block w-full max-w-xl text-xs font-medium text-slate-600">Поиск по запросу или теме<input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Например, лечение рака" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-slate-400" /></label>
        <div className="flex flex-wrap gap-2"><label className="text-xs text-slate-600">Классификация<select value={classification} onChange={(event) => { setClassification(event.target.value as typeof classification); setPage(1); }} className="ml-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700"><option value="all">Все</option>{Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs text-slate-600">Действие<select value={action} onChange={(event) => { setAction(event.target.value as QueryActionFilter); setPage(1); }} className="ml-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700"><option value="all">Все</option><option value="review">Медицинская проверка</option><option value="exclude">Исключить</option>{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2" aria-label="Сортировка запросов"><SortButton label="Запрос" sortKey="query" sort={sort} onChange={changeSort} /><SortButton label="Спрос" sortKey="count" sort={sort} onChange={changeSort} /><SortButton label="Классификация" sortKey="classification" sort={sort} onChange={changeSort} /><SortButton label="Действие" sortKey="action" sort={sort} onChange={changeSort} /></div>
      {message ? <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">{message}</p> : null}
      <ZarukuTableFrame mode="operational" label={`Текущие запросы Wordstat · ${formatPeriod(data.current.query_period, locale)}`}>
        <table className="zaruku-table min-w-[1120px]"><thead><tr><th className="px-4 py-2.5 text-left font-medium">Запрос</th><th className="px-4 py-2.5 text-right font-medium">Спрос Wordstat</th><th className="px-4 py-2.5 text-left font-medium">Классификация</th><th className="px-4 py-2.5 text-left font-medium">Тема Zaruku</th><th className="px-4 py-2.5 text-right font-medium">SEO OS</th><th className="px-4 py-2.5 text-left font-medium">Страница Zaruku</th><th className="px-4 py-2.5 text-left font-medium">Предложенное действие</th></tr></thead><tbody className="divide-y divide-slate-100">{paginated.rows.map((row) => <tr key={`${row.normalized_query}\u0000${row.request_kind}\u0000${row.device}`}><td className="px-4 py-3 font-medium text-slate-700">{row.query}<div className="mt-0.5 text-xs font-normal text-slate-500">{row.request_kind === "popular" ? "Популярный запрос" : "Похожий запрос"}</div></td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.count, locale)}</td><td className="px-4 py-3 text-slate-600">{CLASSIFICATION_LABELS[row.classification]}</td><td className="px-4 py-3 text-slate-600">{row.topic ?? "—"}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{row.seo_os_position == null ? "Не отслеживается" : `${formatPosition(row.seo_os_position, locale)} · ${row.seo_os_week ?? "неделя не указана"}`}</td><td className="px-4 py-3 text-slate-600">{row.confirmed_url ?? "Не подтверждена"}</td><td className="px-4 py-3 text-slate-700"><div>{queryAction(row)}</div><div className="mt-0.5 text-xs text-slate-500">{reviewState(row)}</div></td></tr>)}</tbody></table>
      </ZarukuTableFrame>
      <footer className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500"><button type="button" disabled={paginated.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Предыдущая</button><span>{paginated.totalRows.toLocaleString(locale)} найдено · Страница {paginated.page} из {paginated.totalPages}</span><button type="button" disabled={paginated.page >= paginated.totalPages} onClick={() => setPage((value) => Math.min(paginated.totalPages, value + 1))} className="rounded-md border border-slate-200 px-3 py-1.5 disabled:opacity-40">Следующая</button></footer>
    </>
  );
}

function RegionTable({ rows, locale, period, status }: { rows: ZarukuWordstatRegionRow[]; locale: string; period: { from: string; to: string } | null; status: ZarukuWordstatScopeStatus }) {
  const message = scopeMessage(status, "регионам");
  if (status === "unavailable" || status === "empty" || !rows.length) return <p role="status" className="py-2 text-sm text-slate-500">{message ?? "Нет подтверждённой региональной разбивки."}</p>;
  const rankedRows = [...rows].sort((left, right) => right.count - left.count || left.region_name.localeCompare(right.region_name, locale));
  return (
    <>
      {message ? <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">{message}</p> : null}
      <ZarukuTableFrame mode="operational" label={`Региональные возможности Wordstat · ${formatPeriod(period, locale)}`}>
        <table className="zaruku-table min-w-[900px]"><thead><tr><th className="px-4 py-2.5 text-left font-medium">Регион</th><th className="px-4 py-2.5 text-right font-medium">Спрос</th><th className="px-4 py-2.5 text-right font-medium"><span className="inline-flex items-center gap-1">Доля запросов в регионе<ZarukuInfoPopover label="Как показана доля запросов в регионе"><p className="text-xs leading-relaxed">Wordstat передаёт долю как число от 0 до 1. На экране 0,25 показано как 25%.</p></ZarukuInfoPopover></span></th><th className="px-4 py-2.5 text-right font-medium">Интерес выше/ниже среднего</th><th className="px-4 py-2.5 text-right font-medium">Переходы Zaruku</th><th className="px-4 py-2.5 text-left font-medium"><span className="inline-flex items-center gap-1">Вывод<ZarukuInfoPopover label="Как ранжируются региональные возможности"><p className="text-xs leading-relaxed">Индекс 1 — на уровне среднего: выше 1 — интерес выше среднего, ниже 1 — ниже. Высокая возможность возможна только при индексе выше 1 и сопоставимых переходах Метрики, равных нулю; без сопоставимых данных вывод не делается.</p></ZarukuInfoPopover></span></th></tr></thead><tbody className="divide-y divide-slate-100">{rankedRows.map((row) => <tr key={`${row.region_id}-${row.device}`}><td className="px-4 py-3 font-medium text-slate-700">{row.region_name}<div className="mt-0.5 text-xs font-normal text-slate-500">{row.region_type}</div></td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.count, locale)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatProviderShare(row.share, locale)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{row.affinity_index == null ? "—" : `${formatPosition(row.affinity_index, locale)} · ${affinityLabel(row)}`}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(row.metrika_visits, locale)}</td><td className="px-4 py-3 text-slate-600">{regionOpportunity(row)}</td></tr>)}</tbody></table>
      </ZarukuTableFrame>
    </>
  );
}

export default function ZarukuWordstatTab({ data, locale = "ru-RU" }: Props) {
  const historicalPeriod = formatHistoricalPeriod(data.historical.period, locale);
  const queryPeriod = formatPeriod(data.current.query_period, locale);
  const regionPeriod = formatPeriod(data.current.region_period, locale);
  const status = sourceStatus(data);
  const periodMismatch = !samePeriod(data.current.query_period, data.current.region_period);

  return (
    <div className="zaruku-section-stack">
      <section className="card-surface zaruku-panel">
        <div className="zaruku-panel-body">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div><h3 className="text-lg font-semibold text-slate-900">Где есть медицинский спрос, что уже получает Zaruku и что стоит улучшить</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">Wordstat показывает спрос, а не визиты, показы или долю сайта.</p></div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600"><span className="rounded-md bg-slate-50 px-2.5 py-1.5">Сопоставление · {historicalPeriod}</span><span className="rounded-md bg-slate-50 px-2.5 py-1.5">Новые запросы · последние 30 дней · {queryPeriod}</span></div>
          </div>
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500 sm:flex-row sm:items-start sm:justify-between"><div><span className={`mr-2 inline-flex rounded-md px-2 py-1 font-semibold ${sourceStatusClass(status)}`}>{status}</span>{data.source_freshness?.last_success_at ? <>Последний успешный сбор: {formatDateTime(data.source_freshness.last_success_at, locale)}.</> : "Последний успешный сбор пока не подтверждён."}</div><span className="max-w-xl">{sourceStateNote(data, data.source_freshness)}</span></div>
          {data.messages.map((message) => <p key={message} role="status" className="mt-2 text-xs leading-relaxed text-slate-500">{message}</p>)}
        </div>
      </section>

      <Panel title="Сводка спроса" note="Показатели не смешивают Wordstat, Вебмастер, SEO OS и Метрику в одну долю или конверсию.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Indicator label="Темы с растущим спросом" value={indicatorValue(data.historical.status, formatNumber(data.indicators.growing_medical_topics, locale))} note={`Число проверенных медицинских тем, где спрос вырос относительно предыдущего сопоставимого периода. Период тем: ${historicalPeriod}.`} />
          <Indicator label="Самая большая возможность" value={indicatorValue(data.historical.status, data.indicators.largest_opportunity ? OPPORTUNITY_LABELS[data.indicators.largest_opportunity] : "—")} note={`Категория для проверенной медицинской темы с заметным спросом и слабым присутствием Zaruku; это не процент и не доля рынка. Период тем: ${historicalPeriod}.`} />
          <Indicator label="Нерелевантный спрос сейчас" value={indicatorValue(data.current.query_status, formatPercentPoints(data.indicators.irrelevant_demand_share, locale))} note={`Доля де-дублированного проверенного спроса в текущем окне, признанная нерелевантной правилами Zaruku. Период запросов: ${queryPeriod}.`} />
          <Indicator label="Новые темы для проверки" value={indicatorValue(data.current.query_status, formatNumber(data.indicators.review_queue_count, locale))} note={`Не проверенные и смежные запросы; до медицинской проверки они не становятся задачами SEO OS. Период запросов: ${queryPeriod}.`} />
          <Indicator label="Регионы возможностей" value={indicatorValue(data.current.region_status, formatNumber(data.indicators.region_opportunity_count, locale))} note={`Регионы с интересом Wordstat выше среднего и сравнительно слабым подтверждённым присутствием Zaruku. Это ранжирование, не доля рынка. Период регионов: ${regionPeriod}.`} />
        </div>
        <p className="mt-4 max-w-4xl text-xs leading-relaxed text-slate-500">Доля нерелевантного спроса среди запросов, найденных Wordstat. Определяется правилами Zaruku, а не Яндексом. Не является долей нецелевого трафика на сайте.</p>
      </Panel>

      <Panel title={`${historicalPeriod}: спрос и присутствие Zaruku`} note="Спрос Wordstat показан по каждой утверждённой теме. Его нельзя складывать между пересекающимися фразами и нельзя делить на показы Zaruku.">
        <HistoricalTable rows={data.historical.rows} locale={locale} period={data.historical.period} status={data.historical.status} />
      </Panel>

      <Panel title="Текущие запросы Wordstat" note={`Де-дублированные популярные и похожие запросы за последние 30 дней. Запросы: ${queryPeriod}.`}>
        <QueryDiscovery data={data} locale={locale} />
      </Panel>

      <Panel title="Региональные возможности" note={`Спрос и интерес взяты из Wordstat; переходы Zaruku — только из сопоставимого доступного среза Метрики. Регионы: ${regionPeriod}. Индекс интереса описывает относительный интерес в регионе, а не долю Zaruku на рынке.`}>
        {periodMismatch ? <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">Периоды запросов и регионов не совпадают: запросы {queryPeriod}, регионы {regionPeriod}. Они показаны отдельно и не объединены в общий показатель.</p> : null}
        <RegionTable rows={data.current.regions} locale={locale} period={data.current.region_period} status={data.current.region_status} />
      </Panel>

      <Panel title="Wordstat → проверка → SEO OS" note="Wordstat создаёт предложение, а не готовую задачу. На одобрение в SEO OS может перейти только действующая, проверенная медицинская тема с подготовленным действием.">
        <ol className="grid gap-2 text-sm text-slate-700 md:grid-cols-5"><li className="rounded-lg bg-slate-50 px-3 py-2">1. Запрос Wordstat</li><li className="rounded-lg bg-slate-50 px-3 py-2">2. Классификация Zaruku</li><li className="rounded-lg bg-slate-50 px-3 py-2">3. Медицинская проверка</li><li className="rounded-lg bg-slate-50 px-3 py-2">4. Одобрение менеджера</li><li className="rounded-lg bg-slate-50 px-3 py-2">5. Возможность или задача SEO OS</li></ol>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">Непроверенные и смежные запросы остаются на проверке. Нерелевантные становятся исключениями или правилами наблюдения. Автоматически задача не создаётся.</p>
      </Panel>
    </div>
  );
}

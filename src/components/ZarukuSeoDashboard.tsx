"use client";

import { useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Database,
  FileText,
  Info,
  LayoutGrid,
  Lock,
  MapPin,
  MonitorSmartphone,
  Repeat,
  Search,
  ShieldAlert,
  Users,
  Workflow,
} from "lucide-react";
import ZarukuSeoWeekToolbar from "@/components/ZarukuSeoWeekToolbar";
import type {
  ZarukuGoogleSearchConsoleCountryRow,
  ZarukuGoogleSearchConsolePageRow,
  ZarukuGoogleSearchConsoleQueryRow,
  ZarukuGoogleSearchConsoleSummaryRow,
  ZarukuSeoData,
  ZarukuSeoLayerId,
  ZarukuSeoMetricRow,
  ZarukuSeoSource,
  ZarukuSeoSourceId,
  ZarukuYandexWebmasterPageRow,
  ZarukuYandexWebmasterQueryRow,
  ZarukuYandexWebmasterSummaryRow,
} from "@/lib/types";
import {
  canCompareWeeks,
  createWeekSelection,
  previousAvailableWeek,
  reconcileWeekSelection,
  shouldShowSeoWeekToolbar,
  updateWeekSelection,
  type WeekSelectionField,
} from "@/components/zaruku-seo-week-selection";
import ZarukuSeoAnalytics from "@/components/ZarukuSeoAnalytics";
import ZarukuSeoOperations from "@/components/ZarukuSeoOperations";
import ZarukuTrafficVisibility from "@/components/ZarukuTrafficVisibility";
import {
  buildNorthStarKpis,
  buildSemanticHealthRows,
  buildWeeklyFocus,
} from "@/components/zaruku-north-star";
import {
  buildNorthStarStripItems,
  buildTrafficHealthRows,
} from "@/components/zaruku-overview-layout";
import { formatPendingRequirementSources } from "@/components/zaruku-seo-pending";
import {
  buildWebmasterFactsPanelChrome,
  buildWebmasterSelectionMeta,
  resolveRowsForWeek,
  resolveRowsForWeekOrLatest,
  SearchConsoleKpiRow,
  summarizeWebmasterKpis,
  topGscCountries,
  topGscPages,
  topGscQueries,
  topWebmasterPages,
  topWebmasterQueries,
} from "@/components/zaruku-yandex-webmaster-panels";

type Props = {
  data: ZarukuSeoData;
  locale?: string;
};

type TabId = "overview" | "seo" | "seo_ops" | "content" | "geo" | "devices" | "audience" | "behavior" | "quality";

const NAV: Array<{ id: TabId; label: string; icon: typeof LayoutGrid }> = [
  { id: "overview", label: "Обзор", icon: LayoutGrid },
  { id: "seo", label: "SEO", icon: Search },
  { id: "seo_ops", label: "SEO-операции", icon: Workflow },
  { id: "content", label: "Контент", icon: FileText },
  { id: "geo", label: "География", icon: MapPin },
  { id: "devices", label: "Устройства", icon: MonitorSmartphone },
  { id: "audience", label: "Аудитория", icon: Users },
  { id: "behavior", label: "Поведение", icon: Repeat },
  { id: "quality", label: "Качество", icon: ShieldAlert },
];

const COLORS = ["#0d9488", "#334155", "#64748b", "#94a3b8", "#0891b2", "#9333ea", "#2563eb", "#f59e0b"];

function formatNumber(value: number, locale = "ru-RU") {
  return Math.round(value).toLocaleString(locale);
}

function formatPercent(value: number | null | undefined, locale = "ru-RU", digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })}%`;
}

function formatDecimal(value: number | null | undefined, locale = "ru-RU", digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(locale, { maximumFractionDigits: digits });
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function shortUrl(url: string | null | undefined) {
  if (!url) return "—";
  try {
    const parsed = new URL(url);
    return parsed.pathname || "/";
  } catch {
    return url;
  }
}

function truncate(value: string, max = 84) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatSignedPercent(value: number | null | undefined, locale = "ru-RU", digits = 1) {
  if (value == null || !Number.isFinite(value)) return "Δ —";
  const sign = value > 0 ? "+" : "";
  return `Δ ${sign}${formatPercent(value, locale, digits)}`;
}

const SOURCE_STATUS_LABELS: Record<ZarukuSeoSource["status"], string> = {
  connected: "подключено",
  pending: "ожидается",
  partial: "частично",
  unavailable: "недоступно",
};

const SOURCE_COLLECTION_MODE_LABELS: Record<ZarukuSeoSource["collection_mode"], string> = {
  automated: "автоматически",
  external: "внешний импорт",
  manual: "вручную",
  not_connected: "не подключено",
};

function SourceHealthMeta({ source }: { source: ZarukuSeoSource }) {
  return (
    <span className="text-[11px] font-normal text-slate-400">
      {SOURCE_STATUS_LABELS[source.status]} · {SOURCE_COLLECTION_MODE_LABELS[source.collection_mode]}
      {source.data_through ? ` · данные по ${source.data_through}` : ""}
    </span>
  );
}

function SourceBadge({ data, id }: { data: ZarukuSeoData; id: ZarukuSeoSourceId }) {
  const source = data.sources.find((item) => item.id === id);
  if (!source) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />
      {source.label}
      <SourceHealthMeta source={source} />
      {source.status !== "connected" ? <Lock className="h-3 w-3 text-slate-300" /> : null}
    </span>
  );
}

function LayerTag({ data, id }: { data: ZarukuSeoData; id: ZarukuSeoLayerId }) {
  const layer = data.layers.find((item) => item.id === id);
  if (!layer) return null;
  return (
    <span className="text-xs font-medium uppercase text-slate-400">
      {layer.label}
      <span className="font-normal normal-case text-slate-400"> · {layer.hint}</span>
    </span>
  );
}

function Panel({
  data,
  title,
  source,
  layer,
  pending,
  right,
  children,
}: {
  data: ZarukuSeoData;
  title: string;
  source?: ZarukuSeoSourceId;
  layer?: ZarukuSeoLayerId;
  pending?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-col items-start gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {pending ? (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-400">не подключено</span>
            ) : null}
          </div>
          {layer ? (
            <div className="mt-1">
              <LayerTag data={data} id={layer} />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          {source ? <SourceBadge data={data} id={source} /> : null}
        </div>
      </header>
      <div className={pending ? "px-5 py-4 opacity-60" : "px-5 py-4"}>{children}</div>
    </section>
  );
}

function InfoTooltip({
  label,
  title,
  description,
  importance,
  details,
}: {
  label: string;
  title: string;
  description: string;
  importance: string;
  details?: string;
}) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex rounded-full text-slate-400 outline-none transition hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
      >
        <Info className="h-3 w-3" aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-5 z-50 hidden w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg group-hover:block group-focus-within:block"
      >
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-1.5 block text-xs leading-relaxed text-slate-600">{description}</span>
        <span className="mt-2 block text-xs leading-relaxed text-slate-700">{importance}</span>
        {details ? <span className="mt-2 block border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-400">{details}</span> : null}
      </span>
    </span>
  );
}

function BarList({ rows, value = "visits", locale = "ru-RU" }: { rows: ZarukuSeoMetricRow[]; value?: "visits" | "users" | "pageviews"; locale?: string }) {
  const max = Math.max(1, ...rows.map((row) => row[value]));
  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => (
        <div key={`${row.label}-${row.secondary_label ?? ""}-${index}`} className="grid grid-cols-[128px_minmax(0,1fr)_76px] items-center gap-3">
          <div className="min-w-0 text-sm text-slate-600" title={row.label}>
            {truncate(row.label, 28)}
          </div>
          <div className="h-6 overflow-hidden rounded-md bg-slate-50">
            <div
              className="flex h-full items-center rounded-md px-2 text-xs font-medium text-white"
              style={{ width: `${Math.max(4, (row[value] / max) * 100)}%`, background: COLORS[index % COLORS.length] }}
            >
              {row.share != null ? formatPercent(row.share, locale, 1) : ""}
            </div>
          </div>
          <div className="text-right text-sm text-slate-500">{formatNumber(row[value], locale)}</div>
        </div>
      ))}
    </div>
  );
}

function DataTable({
  rows,
  mode,
  locale,
  wrapText = false,
}: {
  rows: ZarukuSeoMetricRow[];
  mode: "pages" | "metrics" | "cross";
  locale: string;
  wrapText?: boolean;
}) {
  const tableMinWidth = mode === "pages" ? "min-w-[1080px]" : mode === "cross" ? "min-w-[980px]" : "min-w-[900px]";
  const labelColumnWidth = mode === "pages" ? "w-[42%]" : mode === "cross" ? "w-[24%]" : "w-[34%]";
  const secondaryColumnWidth = "w-[18%]";
  const metricColumnWidth = mode === "pages" ? "w-[9.6%]" : mode === "cross" ? "w-[9.6%]" : "w-[11%]";
  const headerClass = "px-3 pb-2 text-right font-medium leading-tight whitespace-normal";
  const labelHeaderClass = "px-3 pb-2 text-left font-medium leading-tight whitespace-normal";
  const metricCellClass = "whitespace-nowrap px-3 py-2.5 text-right text-slate-600";
  const secondaryMetricCellClass = "whitespace-nowrap px-3 py-2.5 text-right text-slate-500";

  return (
    <div className="overflow-x-auto">
      <table className={`w-full table-fixed ${tableMinWidth} text-sm`}>
        <colgroup>
          <col className={labelColumnWidth} />
          {mode === "cross" ? <col className={secondaryColumnWidth} /> : null}
          <col className={metricColumnWidth} />
          <col className={metricColumnWidth} />
          <col className={metricColumnWidth} />
          <col className={metricColumnWidth} />
          <col className={metricColumnWidth} />
          <col className={metricColumnWidth} />
        </colgroup>
        <thead>
          <tr className="text-xs text-slate-400">
            <th className={labelHeaderClass}>{mode === "pages" ? "Страница" : "Сегмент"}</th>
            {mode === "cross" ? <th className={labelHeaderClass}>Разрез</th> : null}
            <th className={headerClass}>Визиты</th>
            <th className={headerClass}>Пользователи</th>
            <th className={headerClass}>Просмотры</th>
            <th className={headerClass}>Отказы</th>
            <th className={headerClass}>Время</th>
            <th className={headerClass}>Глубина</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={`${row.label}-${row.secondary_label ?? ""}-${row.url ?? ""}-${index}`}>
              <td className="py-2.5 pl-3 pr-5 align-top">
                <div className={wrapText ? "font-medium leading-snug text-slate-700" : "font-medium text-slate-700"} title={row.label}>
                  {wrapText ? row.label : truncate(row.label, mode === "pages" ? 72 : 48)}
                </div>
                {row.url ? (
                  <div className={wrapText ? "mt-1 break-all text-xs leading-snug text-slate-400" : "text-xs text-slate-400"}>
                    {wrapText ? shortUrl(row.url) : truncate(shortUrl(row.url), 86)}
                  </div>
                ) : null}
              </td>
              {mode === "cross" ? <td className="px-3 py-2.5 text-slate-500">{row.secondary_label ?? "—"}</td> : null}
              <td className={metricCellClass}>{row.visits ? formatNumber(row.visits, locale) : "—"}</td>
              <td className={metricCellClass}>{formatNumber(row.users, locale)}</td>
              <td className={metricCellClass}>{formatNumber(row.pageviews, locale)}</td>
              <td className={secondaryMetricCellClass}>{formatPercent(row.bounce_rate, locale, 1)}</td>
              <td className={secondaryMetricCellClass}>{formatDuration(row.avg_duration_seconds)}</td>
              <td className={secondaryMetricCellClass}>{row.page_depth?.toFixed(1) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReturningPagesTable({ rows, locale }: { rows: ZarukuSeoMetricRow[]; locale: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="pb-2 font-medium">Страница</th>
            <th className="pb-2 text-right font-medium">Возвраты</th>
            <th className="pb-2 text-right font-medium">Просмотры</th>
            <th className="pb-2 text-right font-medium">Доля</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={`${row.url ?? row.label}-${index}`}>
              <td className="max-w-[460px] py-2.5">
                <div className="font-medium text-slate-700" title={row.url ?? row.label}>
                  {truncate(shortUrl(row.url ?? row.label), 86)}
                </div>
              </td>
              <td className="py-2.5 text-right text-slate-600">{formatNumber(row.visits, locale)}</td>
              <td className="py-2.5 text-right text-slate-600">{formatNumber(row.pageviews, locale)}</td>
              <td className="py-2.5 text-right text-slate-500">{formatPercent(row.share, locale, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MapCityDemandTable({ rows, locale }: { rows: ZarukuSeoMetricRow[]; locale: string }) {
  if (rows.length === 0) {
    return <div className="rounded-md bg-slate-50 px-4 py-5 text-sm text-slate-500">Нет данных по городам для /map за выбранный период.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="pb-2 font-medium">Город</th>
            <th className="pb-2 text-right font-medium">Визиты</th>
            <th className="pb-2 text-right font-medium">Пользователи</th>
            <th className="pb-2 text-right font-medium">Просмотры</th>
            <th className="pb-2 text-right font-medium">Доля</th>
            <th className="pb-2 text-right font-medium">Отказы</th>
            <th className="pb-2 text-right font-medium">Время</th>
            <th className="pb-2 text-right font-medium">Глубина</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`}>
              <td className="max-w-[320px] py-2.5">
                <div className="font-medium text-slate-700" title={row.label}>
                  {truncate(row.label, 48)}
                </div>
                {row.secondary_label ? <div className="text-xs text-slate-400">{truncate(shortUrl(row.secondary_label), 72)}</div> : null}
              </td>
              <td className="py-2.5 text-right text-slate-600">{formatNumber(row.visits, locale)}</td>
              <td className="py-2.5 text-right text-slate-600">{formatNumber(row.users, locale)}</td>
              <td className="py-2.5 text-right text-slate-600">{formatNumber(row.pageviews, locale)}</td>
              <td className="py-2.5 text-right text-slate-500">{formatPercent(row.share, locale, 1)}</td>
              <td className="py-2.5 text-right text-slate-500">{formatPercent(row.bounce_rate, locale, 1)}</td>
              <td className="py-2.5 text-right text-slate-500">{formatDuration(row.avg_duration_seconds)}</td>
              <td className="py-2.5 text-right text-slate-500">{formatDecimal(row.page_depth, locale, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingPanel({ data }: { data: ZarukuSeoData }) {
  return (
    <Panel data={data} title="Что ещё ждём" layer="serp" pending right={<span className="text-xs text-slate-400">{formatPendingRequirementSources(data)}</span>}>
      <div className="grid gap-3 md:grid-cols-3">
        {data.pending_requirements.map((item) => (
          <div key={item.title} className="rounded-lg border border-dashed border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-700">{item.title}</div>
              <SourceBadge data={data} id={item.source} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{item.reason}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {item.expected_fields.slice(0, 6).map((field) => (
                <span key={field} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  {field}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

type WebmasterKpiRow = ZarukuYandexWebmasterQueryRow | ZarukuYandexWebmasterSummaryRow;
type GscKpiRow = ZarukuGoogleSearchConsoleQueryRow | ZarukuGoogleSearchConsoleSummaryRow;

function SearchConsoleKpiStrip({ rows, locale }: { rows: SearchConsoleKpiRow[]; locale: string }) {
  const summary = summarizeWebmasterKpis(rows);
  const cells = [
    ["Показы", formatNumber(summary.impressions, locale)],
    ["Клики", formatNumber(summary.clicks, locale)],
    ["CTR", formatPercent(summary.ctr, locale, 2)],
    ["Позиция", formatDecimal(summary.average_position, locale, 1)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs uppercase text-slate-400">{label}</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
        </div>
      ))}
    </div>
  );
}

function SearchConsoleQueryTable({
  rows,
  locale,
  emptyLabel,
}: {
  rows: Array<ZarukuYandexWebmasterQueryRow | ZarukuGoogleSearchConsoleQueryRow>;
  locale: string;
  emptyLabel: string;
}) {
  return (
    <div className="max-h-[30rem] overflow-auto rounded-md border border-slate-100">
      <table className="w-full min-w-[860px] table-fixed text-sm">
        <colgroup>
          <col className="w-[56%]" />
          <col className="w-[12%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-400 shadow-[0_1px_0_0_rgb(241_245_249)]">
          <tr>
            <th className="px-3 py-2.5 font-medium">Запрос</th>
            <th className="px-3 py-2.5 text-right font-medium">Показы</th>
            <th className="px-3 py-2.5 text-right font-medium">Клики</th>
            <th className="px-3 py-2.5 text-right font-medium">CTR</th>
            <th className="px-3 py-2.5 text-right font-medium">Позиция</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={`${row.week}-${row.query_id}`} className="align-top hover:bg-slate-50/70">
              <td className="px-3 py-2.5 font-medium leading-snug text-slate-700" title={row.query}>
                <div className="line-clamp-2">{row.query}</div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">{formatNumber(row.impressions, locale)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">{formatNumber(row.clicks, locale)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-500">{formatPercent(row.ctr, locale, 2)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-500">{formatDecimal(row.average_position, locale, 1)}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">{emptyLabel}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function SearchConsolePageTable({
  rows,
  locale,
  emptyLabel,
}: {
  rows: Array<ZarukuYandexWebmasterPageRow | ZarukuGoogleSearchConsolePageRow>;
  locale: string;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={`${row.week}-${row.url}`} className="grid grid-cols-[minmax(0,1fr)_88px_72px_72px] items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <div className="min-w-0 truncate font-medium text-slate-700" title={row.url}>{shortUrl(row.url)}</div>
          <div className="text-right text-slate-600">{formatNumber(row.impressions, locale)}</div>
          <div className="text-right text-slate-500">{formatNumber(row.clicks, locale)}</div>
          <div className="text-right text-slate-500">{formatDecimal(row.average_position, locale, 1)}</div>
        </div>
      ))}
      {rows.length === 0 ? <div className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">{emptyLabel}</div> : null}
    </div>
  );
}

function SearchConsoleCountryTable({
  rows,
  locale,
}: {
  rows: ZarukuGoogleSearchConsoleCountryRow[];
  locale: string;
}) {
  return (
    <div className="max-h-[24rem] overflow-auto rounded-md border border-slate-100">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-400 shadow-[0_1px_0_0_rgb(241_245_249)]">
          <tr>
            <th className="px-3 py-2.5 font-medium">Страна</th>
            <th className="px-3 py-2.5 font-medium">Устройство</th>
            <th className="px-3 py-2.5 text-right font-medium">Показы</th>
            <th className="px-3 py-2.5 text-right font-medium">Клики</th>
            <th className="px-3 py-2.5 text-right font-medium">CTR</th>
            <th className="px-3 py-2.5 text-right font-medium">Позиция</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={`${row.week}-${row.country_code}-${row.device}`} className="hover:bg-slate-50/70">
              <td className="px-3 py-2.5 font-medium text-slate-700">{row.country_code}</td>
              <td className="px-3 py-2.5 text-slate-500">{row.device}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">{formatNumber(row.impressions, locale)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">{formatNumber(row.clicks, locale)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-500">{formatPercent(row.ctr, locale, 2)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-500">{formatDecimal(row.average_position, locale, 1)}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">Country split из GSC пока пустой для выбранной недели.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function WebmasterQueryTable({ rows, locale }: { rows: ZarukuYandexWebmasterQueryRow[]; locale: string }) {
  return <SearchConsoleQueryTable rows={rows} locale={locale} emptyLabel="Нет Webmaster-запросов для выбранной недели." />;
}

function WebmasterPageTable({ rows, locale }: { rows: ZarukuYandexWebmasterPageRow[]; locale: string }) {
  return <SearchConsolePageTable rows={rows} locale={locale} emptyLabel="URL-факты Вебмастера пока пустые." />;
}

function NorthStarBlock({ data, locale }: Props) {
  const items = buildNorthStarStripItems(buildNorthStarKpis({
    sovRows: data.seo_intelligence.sov.rows,
    aiRows: data.seo_intelligence.ai.rows,
    opportunities: data.seo_os.opportunities,
  }));
  return (
    <section className="rounded-lg border border-slate-200 border-t-slate-300 bg-[#f5f7fa] px-5 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2 lg:w-[380px]">
          <h3 className="text-base font-medium text-slate-900 lg:whitespace-nowrap">Цель: целевой органический трафик + ИИ-выдача</h3>
          <span title="Метрики — корреляционные показатели работы SEO OS." className="inline-flex shrink-0 text-slate-400">
            <Info className="h-3.5 w-3.5" aria-label="Описание north-star" />
          </span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
          {items.map((item) => (
            <div key={item.key} className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>{item.label}</span>
                <InfoTooltip
                  label={`${item.label}: что это и почему важно`}
                  title={item.tooltipTitle}
                  description={item.tooltipDescription}
                  importance={item.tooltipImportance}
                  details={item.tooltip}
                />
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold leading-none text-slate-950">{formatPercent(item.value, locale, 1)}</span>
                <span className="text-sm font-medium text-slate-400">{item.arrow}</span>
                {item.showDelta ? (
                  <span className={item.deltaTone === "good" ? "text-xs font-medium text-teal-700" : "text-xs font-medium text-red-700"}>
                    {formatSignedPercent(item.delta, locale, 1)}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">бейзлайн 13.07.2026</div>
      </div>
    </section>
  );
}

function TrafficHealthStrip({ data }: { data: ZarukuSeoData }) {
  const [expanded, setExpanded] = useState(false);
  const rows = buildTrafficHealthRows(data.kpis);
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <h3 className="text-base font-medium text-slate-900">Здоровье трафика</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            aria-expanded={expanded}
          >
            ещё {expanded ? "⌃" : "⌄"}
          </button>
          <SourceBadge data={data} id="metrika" />
        </div>
      </header>
      <div className="px-5 py-4">
        <div className="grid gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
          {rows.primary.map((item, index) => (
            <div key={item.key} className={index === 0 ? "min-w-0" : "min-w-0 border-slate-200 sm:border-l sm:pl-5"}>
              <div className="text-xs text-slate-500">{item.label}</div>
              <div className="mt-1 text-2xl font-semibold leading-none text-slate-950">{item.value}</div>
            </div>
          ))}
        </div>
        {expanded ? (
          <div className="mt-4 grid gap-y-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-5">
            {rows.secondary.map((item, index) => (
              <div key={item.key} className={index === 0 ? "min-w-0" : "min-w-0 border-slate-100 sm:border-l sm:pl-5"}>
                <span className="text-xs text-slate-400">{item.label}</span>
                <span className="ml-2 text-sm font-medium text-slate-600">{item.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AiAggregateVisibilityPanel({ data, locale }: Props) {
  const rows = data.seo_intelligence.ai.rows;
  const chartRows = rows.map((row) => ({ ...row, label: row.period }));
  const latest = [...rows].sort((left, right) => left.period.localeCompare(right.period)).at(-1) ?? null;
  return (
    <Panel
      data={data}
      title="AI-видимость (Яндекс Вебмастер / внешний источник)"
      source="yandex_gen_search"
      layer="ai"
      pending={rows.length === 0}
      right={<span className="text-xs text-slate-400">{latest?.period ?? "период —"}</span>}
    >
      {rows.length ? (
        <div className="space-y-3">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartRows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="presence_rate" name="Доля присутствия" fill="#0891b2" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div className="text-xs uppercase text-slate-400">Присутствие</div><div className="mt-1 text-xl font-semibold text-slate-900">{formatPercent(latest?.presence_rate, locale, 1)}</div></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div className="text-xs uppercase text-slate-400">Упоминания</div><div className="mt-1 text-xl font-semibold text-slate-900">{formatNumber(latest?.mentions ?? 0, locale)}</div></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div className="text-xs uppercase text-slate-400">Цитаты</div><div className="mt-1 text-xl font-semibold text-slate-900">{formatNumber(latest?.citations ?? 0, locale)}</div></div>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            {latest ? `${formatNumber(latest.mentions, locale)} из ${formatNumber(latest.citations, locale)} примеров, источник №1 во всех случаях.` : ""}
            {latest?.provenance ? ` Источник данных: ${latest.provenance}.` : ""}
          </p>
        </div>
      ) : (
        <div className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Снимок AI-видимости ещё не записан в seo_ai_visibility.</div>
      )}
    </Panel>
  );
}

function SemanticHealthPanel({ data, locale, primaryWeek }: Props & { primaryWeek: string | null }) {
  const selectedRows = buildSemanticHealthRows(data.seo_intelligence.sov.rows, primaryWeek ?? data.seo_intelligence.sov.latest_week);
  const weeks = data.seo_intelligence.sov.weeks;
  const chartRows = weeks.map((week) => {
    const rows = data.seo_intelligence.sov.rows.filter((row) => row.week === week);
    return {
      week,
      noise: rows.find((row) => row.cluster === "medical_org_labs_noise")?.impressions_share ?? null,
      medical: rows.find((row) => row.cluster === "medical_intent_total")?.impressions_share ?? null,
      noise_baseline: 63.74,
      medical_baseline: 24.81,
    };
  });
  const periodLabel = selectedRows[0]?.period_label ?? primaryWeek ?? data.seo_intelligence.sov.latest_week;
  return (
    <Panel data={data} title="Семантическое здоровье" source="seo_os" layer="serp" pending={selectedRows.length === 0} right={<span className="text-xs text-slate-400">{periodLabel ?? "неделя —"}</span>}>
      <div className="space-y-4">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartRows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Line type="monotone" dataKey="noise" name="Шум в показах" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="medical" name="Медицинский интент" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="noise_baseline" name="Бейзлайн шума" stroke="#ef4444" strokeDasharray="5 5" dot={false} />
            <Line type="monotone" dataKey="medical_baseline" name="Бейзлайн мед. интента" stroke="#0d9488" strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Кластер</th><th className="pb-2 text-right font-medium">Запросы</th><th className="pb-2 text-right font-medium">Показы</th><th className="pb-2 text-right font-medium">Клики</th><th className="pb-2 text-right font-medium">Доля показов</th><th className="pb-2 text-right font-medium">Доля кликов</th><th className="pb-2 text-right font-medium">CTR</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {selectedRows.map((row) => <tr key={`${row.week}-${row.cluster}`}><td className="py-2.5 font-medium text-slate-700">{row.cluster}{row.isBaselineCluster ? <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">бейзлайн</span> : null}</td><td className="py-2.5 text-right text-slate-600">{formatNumber(row.query_count, locale)}</td><td className="py-2.5 text-right text-slate-600">{formatNumber(row.impressions, locale)}</td><td className="py-2.5 text-right text-slate-600">{formatNumber(row.clicks, locale)}</td><td className="py-2.5 text-right text-slate-600">{formatPercent(row.impressions_share, locale, 2)}</td><td className="py-2.5 text-right text-slate-600">{formatPercent(row.clicks_share, locale, 2)}</td><td className="py-2.5 text-right text-slate-500">{formatPercent(row.ctr, locale, 2)}</td></tr>)}
              {selectedRows.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-500">SOV-кластеры ещё не записаны.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function WeeklyFocusPanel({ data, primaryWeek }: Props & { primaryWeek: string | null }) {
  const focus = buildWeeklyFocus({
    opportunities: data.seo_os.opportunities,
    aiRows: data.seo_intelligence.ai.rows,
    tasks: data.seo_os.tasks,
    runs: data.seo_os.runs,
    week: primaryWeek ?? data.seo_os.latest_week,
  });
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-900">Выводы и фокус недели</h3>
      </header>
      <div className="grid gap-px bg-slate-100 md:grid-cols-3">
        {[focus.seo, focus.ai, focus.pipeline].map((line, index) => (
          <div key={index} className="min-h-24 bg-white px-4 py-3 text-sm leading-relaxed text-slate-700">{line}</div>
        ))}
      </div>
    </section>
  );
}

function OverviewTab({ data, locale }: Props) {
  return (
    <div className="space-y-5">
      <NorthStarBlock data={data} locale={locale} />
      <TrafficHealthStrip data={data} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel data={data} title="Каналы привлечения" source="metrika">
            <BarList rows={data.traffic_channels} locale={locale} />
            {data.technical_tail.length ? (
              <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Технический хвост:{" "}
                {data.technical_tail.map((row) => `${row.label}: ${formatNumber(row.visits, locale)}`).join(", ")}. Он не считается отдельным каналом привлечения.
              </div>
            ) : null}
          </Panel>
        </div>
        <Panel data={data} title="Органика по месяцам" source="metrika">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.organic_trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="visits" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <PendingPanel data={data} />
    </div>
  );
}

function SeoTab({ data, locale, primaryWeek, comparisonWeek }: Props & { primaryWeek: string | null; comparisonWeek: string | null }) {
  const phraseCoverage = data.data_quality.find((item) => item.title === "Покрытие поисковых фраз");
  const currentLocale = locale ?? "ru-RU";
  const gscWeek = primaryWeek ?? data.gsc.latest_week;
  const gscSummarySelection = resolveRowsForWeek(data.gsc.summary, gscWeek, data.gsc.latest_week);
  const gscQuerySelection = resolveRowsForWeekOrLatest(data.gsc.queries, gscWeek, data.gsc.latest_week);
  const gscPageSelection = resolveRowsForWeekOrLatest(data.gsc.pages, gscWeek, data.gsc.latest_week);
  const gscCountrySelection = resolveRowsForWeekOrLatest(data.gsc.countries, gscWeek, data.gsc.latest_week);
  const gscSummaryRows = gscSummarySelection.rows;
  const gscQueries = gscQuerySelection.rows;
  const gscPages = gscPageSelection.rows;
  const gscCountries = gscCountrySelection.rows;
  const gscFactsSelection: { week: string | null; rows: GscKpiRow[] } = gscSummaryRows.length > 0
    ? gscSummarySelection
    : gscQuerySelection;
  const gscFactsMeta = buildWebmasterSelectionMeta(gscFactsSelection, gscWeek);
  const gscQueryMeta = buildWebmasterSelectionMeta(gscQuerySelection, gscWeek);
  const gscPageMeta = buildWebmasterSelectionMeta(gscPageSelection, gscWeek);
  const gscCountryMeta = buildWebmasterSelectionMeta(gscCountrySelection, gscWeek);
  const webmasterWeek = primaryWeek ?? data.webmaster.latest_week;
  const webmasterSummarySelection = resolveRowsForWeek(data.webmaster.summary, webmasterWeek, data.webmaster.latest_week);
  const webmasterQuerySelection = resolveRowsForWeekOrLatest(data.webmaster.queries, webmasterWeek, data.webmaster.latest_week);
  const webmasterPageSelection = resolveRowsForWeek(data.webmaster.pages, webmasterWeek, data.webmaster.latest_week);
  const webmasterSummaryRows = webmasterSummarySelection.rows;
  const webmasterQueries = webmasterQuerySelection.rows;
  const webmasterPages = webmasterPageSelection.rows;
  const webmasterFactsSelection: { week: string | null; rows: WebmasterKpiRow[] } = webmasterSummaryRows.length > 0
    ? webmasterSummarySelection
    : webmasterQuerySelection;
  const webmasterFactsMeta = buildWebmasterSelectionMeta(webmasterFactsSelection, webmasterWeek);
  const webmasterQueryMeta = buildWebmasterSelectionMeta(webmasterQuerySelection, webmasterWeek);
  const webmasterPageMeta = buildWebmasterSelectionMeta(webmasterPageSelection, webmasterWeek);
  const webmasterFactsChrome = buildWebmasterFactsPanelChrome();
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data={data} title="Поисковые системы" source="metrika" layer="onsite">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.search_engines} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="visits" radius={[6, 6, 0, 0]}>
                {data.search_engines.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel
          data={data}
          title="Факты Яндекс Поиска"
          source={webmasterFactsChrome.source}
          layer={webmasterFactsChrome.layer ?? undefined}
          pending={data.webmaster.status === "unavailable"}
          right={<span className="text-xs text-slate-400">{webmasterFactsMeta.periodLabel}</span>}
        >
          <SearchConsoleKpiStrip rows={webmasterSummaryRows.length > 0 ? webmasterSummaryRows : webmasterQueries} locale={currentLocale} />
          <div className="mt-3 text-xs leading-relaxed text-slate-500">
            {webmasterFactsMeta.sourceNote} Период: {webmasterFactsMeta.periodLabel}.
          </div>
          {webmasterFactsMeta.fallbackNote ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              {webmasterFactsMeta.fallbackNote}
            </div>
          ) : null}
        </Panel>
      </div>
      <SemanticHealthPanel data={data} locale={locale} primaryWeek={primaryWeek} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          data={data}
          title="Факты Google Search Console"
          source="gsc"
          layer="serp"
          pending={data.gsc.status === "unavailable"}
          right={<span className="text-xs text-slate-400">{gscFactsMeta.periodLabel}</span>}
        >
          <SearchConsoleKpiStrip rows={gscSummaryRows.length > 0 ? gscSummaryRows : gscQueries} locale={currentLocale} />
          <div className="mt-3 text-xs leading-relaxed text-slate-500">
            Источник: Google Search Console / canonical_fact_gsc_*_daily. Период: {gscFactsMeta.periodLabel}.
          </div>
          {gscFactsMeta.fallbackNote ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              {gscFactsMeta.fallbackNote.replaceAll("Яндекс Вебмастера", "Google Search Console")}
            </div>
          ) : null}
        </Panel>
        <AiAggregateVisibilityPanel data={data} locale={currentLocale} />
      </div>
      <ZarukuSeoAnalytics
        seoOs={data.seo_os}
        primaryWeek={primaryWeek}
        comparisonWeek={comparisonWeek}
        source={data.sources.find((source) => source.id === "seo_os")}
      />
      <Panel data={data} title="Топ органических посадочных страниц" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">Метрика · топ 10</span>}>
        <div className="max-h-[29rem] overflow-auto rounded-md border border-slate-100">
          <DataTable rows={data.organic_landing_pages.slice(0, 10)} mode="cross" locale={currentLocale} />
        </div>
      </Panel>
      <Panel data={data} title="Запросы Яндекса" source="webmaster" layer="serp" right={<span className="text-xs text-slate-400">{webmasterQueryMeta.periodLabel} · {webmasterQueries.length} строк</span>}>
        <WebmasterQueryTable rows={topWebmasterQueries(webmasterQueries, 12)} locale={currentLocale} />
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Это запросы из Яндекс Вебмастера: показы, клики, CTR и средняя позиция до клика. Таблица отсортирована по показам.
        </p>
        {webmasterQueryMeta.fallbackNote ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            {webmasterQueryMeta.fallbackNote}
          </div>
        ) : null}
        {webmasterPages.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
            Посадочные страницы Яндекса пока не показываем: canonical Webmaster collector сейчас собирает запросы и сводку хоста, но не URL-факты.
          </div>
        ) : null}
      </Panel>
      {webmasterPages.length > 0 ? (
        <Panel data={data} title="Посадочные страницы Яндекса" source="webmaster" layer="serp" right={<span className="text-xs text-slate-400">{webmasterPageMeta.periodLabel} · URL-факты</span>}>
          <WebmasterPageTable rows={topWebmasterPages(webmasterPages, 10)} locale={currentLocale} />
        </Panel>
      ) : null}
      <Panel data={data} title="Запросы Google" source="gsc" layer="serp" right={<span className="text-xs text-slate-400">{gscQueryMeta.periodLabel} · {gscQueries.length} строк</span>}>
        <SearchConsoleQueryTable rows={topGscQueries(gscQueries, 12)} locale={currentLocale} emptyLabel="Нет GSC-запросов для выбранной недели." />
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Это запросы из Google Search Console: показы, клики, CTR и средняя позиция до клика. Таблица отсортирована по показам.
        </p>
        {gscQueryMeta.fallbackNote ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            {gscQueryMeta.fallbackNote.replaceAll("Яндекс Вебмастера", "Google Search Console")}
          </div>
        ) : null}
      </Panel>
      <Panel data={data} title="Посадочные страницы Google" source="gsc" layer="serp" right={<span className="text-xs text-slate-400">{gscPageMeta.periodLabel} · URL-факты</span>}>
        <SearchConsolePageTable rows={topGscPages(gscPages, 10)} locale={currentLocale} emptyLabel="URL-факты GSC пока пустые." />
      </Panel>
      <Panel data={data} title="Страны в Google Search Console" source="gsc" layer="serp" right={<span className="text-xs text-slate-400">{gscCountryMeta.periodLabel} · country/device</span>}>
        <SearchConsoleCountryTable rows={topGscCountries(gscCountries, 10)} locale={currentLocale} />
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Это country-разрез Google Search Console до клика. Он показывает спрос в поиске по странам и устройствам; это не вкладка «География» из Метрики после клика.
        </p>
        {gscCountryMeta.fallbackNote ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            {gscCountryMeta.fallbackNote.replaceAll("Яндекс Вебмастера", "Google Search Console")}
          </div>
        ) : null}
      </Panel>
      <Panel data={data} title="Поисковые фразы из Метрики" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">{phraseCoverage?.value ?? "покрытие —"}</span>}>
        <p className="mb-3 text-xs leading-relaxed text-slate-500">
          Фразы, которые Метрика смогла определить после клика. Это не полный список SEO-запросов: часть запросов скрывается поисковиками, а показы и позиции живут в Яндекс Вебмастере.
        </p>
        <div className="max-h-[29rem] overflow-auto">
          <div className="space-y-2">
            {data.search_phrases.slice(0, 12).map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                <span className="min-w-0 text-sm text-slate-700" title={row.label}>{truncate(row.label, 72)}</span>
                <span className="shrink-0 text-sm text-slate-500">{formatNumber(row.visits, currentLocale)}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ContentTab({ data, locale, primaryWeek, comparisonWeek }: Props & { primaryWeek: string | null; comparisonWeek: string | null }) {
  return (
    <div className="space-y-5">
      <ZarukuTrafficVisibility
        seoOs={data.seo_os}
        primaryWeek={primaryWeek}
        comparisonWeek={comparisonWeek}
        source={data.sources.find((source) => source.id === "seo_os")}
      />
      <Panel data={data} title="Разделы портала" source="metrika" layer="onsite">
        <DataTable rows={data.content_sections} mode="metrics" locale={locale ?? "ru-RU"} />
      </Panel>
      <Panel data={data} title="Топ страниц" source="metrika" layer="onsite">
        <DataTable rows={data.top_pages.slice(0, 20)} mode="pages" locale={locale ?? "ru-RU"} />
      </Panel>
    </div>
  );
}

function GeoTab({ data, locale }: Props) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data={data} title="Страны" source="metrika" layer="onsite">
          <BarList rows={data.geo_countries.slice(0, 10)} locale={locale} />
        </Panel>
        <Panel data={data} title="Города" source="metrika" layer="onsite">
          <BarList rows={data.geo_cities.slice(0, 12)} locale={locale} />
        </Panel>
      </div>
      <Panel data={data} title="Спрос на карту онкоцентров" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">regionCity × /map</span>}>
        <MapCityDemandTable rows={data.map_city_demand} locale={locale ?? "ru-RU"} />
      </Panel>
    </div>
  );
}

function DevicesTab({ data, locale }: Props) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data={data} title="Типы устройств" source="metrika" layer="onsite">
          <BarList rows={data.devices} locale={locale} />
        </Panel>
        <Panel data={data} title="Источник × устройство" source="metrika" layer="onsite">
          <DataTable rows={data.source_devices.slice(0, 12)} mode="cross" locale={locale ?? "ru-RU"} />
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data={data} title="Браузеры" source="metrika" layer="onsite">
          <BarList rows={data.browsers.slice(0, 10)} locale={locale} />
        </Panel>
        <Panel data={data} title="ОС" source="metrika" layer="onsite">
          <BarList rows={data.operating_systems.slice(0, 10)} locale={locale} />
        </Panel>
      </div>
    </div>
  );
}

function AudienceTab({ data, locale }: Props) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data={data} title="Возраст" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">оценка</span>}>
          <BarList rows={data.age} locale={locale} />
        </Panel>
        <Panel data={data} title="Пол" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">оценка</span>}>
          <BarList rows={data.gender} locale={locale} />
        </Panel>
      </div>
      <Panel data={data} title="Интересы" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">покрытие зависит от Яндекса</span>}>
        <BarList rows={data.interests.slice(0, 12)} locale={locale} />
      </Panel>
    </div>
  );
}

function BehaviorTab({ data, locale }: Props) {
  const currentLocale = locale ?? "ru-RU";
  return (
    <div className="space-y-5">
      <Panel data={data} title="Лучшее удержание" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">startURL · удержание</span>}>
        <DataTable rows={data.best_engagement_pages} mode="pages" locale={currentLocale} wrapText />
      </Panel>
      <Panel data={data} title="Проблемные входные страницы" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">startURL · высокие отказы</span>}>
        <DataTable rows={data.high_bounce_pages} mode="pages" locale={currentLocale} wrapText />
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel data={data} title="Возвратный контент" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">возвратные просмотры</span>}>
          <ReturningPagesTable rows={data.returning_pages.slice(0, 16)} locale={currentLocale} />
        </Panel>
        <Panel data={data} title="Поведение по каналам" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">источник трафика</span>}>
          <DataTable rows={data.traffic_channels} mode="metrics" locale={currentLocale} />
        </Panel>
      </div>
    </div>
  );
}

function QualityTab({ data }: { data: ZarukuSeoData }) {
  return (
    <div className="space-y-5">
      <Panel data={data} title="Качество данных" source="metrika" layer="onsite">
        <div className="grid gap-3 md:grid-cols-2">
          {data.data_quality.map((item) => (
            <div key={item.title} className="rounded-lg bg-slate-50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-700">{item.title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-500">{item.note}</div>
                </div>
                <div className={item.severity === "warning" ? "text-sm font-medium text-amber-600" : "text-sm font-medium text-slate-600"}>
                  {item.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <PendingPanel data={data} />
    </div>
  );
}

export default function ZarukuSeoDashboard({ data, locale = "ru-RU" }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const weeksKey = data.seo_os.weeks.join("\u0000");
  const [weekState, setWeekState] = useState(() => ({
    weeksKey,
    selection: createWeekSelection(data.seo_os.latest_week),
    comparisonEnabled: false,
  }));
  const comparisonAvailable = canCompareWeeks(data.seo_os.weeks);
  if (weekState.weeksKey !== weeksKey) {
    setWeekState({
      weeksKey,
      selection: reconcileWeekSelection(weekState.selection, data.seo_os.weeks),
      comparisonEnabled: weekState.comparisonEnabled && comparisonAvailable,
    });
  }
  const reconciledWeekSelection = reconcileWeekSelection(weekState.selection, data.seo_os.weeks);
  const effectiveComparisonEnabled = weekState.comparisonEnabled && comparisonAvailable;
  const selectedWeeks = {
    primaryWeek: reconciledWeekSelection.primaryWeek,
    comparisonWeek: effectiveComparisonEnabled ? reconciledWeekSelection.comparisonWeek : null,
  };
  const activeNav = NAV.find((item) => item.id === activeTab) ?? NAV[0];
  const CurrentIcon = activeNav.icon;

  const changeWeekSelection = (field: WeekSelectionField, week: string | null) => {
    setWeekState((current) => ({
      ...current,
      selection: reconcileWeekSelection(updateWeekSelection(current.selection, field, week, data.seo_os.weeks), data.seo_os.weeks),
    }));
  };
  const changeComparisonMode = (enabled: boolean) => {
    setWeekState((current) => ({
      ...current,
      comparisonEnabled: enabled && comparisonAvailable,
      selection: enabled ? current.selection : { ...current.selection, comparisonWeek: null },
    }));
  };
  const comparePreviousWeek = () => {
    if (!comparisonAvailable) return;
    setWeekState((current) => ({
      ...current,
      comparisonEnabled: true,
      selection: {
        ...current.selection,
        comparisonWeek: current.selection.primaryWeek ? previousAvailableWeek(data.seo_os.weeks, current.selection.primaryWeek) : null,
      },
    }));
  };
  const content = useMemo(() => {
    switch (activeTab) {
      case "seo":
        return <SeoTab data={data} locale={locale} primaryWeek={selectedWeeks.primaryWeek} comparisonWeek={selectedWeeks.comparisonWeek} />;
      case "seo_ops":
        return (
          <div className="space-y-5">
            <WeeklyFocusPanel data={data} locale={locale} primaryWeek={selectedWeeks.primaryWeek} />
            <ZarukuSeoOperations
              seoOs={data.seo_os}
              primaryWeek={selectedWeeks.primaryWeek}
              comparisonWeek={selectedWeeks.comparisonWeek}
              source={data.sources.find((source) => source.id === "seo_os")}
            />
          </div>
        );
      case "content":
        return <ContentTab data={data} locale={locale} primaryWeek={selectedWeeks.primaryWeek} comparisonWeek={selectedWeeks.comparisonWeek} />;
      case "geo":
        return <GeoTab data={data} locale={locale} />;
      case "devices":
        return <DevicesTab data={data} locale={locale} />;
      case "audience":
        return <AudienceTab data={data} locale={locale} />;
      case "behavior":
        return <BehaviorTab data={data} locale={locale} />;
      case "quality":
        return <QualityTab data={data} />;
      default:
        return <OverviewTab data={data} locale={locale} />;
    }
  }, [activeTab, data, locale, selectedWeeks.comparisonWeek, selectedWeeks.primaryWeek]);

  return (
    <div className="min-h-[calc(100vh-160px)] rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
      <div className="flex">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">Z</div>
            <div>
              <div className="text-sm font-semibold leading-tight">Zaruku</div>
              <div className="text-xs text-slate-400">SEO / GEO дашборд</div>
            </div>
          </div>
          <nav className="mt-6 space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={active
                    ? "flex w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-950"
                    : "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800"}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="mt-8 rounded-lg bg-slate-50 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
              <Database className="h-3.5 w-3.5" />
              Источники
            </div>
            <div className="space-y-1.5">
              {data.sources.map((source) => (
                <div key={source.id} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />
                      {source.label}
                    </span>
                    <span className={source.status === "connected" ? "text-teal-600" : "text-slate-400"}>
                      {SOURCE_STATUS_LABELS[source.status]}
                    </span>
                  </div>
                  <div className="ml-3 mt-0.5 text-[11px] leading-tight text-slate-400">
                    {SOURCE_COLLECTION_MODE_LABELS[source.collection_mode]}
                    {source.data_through ? ` · данные по ${source.data_through}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b border-slate-200 bg-slate-50 px-4 py-4 md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <CurrentIcon className="mt-1 h-5 w-5 text-teal-600" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{activeNav.label}</h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{data.domain}</span>
                    <span>·</span>
                    <span>счётчик {data.counters.join(", ")}</span>
                    <span>·</span>
                    <span>Период трафика:</span>
                    <span>{data.period.from} — {data.period.to}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.layers.map((layer) => (
                  <span key={layer.id} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-500">
                    {layer.label}
                  </span>
                ))}
              </div>
            </div>
            {shouldShowSeoWeekToolbar(activeTab) ? <div className="mt-3">
              <ZarukuSeoWeekToolbar
                weeks={data.seo_os.weeks}
                primaryWeek={selectedWeeks.primaryWeek}
                comparisonWeek={selectedWeeks.comparisonWeek}
                comparisonEnabled={effectiveComparisonEnabled}
                onComparisonEnabledChange={changeComparisonMode}
                onPrimaryWeekChange={(week) => changeWeekSelection("primaryWeek", week)}
                onComparisonWeekChange={(week) => changeWeekSelection("comparisonWeek", week)}
                onComparePrevious={comparePreviousWeek}
              />
            </div> : null}
            <div className="mt-3 flex gap-1 overflow-x-auto md:hidden">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={item.id === activeTab ? "shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white" : "shrink-0 rounded-md px-3 py-1.5 text-xs text-slate-500"}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </header>
          <div className="p-4 md:p-5">{content}</div>
        </main>
      </div>
    </div>
  );
}

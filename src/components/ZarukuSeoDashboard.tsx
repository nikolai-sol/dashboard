"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  LayoutGrid,
  Lock,
  Search,
  ShieldAlert,
  Users,
  Workflow,
} from "lucide-react";
import ZarukuSeoWeekToolbar from "@/components/ZarukuSeoWeekToolbar";
import ZarukuSeoDiagnostics from "@/components/ZarukuSeoDiagnostics";
import ZarukuSeoPageComparison from "@/components/ZarukuSeoPageComparison";
import ZarukuSeoQueryComparison from "@/components/ZarukuSeoQueryComparison";
import ZarukuInfoPopover from "@/components/ZarukuInfoPopover";
import ZarukuTableFrame from "@/components/ZarukuTableFrame";
import type {
  ZarukuSeoData,
  ZarukuSeoLayerId,
  ZarukuSeoMetricRow,
  ZarukuSeoSource,
  ZarukuSeoSourceId,
} from "@/lib/types";
import {
  canCompareWeeks,
  createWeekSelection,
  previousAvailableWeek,
  reconcileWeekSelection,
  shouldShowSeoWeekToolbar,
  updateWeekSelection,
  WEEK_SELECTION_FIELD_BY_SLOT,
  type ZarukuTabId,
  type WeekComparisonMode,
  type WeekSelection,
  type WeekSelectionField,
} from "@/components/zaruku-seo-week-selection";
import ZarukuSeoAnalytics from "@/components/ZarukuSeoAnalytics";
import ZarukuSeoOperations from "@/components/ZarukuSeoOperations";
import ZarukuOverviewTab from "@/components/ZarukuOverviewTab";
import ZarukuContentTab from "@/components/ZarukuContentTab";
import ZarukuAudienceTab, { isZarukuAudienceVisible } from "@/components/ZarukuAudienceTab";
import ZarukuWorkTab from "@/components/ZarukuWorkTab";
import ZarukuQualityTab from "@/components/ZarukuQualityTab";
import {
  buildNorthStarKpis,
  buildSemanticHealthRows,
  buildWeeklyFocus,
} from "@/components/zaruku-north-star";
import {
  buildUnifiedSeoPageRows,
  buildUnifiedSeoQueryRows,
} from "@/components/zaruku-seo-workspace";
import {
  buildNorthStarStripItems,
  buildTrafficHealthRows,
} from "@/components/zaruku-overview-layout";
import { formatPendingRequirementSources } from "@/components/zaruku-seo-pending";
import { resolveRowsForWeek } from "@/components/zaruku-yandex-webmaster-panels";
import { ZARUKU_CHART_PALETTE } from "@/lib/chart-palette";
import { ZARUKU_CLIENT_COPY } from "@/components/zaruku-client-copy";

type Props = {
  data: ZarukuSeoData;
  locale?: string;
  onActiveTabChange?: (tab: ZarukuTabId) => void;
};

type ZarukuWeekState = {
  weeksKey: string;
  selection: WeekSelection;
  comparisonMode: WeekComparisonMode;
};

export type { ZarukuTabId } from "@/components/zaruku-seo-week-selection";

const NAV: Array<{ id: ZarukuTabId; label: string; icon: typeof LayoutGrid }> = [
  { id: "overview", label: "Обзор", icon: LayoutGrid },
  { id: "seo", label: "SEO", icon: Search },
  { id: "content", label: "Контент", icon: FileText },
  { id: "audience", label: "Аудитория", icon: Users },
  { id: "work", label: "Работы и задачи", icon: Workflow },
  { id: "quality", label: "Качество", icon: ShieldAlert },
];

function formatNumber(value: number, locale = "ru-RU") {
  return Math.round(value).toLocaleString(locale);
}

function formatPercent(value: number | null | undefined, locale = "ru-RU", digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })}%`;
}

function truncate(value: string, max = 84) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatSignedPercent(value: number | null | undefined, locale = "ru-RU", digits = 1) {
  if (value == null || !Number.isFinite(value)) return "Δ —";
  const sign = value > 0 ? "+" : "";
  return `Δ ${sign}${formatPercent(value, locale, digits)}`;
}

function readableAudienceLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  const labels: Record<string, string> = {
    male: "Мужчины",
    men: "Мужчины",
    female: "Женщины",
    women: "Женщины",
    undefined: "Не определено",
    unknown: "Не определено",
    "not defined": "Не определено",
    "age undefined": "Возраст не определён",
    "gender undefined": "Пол не определён",
  };
  return labels[normalized] ?? label
    .replace(/^age:\s*/i, "")
    .replace(/^gender:\s*/i, "")
    .replace("years", "лет");
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

function formatSidebarDate(dateText: string): string {
  const normalized = String(dateText).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized.slice(8, 10)}.${normalized.slice(5, 7)}.${normalized.slice(0, 4)}`;
  }
  return normalized;
}

function formatSidebarMonthDate(dateText: string): string {
  const normalized = String(dateText).slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(normalized)) {
    return `01.${normalized.slice(5, 7)}.${normalized.slice(0, 4)}`;
  }
  return normalized;
}

const SOURCE_FRESHNESS_SOURCE_KEYS: Partial<Record<ZarukuSeoSourceId, string>> = {
  metrika: "yandex_metrika",
  gsc: "google_search_console",
  webmaster: "yandex_webmaster",
};

function getSourceRowsLabel(data: ZarukuSeoData, sourceId: ZarukuSeoSourceId) {
  const sourceFreshnessKey = SOURCE_FRESHNESS_SOURCE_KEYS[sourceId];
  if (sourceFreshnessKey) {
    const row = data.source_freshness.find((item) => item.source_key === sourceFreshnessKey);
    if (row?.date_to) return `посл. дата: ${formatSidebarDate(row.date_to)}`;
    return row?.last_success_at ? `посл. дата: ${formatSidebarDate(row.last_success_at)}` : null;
  }
  if (sourceId === "yandex_gen_search") {
    return seoIntelligenceRowsLabel(data);
  }
  if (sourceId === "seo_os") {
    return data.seo_os.latest_week ? `посл. неделя: ${data.seo_os.latest_week}` : null;
  }
  return null;
}

function seoIntelligenceRowsLabel(data: ZarukuSeoData) {
  const latestCapturedAt = data.seo_intelligence.ai.rows
    .map((row) => row.captured_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => value.slice(0, 10))
    .sort()
    .at(-1);
  if (latestCapturedAt) return `посл. дата: ${formatSidebarDate(latestCapturedAt)}`;
  if (!data.seo_intelligence.ai.latest_period) return null;
  return `посл. дата: ${formatSidebarMonthDate(data.seo_intelligence.ai.latest_period)}`;
}

function SourceBadge({ data, id }: { data: ZarukuSeoData; id: ZarukuSeoSourceId }) {
  const source = data.sources.find((item) => item.id === id);
  if (!source) return null;
  return (
    <span className="inline-flex flex-col items-start gap-0.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />
        {source.label}
        {source.status !== "connected" ? <Lock className="h-3 w-3 text-slate-300" /> : null}
      </span>
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
  titleInfo,
  bodyClassName = "",
  children,
}: {
  data: ZarukuSeoData;
  title: string;
  source?: ZarukuSeoSourceId;
  layer?: ZarukuSeoLayerId;
  pending?: boolean;
  right?: React.ReactNode;
  titleInfo?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface zaruku-panel flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex flex-col items-start gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {titleInfo}
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
      <div className={`${pending ? "opacity-60" : ""} min-h-0 flex-1 px-5 py-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

function BarList({
  rows,
  value = "visits",
  locale = "ru-RU",
  initialLimit,
}: {
  rows: ZarukuSeoMetricRow[];
  value?: "visits" | "users" | "pageviews";
  locale?: string;
  initialLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(1, ...rows.map((row) => row[value]));
  const visibleRows = initialLimit && !expanded ? rows.slice(0, initialLimit) : rows;
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);
  return (
    <div className="space-y-2.5">
      {visibleRows.map((row, index) => (
        <BarListRow
          key={`${row.label}-${row.secondary_label ?? ""}-${index}`}
          row={row}
          index={index}
          value={value}
          locale={locale}
          max={max}
        />
      ))}
      {initialLimit && rows.length > initialLimit ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          {expanded ? "свернуть" : `ещё ${hiddenCount}`}
        </button>
      ) : null}
    </div>
  );
}

function BarListRow({
  row,
  index,
  value,
  locale,
  max,
}: {
  row: ZarukuSeoMetricRow;
  index: number;
  value: "visits" | "users" | "pageviews";
  locale: string;
  max: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [showPercentInside, setShowPercentInside] = useState(true);
  const label = readableAudienceLabel(row.label);

  const share = row.share != null && Number.isFinite(row.share) ? row.share : (Math.max(0, row[value]) / max) * 100;
  const sharePercent = Math.max(0, Math.min(100, share));
  const percentText = formatPercent(sharePercent, locale, 1);
  const barStyle = {
    width: `${sharePercent}%`,
    background: ZARUKU_CHART_PALETTE.series[index % ZARUKU_CHART_PALETTE.series.length],
  };

  useLayoutEffect(() => {
    const track = trackRef.current;
    const label = labelRef.current;
    if (!track || !label) return;

    const evaluate = () => {
      const trackWidth = Math.max(1, track.clientWidth);
      const fillWidth = (sharePercent / 100) * trackWidth;
      const labelWidth = Math.ceil(label.getBoundingClientRect().width);
      const requiredGap = 8;
      setShowPercentInside(fillWidth >= labelWidth + requiredGap);
    };

    evaluate();
    const observer = new ResizeObserver(evaluate);
    observer.observe(track);
    return () => observer.disconnect();
  }, [sharePercent, percentText]);

  return (
    <div className="grid grid-cols-[128px_minmax(0,1fr)_64px] items-center gap-3">
      <div className="min-w-0 text-sm text-slate-600" title={label}>
        {truncate(label, 28)}
      </div>
      <div ref={trackRef} className="relative h-6 overflow-visible rounded-md bg-slate-50">
        <div className="absolute inset-y-0 left-0 overflow-hidden rounded-md" style={barStyle}>
          <span
            ref={labelRef}
            className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center whitespace-nowrap px-2 text-xs font-medium opacity-0"
            aria-hidden="true"
          >
            {percentText}
          </span>
          {showPercentInside ? (
            <span className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center justify-center whitespace-nowrap px-2 text-xs font-medium text-white">
              {percentText}
            </span>
          ) : null}
        </div>
        {!showPercentInside ? (
          <span
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-medium text-slate-600"
            style={{ left: `calc(${sharePercent}% + 6px)` }}
          >
            {percentText}
          </span>
        ) : null}
      </div>
      <div className="text-right text-sm text-slate-500">{formatNumber(row[value], locale)}</div>
    </div>
  );
}

function PendingPanel({ data }: { data: ZarukuSeoData }) {
  if (data.pending_requirements.length === 0) return null;

  return (
    <Panel data={data} title="Что ещё ждём" layer="serp" pending={data.pending_requirements.length > 0} right={<span className="text-xs text-slate-400">{formatPendingRequirementSources(data)}</span>}>
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

function buildGscSelectionMeta<T extends { week: string; week_from: string; week_to: string; is_partial_week?: boolean }>(
  selection: { week: string | null; rows: T[] },
  selectedWeek: string | null,
) {
  const firstRow = selection.rows[0];
  const weekLabel = selection.week ?? firstRow?.week ?? selectedWeek ?? "неделя —";
  const [, month, day] = (firstRow?.week_to ?? "").slice(0, 10).split("-");
  const shortTo = day && month ? `${day}.${month}` : firstRow?.week_to;
  const periodLabel = firstRow?.is_partial_week
    ? `${weekLabel} · частично, по ${shortTo}`
    : firstRow
      ? `${weekLabel} · ${firstRow.week_from} — ${firstRow.week_to}`
      : weekLabel;
  const fallbackNote = selectedWeek && selection.rows.length === 0
    ? "За текущий ежедневный период GSC search facts пока нет."
    : null;

  return {
    periodLabel,
    sourceNote: "Источник: Google Search Console · данные поисковых запросов.",
    fallbackNote,
  };
}

function NorthStarBlock({ data, locale }: Props) {
  const items = buildNorthStarStripItems(buildNorthStarKpis({
    sovRows: data.seo_intelligence.sov.rows,
    aiRows: data.seo_intelligence.ai.rows,
    opportunities: data.seo_os.opportunities,
  }));
  return (
    <section className="card-surface zaruku-panel h-full overflow-hidden border-t-slate-300 bg-surface-alt px-5 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 lg:w-[380px]">
          <h3 className="text-base font-medium text-slate-900 lg:whitespace-nowrap">Цель: целевой органический трафик + ИИ-выдача</h3>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
          {items.map((item) => (
            <div key={item.key} className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>{item.label}</span>
                <ZarukuInfoPopover label={`${item.label}: что это и почему важно`}>
                  <div className="text-sm font-semibold text-slate-900">{item.tooltipTitle}</div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{item.tooltipDescription}</p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-700">{item.tooltipImportance}</p>
                  <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-400">{item.tooltip}</p>
                </ZarukuInfoPopover>
              </div>
              <div data-zaruku-kpi-value-row className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
                <span className="zaruku-kpi-value min-w-0 text-3xl font-semibold leading-none text-slate-950">{formatPercent(item.value, locale, 1)}</span>
                <span className="shrink-0 text-sm font-medium text-slate-400">{item.arrow}</span>
                {item.showDelta ? (
                  <span className={item.deltaTone === "good" ? "shrink-0 text-xs font-medium text-teal-700" : "shrink-0 text-xs font-medium text-red-700"}>
                    {formatSignedPercent(item.delta, locale, 1)}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">с 07.2026</div>
      </div>
    </section>
  );
}

function TrafficHealthStrip({ data }: { data: ZarukuSeoData }) {
  const [expanded, setExpanded] = useState(false);
  const rows = buildTrafficHealthRows(data.kpis);
  return (
    <section className="card-surface zaruku-panel h-full overflow-hidden">
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
              <div className="zaruku-kpi-value mt-1 text-2xl font-semibold leading-none text-slate-950">{item.value}</div>
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
              <CartesianGrid stroke={ZARUKU_CHART_PALETTE.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="presence_rate" name="Доля присутствия" fill={ZARUKU_CHART_PALETTE.position} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div className="text-xs uppercase text-slate-400">Присутствие</div><div className="zaruku-kpi-value mt-1 text-xl font-semibold text-slate-900">{formatPercent(latest?.presence_rate, locale, 1)}</div></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div className="text-xs uppercase text-slate-400">Упоминания</div><div className="zaruku-kpi-value mt-1 text-xl font-semibold text-slate-900">{formatNumber(latest?.mentions ?? 0, locale)}</div></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div className="text-xs uppercase text-slate-400">Цитаты</div><div className="zaruku-kpi-value mt-1 text-xl font-semibold text-slate-900">{formatNumber(latest?.citations ?? 0, locale)}</div></div>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            {latest ? `${formatNumber(latest.mentions, locale)} упоминаний и ${formatNumber(latest.citations, locale)} цитирований за ${latest.period}.` : ""}
            {latest?.provenance ? ` Контрольная точка загружена вручную; источник: ${latest.provenance}.` : ""}
          </p>
        </div>
      ) : (
        <div className="rounded-md bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">{ZARUKU_CLIENT_COPY.emptyAiVisibility}</div>
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
            <CartesianGrid stroke={ZARUKU_CHART_PALETTE.grid} strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Line type="monotone" dataKey="noise" name="Шум в показах" stroke={ZARUKU_CHART_PALETTE.danger} strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="medical" name="Медицинский интент" stroke={ZARUKU_CHART_PALETTE.seo} strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="noise_baseline" name="Ориентир шума" stroke={ZARUKU_CHART_PALETTE.danger} strokeDasharray="5 5" dot={false} />
            <Line type="monotone" dataKey="medical_baseline" name="Ориентир мед. интента" stroke={ZARUKU_CHART_PALETTE.seo} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <ZarukuTableFrame mode="standard" label="Семантические кластеры">
          <table className="zaruku-table min-w-[760px]">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Кластер</th><th className="pb-2 text-right font-medium">Запросы</th><th className="pb-2 text-right font-medium">Показы</th><th className="pb-2 text-right font-medium">Клики</th><th className="pb-2 text-right font-medium">Доля показов</th><th className="pb-2 text-right font-medium">Доля кликов</th><th className="pb-2 text-right font-medium">CTR</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {selectedRows.map((row) => <tr key={`${row.week}-${row.cluster}`}><td className="py-2.5 font-medium text-slate-700">{row.cluster}{row.isBaselineCluster ? <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">ориентир</span> : null}</td><td className="py-2.5 text-right text-slate-600">{formatNumber(row.query_count, locale)}</td><td className="py-2.5 text-right text-slate-600">{formatNumber(row.impressions, locale)}</td><td className="py-2.5 text-right text-slate-600">{formatNumber(row.clicks, locale)}</td><td className="py-2.5 text-right text-slate-600">{formatPercent(row.impressions_share, locale, 2)}</td><td className="py-2.5 text-right text-slate-600">{formatPercent(row.clicks_share, locale, 2)}</td><td className="py-2.5 text-right text-slate-500">{formatPercent(row.ctr, locale, 2)}</td></tr>)}
              {selectedRows.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-500">{ZARUKU_CLIENT_COPY.emptySemanticGroups}</td></tr> : null}
            </tbody>
          </table>
        </ZarukuTableFrame>
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
    <>
      <ZarukuOverviewTab data={data}>
        <NorthStarBlock data={data} locale={locale} />
        <TrafficHealthStrip data={data} />
        <Panel
          data={data}
          title="Каналы привлечения"
          source="metrika"
          bodyClassName="overflow-auto"
          titleInfo={data.technical_tail.length ? (
            <ZarukuInfoPopover label={ZARUKU_CLIENT_COPY.technicalTail.label}>
              <div className="text-sm font-semibold text-slate-900">{ZARUKU_CLIENT_COPY.technicalTail.title}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{ZARUKU_CLIENT_COPY.technicalTail.description}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-700">{ZARUKU_CLIENT_COPY.technicalTail.importance}</p>
              <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-400">
                {data.technical_tail.map((row) => `${row.label}: ${formatNumber(row.visits, locale)}`).join(", ")}
              </p>
            </ZarukuInfoPopover>
          ) : null}
        >
          <BarList rows={data.traffic_channels} locale={locale} initialLimit={6} />
        </Panel>
        <Panel data={data} title="Органический поиск" source="metrika">
          <div className="h-[220px] xl:h-full">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
              <LineChart data={data.organic_trend} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={ZARUKU_CHART_PALETTE.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" padding={{ right: 12 }} tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="visits" stroke={ZARUKU_CHART_PALETTE.seo} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </ZarukuOverviewTab>
      <PendingPanel data={data} />
    </>
  );
}

function SeoTab({ data, locale, primaryWeek, comparisonWeek }: Props & { primaryWeek: string | null; comparisonWeek: string | null }) {
  const phraseCoverage = data.data_quality.find((item) => item.title === "Покрытие поисковых фраз");
  const currentLocale = locale ?? "ru-RU";
  const webmasterWeek = data.webmaster.latest_week;
  const webmasterQuerySelection = resolveRowsForWeek(data.webmaster.queries, webmasterWeek, null);
  const webmasterPageSelection = resolveRowsForWeek(data.webmaster.pages, webmasterWeek, data.webmaster.latest_week);
  const webmasterQueries = webmasterQuerySelection.rows;
  const webmasterPages = webmasterPageSelection.rows;
  const gscWeek = data.gsc.latest_week;
  const gscSummarySelection = resolveRowsForWeek(data.gsc.summary, gscWeek, null);
  const gscQuerySelection = resolveRowsForWeek(data.gsc.queries, gscWeek, null);
  const gscLandingPageSelection = resolveRowsForWeek(data.gsc.landing_pages, gscWeek, null);
  const gscBrandSplitSelection = resolveRowsForWeek(data.gsc.brand_split, gscWeek, null);
  const gscSearchAppearanceSelection = resolveRowsForWeek(data.gsc.search_appearance, gscWeek, null);
  const gscSearchTypeSelection = resolveRowsForWeek(data.gsc.search_type_summary, gscWeek, null);
  const gscSummaryRows = gscSummarySelection.rows;
  const gscQueries = gscQuerySelection.rows;
  const gscLandingPages = gscLandingPageSelection.rows;
  const gscBrandSplit = gscBrandSplitSelection.rows;
  const gscSearchAppearanceRows = gscSearchAppearanceSelection.rows;
  const gscSearchTypeRows = gscSearchTypeSelection.rows;
  const gscFactsMeta = buildGscSelectionMeta(gscSummaryRows.length > 0 ? gscSummarySelection : gscQuerySelection, gscWeek);
  const gscBrandSplitMeta = buildGscSelectionMeta(gscBrandSplitSelection, gscWeek);
  const gscSearchAppearanceMeta = buildGscSelectionMeta(gscSearchAppearanceSelection, gscWeek);
  const gscSearchTypeMeta = buildGscSelectionMeta(gscSearchTypeSelection, gscWeek);
  const seoOsWeek = primaryWeek ?? data.seo_os.latest_week;
  const selectedSeoOsClusters = seoOsWeek
    ? data.seo_os.clusters.filter((row) => row.week === seoOsWeek)
    : [];
  const unifiedQueryRows = buildUnifiedSeoQueryRows({
    gscRows: gscQueries,
    webmasterRows: webmasterQueries,
    seoOsRows: selectedSeoOsClusters,
  });
  const unifiedPageRows = buildUnifiedSeoPageRows({
    gscRows: gscLandingPages,
    webmasterRows: webmasterPages,
    metrikaRows: data.organic_landing_pages,
    seoOsRows: selectedSeoOsClusters,
  });
  return (
    <div className="space-y-5">
      <ZarukuSeoQueryComparison
        rows={unifiedQueryRows}
        sourceAvailability={{
          google: data.gsc.status !== "unavailable",
          webmaster: data.webmaster.status !== "unavailable",
          seoOs: data.seo_os.status !== "unavailable",
        }}
        sourceWeeks={{
          google: gscQuerySelection.week,
          webmaster: webmasterQuerySelection.week,
          seoOs: selectedSeoOsClusters.length > 0 ? seoOsWeek : null,
        }}
        defaultSort={{ key: "google_position", direction: "asc" }}
        locale={currentLocale}
      />
      <ZarukuSeoPageComparison
        rows={unifiedPageRows}
        sourceAvailability={{
          google: data.gsc.status !== "unavailable",
          webmaster: data.webmaster.status !== "unavailable",
          seoOs: data.seo_os.status !== "unavailable",
        }}
        seoWeek={seoOsWeek}
        sourceWeeks={{
          google: gscLandingPages.length > 0 ? gscLandingPageSelection.week : null,
          webmaster: webmasterPages.length > 0 ? webmasterPageSelection.week : null,
          seoOs: selectedSeoOsClusters.length > 0 ? seoOsWeek : null,
        }}
        trafficPeriod={data.period}
        locale={currentLocale}
      />
      <SemanticHealthPanel data={data} locale={locale} primaryWeek={primaryWeek} />
      <ZarukuSeoAnalytics
        seoOs={data.seo_os}
        primaryWeek={primaryWeek}
        comparisonWeek={comparisonWeek}
        source={data.sources.find((source) => source.id === "seo_os")}
        showClusterTable={false}
      />
      <AiAggregateVisibilityPanel data={data} locale={currentLocale} />
      <ZarukuSeoDiagnostics
        summaryRows={gscSummaryRows}
        brandRows={gscBrandSplit}
        appearanceRows={gscSearchAppearanceRows}
        resultTypeRows={gscSearchTypeRows}
        periods={{
          summary: { label: gscFactsMeta.periodLabel, fallbackNote: gscFactsMeta.fallbackNote },
          brand: { label: gscBrandSplitMeta.periodLabel, fallbackNote: gscBrandSplitMeta.fallbackNote },
          appearance: { label: gscSearchAppearanceMeta.periodLabel, fallbackNote: gscSearchAppearanceMeta.fallbackNote },
          resultType: { label: gscSearchTypeMeta.periodLabel, fallbackNote: gscSearchTypeMeta.fallbackNote },
        }}
        locale={currentLocale}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data={data} title="Поисковые системы после клика" source="metrika" layer="onsite">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.search_engines} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={ZARUKU_CHART_PALETTE.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: ZARUKU_CHART_PALETTE.axis }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="visits" radius={[6, 6, 0, 0]}>
                {data.search_engines.map((_, index) => <Cell key={index} fill={ZARUKU_CHART_PALETTE.series[index % ZARUKU_CHART_PALETTE.series.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel data={data} title="Поисковые фразы из Метрики" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">{phraseCoverage?.value ?? "покрытие —"}</span>}>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            Фразы, которые Метрика смогла определить после клика. Это не полный список SEO-запросов: часть запросов скрывается поисковиками.
          </p>
          <div className="max-h-[15rem] overflow-auto">
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
    </div>
  );
}

export default function ZarukuSeoDashboard({ data, locale = "ru-RU", onActiveTabChange }: Props) {
  const [activeTab, setActiveTab] = useState<ZarukuTabId>("overview");
  const audienceVisible = isZarukuAudienceVisible(data);
  const visibleNav = useMemo(
    () => audienceVisible ? NAV : NAV.filter((item) => item.id !== "audience"),
    [audienceVisible],
  );
  const weeksKey = data.seo_os.weeks.join("\u0000");
  const [weekState, setWeekState] = useState<ZarukuWeekState>(() => ({
    weeksKey,
    selection: createWeekSelection(data.seo_os.latest_week),
    comparisonMode: "single",
  }));
  const comparisonAvailable = canCompareWeeks(data.seo_os.weeks);
  if (weekState.weeksKey !== weeksKey) {
    setWeekState({
      weeksKey,
      selection: reconcileWeekSelection(weekState.selection, data.seo_os.weeks),
      comparisonMode: weekState.comparisonMode === "comparison" && comparisonAvailable ? "comparison" : "single",
    });
  }
  const reconciledWeekSelection = reconcileWeekSelection(weekState.selection, data.seo_os.weeks);
  const effectiveComparisonEnabled = weekState.comparisonMode === "comparison" && comparisonAvailable;
  const selectedWeeks = {
    primaryWeek: reconciledWeekSelection.primaryWeek,
    comparisonWeek: effectiveComparisonEnabled ? reconciledWeekSelection.comparisonWeek : null,
  };
  const activeNav = visibleNav.find((item) => item.id === activeTab) ?? visibleNav[0];
  const CurrentIcon = activeNav.icon;

  useEffect(() => {
    if (visibleNav.some((item) => item.id === activeTab)) return;
    const frame = window.requestAnimationFrame(() => {
      setActiveTab("overview");
      onActiveTabChange?.("overview");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, onActiveTabChange, visibleNav]);

  const changeWeekSelection = (field: WeekSelectionField, week: string | null) => {
    setWeekState((current) => ({
      ...current,
      selection: reconcileWeekSelection(updateWeekSelection(current.selection, field, week, data.seo_os.weeks), data.seo_os.weeks),
    }));
  };
  const changeComparisonMode = (enabled: boolean) => {
    setWeekState((current) => ({
      ...current,
      comparisonMode: enabled && comparisonAvailable ? "comparison" : "single",
      selection: enabled ? current.selection : { ...current.selection, comparisonWeek: null },
    }));
  };
  const comparePreviousWeek = () => {
    if (!comparisonAvailable) return;
    setWeekState((current) => ({
      ...current,
      comparisonMode: "comparison",
      selection: {
        ...current.selection,
        comparisonWeek: current.selection.primaryWeek ? previousAvailableWeek(data.seo_os.weeks, current.selection.primaryWeek) : null,
      },
    }));
  };
  const selectTab = (tab: ZarukuTabId) => {
    setActiveTab(tab);
    onActiveTabChange?.(tab);
    window.requestAnimationFrame(() => {
      document.getElementById("zaruku-tab-content")?.scrollIntoView({ block: "start" });
    });
  };
  const content = useMemo(() => {
    switch (activeTab) {
      case "seo":
        return <SeoTab data={data} locale={locale} primaryWeek={selectedWeeks.primaryWeek} comparisonWeek={selectedWeeks.comparisonWeek} />;
      case "work":
        return (
          <ZarukuWorkTab data={data} primaryWeek={selectedWeeks.primaryWeek} comparisonWeek={selectedWeeks.comparisonWeek}>
            <WeeklyFocusPanel data={data} locale={locale} primaryWeek={selectedWeeks.primaryWeek} />
            <ZarukuSeoOperations
              seoOs={data.seo_os}
              primaryWeek={selectedWeeks.primaryWeek}
              comparisonWeek={selectedWeeks.comparisonWeek}
              source={data.sources.find((source) => source.id === "seo_os")}
            />
          </ZarukuWorkTab>
        );
      case "content":
        return <ZarukuContentTab data={data} locale={locale} primaryWeek={selectedWeeks.primaryWeek} comparisonWeek={selectedWeeks.comparisonWeek} />;
      case "audience":
        return <ZarukuAudienceTab data={data} locale={locale} />;
      case "quality":
        return <ZarukuQualityTab data={data} />;
      default:
        return <OverviewTab data={data} locale={locale} />;
    }
  }, [activeTab, data, locale, selectedWeeks.comparisonWeek, selectedWeeks.primaryWeek]);

  return (
    <div className="zaruku-dashboard min-h-[calc(100vh-194px)] rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
      <div className="flex">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">Z</div>
            <div>
              <div className="text-sm font-semibold leading-tight">Zaruku</div>
              <div className="text-xs text-slate-400">SEO / AI-поиск</div>
            </div>
          </div>
          <nav className="mt-6 space-y-1">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectTab(item.id)}
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
              {data.sources.map((source) => {
                const rowsLabel = getSourceRowsLabel(data, source.id);
                return (
                  <div key={source.id} className="min-w-0 text-xs">
                    <div data-source-main-row className="flex min-w-0 items-start justify-between gap-2">
                      <span className="flex min-w-0 items-start gap-1.5 text-slate-600">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: source.color }} />
                        <span>{source.label}</span>
                      </span>
                      <span className={source.status === "connected" ? "shrink-0 text-teal-600" : "shrink-0 text-slate-400"}>
                        {SOURCE_STATUS_LABELS[source.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-3 text-[11px] font-normal leading-tight text-slate-400">
                      {SOURCE_COLLECTION_MODE_LABELS[source.collection_mode]}
                    </div>
                    {source.status === "connected" && rowsLabel ? (
                      <div data-source-freshness className="mt-0.5 pl-3 text-[11px] font-normal leading-tight text-slate-400">
                        {rowsLabel}
                      </div>
                    ) : null}
                  </div>
                );
              })}
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
            </div>
            {shouldShowSeoWeekToolbar(activeTab) ? <div className="mt-3">
              <ZarukuSeoWeekToolbar
                weeks={data.seo_os.weeks}
                primaryWeek={selectedWeeks.primaryWeek}
                comparisonWeek={selectedWeeks.comparisonWeek}
                comparisonEnabled={effectiveComparisonEnabled}
                onComparisonEnabledChange={changeComparisonMode}
                onPrimaryWeekChange={(week) => changeWeekSelection(WEEK_SELECTION_FIELD_BY_SLOT.A, week)}
                onComparisonWeekChange={(week) => changeWeekSelection(WEEK_SELECTION_FIELD_BY_SLOT.B, week)}
                onComparePrevious={comparePreviousWeek}
              />
            </div> : null}
            <div className="mt-3 flex gap-1 overflow-x-auto md:hidden">
              {visibleNav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectTab(item.id)}
                  className={item.id === activeTab ? "shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white" : "shrink-0 rounded-md px-3 py-1.5 text-xs text-slate-500"}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </header>
          <div id="zaruku-tab-content" className="scroll-mt-4 p-4 md:p-5">{content}</div>
        </main>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
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
  MapPin,
  MonitorSmartphone,
  Repeat,
  Search,
  ShieldAlert,
  Users,
} from "lucide-react";
import ZarukuSeoWeekToolbar from "@/components/ZarukuSeoWeekToolbar";
import type {
  ZarukuSeoData,
  ZarukuSeoLayerId,
  ZarukuSeoMetricRow,
  ZarukuSeoSourceId,
} from "@/lib/types";
import {
  createWeekSelection,
  previousAvailableWeek,
  updateWeekSelection,
  type WeekSelectionField,
} from "@/components/zaruku-seo-week-selection";
import ZarukuSeoAnalytics from "@/components/ZarukuSeoAnalytics";

type Props = {
  data: ZarukuSeoData;
  locale?: string;
};

type TabId = "overview" | "seo" | "content" | "geo" | "devices" | "audience" | "behavior" | "quality";

const NAV: Array<{ id: TabId; label: string; icon: typeof LayoutGrid }> = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "seo", label: "SEO", icon: Search },
  { id: "content", label: "Контент", icon: FileText },
  { id: "geo", label: "Гео", icon: MapPin },
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

function SourceBadge({ data, id }: { data: ZarukuSeoData; id: ZarukuSeoSourceId }) {
  const source = data.sources.find((item) => item.id === id);
  if (!source) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />
      {source.label}
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

function KpiGrid({ data }: { data: ZarukuSeoData }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {data.kpis.map((kpi) => (
        <div key={kpi.key} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-medium uppercase text-slate-400">{kpi.label}</div>
          <div className="mt-1.5 text-2xl font-semibold text-slate-950">{kpi.value}</div>
          <div className="mt-1 text-xs text-slate-400">{kpi.note ?? kpi.source}</div>
        </div>
      ))}
    </div>
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
}: {
  rows: ZarukuSeoMetricRow[];
  mode: "pages" | "metrics" | "cross";
  locale: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="pb-2 font-medium">{mode === "pages" ? "Страница" : "Сегмент"}</th>
            {mode === "cross" ? <th className="pb-2 font-medium">Разрез</th> : null}
            <th className="pb-2 text-right font-medium">Визиты</th>
            <th className="pb-2 text-right font-medium">Users</th>
            <th className="pb-2 text-right font-medium">Просмотры</th>
            <th className="pb-2 text-right font-medium">Отказы</th>
            <th className="pb-2 text-right font-medium">Время</th>
            <th className="pb-2 text-right font-medium">Глубина</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={`${row.label}-${row.secondary_label ?? ""}-${row.url ?? ""}-${index}`}>
              <td className="max-w-[420px] py-2.5">
                <div className="font-medium text-slate-700" title={row.label}>
                  {truncate(row.label, mode === "pages" ? 72 : 48)}
                </div>
                {row.url ? <div className="text-xs text-slate-400">{truncate(shortUrl(row.url), 86)}</div> : null}
              </td>
              {mode === "cross" ? <td className="py-2.5 text-slate-500">{row.secondary_label ?? "—"}</td> : null}
              <td className="py-2.5 text-right text-slate-600">{row.visits ? formatNumber(row.visits, locale) : "—"}</td>
              <td className="py-2.5 text-right text-slate-600">{formatNumber(row.users, locale)}</td>
              <td className="py-2.5 text-right text-slate-600">{formatNumber(row.pageviews, locale)}</td>
              <td className="py-2.5 text-right text-slate-500">{formatPercent(row.bounce_rate, locale, 1)}</td>
              <td className="py-2.5 text-right text-slate-500">{formatDuration(row.avg_duration_seconds)}</td>
              <td className="py-2.5 text-right text-slate-500">{row.page_depth?.toFixed(1) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingPanel({ data }: { data: ZarukuSeoData }) {
  return (
    <Panel data={data} title="Что еще ждем" layer="serp" pending right={<span className="text-xs text-slate-400">GSC · Вебмастер · DataForSEO</span>}>
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

function OverviewTab({ data, locale }: Props) {
  return (
    <div className="space-y-5">
      <KpiGrid data={data} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel data={data} title="Каналы привлечения" source="metrika" layer="onsite">
            <BarList rows={data.traffic_channels} locale={locale} />
            {data.technical_tail.length ? (
              <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Технический хвост:{" "}
                {data.technical_tail.map((row) => `${row.label}: ${formatNumber(row.visits, locale)}`).join(", ")}. Он не считается отдельным acquisition-каналом.
              </div>
            ) : null}
          </Panel>
        </div>
        <Panel data={data} title="Organic по месяцам" source="metrika" layer="onsite">
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
        <Panel data={data} title="Показы · клики · CTR" source="gsc" layer="serp" pending right={<span className="text-xs text-slate-400">GSC · Вебмастер</span>}>
          <div className="grid grid-cols-3 gap-3">
            {["Показы", "Клики", "CTR"].map((item) => (
              <div key={item} className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center">
                <div className="text-xs uppercase text-slate-400">{item}</div>
                <div className="mt-2 text-xl font-semibold text-slate-300">—</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            Данные по показам, кликам и CTR ожидаются из Search Console и Яндекс Вебмастера.
          </p>
        </Panel>
      </div>
      <ZarukuSeoAnalytics
        seoOs={data.seo_os}
        primaryWeek={primaryWeek}
        comparisonWeek={comparisonWeek}
        source={data.sources.find((source) => source.id === "seo_os")}
      />
      <Panel data={data} title="Top organic landing pages" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">SERP columns pending</span>}>
        <DataTable rows={data.organic_landing_pages.slice(0, 12)} mode="cross" locale={locale ?? "ru-RU"} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data={data} title="Поисковые фразы" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">{phraseCoverage?.value ?? "coverage —"}</span>}>
          <div className="space-y-2">
            {data.search_phrases.slice(0, 12).map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                <span className="min-w-0 text-sm text-slate-700" title={row.label}>{truncate(row.label, 72)}</span>
                <span className="shrink-0 text-sm text-slate-500">{formatNumber(row.visits, locale)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Google часто скрывает query, поэтому это не полная SEO-семантика.</p>
        </Panel>
        <Panel data={data} title="AI visibility" source="dataforseo" layer="ai" pending>
          <div className="grid grid-cols-3 gap-3">
            {["Упоминания", "Доля цитат", "Presence"].map((item) => (
              <div key={item} className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center">
                <div className="text-xs uppercase text-slate-400">{item}</div>
                <div className="mt-2 text-xl font-semibold text-slate-300">—</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">Слой DataForSEO/AI будет жить рядом с SERP, не внутри Metrika.</p>
        </Panel>
      </div>
    </div>
  );
}

function ContentTab({ data, locale }: Props) {
  return (
    <div className="space-y-5">
      <Panel data={data} title="Разделы портала" source="metrika" layer="onsite">
        <DataTable rows={data.content_sections} mode="metrics" locale={locale ?? "ru-RU"} />
      </Panel>
      <Panel data={data} title="Top pages" source="metrika" layer="onsite">
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
      <Panel data={data} title="Спрос на карту онкоцентров" source="metrika" layer="onsite">
        <p className="text-sm leading-relaxed text-slate-600">
          Следующий полезный срез: <code className="rounded-md bg-slate-100 px-1 py-0.5">regionCity × /map</code>. Он покажет,
          из каких городов приходят к карте центров и где стоит усиливать региональный контент. UI готов под такой cross-tab.
        </p>
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
        <Panel data={data} title="Source × device" source="metrika" layer="onsite">
          <DataTable rows={data.source_devices.slice(0, 12)} mode="cross" locale={locale ?? "ru-RU"} />
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel data={data} title="Браузеры" source="metrika" layer="onsite">
          <BarList rows={data.browsers.slice(0, 10)} locale={locale} />
        </Panel>
        <Panel data={data} title="OS" source="metrika" layer="onsite">
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
        <Panel data={data} title="Возраст" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">inferred</span>}>
          <BarList rows={data.age} locale={locale} />
        </Panel>
        <Panel data={data} title="Пол" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">inferred</span>}>
          <BarList rows={data.gender} locale={locale} />
        </Panel>
      </div>
      <Panel data={data} title="Интересы" source="metrika" layer="onsite" right={<span className="text-xs text-slate-400">coverage зависит от Яндекса</span>}>
        <BarList rows={data.interests.slice(0, 12)} locale={locale} />
      </Panel>
    </div>
  );
}

function BehaviorTab({ data, locale }: Props) {
  return (
    <div className="space-y-5">
      <Panel data={data} title="Возвраты по URL" source="metrika" layer="onsite">
        <DataTable rows={data.returning_pages.slice(0, 16)} mode="pages" locale={locale ?? "ru-RU"} />
      </Panel>
      <Panel data={data} title="Поведенческие сигналы" source="metrika" layer="onsite">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["High-bounce pages", "Страницы с высоким отказом появятся после сохранения page-level bounce."],
            ["Entry pages", "Основные landing pages уже есть в SEO-разделе."],
            ["Scroll / downloads", "Нужны цели Метрики или события для скачивания материалов."],
          ].map(([title, note]) => (
            <div key={title} className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-700">{title}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500">{note}</div>
            </div>
          ))}
        </div>
      </Panel>
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
  const [weekSelection, setWeekSelection] = useState(() => createWeekSelection(data.seo_os.latest_week));
  const [comparisonEnabled, setComparisonEnabled] = useState(false);
  const activeNav = NAV.find((item) => item.id === activeTab) ?? NAV[0];
  const CurrentIcon = activeNav.icon;
  const changeWeekSelection = (field: WeekSelectionField, week: string | null) => {
    setWeekSelection((current) => updateWeekSelection(current, field, week, data.seo_os.weeks));
  };
  const changeComparisonMode = (enabled: boolean) => {
    setComparisonEnabled(enabled);
    if (!enabled) setWeekSelection((current) => ({ ...current, comparisonWeek: null }));
  };
  const comparePreviousWeek = () => {
    setComparisonEnabled(true);
    setWeekSelection((current) => ({
      ...current,
      comparisonWeek: current.primaryWeek ? previousAvailableWeek(data.seo_os.weeks, current.primaryWeek) : null,
    }));
  };
  const content = useMemo(() => {
    switch (activeTab) {
      case "seo":
        return <SeoTab data={data} locale={locale} primaryWeek={weekSelection.primaryWeek} comparisonWeek={weekSelection.comparisonWeek} />;
      case "content":
        return <ContentTab data={data} locale={locale} />;
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
  }, [activeTab, data, locale, weekSelection.comparisonWeek, weekSelection.primaryWeek]);

  return (
    <div className="min-h-[calc(100vh-160px)] rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
      <div className="flex">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">Z</div>
            <div>
              <div className="text-sm font-semibold leading-tight">Zaruku</div>
              <div className="text-xs text-slate-400">SEO / GEO dashboard</div>
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
                <div key={source.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />
                    {source.label}
                  </span>
                  <span className={source.status === "connected" ? "text-teal-600" : "text-slate-300"}>
                    {source.status === "connected" ? "on" : "—"}
                  </span>
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
                    <span>counter {data.counters.join(", ")}</span>
                    <span>·</span>
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
            <div className="mt-3">
              <ZarukuSeoWeekToolbar
                weeks={data.seo_os.weeks}
                primaryWeek={weekSelection.primaryWeek}
                comparisonWeek={weekSelection.comparisonWeek}
                comparisonEnabled={comparisonEnabled}
                onComparisonEnabledChange={changeComparisonMode}
                onPrimaryWeekChange={(week) => changeWeekSelection("primaryWeek", week)}
                onComparisonWeekChange={(week) => changeWeekSelection("comparisonWeek", week)}
                onComparePrevious={comparePreviousWeek}
              />
            </div>
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

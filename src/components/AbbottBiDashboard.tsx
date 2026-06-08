"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AbbottBiData } from "@/lib/types";

type AbbottBiDashboardProps = {
  data: AbbottBiData;
  locale?: string;
};

type TabId =
  | "users_summary"
  | "user_actions"
  | "page_stats"
  | "bitrix_pages"
  | "external_events"
  | "time_buckets"
  | "returning"
  | "general_materials";

type TabConfig = {
  id: TabId;
  label: string;
  description: string;
};

type SelectOption = {
  label: string;
  value: string;
};

type SearchOption = {
  label: string;
  value: string;
  description?: string;
};

type TableColumn = {
  key: string;
  label: string;
  className?: string;
};

type ThemeConfig = {
  accent: string;
  accentSoft: string;
  borderClass: string;
  textClass: string;
  pillClass: string;
  headerClass: string;
  barColor: string;
  pieColors: string[];
};

const TABS: TabConfig[] = [
  {
    id: "users_summary",
    label: "1. Общая таблица по пользователям",
    description:
      "Источник: canonical_fact_user_behavior_daily. Grain: UserID + Источник, только numeric UserID > 0.",
  },
  {
    id: "user_actions",
    label: "2. Действия пользователя на сайте ABBOTT",
    description: "Grain: UserID + Источник + Start URL + End URL. Это aggregated proxy, не session-level.",
  },
  {
    id: "page_stats",
    label: "3. Статистика страниц на сайте ABBOTT",
    description: "Источник: yandex_metrika_internal + Abbott names workbook enrichment.",
  },
  {
    id: "bitrix_pages",
    label: "3.1 Bitrix: страницы и сессии",
    description: "Источник: b_stat_hit + b_stat_session из Bitrix dump. Grain: normalized URL, очищено от ботов и технических URL.",
  },
  {
    id: "external_events",
    label: "4. Внешние переходы",
    description: "Источник: нормализованный yandex_metrika_external. events используются только как optional exact-match enrichment.",
  },
  {
    id: "returning",
    label: "5. Вернувшиеся",
    description: "Источник: yandex_metrika_returned + ym_url_return + url_return.",
  },
  {
    id: "general_materials",
    label: "6. Общие материалы",
    description: "Источник: general_materials + yandex_metrika_internal.",
  },
  {
    id: "time_buckets",
    label: "7. Время на сайте",
    description:
      "Источник: canonical_fact_user_behavior_daily. Бакеты по weighted avg duration на UserID, отдельно overall и по material URLs.",
  },
];

const PAGE_SIZE = 100;

const USER_ID_TRAFFIC_OPTIONS: SelectOption[] = [
  { value: "with_user_id", label: "Трафик с User ID" },
  { value: "without_user_id", label: "Трафик без User ID" },
];

const TAB_THEMES: Record<TabId, ThemeConfig> = {
  users_summary: {
    accent: "#dd6b78",
    accentSoft: "#fff1f2",
    borderClass: "border-rose-200",
    textClass: "text-rose-700",
    pillClass: "bg-rose-50 text-rose-700 border-rose-200",
    headerClass: "bg-rose-400 text-white",
    barColor: "#dd6b78",
    pieColors: ["#f43f5e", "#fb7185", "#fda4af", "#fecdd3", "#ffe4e6"],
  },
  user_actions: {
    accent: "#5fa0e0",
    accentSoft: "#eff6ff",
    borderClass: "border-sky-200",
    textClass: "text-sky-700",
    pillClass: "bg-sky-50 text-sky-700 border-sky-200",
    headerClass: "bg-sky-500 text-white",
    barColor: "#5fa0e0",
    pieColors: ["#0ea5e9", "#38bdf8", "#7dd3fc", "#bae6fd", "#e0f2fe"],
  },
  page_stats: {
    accent: "#88c55a",
    accentSoft: "#f2faea",
    borderClass: "border-lime-200",
    textClass: "text-lime-700",
    pillClass: "bg-lime-50 text-lime-700 border-lime-200",
    headerClass: "bg-lime-500 text-white",
    barColor: "#88c55a",
    pieColors: ["#84cc16", "#a3e635", "#bef264", "#d9f99d", "#ecfccb"],
  },
  bitrix_pages: {
    accent: "#0f766e",
    accentSoft: "#f0fdfa",
    borderClass: "border-teal-200",
    textClass: "text-teal-700",
    pillClass: "bg-teal-50 text-teal-700 border-teal-200",
    headerClass: "bg-teal-600 text-white",
    barColor: "#0f766e",
    pieColors: ["#0f766e", "#14b8a6", "#2dd4bf", "#5eead4", "#99f6e4"],
  },
  external_events: {
    accent: "#7c6ad4",
    accentSoft: "#f5f3ff",
    borderClass: "border-violet-200",
    textClass: "text-violet-700",
    pillClass: "bg-violet-50 text-violet-700 border-violet-200",
    headerClass: "bg-violet-500 text-white",
    barColor: "#7c6ad4",
    pieColors: ["#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"],
  },
  time_buckets: {
    accent: "#14b8a6",
    accentSoft: "#f0fdfa",
    borderClass: "border-teal-200",
    textClass: "text-teal-700",
    pillClass: "bg-teal-50 text-teal-700 border-teal-200",
    headerClass: "bg-teal-500 text-white",
    barColor: "#14b8a6",
    pieColors: ["#14b8a6", "#2dd4bf", "#5eead4", "#99f6e4", "#ccfbf1"],
  },
  returning: {
    accent: "#8367d4",
    accentSoft: "#f5f3ff",
    borderClass: "border-violet-200",
    textClass: "text-violet-700",
    pillClass: "bg-violet-50 text-violet-700 border-violet-200",
    headerClass: "bg-violet-500 text-white",
    barColor: "#8367d4",
    pieColors: ["#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe"],
  },
  general_materials: {
    accent: "#3fa39b",
    accentSoft: "#f0fdfa",
    borderClass: "border-emerald-200",
    textClass: "text-emerald-700",
    pillClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    headerClass: "bg-emerald-500 text-white",
    barColor: "#3fa39b",
    pieColors: ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0", "#d1fae5"],
  },
};

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value));
}

function formatDecimal(value: number, locale: string) {
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number, locale: string) {
  return `${formatDecimal(value, locale)}%`;
}

function formatDurationMinutes(seconds: number, locale: string) {
  return formatDecimal(seconds / 60, locale);
}

function formatDateTimeRange(from: string | null | undefined, to: string | null | undefined, locale: string) {
  const formatValue = (value: string | null | undefined) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return "—";
    const parsed = new Date(normalized.replace(" ", "T") + (normalized.includes("Z") ? "" : "Z"));
    if (Number.isNaN(parsed.getTime())) return normalized;
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    }).format(parsed);
  };
  return `${formatValue(from)} — ${formatValue(to)}`;
}

function matchesQuery(values: Array<string | number | null | undefined>, query: string) {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalized));
}

function sliceRows<T>(rows: T[], page: number) {
  const safePage = Math.max(1, page);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(safePage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  return {
    totalPages,
    currentPage,
    pageRows: rows.slice(start, start + PAGE_SIZE),
  };
}

function uniqOptions(values: Array<string | null | undefined>, limit = 500): SelectOption[] {
  const unique = [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
  return unique.slice(0, limit).map((value) => ({ value, label: value }));
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface overflow-hidden p-5">
      <h3 className="mb-4 text-lg font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  theme,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  theme: ThemeConfig;
}) {
  return (
    <label className={`card-surface block p-4 ${theme.borderClass}`}>
      <span className={`mb-2 block text-sm font-semibold ${theme.textClass}`}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchPickField({
  label,
  searchValue,
  selectedValue,
  selectedLabel,
  options,
  onSearchChange,
  onSelect,
  onClear,
  theme,
}: {
  label: string;
  searchValue: string;
  selectedValue: string;
  selectedLabel?: string | null;
  options: SearchOption[];
  onSearchChange: (value: string) => void;
  onSelect: (option: SearchOption) => void;
  onClear: () => void;
  theme: ThemeConfig;
}) {
  const normalized = searchValue.trim().toLowerCase();
  const filtered = (normalized
    ? options.filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(normalized))
    : options
  ).slice(0, 12);

  return (
    <label className={`card-surface block p-4 ${theme.borderClass}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={`block text-sm font-semibold ${theme.textClass}`}>{label}</span>
        {selectedValue ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-slate-500 transition hover:text-slate-700"
          >
            Очистить
          </button>
        ) : null}
      </div>
      <input
        type="search"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Начните вводить название страницы"
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
      />
      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
            Ничего не найдено
          </div>
        ) : (
          filtered.map((option) => {
            const isSelected = option.value === selectedValue;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option)}
                className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                  isSelected ? `${theme.pillClass}` : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-sm font-medium text-slate-800">{option.label}</div>
                {option.description ? <div className="mt-1 break-all text-xs text-slate-500">{option.description}</div> : null}
              </button>
            );
          })
        )}
      </div>
      {selectedLabel ? <div className="mt-3 text-xs text-slate-500">Выбрано: {selectedLabel}</div> : null}
    </label>
  );
}

function CompactPagePicker({
  label,
  searchValue,
  selectedValue,
  selectedLabel,
  options,
  onSearchChange,
  onSelect,
  onClear,
  theme,
}: {
  label: string;
  searchValue: string;
  selectedValue: string;
  selectedLabel?: string | null;
  options: SearchOption[];
  onSearchChange: (value: string) => void;
  onSelect: (option: SearchOption) => void;
  onClear: () => void;
  theme: ThemeConfig;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!rootRef.current) return;
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const normalized = searchValue.trim().toLowerCase();
  const filtered = (normalized
    ? options.filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(normalized))
    : options
  ).slice(0, 20);

  return (
    <div ref={rootRef} className="relative z-[120] block md:w-[420px]">
      <label className="block">
        <span className={`mb-2 block text-xs font-semibold uppercase tracking-[0.12em] ${theme.textClass}`}>{label}</span>
        <div className={`rounded-2xl border bg-white p-3 shadow-sm ${theme.borderClass}`}>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={searchValue}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                onSearchChange(event.target.value);
                setOpen(true);
              }}
              placeholder={selectedLabel || "Начните вводить название страницы"}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            />
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
            >
              ▾
            </button>
          </div>
        </div>
      </label>

      {open ? (
        <div className="absolute z-[140] mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          {selectedValue ? (
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="mb-2 w-full rounded-xl border border-dashed border-slate-200 px-3 py-2 text-left text-sm text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
            >
              Очистить выбор
            </button>
          ) : null}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
              Ничего не найдено
            </div>
          ) : (
            filtered.map((option) => {
              const isSelected = option.value === selectedValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onSelect(option);
                    setOpen(false);
                  }}
                  className={`mb-2 w-full rounded-xl border px-3 py-2 text-left transition last:mb-0 ${
                    isSelected ? `${theme.pillClass}` : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="text-sm font-medium text-slate-800">{option.label}</div>
                  {option.description ? <div className="mt-1 break-all text-xs text-slate-500">{option.description}</div> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatsPill({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: ThemeConfig;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${theme.pillClass}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.12em] opacity-80">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function DataTable({
  columns,
  rows,
  emptyText,
  headerClass,
}: {
  columns: TableColumn[];
  rows: Array<Record<string, string>>;
  emptyText: string;
  headerClass: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className={headerClass}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 text-left text-sm font-semibold ${column.className ?? ""}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={`${index}-${row[columns[0]?.key] ?? "row"}`} className="align-top odd:bg-slate-50/60">
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-3 text-slate-700 ${column.className ?? ""}`}>
                      {row[column.key] || "—"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pagination({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
      <button
        type="button"
        onClick={() => onChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Назад
      </button>
      <span>
        Страница {currentPage} из {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Вперёд
      </button>
    </div>
  );
}

function SimpleTooltip({
  active,
  payload,
  label,
  locale,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
  label?: string;
  locale: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg">
      {label ? <div className="mb-1 font-medium text-slate-900">{label}</div> : null}
      {payload.map((item, index) => (
        <div key={`${item.name ?? "metric"}-${index}`} className="text-slate-600">
          {item.name}: {formatter ? formatter(Number(item.value ?? 0)) : formatNumber(Number(item.value ?? 0), locale)}
        </div>
      ))}
    </div>
  );
}

function AbbottBarChart({
  data,
  dataKey,
  color,
  locale,
  layout = "vertical",
  valueFormatter,
}: {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  color: string;
  locale: string;
  layout?: "horizontal" | "vertical";
  valueFormatter?: (value: number) => string;
}) {
  const isHorizontalBars = layout === "horizontal";
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={isHorizontalBars ? "vertical" : "horizontal"}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          {isHorizontalBars ? (
            <>
              <XAxis type="number" tick={{ fill: "#64748b", fontSize: 12 }} />
              <YAxis dataKey="label" type="category" width={140} tick={{ fill: "#64748b", fontSize: 12 }} />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                tick={{ fill: "#64748b", fontSize: 12 }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={60}
              />
              <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
            </>
          )}
          <Tooltip content={<SimpleTooltip locale={locale} formatter={valueFormatter} />} />
          <Bar dataKey={dataKey} fill={color} radius={[10, 10, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AbbottPieChart({
  data,
  colors,
  locale,
}: {
  data: Array<{ label: string; value: number }>;
  colors: string[];
  locale: string;
}) {
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius={55} outerRadius={92} paddingAngle={2}>
            {data.map((entry, index) => (
              <Cell key={`${entry.label}-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<SimpleTooltip locale={locale} />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function groupNumberRows<T>(
  rows: T[],
  keySelector: (row: T) => string | null | undefined,
  valueSelector: (row: T) => number,
): Array<{ label: string; value: number }> {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const key = String(keySelector(row) ?? "").trim() || "Без значения";
    totals.set(key, (totals.get(key) ?? 0) + valueSelector(row));
  });
  return Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function excludeUnnamedChartGroups(rows: Array<{ label: string; value: number }>) {
  const hiddenLabels = new Set(["", "—", "Без значения", "Без названия", "Без направления", "Без типа", "Без доступа"]);
  return rows.filter((row) => !hiddenLabels.has(row.label.trim()));
}

function userIdLabel(userId: string, hasUserId: boolean) {
  return hasUserId ? userId : "Без User ID";
}

export default function AbbottBiDashboard({ data, locale = "ru-RU" }: AbbottBiDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>("users_summary");
  const [queryByTab, setQueryByTab] = useState<Record<TabId, string>>({
    users_summary: "",
    user_actions: "",
    page_stats: "",
    bitrix_pages: "",
    external_events: "",
    time_buckets: "",
    returning: "",
    general_materials: "",
  });
  const [pageByTab, setPageByTab] = useState<Record<TabId, number>>({
    users_summary: 1,
    user_actions: 1,
    page_stats: 1,
    bitrix_pages: 1,
    external_events: 1,
    time_buckets: 1,
    returning: 1,
    general_materials: 1,
  });
  const [filtersByTab, setFiltersByTab] = useState<Record<TabId, Record<string, string>>>({
    users_summary: { user_id: "", user_id_traffic: "", traffic_source: "", direction: "" },
    user_actions: { user_id: "", user_id_traffic: "", traffic_source: "", direction: "" },
    page_stats: { page_title: "", direction: "", material_type: "", access: "" },
    bitrix_pages: { direction: "", material_type: "", access: "" },
    external_events: { direction: "" },
    time_buckets: { page_url: "" },
    returning: { url: "", direction: "" },
    general_materials: { material_name: "" },
  });
  const [timeBucketPageSearch, setTimeBucketPageSearch] = useState("");

  const theme = TAB_THEMES[activeTab];

  const setSelectFilter = (tab: TabId, key: string, value: string) => {
    setFiltersByTab((prev) => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        [key]: value,
      },
    }));
    setPageByTab((prev) => ({ ...prev, [tab]: 1 }));
  };

  const onQueryChange = (value: string) => {
    setQueryByTab((prev) => ({ ...prev, [activeTab]: value }));
    setPageByTab((prev) => ({ ...prev, [activeTab]: 1 }));
  };

  const usersSummaryOptions = useMemo(
    () => ({
      user_id: uniqOptions(data.users_summary.map((row) => row.user_id)),
      traffic_source: uniqOptions(data.users_summary.map((row) => row.traffic_source)),
      direction: uniqOptions(data.users_summary.map((row) => row.direction)),
    }),
    [data.users_summary],
  );

  const userActionsOptions = useMemo(
    () => ({
      user_id: uniqOptions(data.user_actions.filter((row) => row.has_user_id).map((row) => row.user_id)),
      traffic_source: uniqOptions(data.user_actions.map((row) => row.traffic_source)),
      direction: uniqOptions(data.user_actions.map((row) => row.direction)),
    }),
    [data.user_actions],
  );

  const pageStatsOptions = useMemo(
    () => ({
      page_title: uniqOptions(data.page_stats.map((row) => row.page_title)),
      direction: uniqOptions(data.page_stats.map((row) => row.direction)),
      material_type: uniqOptions(data.page_stats.map((row) => row.material_type)),
      access: uniqOptions(data.page_stats.map((row) => row.access)),
    }),
    [data.page_stats],
  );

  const bitrixPageOptions = useMemo(
    () => ({
      direction: uniqOptions(data.bitrix_pages.map((row) => row.direction)),
      material_type: uniqOptions(data.bitrix_pages.map((row) => row.material_type)),
      access: uniqOptions(data.bitrix_pages.map((row) => row.access)),
    }),
    [data.bitrix_pages],
  );

  const returningOptions = useMemo(
    () => ({
      url: uniqOptions(data.returning.map((row) => row.url), 200),
      direction: uniqOptions(data.returning.map((row) => row.direction)),
    }),
    [data.returning],
  );

  const generalMaterialsOptions = useMemo(
    () => ({
      material_name: uniqOptions(data.general_materials.map((row) => row.material_name)),
    }),
    [data.general_materials],
  );

  const timeBucketPageOptions = useMemo(() => {
    const uniqueByUrl = new Map<string, SearchOption>();
    data.page_stats.forEach((row) => {
      const url = row.url?.trim();
      if (!url || uniqueByUrl.has(url)) return;
      uniqueByUrl.set(url, {
        value: url,
        label: row.page_title?.trim() || url,
        description: url,
      });
    });
    return Array.from(uniqueByUrl.values()).sort((a, b) =>
      `${a.label} ${a.description ?? ""}`.localeCompare(`${b.label} ${b.description ?? ""}`, "ru"),
    );
  }, [data.page_stats]);

  const usersSummaryRows = useMemo(() => {
    const query = queryByTab.users_summary;
    const filters = filtersByTab.users_summary;
    return data.users_summary.filter((row) => {
      if (!matchesQuery([userIdLabel(row.user_id, row.has_user_id), row.traffic_source, row.direction, row.visits, row.bounce_rate], query)) return false;
      if (filters.user_id && row.user_id !== filters.user_id) return false;
      if (filters.user_id_traffic === "with_user_id" && !row.has_user_id) return false;
      if (filters.user_id_traffic === "without_user_id" && row.has_user_id) return false;
      if (filters.traffic_source && row.traffic_source !== filters.traffic_source) return false;
      if (filters.direction && (row.direction ?? "") !== filters.direction) return false;
      return true;
    });
  }, [data.users_summary, filtersByTab.users_summary, queryByTab.users_summary]);

  const userActionRows = useMemo(() => {
    const query = queryByTab.user_actions;
    const filters = filtersByTab.user_actions;
    return data.user_actions.filter((row) => {
      if (!matchesQuery([userIdLabel(row.user_id, row.has_user_id), row.traffic_source, row.direction, row.start_url, row.end_url, row.visits], query)) return false;
      if (filters.user_id && row.user_id !== filters.user_id) return false;
      if (filters.user_id_traffic === "with_user_id" && !row.has_user_id) return false;
      if (filters.user_id_traffic === "without_user_id" && row.has_user_id) return false;
      if (filters.traffic_source && row.traffic_source !== filters.traffic_source) return false;
      if (filters.direction && (row.direction ?? "") !== filters.direction) return false;
      return true;
    });
  }, [data.user_actions, filtersByTab.user_actions, queryByTab.user_actions]);

  const pageStatRows = useMemo(() => {
    const query = queryByTab.page_stats;
    const filters = filtersByTab.page_stats;
    return data.page_stats.filter((row) => {
      if (
        !matchesQuery(
          [
            row.page_title,
            row.url,
            row.direction,
            row.material_type,
            row.access,
            row.pageviews,
            row.users,
            row.bitrix_pageviews,
            row.bitrix_sessions,
            row.bitrix_users,
          ],
          query,
        )
      )
        return false;
      if (filters.page_title && row.page_title !== filters.page_title) return false;
      if (filters.direction && (row.direction ?? "") !== filters.direction) return false;
      if (filters.material_type && (row.material_type ?? "") !== filters.material_type) return false;
      if (filters.access && (row.access ?? "") !== filters.access) return false;
      return true;
    });
  }, [data.page_stats, filtersByTab.page_stats, queryByTab.page_stats]);

  const bitrixPageRows = useMemo(() => {
    const query = queryByTab.bitrix_pages;
    const filters = filtersByTab.bitrix_pages;
    return data.bitrix_pages.filter((row) => {
      if (
        !matchesQuery(
          [
            row.url,
            row.path,
            row.direction,
            row.material_type,
            row.access,
            row.pageviews,
            row.sessions,
            row.users,
            row.top_utm_source,
            row.top_utm_medium,
            row.top_utm_campaign,
          ],
          query,
        )
      )
        return false;
      if (filters.direction && (row.direction ?? "") !== filters.direction) return false;
      if (filters.material_type && (row.material_type ?? "") !== filters.material_type) return false;
      if (filters.access && (row.access ?? "") !== filters.access) return false;
      return true;
    });
  }, [data.bitrix_pages, filtersByTab.bitrix_pages, queryByTab.bitrix_pages]);

  const externalEventRows = useMemo(() => {
    const query = queryByTab.external_events;
    const filters = filtersByTab.external_events;
    return data.external_clicks.filter((row) => {
      if (!matchesQuery([row.title, row.direction, row.external_url, row.outbound_clicks], query)) return false;
      if (filters.direction && (row.direction ?? "") !== filters.direction) return false;
      return true;
    });
  }, [data.external_clicks, filtersByTab.external_events, queryByTab.external_events]);

  const returningRows = useMemo(() => {
    const query = queryByTab.returning;
    const filters = filtersByTab.returning;
    return data.returning.filter((row) => {
      if (!matchesQuery([row.url, row.direction, row.visits, row.returning_1_day, row.returning_2_7_days, row.returning_8_31_days], query)) return false;
      if (filters.url && row.url !== filters.url) return false;
      if (filters.direction && (row.direction ?? "") !== filters.direction) return false;
      return true;
    });
  }, [data.returning, filtersByTab.returning, queryByTab.returning]);

  const generalMaterialRows = useMemo(() => {
    const query = queryByTab.general_materials;
    const filters = filtersByTab.general_materials;
    return data.general_materials.filter((row) => {
      if (!matchesQuery([row.material_name, row.url, row.pageviews, row.users], query)) return false;
      if (filters.material_name && row.material_name !== filters.material_name) return false;
      return true;
    });
  }, [data.general_materials, filtersByTab.general_materials, queryByTab.general_materials]);

  const timeBucketSections = useMemo(() => {
    const query = queryByTab.time_buckets.trim().toLowerCase();
    const filterRows = (rows: typeof data.time_buckets.overall) =>
      rows.filter((row) => !query || matchesQuery([row.label, row.users], query));
    return {
      overall: filterRows(data.time_buckets.overall),
      materials: filterRows(data.time_buckets.materials),
    };
  }, [data.time_buckets.materials, data.time_buckets.overall, queryByTab.time_buckets]);

  const selectedTimeBucketPage = useMemo(() => {
    const pageUrl = filtersByTab.time_buckets.page_url;
    if (!pageUrl) return null;
    const pageMeta = timeBucketPageOptions.find((option) => option.value === pageUrl) ?? null;
    const bucketRow = data.time_buckets.by_page.find((row) => row.url === pageUrl) ?? null;
    return {
      url: pageUrl,
      label: pageMeta?.label ?? pageUrl,
      buckets: bucketRow?.buckets ?? [],
    };
  }, [data.time_buckets.by_page, filtersByTab.time_buckets.page_url, timeBucketPageOptions]);

  const tabRows = {
    users_summary: usersSummaryRows,
    user_actions: userActionRows,
    page_stats: pageStatRows,
    bitrix_pages: bitrixPageRows,
    external_events: externalEventRows,
    time_buckets: timeBucketSections.overall,
    returning: returningRows,
    general_materials: generalMaterialRows,
  } as const;

  const currentTab = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  const usersDurationBySource = useMemo(() => {
    const totals = new Map<string, { durationWeighted: number; visits: number }>();
    usersSummaryRows.forEach((row) => {
      const current = totals.get(row.traffic_source) ?? { durationWeighted: 0, visits: 0 };
      current.durationWeighted += row.avg_duration * row.visits;
      current.visits += row.visits;
      totals.set(row.traffic_source, current);
    });
    return Array.from(totals.entries())
      .map(([label, value]) => ({
        label,
        duration_minutes: value.visits > 0 ? Number((value.durationWeighted / value.visits / 60).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.duration_minutes - a.duration_minutes);
  }, [usersSummaryRows]);

  const userActionTopDuration = useMemo(
    () =>
      userActionRows
        .map((row) => ({
          label: row.user_id,
          duration_minutes: Number((row.avg_duration / 60).toFixed(2)),
        }))
        .sort((a, b) => b.duration_minutes - a.duration_minutes)
        .slice(0, 12),
    [userActionRows],
  );

  const pageDirectionData = useMemo(
    () => excludeUnnamedChartGroups(groupNumberRows(pageStatRows, (row) => row.direction, (row) => row.users)).slice(0, 8),
    [pageStatRows],
  );
  const pageMaterialData = useMemo(
    () => excludeUnnamedChartGroups(groupNumberRows(pageStatRows, (row) => row.material_type, (row) => row.users)).slice(0, 8),
    [pageStatRows],
  );
  const pageAccessData = useMemo(
    () => excludeUnnamedChartGroups(groupNumberRows(pageStatRows, (row) => row.access, (row) => row.users)),
    [pageStatRows],
  );
  const bitrixDirectionData = useMemo(
    () => excludeUnnamedChartGroups(groupNumberRows(bitrixPageRows, (row) => row.direction, (row) => row.sessions)).slice(0, 8),
    [bitrixPageRows],
  );
  const bitrixMaterialData = useMemo(
    () => excludeUnnamedChartGroups(groupNumberRows(bitrixPageRows, (row) => row.material_type, (row) => row.pageviews)).slice(0, 8),
    [bitrixPageRows],
  );
  const bitrixTopPages = useMemo(
    () => bitrixPageRows.map((row) => ({ label: row.path || row.url, pageviews: row.pageviews })).slice(0, 12),
    [bitrixPageRows],
  );
  const externalTopRows = useMemo(
    () => externalEventRows.map((row) => ({ label: row.title ?? row.external_url, clicks: row.outbound_clicks })).slice(0, 10),
    [externalEventRows],
  );

  const returningDirectionData = useMemo(() => {
    const totals = new Map<string, { visits: number; r1: number; r27: number; r831: number }>();
    returningRows.forEach((row) => {
      const label = row.direction ?? "Без направления";
      const current = totals.get(label) ?? { visits: 0, r1: 0, r27: 0, r831: 0 };
      current.visits += row.visits;
      current.r1 += row.returning_1_day;
      current.r27 += row.returning_2_7_days;
      current.r831 += row.returning_8_31_days;
      totals.set(label, current);
    });
    return Array.from(totals.entries())
      .map(([label, value]) => ({
        label,
        returning_1_day_pct: value.visits > 0 ? Number(((value.r1 / value.visits) * 100).toFixed(2)) : 0,
        returning_2_7_days_pct: value.visits > 0 ? Number(((value.r27 / value.visits) * 100).toFixed(2)) : 0,
        returning_8_31_days_pct: value.visits > 0 ? Number(((value.r831 / value.visits) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.returning_1_day_pct - a.returning_1_day_pct);
  }, [returningRows]);

  const generalMaterialsTop = useMemo(
    () =>
      generalMaterialRows
        .map((row) => ({ label: row.material_name, users: row.users }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 10),
    [generalMaterialRows],
  );

  const timeBucketCompare = useMemo(
    () =>
      data.time_buckets.overall.map((bucket) => ({
        label: bucket.label,
        overall: bucket.users,
        materials: data.time_buckets.materials.find((item) => item.bucket_id === bucket.bucket_id)?.users ?? 0,
      })),
    [data.time_buckets.materials, data.time_buckets.overall],
  );

  const themeLabel = currentTab.label.split(". ").slice(1).join(". ") || currentTab.label;

  const usersSummaryPage = sliceRows(usersSummaryRows, pageByTab.users_summary);
  const userActionsPage = sliceRows(userActionRows, pageByTab.user_actions);
  const pageStatsPage = sliceRows(pageStatRows, pageByTab.page_stats);
  const bitrixPagesPage = sliceRows(bitrixPageRows, pageByTab.bitrix_pages);
  const externalEventsPage = sliceRows(externalEventRows, pageByTab.external_events);
  const returningPage = sliceRows(returningRows, pageByTab.returning);
  const generalMaterialsPage = sliceRows(generalMaterialRows, pageByTab.general_materials);
  const bitrixMatchedPageStats = data.page_stats.filter((row) => row.bitrix_sessions > 0).length;
  const bitrixMatchCoveragePct =
    data.page_stats.length > 0 ? (bitrixMatchedPageStats / data.page_stats.length) * 100 : 0;

  let tableColumns: TableColumn[] = [];
  let tableRows: Array<Record<string, string>> = [];
  let currentPage = 1;
  let totalPages = 1;
  let emptyText = "Нет данных за выбранный период.";

  if (activeTab === "users_summary") {
    currentPage = usersSummaryPage.currentPage;
    totalPages = usersSummaryPage.totalPages;
    tableColumns = [
      { key: "user_id", label: "User ID" },
      { key: "direction", label: "Направление" },
      { key: "traffic_source", label: "Источник" },
      { key: "visits", label: "Сессии", className: "text-right" },
      { key: "bounce_rate", label: "Процент отказов", className: "text-right" },
      { key: "avg_duration", label: "Продолжительность визита, мин", className: "text-right" },
      { key: "page_depth", label: "Глубина просмотра", className: "text-right" },
    ];
    tableRows = usersSummaryPage.pageRows.map((row) => ({
      user_id: userIdLabel(row.user_id, row.has_user_id),
      direction: row.direction ?? "—",
      traffic_source: row.traffic_source,
      visits: formatNumber(row.visits, locale),
      bounce_rate: formatPercent(row.bounce_rate, locale),
      avg_duration: formatDurationMinutes(row.avg_duration, locale),
      page_depth: formatDecimal(row.page_depth, locale),
    }));
  } else if (activeTab === "user_actions") {
    currentPage = userActionsPage.currentPage;
    totalPages = userActionsPage.totalPages;
    tableColumns = [
      { key: "user_id", label: "User ID" },
      { key: "traffic_source", label: "Источник" },
      { key: "direction", label: "Направление" },
      { key: "end_url", label: "Последняя страница", className: "min-w-[320px] break-all" },
      { key: "avg_duration", label: "Продолжительность визита, мин", className: "text-right" },
      { key: "page_depth", label: "Глубина просмотра", className: "text-right" },
    ];
    tableRows = userActionsPage.pageRows.map((row) => ({
      user_id: userIdLabel(row.user_id, row.has_user_id),
      traffic_source: row.traffic_source,
      direction: row.direction ?? "—",
      end_url: row.end_url || "—",
      avg_duration: formatDurationMinutes(row.avg_duration, locale),
      page_depth: formatDecimal(row.page_depth, locale),
    }));
  } else if (activeTab === "page_stats") {
    currentPage = pageStatsPage.currentPage;
    totalPages = pageStatsPage.totalPages;
    tableColumns = [
      { key: "page_title", label: "Заголовок страниц", className: "min-w-[220px]" },
      { key: "url", label: "URL", className: "min-w-[280px] break-all" },
      { key: "direction", label: "Направление" },
      { key: "material_type", label: "Тип материала" },
      { key: "access", label: "Доступ" },
      { key: "pageviews", label: "Просмотры", className: "text-right" },
      { key: "users", label: "Посетители", className: "text-right" },
      { key: "bitrix_pageviews", label: "Bitrix просмотры", className: "text-right" },
      { key: "bitrix_sessions", label: "Bitrix сессии", className: "text-right" },
      { key: "bitrix_users", label: "Bitrix User ID", className: "text-right" },
    ];
    tableRows = pageStatsPage.pageRows.map((row) => ({
      page_title: row.page_title || "—",
      url: row.url || "—",
      direction: row.direction ?? "—",
      material_type: row.material_type ?? "—",
      access: row.access ?? "—",
      pageviews: formatNumber(row.pageviews, locale),
      users: formatNumber(row.users, locale),
      bitrix_pageviews: formatNumber(row.bitrix_pageviews, locale),
      bitrix_sessions: formatNumber(row.bitrix_sessions, locale),
      bitrix_users: formatNumber(row.bitrix_users, locale),
    }));
  } else if (activeTab === "bitrix_pages") {
    currentPage = bitrixPagesPage.currentPage;
    totalPages = bitrixPagesPage.totalPages;
    tableColumns = [
      { key: "url", label: "URL", className: "min-w-[320px] break-all" },
      { key: "direction", label: "Направление" },
      { key: "material_type", label: "Тип материала" },
      { key: "access", label: "Доступ" },
      { key: "pageviews", label: "Просмотры", className: "text-right" },
      { key: "sessions", label: "Сессии", className: "text-right" },
      { key: "users", label: "User ID", className: "text-right" },
      { key: "logged_in_sessions", label: "Сессии с User ID", className: "text-right" },
      { key: "anonymous_sessions", label: "Сессии без User ID", className: "text-right" },
      { key: "avg_session_duration", label: "Средняя сессия, мин", className: "text-right" },
      { key: "top_utm_source", label: "UTM source" },
      { key: "top_utm_campaign", label: "UTM campaign" },
    ];
    tableRows = bitrixPagesPage.pageRows.map((row) => ({
      url: row.url,
      direction: row.direction ?? "—",
      material_type: row.material_type ?? "—",
      access: row.access ?? "—",
      pageviews: formatNumber(row.pageviews, locale),
      sessions: formatNumber(row.sessions, locale),
      users: formatNumber(row.users, locale),
      logged_in_sessions: formatNumber(row.logged_in_sessions, locale),
      anonymous_sessions: formatNumber(row.anonymous_sessions, locale),
      avg_session_duration: formatDurationMinutes(row.avg_session_duration, locale),
      top_utm_source: row.top_utm_source || "—",
      top_utm_campaign: row.top_utm_campaign || "—",
    }));
  } else if (activeTab === "external_events") {
    currentPage = externalEventsPage.currentPage;
    totalPages = externalEventsPage.totalPages;
    tableColumns = [
      { key: "title", label: "Event Title", className: "min-w-[240px]" },
      { key: "direction", label: "Direction" },
      { key: "external_url", label: "External URL", className: "min-w-[320px] break-all" },
      { key: "outbound_clicks", label: "Outbound Clicks", className: "text-right" },
    ];
    tableRows = externalEventsPage.pageRows.map((row) => ({
      title: row.title ?? "—",
      direction: row.direction ?? "—",
      external_url: row.external_url,
      outbound_clicks: formatNumber(row.outbound_clicks, locale),
    }));
    emptyText = "Нет внешних переходов за выбранный период.";
  } else if (activeTab === "returning") {
    currentPage = returningPage.currentPage;
    totalPages = returningPage.totalPages;
    tableColumns = [
      { key: "url", label: "URL", className: "min-w-[320px] break-all" },
      { key: "direction", label: "Направление" },
      { key: "returning_1_day", label: "Вернувшиеся в 1 день", className: "text-right" },
      { key: "returning_2_7_days", label: "Вернувшиеся в 2-7 дни", className: "text-right" },
      { key: "returning_8_31_days", label: "Вернувшиеся в 8-31 дни", className: "text-right" },
    ];
    tableRows = returningPage.pageRows.map((row) => ({
      url: row.url,
      direction: row.direction ?? "—",
      returning_1_day: formatPercent(row.visits > 0 ? (row.returning_1_day / row.visits) * 100 : 0, locale),
      returning_2_7_days: formatPercent(row.visits > 0 ? (row.returning_2_7_days / row.visits) * 100 : 0, locale),
      returning_8_31_days: formatPercent(row.visits > 0 ? (row.returning_8_31_days / row.visits) * 100 : 0, locale),
    }));
  } else if (activeTab === "general_materials") {
    currentPage = generalMaterialsPage.currentPage;
    totalPages = generalMaterialsPage.totalPages;
    tableColumns = [
      { key: "material_name", label: "Material Name", className: "min-w-[220px]" },
      { key: "url", label: "URL", className: "min-w-[320px] break-all" },
      { key: "pageviews", label: "Pageviews", className: "text-right" },
      { key: "users", label: "Users", className: "text-right" },
    ];
    tableRows = generalMaterialsPage.pageRows.map((row) => ({
      material_name: row.material_name,
      url: row.url,
      pageviews: formatNumber(row.pageviews, locale),
      users: formatNumber(row.users, locale),
    }));
  }

  const tabFilterContent: Record<TabId, React.ReactNode> = {
    users_summary: (
      <>
        <SelectField
          label="Трафик"
          value={filtersByTab.users_summary.user_id_traffic}
          options={USER_ID_TRAFFIC_OPTIONS}
          onChange={(value) => setSelectFilter("users_summary", "user_id_traffic", value)}
          theme={theme}
        />
        <SelectField
          label="User ID"
          value={filtersByTab.users_summary.user_id}
          options={usersSummaryOptions.user_id}
          onChange={(value) => setSelectFilter("users_summary", "user_id", value)}
          theme={theme}
        />
        <SelectField
          label="Источник"
          value={filtersByTab.users_summary.traffic_source}
          options={usersSummaryOptions.traffic_source}
          onChange={(value) => setSelectFilter("users_summary", "traffic_source", value)}
          theme={theme}
        />
        <SelectField
          label="Направление"
          value={filtersByTab.users_summary.direction}
          options={usersSummaryOptions.direction}
          onChange={(value) => setSelectFilter("users_summary", "direction", value)}
          theme={theme}
        />
      </>
    ),
    user_actions: (
      <>
        <SelectField
          label="UserID"
          value={filtersByTab.user_actions.user_id}
          options={userActionsOptions.user_id}
          onChange={(value) => setSelectFilter("user_actions", "user_id", value)}
          theme={theme}
        />
        <SelectField
          label="Трафик"
          value={filtersByTab.user_actions.user_id_traffic}
          options={USER_ID_TRAFFIC_OPTIONS}
          onChange={(value) => setSelectFilter("user_actions", "user_id_traffic", value)}
          theme={theme}
        />
        <SelectField
          label="Источник"
          value={filtersByTab.user_actions.traffic_source}
          options={userActionsOptions.traffic_source}
          onChange={(value) => setSelectFilter("user_actions", "traffic_source", value)}
          theme={theme}
        />
        <SelectField
          label="Направление"
          value={filtersByTab.user_actions.direction}
          options={userActionsOptions.direction}
          onChange={(value) => setSelectFilter("user_actions", "direction", value)}
          theme={theme}
        />
      </>
    ),
    page_stats: (
      <>
        <SelectField
          label="Тип материала"
          value={filtersByTab.page_stats.material_type}
          options={pageStatsOptions.material_type}
          onChange={(value) => setSelectFilter("page_stats", "material_type", value)}
          theme={theme}
        />
        <SelectField
          label="Заголовок страниц"
          value={filtersByTab.page_stats.page_title}
          options={pageStatsOptions.page_title}
          onChange={(value) => setSelectFilter("page_stats", "page_title", value)}
          theme={theme}
        />
        <SelectField
          label="Направление"
          value={filtersByTab.page_stats.direction}
          options={pageStatsOptions.direction}
          onChange={(value) => setSelectFilter("page_stats", "direction", value)}
          theme={theme}
        />
        <SelectField
          label="Доступ"
          value={filtersByTab.page_stats.access}
          options={pageStatsOptions.access}
          onChange={(value) => setSelectFilter("page_stats", "access", value)}
          theme={theme}
        />
      </>
    ),
    bitrix_pages: (
      <>
        <SelectField
          label="Направление"
          value={filtersByTab.bitrix_pages.direction}
          options={bitrixPageOptions.direction}
          onChange={(value) => setSelectFilter("bitrix_pages", "direction", value)}
          theme={theme}
        />
        <SelectField
          label="Тип материала"
          value={filtersByTab.bitrix_pages.material_type}
          options={bitrixPageOptions.material_type}
          onChange={(value) => setSelectFilter("bitrix_pages", "material_type", value)}
          theme={theme}
        />
        <SelectField
          label="Доступ"
          value={filtersByTab.bitrix_pages.access}
          options={bitrixPageOptions.access}
          onChange={(value) => setSelectFilter("bitrix_pages", "access", value)}
          theme={theme}
        />
      </>
    ),
    external_events: (
      <SelectField
        label="Направление"
        value={filtersByTab.external_events.direction}
        options={uniqOptions(data.external_clicks.map((row) => row.direction))}
        onChange={(value) => setSelectFilter("external_events", "direction", value)}
        theme={theme}
      />
    ),
    returning: (
      <>
        <SelectField
          label="URL"
          value={filtersByTab.returning.url}
          options={returningOptions.url}
          onChange={(value) => setSelectFilter("returning", "url", value)}
          theme={theme}
        />
        <SelectField
          label="Направление"
          value={filtersByTab.returning.direction}
          options={returningOptions.direction}
          onChange={(value) => setSelectFilter("returning", "direction", value)}
          theme={theme}
        />
      </>
    ),
    general_materials: (
      <SelectField
        label="Материал"
        value={filtersByTab.general_materials.material_name}
        options={generalMaterialsOptions.material_name}
        onChange={(value) => setSelectFilter("general_materials", "material_name", value)}
        theme={theme}
      />
    ),
    time_buckets: null,
  };

  let chartContent: React.ReactNode = null;

  if (activeTab === "users_summary") {
    chartContent = (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <ChartCard title="Средняя продолжительность визита по источникам, мин">
          <AbbottBarChart
            data={usersDurationBySource}
            dataKey="duration_minutes"
            color={theme.barColor}
            locale={locale}
            layout="horizontal"
            valueFormatter={(value) => `${formatDecimal(value, locale)} мин`}
          />
        </ChartCard>
        <ChartCard title="Сводка">
          <div className="grid gap-3">
            <StatsPill
              label="Сессии"
              value={formatNumber(usersSummaryRows.reduce((sum, row) => sum + row.visits, 0), locale)}
              theme={theme}
            />
            <StatsPill
              label="% отказа"
              value={formatPercent(
                usersSummaryRows.reduce((sum, row) => sum + row.bounce_rate * row.visits, 0) /
                  Math.max(1, usersSummaryRows.reduce((sum, row) => sum + row.visits, 0)),
                locale,
              )}
              theme={theme}
            />
            <StatsPill
              label="Avg duration"
              value={`${formatDecimal(
                usersSummaryRows.reduce((sum, row) => sum + row.avg_duration * row.visits, 0) /
                  Math.max(1, usersSummaryRows.reduce((sum, row) => sum + row.visits, 0)) /
                  60,
                locale,
              )} мин`}
              theme={theme}
            />
            <StatsPill
              label="Avg depth"
              value={formatDecimal(
                usersSummaryRows.reduce((sum, row) => sum + row.page_depth * row.visits, 0) /
                  Math.max(1, usersSummaryRows.reduce((sum, row) => sum + row.visits, 0)),
                locale,
              )}
              theme={theme}
            />
          </div>
        </ChartCard>
      </div>
    );
  } else if (activeTab === "user_actions") {
    chartContent = (
      <ChartCard title="Топ User ID по продолжительности визита, мин">
        <AbbottBarChart
          data={userActionTopDuration}
          dataKey="duration_minutes"
          color={theme.barColor}
          locale={locale}
          layout="horizontal"
          valueFormatter={(value) => `${formatDecimal(value, locale)} мин`}
        />
      </ChartCard>
    );
  } else if (activeTab === "page_stats") {
    chartContent = (
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Посетители по направлению">
          <AbbottPieChart data={pageDirectionData} colors={theme.pieColors} locale={locale} />
        </ChartCard>
        <ChartCard title="Посетители по доступу">
          <AbbottBarChart data={pageAccessData} dataKey="value" color={theme.barColor} locale={locale} valueFormatter={(value) => formatNumber(value, locale)} />
        </ChartCard>
        <ChartCard title="Посетители по типу материала">
          <AbbottPieChart data={pageMaterialData} colors={[...theme.pieColors].reverse()} locale={locale} />
        </ChartCard>
      </div>
    );
  } else if (activeTab === "bitrix_pages") {
    const excludedTotal = data.bitrix_summary
      ? Object.values(data.bitrix_summary.excluded).reduce((sum, value) => sum + value, 0)
      : 0;
    const totalBitrixSessions = bitrixPageRows.reduce((sum, row) => sum + row.sessions, 0);
    const loggedInBitrixSessions = bitrixPageRows.reduce((sum, row) => sum + row.logged_in_sessions, 0);
    const anonymousBitrixSessions = bitrixPageRows.reduce((sum, row) => sum + row.anonymous_sessions, 0);
    const exclusionRows = Object.entries(data.bitrix_summary?.excluded ?? {})
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    chartContent = (
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Сводка парсинга дампа">
          <div className="grid gap-3">
            <StatsPill
              label="Чистые хиты"
              value={formatNumber(data.bitrix_summary?.clean_hit_rows ?? 0, locale)}
              theme={theme}
            />
            <StatsPill
              label="URL после чистки"
              value={formatNumber(data.bitrix_summary?.unique_clean_urls ?? 0, locale)}
              theme={theme}
            />
            <StatsPill
              label="Исключено"
              value={formatNumber(excludedTotal, locale)}
              theme={theme}
            />
          </div>
        </ChartCard>
        <ChartCard title="Результат соединения">
          <div className="grid gap-3">
            <StatsPill
              label="Страницы Метрики с Bitrix-данными"
              value={`${formatNumber(bitrixMatchedPageStats, locale)} из ${formatNumber(data.page_stats.length, locale)}`}
              theme={theme}
            />
            <StatsPill
              label="Покрытие страниц Метрики"
              value={formatPercent(bitrixMatchCoveragePct, locale)}
              theme={theme}
            />
            <StatsPill
              label="Сессии по выбранным URL"
              value={formatNumber(totalBitrixSessions, locale)}
              theme={theme}
            />
          </div>
        </ChartCard>
        <ChartCard title="Авторизация в Bitrix-сессиях">
          <div className="grid gap-3">
            <StatsPill
              label="Сессии с User ID"
              value={formatNumber(loggedInBitrixSessions, locale)}
              theme={theme}
            />
            <StatsPill
              label="Сессии без User ID"
              value={formatNumber(anonymousBitrixSessions, locale)}
              theme={theme}
            />
            <StatsPill
              label="Доля с User ID"
              value={formatPercent(
                totalBitrixSessions > 0 ? (loggedInBitrixSessions / totalBitrixSessions) * 100 : 0,
                locale,
              )}
              theme={theme}
            />
          </div>
        </ChartCard>
        <ChartCard title="Сессии по направлению">
          <AbbottPieChart data={bitrixDirectionData} colors={theme.pieColors} locale={locale} />
        </ChartCard>
        <ChartCard title="Просмотры по типу материала">
          <AbbottPieChart data={bitrixMaterialData} colors={[...theme.pieColors].reverse()} locale={locale} />
        </ChartCard>
        <ChartCard title="Что исключено при очистке">
          <AbbottBarChart
            data={exclusionRows}
            dataKey="value"
            color={theme.barColor}
            locale={locale}
            layout="horizontal"
          />
        </ChartCard>
        <div className="xl:col-span-3">
          <ChartCard title="Топ Bitrix URL по просмотрам">
            <AbbottBarChart data={bitrixTopPages} dataKey="pageviews" color={theme.barColor} locale={locale} layout="horizontal" />
          </ChartCard>
        </div>
      </div>
    );
  } else if (activeTab === "external_events") {
    chartContent = (
      <ChartCard title="Топ внешних URL по количеству переходов">
        <AbbottBarChart data={externalTopRows} dataKey="clicks" color={theme.barColor} locale={locale} layout="horizontal" />
      </ChartCard>
    );
  } else if (activeTab === "returning") {
    chartContent = (
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Вернувшиеся в 1 день">
          <AbbottBarChart
            data={returningDirectionData.map((row) => ({ label: row.label, value: row.returning_1_day_pct }))}
            dataKey="value"
            color={theme.barColor}
            locale={locale}
            valueFormatter={(value) => formatPercent(value, locale)}
          />
        </ChartCard>
        <ChartCard title="Вернувшиеся в 2-7 дни">
          <AbbottBarChart
            data={returningDirectionData.map((row) => ({ label: row.label, value: row.returning_2_7_days_pct }))}
            dataKey="value"
            color={theme.barColor}
            locale={locale}
            valueFormatter={(value) => formatPercent(value, locale)}
          />
        </ChartCard>
        <ChartCard title="Вернувшиеся в 8-31 дни">
          <AbbottBarChart
            data={returningDirectionData.map((row) => ({ label: row.label, value: row.returning_8_31_days_pct }))}
            dataKey="value"
            color={theme.barColor}
            locale={locale}
            valueFormatter={(value) => formatPercent(value, locale)}
          />
        </ChartCard>
      </div>
    );
  } else if (activeTab === "general_materials") {
    chartContent = (
      <ChartCard title="Топ общих материалов по пользователям">
        <AbbottBarChart data={generalMaterialsTop} dataKey="users" color={theme.barColor} locale={locale} layout="horizontal" />
      </ChartCard>
    );
  } else if (activeTab === "time_buckets") {
    chartContent = (
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Итого на сайте">
          <DataTable
            columns={[
              { key: "label", label: "Диапазон времени" },
              { key: "users", label: "Количество пользователей", className: "text-right" },
            ]}
            rows={timeBucketSections.overall.map((row) => ({
              label: row.label,
              users: formatNumber(row.users, locale),
            }))}
            emptyText="Нет данных по времени за выбранный период."
            headerClass={theme.headerClass}
          />
        </ChartCard>
        <ChartCard title="По материалам">
          <DataTable
            columns={[
              { key: "label", label: "Диапазон времени" },
              { key: "users", label: "Количество пользователей", className: "text-right" },
            ]}
            rows={timeBucketSections.materials.map((row) => ({
              label: row.label,
              users: formatNumber(row.users, locale),
            }))}
            emptyText="Нет данных по материалам за выбранный период."
            headerClass={theme.headerClass}
          />
        </ChartCard>
        <ChartCard title={selectedTimeBucketPage ? `По выбранной странице: ${selectedTimeBucketPage.label}` : "По выбранной странице"}>
          {selectedTimeBucketPage ? (
            <DataTable
              columns={[
                { key: "label", label: "Диапазон времени" },
                { key: "users", label: "Количество пользователей", className: "text-right" },
              ]}
              rows={selectedTimeBucketPage.buckets.map((row) => ({
                label: row.label,
                users: formatNumber(row.users, locale),
              }))}
              emptyText="Нет данных по выбранной странице."
              headerClass={theme.headerClass}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">
              Выберите страницу сверху, чтобы посмотреть распределение пользователей по времени на этой странице.
            </div>
          )}
        </ChartCard>
        <ChartCard title="Сравнение бакетов">
          <div className="xl:col-span-3">
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeBucketCompare}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
                  <Tooltip content={<SimpleTooltip locale={locale} />} />
                  <Bar dataKey="overall" fill={theme.barColor} radius={[8, 8, 0, 0]} />
                  <Bar dataKey="materials" fill="#0f172a" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </ChartCard>
      </div>
    );
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="card-surface h-fit p-5">
        <div className="mb-6 text-2xl font-semibold text-slate-900">Навигация</div>
        <nav className="space-y-2">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            const tabTheme = TAB_THEMES[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  isActive
                    ? `${tabTheme.borderClass} ${tabTheme.textClass} bg-white shadow-sm`
                    : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="font-semibold">{tab.label.replace(/^\d+\.\s*/, "")}</div>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="space-y-4">
        <div className={`card-surface relative z-[110] overflow-visible border p-5 ${theme.borderClass}`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">{currentTab.label}</h2>
              <p className="mt-1 text-sm text-slate-600">{currentTab.description}</p>
            </div>
            {activeTab === "time_buckets" ? (
              <CompactPagePicker
                label="Текущая страница"
                searchValue={timeBucketPageSearch}
                selectedValue={filtersByTab.time_buckets.page_url}
                selectedLabel={selectedTimeBucketPage ? `${selectedTimeBucketPage.label}` : null}
                options={timeBucketPageOptions}
                onSearchChange={setTimeBucketPageSearch}
                onSelect={(option) => {
                  setSelectFilter("time_buckets", "page_url", option.value);
                  setTimeBucketPageSearch(option.label);
                }}
                onClear={() => {
                  setSelectFilter("time_buckets", "page_url", "");
                  setTimeBucketPageSearch("");
                }}
                theme={theme}
              />
            ) : (
              <label className="block md:w-[320px]">
                <span className={`mb-2 block text-xs font-semibold uppercase tracking-[0.12em] ${theme.textClass}`}>Search</span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                  value={queryByTab[activeTab]}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Фильтр по текущей странице"
                />
              </label>
            )}
          </div>
        </div>

        {activeTab === "bitrix_pages" ? (
          <div className="border-l-4 border-teal-600 bg-teal-50 px-5 py-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">
              Фиксированный доступный период:{" "}
              {formatDateTimeRange(data.bitrix_summary?.date_from, data.bitrix_summary?.date_to, locale)}
            </div>
            <p className="mt-1">
              Этот лист построен из разового парсинга Bitrix SQL dump за указанный период и не меняется при выборе
              других дат в общем фильтре дашборда. Хиты и сессии очищены от ботов, технических URL, 404 и не-GET
              запросов. Затем страницы соединены по нормализованному URL с доступными данными Яндекс Метрики и
              справочником ABBOTT, чтобы дополнить их названием, направлением, типом материала и доступом.
            </p>
          </div>
        ) : null}

        {tabFilterContent[activeTab] ? (
          <div
            className={`grid gap-4 ${
              activeTab === "page_stats"
                ? "xl:grid-cols-4"
                : activeTab === "users_summary"
                  ? "sm:grid-cols-2 lg:grid-cols-4"
                  : "xl:grid-cols-3"
            }`}
          >
            {tabFilterContent[activeTab]}
          </div>
        ) : null}

        {chartContent}

        {activeTab === "time_buckets" ? null : (
          <div className="card-surface overflow-hidden p-5">
            <DataTable columns={tableColumns} rows={tableRows} emptyText={emptyText} headerClass={theme.headerClass} />
          </div>
        )}

        {activeTab === "time_buckets" ? null : (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onChange={(page) => setPageByTab((prev) => ({ ...prev, [activeTab]: page }))}
          />
        )}
      </div>
    </section>
  );
}

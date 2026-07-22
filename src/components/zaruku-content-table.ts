import type { ZarukuMetricAvailability, ZarukuMetricColumn, ZarukuSeoMetricRow } from "@/lib/types";

export type ContentSortKey = "label" | ZarukuMetricColumn;
export type ContentSort = { key: ContentSortKey; direction: "asc" | "desc" };

export type ContentMetricColumn = {
  key: ZarukuMetricColumn;
  label: string;
};

const METRIC_COLUMNS: ContentMetricColumn[] = [
  { key: "visits", label: "Визиты" },
  { key: "users", label: "Пользователи" },
  { key: "pageviews", label: "Просмотры" },
  { key: "bounce_rate", label: "Отказы" },
  { key: "avg_duration_seconds", label: "Время" },
  { key: "page_depth", label: "Глубина" },
];

export function availableMetricColumns(metrics: ZarukuMetricAvailability): ContentMetricColumn[] {
  return METRIC_COLUMNS.filter((column) => metrics[column.key]);
}

function metricValue(row: ZarukuSeoMetricRow, key: ZarukuMetricColumn): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export function sortContentRows(rows: ZarukuSeoMetricRow[], sort: ContentSort, locale = "ru-RU"): ZarukuSeoMetricRow[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.key === "label") return factor * left.label.localeCompare(right.label, locale);
    return factor * (metricValue(left, sort.key) - metricValue(right, sort.key)) || left.label.localeCompare(right.label, locale);
  });
}

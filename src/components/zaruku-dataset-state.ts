import type {
  ZarukuDatasetMeta,
  ZarukuDatasetState,
  ZarukuMetricAvailability,
  ZarukuMetricColumn,
} from "@/lib/types";

const METRIC_ORDER: ZarukuMetricColumn[] = [
  "visits",
  "users",
  "pageviews",
  "bounce_rate",
  "avg_duration_seconds",
  "page_depth",
];

export function resolvePanelState(meta: Pick<ZarukuDatasetMeta, "state" | "message">): ZarukuDatasetState {
  return meta.state;
}

export function availableMetricColumns(metrics: ZarukuMetricAvailability): ZarukuMetricColumn[] {
  return METRIC_ORDER.filter((key) => metrics[key]);
}

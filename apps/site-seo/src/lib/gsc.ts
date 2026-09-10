import type {
  DatasetMeta,
  GscDimensionRow,
  GscView,
  ManualSheet,
  Metrics,
  Period,
} from "@reportingdash/site-seo-contract";

type GscDailyRow = Readonly<{ date: string; metrics: Metrics; meta: DatasetMeta }>;
type GscDimensionReadRow = GscDimensionRow & Readonly<{ meta: DatasetMeta }>;

export type GscReadRows = Readonly<{
  meta: DatasetMeta;
  summary: Metrics | null;
  daily: readonly GscDailyRow[];
  dimensions: readonly GscDimensionReadRow[];
  indexing: DatasetMeta;
}>;

function samePeriod(left: Period | null, right: Period): boolean {
  return left?.kind === right.kind && left.key === right.key && left.from === right.from && left.to === right.to;
}

function missingMeta(source: DatasetMeta): DatasetMeta {
  return {
    sourceKey: source.sourceKey, period: null, state: "missing",
    collectionMode: source.collectionMode, completeness: "unknown", importId: null,
    exportedAt: null, loadedAt: null, freshness: "unknown", latestAttempt: "none",
  };
}

function summaryForPeriod(
  source: GscReadRows,
  period: Period,
  daily: readonly GscDailyRow[],
): Metrics | null {
  if (samePeriod(source.meta.period, period)) return source.summary;
  if (daily.length === 0) return null;
  const clicks = daily.reduce((total, row) => total + row.metrics.clicks, 0);
  const impressions = daily.reduce((total, row) => total + row.metrics.impressions, 0);
  const positionedImpressions = daily.reduce(
    (total, row) => total + (row.metrics.averagePosition === null ? 0 : row.metrics.impressions),
    0,
  );
  const weightedPosition = daily.reduce(
    (total, row) => total + (row.metrics.averagePosition === null ? 0 : row.metrics.averagePosition * row.metrics.impressions),
    0,
  );
  return {
    clicks,
    impressions,
    ctrPct: impressions > 0 ? clicks / impressions * 100 : null,
    averagePosition: positionedImpressions > 0 ? weightedPosition / positionedImpressions : null,
  };
}

export function loadGscView(rows: GscReadRows, period: Period): GscView {
  const dimensions = rows.dimensions.filter((row) => samePeriod(row.meta.period, period));
  const daily = rows.daily.filter((row) => row.date >= period.from && row.date <= period.to);
  const dimensionMeta: Partial<Record<ManualSheet, DatasetMeta>> = {};
  for (const sheet of ["query", "page", "country", "device", "appearance"] as const) {
    dimensionMeta[sheet] = dimensions.find((row) => row.dimension === sheet)?.meta ?? missingMeta(rows.meta);
  }
  return {
    meta: rows.meta,
    summary: summaryForPeriod(rows, period, daily),
    daily: daily
      .map(({ date, metrics }) => ({ date, metrics })),
    dimensions: dimensions.map(({ dimension, value, metrics }) => ({ dimension, value, metrics })),
    dimensionMeta,
  };
}

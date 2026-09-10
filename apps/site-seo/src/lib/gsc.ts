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

export function loadGscView(rows: GscReadRows, period: Period): GscView {
  const dimensions = rows.dimensions.filter((row) => samePeriod(row.meta.period, period));
  const dimensionMeta: Partial<Record<ManualSheet, DatasetMeta>> = {};
  for (const sheet of ["query", "page", "country", "device", "appearance"] as const) {
    dimensionMeta[sheet] = dimensions.find((row) => row.dimension === sheet)?.meta ?? missingMeta(rows.meta);
  }
  return {
    meta: rows.meta,
    summary: rows.summary,
    daily: rows.daily
      .filter((row) => row.date >= period.from && row.date <= period.to)
      .map(({ date, metrics }) => ({ date, metrics })),
    dimensions: dimensions.map(({ dimension, value, metrics }) => ({ dimension, value, metrics })),
    dimensionMeta,
  };
}

import type { ZarukuSeoClusterRow, ZarukuSeoPositionTrendPoint } from "@/lib/types";

export type ClusterFilter = {
  week: string | null;
  section: string;
  status: "all" | ZarukuSeoClusterRow["status"];
};

export type ClusterAnalyticsRow = ZarukuSeoClusterRow & {
  display_delta: number | null;
};

export type PositionComparisonRow = {
  section: string;
  primary_position: number | null;
  primary_coverage: number;
  primary_found_rows: number;
  primary_tracked_rows: number;
  comparison_position: number | null;
  comparison_coverage: number | null;
  comparison_found_rows: number | null;
  comparison_tracked_rows: number | null;
};

type PositionDeltaPresentation = {
  label: string;
  tone: "improved" | "declined" | "neutral";
};

function pointForWeekAndSection(points: ZarukuSeoPositionTrendPoint[], week: string | null, section: string) {
  return week ? points.find((point) => point.week === week && point.section === section) : undefined;
}

export function buildPositionComparisonRows(
  points: ZarukuSeoPositionTrendPoint[],
  primaryWeek: string | null,
  comparisonWeek: string | null,
): PositionComparisonRow[] {
  const sections = new Set<string>();
  for (const point of points) {
    if (point.week === primaryWeek || point.week === comparisonWeek) sections.add(point.section);
  }

  return [...sections]
    .sort((left, right) => left.localeCompare(right))
    .map((section) => {
      const primary = pointForWeekAndSection(points, primaryWeek, section);
      const comparison = pointForWeekAndSection(points, comparisonWeek, section);
      return {
        section,
        primary_position: primary?.average_position ?? null,
        primary_coverage: primary?.coverage ?? 0,
        primary_found_rows: primary?.found_rows ?? 0,
        primary_tracked_rows: primary?.tracked_rows ?? 0,
        comparison_position: comparison?.average_position ?? null,
        comparison_coverage: comparison ? comparison.coverage : null,
        comparison_found_rows: comparison?.found_rows ?? null,
        comparison_tracked_rows: comparison?.tracked_rows ?? null,
      };
    });
}

function comparisonDelta(row: ZarukuSeoClusterRow, comparisonRows: ZarukuSeoClusterRow[]) {
  const comparison = comparisonRows.find(
    (candidate) => candidate.cluster_id === row.cluster_id && candidate.section === row.section,
  );
  if (row.serp_position == null || comparison?.serp_position == null) return null;
  return row.serp_position - comparison.serp_position;
}

export function filterClusterRows(
  rows: ZarukuSeoClusterRow[],
  filter: ClusterFilter,
  comparisonWeek: string | null = null,
): ClusterAnalyticsRow[] {
  const comparisonRows = comparisonWeek ? rows.filter((row) => row.week === comparisonWeek) : [];
  return rows
    .filter((row) => row.week === filter.week)
    .filter((row) => filter.section === "all" || row.section === filter.section)
    .filter((row) => filter.status === "all" || row.status === filter.status)
    .map((row) => ({
      ...row,
      display_delta: comparisonWeek ? comparisonDelta(row, comparisonRows) : row.delta_prev,
    }))
    .sort(
      (left, right) =>
        left.section.localeCompare(right.section) ||
        left.query.localeCompare(right.query) ||
        left.cluster_id.localeCompare(right.cluster_id),
    );
}

export function formatPositionDelta(value: number | null): PositionDeltaPresentation {
  if (value == null || !Number.isFinite(value)) return { label: "—", tone: "neutral" };
  const magnitude = Math.abs(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  if (value < 0) return { label: `↑ ${magnitude}`, tone: "improved" };
  if (value > 0) return { label: `↓ ${magnitude}`, tone: "declined" };
  return { label: "0", tone: "neutral" };
}

export function resolveSafeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

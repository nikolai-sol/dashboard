import type { ZarukuSeoSectionPattern, ZarukuSeoTrafficVisibilityRow } from "@/lib/types";

type TrafficMetrics = Omit<ZarukuSeoTrafficVisibilityRow, "week" | "section">;

export type TrafficVisibilityComparisonRow = {
  section: string;
  primary: TrafficMetrics;
  comparison: TrafficMetrics | null;
  visits_delta: number | null;
  position_delta: number | null;
};

function metricsForWeekAndSection(rows: ZarukuSeoTrafficVisibilityRow[], week: string | null, section: string): TrafficMetrics | null {
  if (!week) return null;
  const row = rows.find((candidate) => candidate.week === week && candidate.section === section);
  return row ? {
    visits: row.visits,
    users: row.users,
    pageviews: row.pageviews,
    average_position: row.average_position,
    coverage: row.coverage,
  } : null;
}

export function buildTrafficVisibilityRows(
  rows: ZarukuSeoTrafficVisibilityRow[],
  patterns: ZarukuSeoSectionPattern[],
  primaryWeek: string | null,
  comparisonWeek: string | null,
): TrafficVisibilityComparisonRow[] {
  const sections = [...new Set(patterns.map((pattern) => pattern.section))].sort((left, right) => left.localeCompare(right));
  return sections.flatMap((section) => {
    const primary = metricsForWeekAndSection(rows, primaryWeek, section);
    const comparison = metricsForWeekAndSection(rows, comparisonWeek, section);
    if (!primary && !comparison) return [];
    const visiblePrimary = primary ?? { visits: 0, users: 0, pageviews: 0, average_position: null, coverage: null };
    return [{
      section,
      primary: visiblePrimary,
      comparison,
      visits_delta: comparison ? visiblePrimary.visits - comparison.visits : null,
      position_delta: comparison && visiblePrimary.average_position != null && comparison.average_position != null
        ? visiblePrimary.average_position - comparison.average_position
        : null,
    }];
  });
}

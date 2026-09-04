import type { DashboardDateRange } from "./dashboard-date-range";

function shift(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function latestZarukuReportingDate(now = new Date()): string {
  return shift(now.toISOString().slice(0, 10), -2);
}

export function clampZarukuDateRange(
  range: DashboardDateRange,
  now = new Date(),
): DashboardDateRange {
  const latest = latestZarukuReportingDate(now);
  return {
    from: range.from > latest ? latest : range.from,
    to: range.to > latest ? latest : range.to,
  };
}

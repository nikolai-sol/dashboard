import type { Period } from "@reportingdash/site-seo-contract";

export const DEFAULT_GSC_FILTERS: Readonly<Record<string, string>> = {
  country: "all",
  search_type: "web",
  device: "all",
};

export function gscFilters(filters: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { ...DEFAULT_GSC_FILTERS, ...filters };
}

export type PeriodSelection = Readonly<{
  traffic: Readonly<{ primary: Period; comparison: Period | null }>;
  alice: Period;
  gsc: Period;
}>;

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function isoWeekPeriod(key: string, sourceTimezone: string): Period {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 53) throw new Error("Invalid ISO week");
  const year = Number(match[1]);
  const week = Number(match[2]);
  const fourthJanuary = new Date(Date.UTC(year, 0, 4));
  const mondayOfWeekOne = addDays(fourthJanuary, -((fourthJanuary.getUTCDay() + 6) % 7));
  const from = addDays(mondayOfWeekOne, (week - 1) * 7);
  return { kind: "iso_week", key, from: formatDate(from), to: formatDate(addDays(from, 6)), sourceTimezone };
}

export function calendarMonthPeriod(key: string, sourceTimezone: string): Period {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error("Invalid calendar month");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return {
    kind: "calendar_month", key,
    from: formatDate(new Date(Date.UTC(year, monthIndex, 1))),
    to: formatDate(new Date(Date.UTC(year, monthIndex + 1, 0))),
    sourceTimezone,
  };
}

export function createPeriodSelection(
  input: Readonly<{ primaryWeek: string; comparisonWeek?: string; aliceMonth: string; gsc: Period }>,
  sourceTimezone: string,
): PeriodSelection {
  return {
    traffic: {
      primary: isoWeekPeriod(input.primaryWeek, sourceTimezone),
      comparison: input.comparisonWeek ? isoWeekPeriod(input.comparisonWeek, sourceTimezone) : null,
    },
    alice: calendarMonthPeriod(input.aliceMonth, sourceTimezone),
    gsc: input.gsc,
  } as const;
}

export function resolveAvailableWeekSelection(
  selection: PeriodSelection,
  availableWeeks: readonly Period[],
): PeriodSelection {
  const fullWeeks = availableWeeks.filter((period) => period.kind === "iso_week");
  const primary = fullWeeks.find((period) => period.key === selection.traffic.primary.key) ?? fullWeeks[0];
  if (!primary) throw new Error("No fully covered Metrika week is available");
  const comparison = selection.traffic.comparison
    ? fullWeeks.find((period) => period.key === selection.traffic.comparison?.key && period.key !== primary.key) ?? null
    : null;
  return { ...selection, traffic: { primary, comparison } };
}

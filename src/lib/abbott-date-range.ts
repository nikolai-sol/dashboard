export const ABBOTT_BUSINESS_TIME_ZONE =
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE?.trim() || "Europe/Moscow";

export const ABBOTT_NO_COMPLETED_DAYS =
  "За текущий период ещё нет завершённых дней. Данные появятся завтра";

export type AbbottDatePreset =
  | "this_month"
  | "previous_month"
  | "this_week"
  | "previous_week"
  | "custom";

export type AbbottDateRange = { from: string; to: string };

export type AbbottPresetResult =
  | { kind: "range"; from: string; to: string }
  | { kind: "empty"; message: typeof ABBOTT_NO_COMPLETED_DAYS };

export class AbbottDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbbottDateRangeError";
  }
}

function zonedCalendarDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function isoDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function startOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function startOfWeek(value: string): string {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  return shiftIsoDate(value, -daysSinceMonday);
}

function previousMonthRange(businessToday: string): AbbottDateRange {
  const [year, month] = businessToday.split("-").map(Number);
  const previousMonthLastDay = new Date(Date.UTC(year, month - 1, 0));
  const previousYear = previousMonthLastDay.getUTCFullYear();
  const previousMonth = previousMonthLastDay.getUTCMonth() + 1;
  return {
    from: isoDate(previousYear, previousMonth, 1),
    to: previousMonthLastDay.toISOString().slice(0, 10),
  };
}

export function businessCalendarIsoDate(
  now = new Date(),
  timeZone = ABBOTT_BUSINESS_TIME_ZONE,
): string {
  const today = zonedCalendarDate(now, timeZone);
  return isoDate(today.year, today.month, today.day);
}

export function latestCompletedAbbottDate(
  now = new Date(),
  timeZone = ABBOTT_BUSINESS_TIME_ZONE,
): string {
  return shiftIsoDate(businessCalendarIsoDate(now, timeZone), -1);
}

export function resolveAbbottPreset(
  preset: AbbottDatePreset,
  now = new Date(),
  timeZone = ABBOTT_BUSINESS_TIME_ZONE,
): AbbottPresetResult {
  const businessToday = businessCalendarIsoDate(now, timeZone);
  const latestCompleted = latestCompletedAbbottDate(now, timeZone);

  if (preset === "previous_month") {
    const range = previousMonthRange(businessToday);
    return { kind: "range", ...range };
  }

  if (preset === "previous_week") {
    const thisWeekStart = startOfWeek(businessToday);
    return {
      kind: "range",
      from: shiftIsoDate(thisWeekStart, -7),
      to: shiftIsoDate(thisWeekStart, -1),
    };
  }

  if (preset === "this_month") {
    const from = startOfMonth(businessToday);
    return latestCompleted < from
      ? { kind: "empty", message: ABBOTT_NO_COMPLETED_DAYS }
      : { kind: "range", from, to: latestCompleted };
  }

  if (preset === "this_week") {
    const from = startOfWeek(businessToday);
    return latestCompleted < from
      ? { kind: "empty", message: ABBOTT_NO_COMPLETED_DAYS }
      : { kind: "range", from, to: latestCompleted };
  }

  return { kind: "empty", message: ABBOTT_NO_COMPLETED_DAYS };
}

export function detectAbbottPreset(
  range: AbbottDateRange,
  now = new Date(),
  timeZone = ABBOTT_BUSINESS_TIME_ZONE,
): AbbottDatePreset {
  const presets: Exclude<AbbottDatePreset, "custom">[] = [
    "this_month",
    "previous_month",
    "this_week",
    "previous_week",
  ];
  for (const preset of presets) {
    const resolved = resolveAbbottPreset(preset, now, timeZone);
    if (resolved.kind === "range" && resolved.from === range.from && resolved.to === range.to) {
      return preset;
    }
  }
  return "custom";
}

export function normalizeAbbottRequestedRange(
  range: AbbottDateRange,
  now = new Date(),
  timeZone = ABBOTT_BUSINESS_TIME_ZONE,
): AbbottDateRange {
  if (!isValidIsoDate(range.from) || !isValidIsoDate(range.to)) {
    throw new AbbottDateRangeError("Abbott date range must use valid ISO calendar dates");
  }
  if (range.from > range.to) {
    throw new AbbottDateRangeError("Abbott date range start must not be after its end");
  }

  const to = range.to > latestCompletedAbbottDate(now, timeZone)
    ? latestCompletedAbbottDate(now, timeZone)
    : range.to;
  if (range.from > to) {
    throw new AbbottDateRangeError("Abbott date range contains no completed days");
  }
  return { from: range.from, to };
}

export function defaultAbbottRange(
  now = new Date(),
  timeZone = ABBOTT_BUSINESS_TIME_ZONE,
): AbbottDateRange | null {
  const resolved = resolveAbbottPreset("this_month", now, timeZone);
  return resolved.kind === "range" ? { from: resolved.from, to: resolved.to } : null;
}

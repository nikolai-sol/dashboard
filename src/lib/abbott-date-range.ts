export const ABBOTT_BUSINESS_TIME_ZONE =
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE?.trim() || "Europe/Moscow";

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

export function defaultAbbottRange(
  now = new Date(),
  timeZone = ABBOTT_BUSINESS_TIME_ZONE,
): { from: string; to: string } {
  const today = zonedCalendarDate(now, timeZone);
  return {
    from: isoDate(today.year, today.month, 1),
    to: isoDate(today.year, today.month, today.day - 1),
  };
}

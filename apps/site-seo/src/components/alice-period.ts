import type { Period } from "@reportingdash/site-seo-contract";

function dateParts(value: string): Readonly<{ day: string; month: string; year: string }> | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? { year: match[1]!, month: match[2]!, day: match[3]! } : null;
}

export function aliceSourceRange(period: Period | null | undefined): string | undefined {
  return period ? `${period.from} — ${period.to}` : undefined;
}

export function aliceOfficialSovPeriodLabel(period: Period | null | undefined): string | undefined {
  if (!period) return undefined;
  const from = dateParts(period.from);
  const to = dateParts(period.to);
  if (!from || !to) return `${period.from} — ${period.to}`;
  const prefix = period.kind === "iso_week" ? "Неделя" : period.kind === "calendar_month" ? "Месяц" : "Период";
  return `${prefix} ${from.day}.${from.month}–${to.day}.${to.month}.${to.year}`;
}

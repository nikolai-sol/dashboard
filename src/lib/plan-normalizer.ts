import type { PlanVsFactItem } from "@/lib/types";
import { MONTH_COLUMNS } from "@/lib/gsheet-fetcher";

export interface MonthlyPlan {
  [month: string]: number;
}

export interface PeriodMonth {
  key: string;
  label: string;
  from: string;
  to: string;
  year: number;
  month: number;
  days_in_month: number;
  selected_days: number;
}

type NormalizeOptions = {
  total: number;
  monthly?: MonthlyPlan;
  periodFrom: string;
  periodTo: string;
  configFrom?: string;
  configTo?: string;
};

const MONTH_TO_NUM: Record<string, number> = {
  январь: 0,
  февраль: 1,
  март: 2,
  апрель: 3,
  май: 4,
  июнь: 5,
  июль: 6,
  август: 7,
  сентябрь: 8,
  октябрь: 9,
  ноябрь: 10,
  декабрь: 11,
};

function toUtcDate(dateIso: string) {
  return new Date(`${dateIso}T00:00:00Z`);
}

function shiftDate(dateIso: string, days: number): string {
  const date = toUtcDate(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(dateFrom: string, dateTo: string): number {
  const fromDate = toUtcDate(dateFrom);
  const toDate = toUtcDate(dateTo);
  return Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
}

function monthStart(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

function monthEnd(dateIso: string): string {
  const date = toUtcDate(monthStart(dateIso));
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

function formatMonthLabel(monthKey: string): string {
  return monthKey.charAt(0).toUpperCase() + monthKey.slice(1);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function buildPeriodMonths(periodFrom: string, periodTo: string): PeriodMonth[] {
  const months: PeriodMonth[] = [];
  let cursor = monthStart(periodFrom);
  while (cursor <= periodTo) {
    const cursorMonthEnd = monthEnd(cursor);
    const from = maxIso(periodFrom, cursor);
    const to = minIso(periodTo, cursorMonthEnd);
    const cursorDate = toUtcDate(cursor);
    const month = cursorDate.getUTCMonth();
    const year = cursorDate.getUTCFullYear();
    const key = MONTH_COLUMNS[month];
    months.push({
      key,
      label: formatMonthLabel(key),
      from,
      to,
      year,
      month,
      days_in_month: daysInMonth(year, month),
      selected_days: inclusiveDays(from, to),
    });
    cursor = shiftDate(cursorMonthEnd, 1);
  }
  return months;
}

export function normalizePlan(
  monthly: MonthlyPlan,
  periodFrom: string,
  periodTo: string,
  defaultYear?: number,
): number {
  let total = 0;
  for (const [monthNameRaw, monthValueRaw] of Object.entries(monthly ?? {})) {
    const monthName = monthNameRaw.toLowerCase().trim();
    const monthNum = MONTH_TO_NUM[monthName];
    const monthValue = Number(monthValueRaw) || 0;
    if (monthNum === undefined || monthValue <= 0) continue;

    const year =
      defaultYear ??
      (() => {
        const from = toUtcDate(periodFrom);
        const to = toUtcDate(periodTo);
        if (monthNum < from.getUTCMonth() && from.getUTCFullYear() !== to.getUTCFullYear()) {
          return to.getUTCFullYear();
        }
        return from.getUTCFullYear();
      })();

    const monthStartIso = new Date(Date.UTC(year, monthNum, 1)).toISOString().slice(0, 10);
    const monthEndIso = new Date(Date.UTC(year, monthNum + 1, 0)).toISOString().slice(0, 10);
    const overlapFrom = maxIso(periodFrom, monthStartIso);
    const overlapTo = minIso(periodTo, monthEndIso);
    if (overlapFrom > overlapTo) continue;
    total += monthValue * (inclusiveDays(overlapFrom, overlapTo) / daysInMonth(year, monthNum));
  }
  return total;
}

export function normalizeValueForPeriod({
  total,
  monthly,
  periodFrom,
  periodTo,
  configFrom,
  configTo,
}: NormalizeOptions): number {
  const monthEntries = Object.values(monthly ?? {}).filter((value) => Number(value) > 0);
  if (monthEntries.length > 0) {
    return normalizePlan(monthly ?? {}, periodFrom, periodTo);
  }

  if (total <= 0) return 0;
  if (!configFrom || !configTo) return total;

  const configDays = inclusiveDays(configFrom, configTo);
  const selectedDays = inclusiveDays(maxIso(periodFrom, configFrom), minIso(periodTo, configTo));
  if (configDays <= 0 || selectedDays <= 0) return 0;
  return total * (selectedDays / configDays);
}

export function normalizeChannelPlan(
  row: PlanVsFactItem,
  periodFrom: string,
  periodTo: string,
  configFrom?: string,
  configTo?: string,
) {
  const budgetMonthly = Object.fromEntries(
    Object.entries(row.monthly_breakdown ?? {}).map(([month, item]) => [month, Number(item.budget || 0)]),
  );
  const impressionsMonthly = Object.fromEntries(
    Object.entries(row.monthly_breakdown ?? {}).map(([month, item]) => [month, Number(item.impressions || 0)]),
  );
  const reachMonthly = Object.fromEntries(
    Object.entries(row.monthly_breakdown ?? {}).map(([month, item]) => [month, Number(item.reach || 0)]),
  );
  const clicksMonthly = Object.fromEntries(
    Object.entries(row.monthly_breakdown ?? {}).map(([month, item]) => [month, Number(item.clicks || 0)]),
  );
  const viewsMonthly = Object.fromEntries(
    Object.entries(row.monthly_breakdown ?? {}).map(([month, item]) => [month, Number(item.views || 0)]),
  );
  const conversionsMonthly = Object.fromEntries(
    Object.entries(row.monthly_breakdown ?? {}).map(([month, item]) => [month, Number(item.conversions || 0)]),
  );

  const spend = normalizeValueForPeriod({
    total: row.budget_plan,
    monthly: budgetMonthly,
    periodFrom,
    periodTo,
    configFrom,
    configTo,
  });
  const impressions = normalizeValueForPeriod({
    total: row.impressions_plan,
    monthly: impressionsMonthly,
    periodFrom,
    periodTo,
    configFrom,
    configTo,
  });
  const reach = normalizeValueForPeriod({
    total: row.reach_plan,
    monthly: reachMonthly,
    periodFrom,
    periodTo,
    configFrom,
    configTo,
  });
  const clicks = normalizeValueForPeriod({
    total: row.clicks_plan,
    monthly: clicksMonthly,
    periodFrom,
    periodTo,
    configFrom,
    configTo,
  });
  const views = normalizeValueForPeriod({
    total: row.views_plan,
    monthly: viewsMonthly,
    periodFrom,
    periodTo,
    configFrom,
    configTo,
  });
  const conversions = normalizeValueForPeriod({
    total: row.conversions_plan,
    monthly: conversionsMonthly,
    periodFrom,
    periodTo,
    configFrom,
    configTo,
  });

  return {
    spend,
    impressions,
    reach,
    clicks,
    views,
    conversions,
    frequency: reach > 0 ? impressions / reach : row.frequency_plan,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : row.cpm_plan,
    cpc: clicks > 0 ? spend / clicks : row.cpc_plan,
    cpv: views > 0 ? spend / views : row.cpv_plan,
    cpa: conversions > 0 ? spend / conversions : row.cpa_plan,
  };
}

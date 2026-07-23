export type DashboardDateRange = { from: string; to: string };

export type DashboardDateRangeInput = {
  requestUrl: string;
  configFrom: string | null;
  configTo: string | null;
  dashboardType?: string;
  now?: Date;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function valid(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shift(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentMonth(now: Date): DashboardDateRange {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export function resolveDashboardDateRange(input: DashboardDateRangeInput): DashboardDateRange {
  const now = input.now ?? new Date();
  const params = new URL(input.requestUrl).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const daysRaw = params.get("days");

  if (valid(from) && valid(to)) return { from, to };

  const fallback = currentMonth(now);
  if (input.dashboardType === "multibrand" && !valid(from) && !valid(to) && !daysRaw) return fallback;

  const isZaruku = input.dashboardType === "zaruku_bi";
  const today = now.toISOString().slice(0, 10);
  const completeTo = shift(today, -1);
  const days = Number(daysRaw);
  if (Number.isInteger(days) && days > 0) {
    const rangeTo = isZaruku ? completeTo : today;
    return { from: shift(rangeTo, -(days - 1)), to: rangeTo };
  }

  if (isZaruku) return { from: shift(completeTo, -27), to: completeTo };

  return {
    from: valid(input.configFrom) ? input.configFrom : fallback.from,
    to: valid(input.configTo) ? input.configTo : fallback.to,
  };
}

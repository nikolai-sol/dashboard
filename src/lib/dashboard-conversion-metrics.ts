type GoalReachRow = {
  goal_reaches: number;
};

type DailyGoalReachRow = GoalReachRow & {
  date: string;
};

type AdvertisingDailyConversions = {
  date: string;
  spend: number;
  conversions: number;
};

export function resolveDashboardConversions(
  advertisingConversions: number,
  postClickRows: readonly GoalReachRow[] | undefined,
): number {
  if (postClickRows === undefined) return advertisingConversions;
  return postClickRows.reduce((sum, row) => sum + Number(row.goal_reaches || 0), 0);
}

export function postClickConversionsByDate(
  postClickTimeseries: readonly DailyGoalReachRow[] | undefined,
): Map<string, number> | null {
  if (postClickTimeseries === undefined) return null;

  return postClickTimeseries.reduce((totals, row) => {
    const date = String(row.date ?? "").trim();
    if (!date) return totals;
    totals.set(date, (totals.get(date) ?? 0) + Number(row.goal_reaches || 0));
    return totals;
  }, new Map<string, number>());
}

export function buildConversionTrend(
  advertisingDaily: readonly AdvertisingDailyConversions[],
  postClickByDate: ReadonlyMap<string, number> | null,
): AdvertisingDailyConversions[] {
  if (postClickByDate === null) return advertisingDaily.map((row) => ({ ...row }));

  const spendByDate = new Map(advertisingDaily.map((row) => [row.date, row.spend] as const));
  return [...postClickByDate.entries()]
    .map(([date, conversions]) => ({
      date,
      spend: spendByDate.get(date) ?? 0,
      conversions,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

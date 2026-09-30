type GoalReachRow = {
  goal_reaches: number;
};

type DailyGoalReachRow = GoalReachRow & {
  date: string;
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

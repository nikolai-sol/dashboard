import type { AbbottBiUserSummaryRow } from "@/lib/types";

export type AbbottSummaryFilters = {
  user_id: string;
  user_id_traffic: string;
  direction: string;
};

export function selectAbbottSummaryRows({
  trafficRows,
  behaviorRows,
  filters,
  showUserIdAnalytics,
}: {
  trafficRows: AbbottBiUserSummaryRow[];
  behaviorRows: AbbottBiUserSummaryRow[];
  filters: AbbottSummaryFilters;
  showUserIdAnalytics: boolean;
}) {
  const needsUserBehavior =
    showUserIdAnalytics &&
    Boolean(filters.user_id || filters.user_id_traffic || filters.direction);
  return !needsUserBehavior && trafficRows.length > 0 ? trafficRows : behaviorRows;
}

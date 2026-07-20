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
  showUserIdAnalytics: _showUserIdAnalytics,
}: {
  trafficRows: AbbottBiUserSummaryRow[];
  behaviorRows: AbbottBiUserSummaryRow[];
  filters: AbbottSummaryFilters;
  showUserIdAnalytics: boolean;
}) {
  if (filters.user_id || filters.direction) return behaviorRows;
  if (filters.user_id_traffic === "with_user_id" || filters.user_id_traffic === "without_user_id") {
    return trafficRows.filter((row) => row.traffic_segment === filters.user_id_traffic);
  }
  const allTrafficRows = trafficRows.filter((row) => row.traffic_segment === "all");
  return allTrafficRows.length > 0 ? allTrafficRows : behaviorRows;
}

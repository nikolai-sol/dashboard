import type { DashboardMetrikaSettingsForm, DashboardMetrikaTrafficMetricId } from "@/lib/admin-ui-types";

export const ALL_METRIKA_TRAFFIC_METRICS: DashboardMetrikaTrafficMetricId[] = [
  "visits",
  "users",
  "pageviews",
  "bounce_rate",
  "avg_visit_duration",
];

export function normalizeDashboardMetrikaSettings(value: unknown): DashboardMetrikaSettingsForm {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawMetrics = Array.isArray(input.selected_traffic_metrics)
    ? input.selected_traffic_metrics.map((item) => String(item).trim().toLowerCase())
    : ALL_METRIKA_TRAFFIC_METRICS;
  const selectedTrafficMetrics = ALL_METRIKA_TRAFFIC_METRICS.filter((metric) => rawMetrics.includes(metric));
  const goalMode = String(input.goal_mode ?? "all").trim() === "selected" ? "selected" : "all";
  const selectedGoalIds = Array.isArray(input.selected_goal_ids)
    ? Array.from(new Set(input.selected_goal_ids.map((item) => String(item).trim()).filter(Boolean)))
    : [];

  return {
    selected_traffic_metrics: selectedTrafficMetrics.length ? selectedTrafficMetrics : [...ALL_METRIKA_TRAFFIC_METRICS],
    goal_mode: goalMode,
    selected_goal_ids: selectedGoalIds,
  };
}

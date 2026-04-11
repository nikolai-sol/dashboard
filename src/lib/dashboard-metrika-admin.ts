import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { DashboardMetrikaObservedGoalRow, DashboardMetrikaSettingsPayload } from "@/lib/admin-ui-types";
import { normalizeDashboardMetrikaSettings } from "@/lib/dashboard-metrika-settings";
import { loadDashboardWithSources } from "@/lib/admin-dashboards";
import { resolveSourceKey, resolveSourceType } from "@/lib/source-mapping";

type GoalRow = RowDataPacket & {
  goal_id: string | null;
  goal_name: string | null;
  rows_count: number | string | null;
  min_date: string | null;
  max_date: string | null;
  total_goal_reaches: number | string | null;
};

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

const TRAFFIC_METRICS: DashboardMetrikaSettingsPayload["traffic_metrics"] = [
  {
    id: "visits",
    label: "Visits",
    description: "Post-click visits from UTM-tagged Yandex Metrika traffic.",
  },
  {
    id: "users",
    label: "Users",
    description: "Users from the same UTM-tagged traffic contour.",
  },
  {
    id: "pageviews",
    label: "Pageviews",
    description: "Pageviews from tagged post-click sessions.",
  },
  {
    id: "bounce_rate",
    label: "Bounce rate",
    description: "Weighted bounce rate from Yandex Metrika traffic facts.",
  },
  {
    id: "avg_visit_duration",
    label: "Avg visit duration",
    description: "Weighted average visit duration from Metrika traffic facts.",
  },
];

export async function loadDashboardMetrikaSettingsPayload(
  conn: PoolConnection,
  dashboardId: number,
  opts?: {
    periodFrom?: string | null;
    periodTo?: string | null;
    accountIds?: string[];
  },
): Promise<DashboardMetrikaSettingsPayload | null> {
  const dashboard = await loadDashboardWithSources(conn, dashboardId);
  if (!dashboard) return null;

  const config = (dashboard.config ?? {}) as Record<string, unknown>;
  const settings = normalizeDashboardMetrikaSettings(config.metrika_settings);

  const actualSources = dashboard.sources.filter((source) => source.role === "actual");
  const defaultAccountIds = Array.from(
    new Set(
      actualSources
        .filter((source) => {
          const sourceKey = resolveSourceKey(source.platform);
          return resolveSourceType(sourceKey) === "analytics" && sourceKey === "yandex_metrika";
        })
        .flatMap((source) => asStringArray(parseJson(source.source_config).account_ids)),
    ),
  );

  const metrikaAccountIds = Array.from(new Set((opts?.accountIds ?? []).filter(Boolean))).length
    ? Array.from(new Set((opts?.accountIds ?? []).filter(Boolean)))
    : defaultAccountIds;

  const periodFrom = String(opts?.periodFrom ?? config.period_from ?? "").trim() || null;
  const periodTo = String(opts?.periodTo ?? config.period_to ?? "").trim() || null;

  if (!metrikaAccountIds.length) {
    return {
      dashboard: {
        id: dashboard.id,
        client_id: dashboard.client_id,
        dashboard_name: dashboard.dashboard_name,
        period_from: periodFrom,
        period_to: periodTo,
        metrika_account_ids: [],
      },
      traffic_metrics: TRAFFIC_METRICS,
      goals: [],
    };
  }

  const params: Array<string | number> = [...metrikaAccountIds];
  const accountPlaceholders = metrikaAccountIds.map(() => "?").join(", ");
  let whereDate = "";
  if (periodFrom) {
    whereDate += " AND report_date >= ?";
    params.push(periodFrom);
  }
  if (periodTo) {
    whereDate += " AND report_date <= ?";
    params.push(periodTo);
  }

  const [goalRows] = await conn.execute<GoalRow[]>(
    `
      SELECT
        goal_id,
        MAX(goal_name) AS goal_name,
        COUNT(*) AS rows_count,
        MIN(report_date) AS min_date,
        MAX(report_date) AS max_date,
        COALESCE(SUM(goal_reaches), 0) AS total_goal_reaches
      FROM canonical_fact_site_analytics_daily
      WHERE source_key = 'yandex_metrika'
        AND analytics_scope = 'goal'
        AND analytics_account_id IN (${accountPlaceholders})
        ${whereDate}
      GROUP BY goal_id
      ORDER BY total_goal_reaches DESC, goal_id
    `,
    params,
  );

  const selectedSet = new Set(settings.selected_goal_ids);
  const goals: DashboardMetrikaObservedGoalRow[] = goalRows
    .map((row) => {
      const goalId = String(row.goal_id ?? "").trim();
      if (!goalId) return null;
      return {
        goal_id: goalId,
        goal_name: String(row.goal_name ?? "").trim() || goalId,
        total_goal_reaches: Number(row.total_goal_reaches ?? 0),
        rows_count: Number(row.rows_count ?? 0),
        min_date: row.min_date ? String(row.min_date).slice(0, 10) : null,
        max_date: row.max_date ? String(row.max_date).slice(0, 10) : null,
        selected: settings.goal_mode === "all" ? true : selectedSet.has(goalId),
      } satisfies DashboardMetrikaObservedGoalRow;
    })
    .filter((row): row is DashboardMetrikaObservedGoalRow => Boolean(row));

  return {
    dashboard: {
      id: dashboard.id,
      client_id: dashboard.client_id,
      dashboard_name: dashboard.dashboard_name,
      period_from: periodFrom,
      period_to: periodTo,
      metrika_account_ids: metrikaAccountIds,
    },
    traffic_metrics: TRAFFIC_METRICS,
    goals,
  };
}

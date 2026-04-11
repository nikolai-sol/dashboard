import type {
  DashboardPostClickFieldId,
  DashboardPromopagesFieldId,
  DashboardSectionFieldOverridesForm,
} from "@/lib/admin-ui-types";

export const DEFAULT_POSTCLICK_FIELDS: DashboardPostClickFieldId[] = [
  "visits",
  "users",
  "pageviews",
  "goal_reaches",
  "conversion_rate",
  "bounce_rate",
  "avg_visit_duration",
];

export const DEFAULT_PROMOPAGES_FIELDS: DashboardPromopagesFieldId[] = [
  "impressions",
  "reach",
  "views",
  "budget",
  "ctr",
  "cpm",
  "clickouts",
  "full_reads",
  "metrica_visits",
];

export const DEFAULT_PLAN_FACT_FIELDS = [
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "views",
  "conversions",
  "ctr",
  "cpm",
  "cpc",
  "cpv",
  "cpa",
  "spend",
] as const;

export const DEFAULT_TREND_FIELDS = [
  "impressions",
  "clicks",
  "views",
  "conversions",
  "ctr",
  "cpm",
  "cpc",
  "cpv",
  "cpa",
  "spend",
] as const;

const POSTCLICK_SET = new Set<DashboardPostClickFieldId>(DEFAULT_POSTCLICK_FIELDS);
const PROMOPAGES_SET = new Set<DashboardPromopagesFieldId>(DEFAULT_PROMOPAGES_FIELDS);
const PLAN_FACT_SET = new Set<string>(DEFAULT_PLAN_FACT_FIELDS);
const TREND_SET = new Set<string>(DEFAULT_TREND_FIELDS);

function normalizePostclickFields(value: unknown): DashboardPostClickFieldId[] {
  if (!Array.isArray(value)) return [...DEFAULT_POSTCLICK_FIELDS];
  const seen = new Set<DashboardPostClickFieldId>();
  const normalized = value
    .map((item) => String(item) as DashboardPostClickFieldId)
    .filter((item) => POSTCLICK_SET.has(item) && !seen.has(item) && seen.add(item));
  return normalized.length ? normalized : [...DEFAULT_POSTCLICK_FIELDS];
}

function normalizePromopagesFields(value: unknown): DashboardPromopagesFieldId[] {
  if (!Array.isArray(value)) return [...DEFAULT_PROMOPAGES_FIELDS];
  const seen = new Set<DashboardPromopagesFieldId>();
  const normalized = value
    .map((item) => String(item) as DashboardPromopagesFieldId)
    .filter((item) => PROMOPAGES_SET.has(item) && !seen.has(item) && seen.add(item));
  return normalized.length ? normalized : [...DEFAULT_PROMOPAGES_FIELDS];
}

function normalizePlanFactFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_PLAN_FACT_FIELDS];
  const seen = new Set<string>();
  const normalized = value
    .map((item) => String(item))
    .filter((item) => PLAN_FACT_SET.has(item) && !seen.has(item) && seen.add(item));
  return normalized.length ? normalized : [...DEFAULT_PLAN_FACT_FIELDS];
}

function normalizeTrendFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_TREND_FIELDS];
  const seen = new Set<string>();
  const normalized = value
    .map((item) => String(item))
    .filter((item) => TREND_SET.has(item) && !seen.has(item) && seen.add(item));
  return normalized.length ? normalized : [...DEFAULT_TREND_FIELDS];
}

export function normalizeDashboardSectionFieldOverrides(
  value: unknown,
): DashboardSectionFieldOverridesForm {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const postclickRaw =
    input.postclick_analytics && typeof input.postclick_analytics === "object"
      ? (input.postclick_analytics as Record<string, unknown>)
      : {};
  const promopagesRaw =
    input.promopages && typeof input.promopages === "object"
      ? (input.promopages as Record<string, unknown>)
      : {};

  return {
    trend_chart: {
      visible_metrics: normalizeTrendFields(
        input.trend_chart && typeof input.trend_chart === "object"
          ? (input.trend_chart as Record<string, unknown>).visible_metrics
          : undefined,
      ),
    },
    postclick_analytics: {
      visible_fields: normalizePostclickFields(postclickRaw.visible_fields),
    },
    platform_table: {
      visible_metrics: normalizePlanFactFields(
        input.platform_table && typeof input.platform_table === "object"
          ? (input.platform_table as Record<string, unknown>).visible_metrics
          : undefined,
      ),
    },
    promopages: {
      visible_metrics: normalizePromopagesFields(promopagesRaw.visible_metrics),
    },
    plan_vs_fact: {
      visible_metrics: normalizePlanFactFields(
        input.plan_vs_fact && typeof input.plan_vs_fact === "object"
          ? (input.plan_vs_fact as Record<string, unknown>).visible_metrics
          : undefined,
      ),
    },
    platform_plan_fact: {
      visible_metrics: normalizePlanFactFields(
        input.platform_plan_fact && typeof input.platform_plan_fact === "object"
          ? (input.platform_plan_fact as Record<string, unknown>).visible_metrics
          : undefined,
      ),
    },
    channel_table: {
      visible_metrics: normalizePlanFactFields(
        input.channel_table && typeof input.channel_table === "object"
          ? (input.channel_table as Record<string, unknown>).visible_metrics
          : undefined,
      ),
    },
  };
}

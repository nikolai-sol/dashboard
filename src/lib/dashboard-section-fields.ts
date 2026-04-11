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

const POSTCLICK_SET = new Set<DashboardPostClickFieldId>(DEFAULT_POSTCLICK_FIELDS);
const PROMOPAGES_SET = new Set<DashboardPromopagesFieldId>(DEFAULT_PROMOPAGES_FIELDS);

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
    postclick_analytics: {
      visible_fields: normalizePostclickFields(postclickRaw.visible_fields),
    },
    promopages: {
      visible_metrics: normalizePromopagesFields(promopagesRaw.visible_metrics),
    },
  };
}

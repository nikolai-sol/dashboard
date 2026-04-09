import type { DashboardKind, DashboardSectionId } from "@/lib/types";

export const SPEND_RELATED_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);
export const PERFORMANCE_ONLY_SECTIONS: DashboardSectionId[] = [
  "conversion_funnel",
  "campaign_table",
  "scatter_plot",
];
export const SPEND_RELATED_SECTIONS = new Set<DashboardSectionId>([
  "spend_section",
  "campaign_table",
  "scatter_plot",
]);
export const OPTIONAL_SECTIONS: DashboardSectionId[] = ["promopages", "analytics"];

const DEFAULT_SECTIONS: Record<DashboardKind, DashboardSectionId[]> = {
  awareness: [
    "kpi_grid",
    "spend_section",
    "trend_chart",
    "platform_table",
    "platform_plan_fact",
    "channel_table",
    "plan_vs_fact",
  ],
  performance: [
    "kpi_grid",
    "conversion_funnel",
    "campaign_table",
    "spend_section",
    "trend_chart",
    "channel_table",
    "plan_vs_fact",
  ],
  overview: [
    "kpi_grid",
    "spend_section",
    "trend_chart",
    "platform_table",
    "platform_plan_fact",
    "channel_table",
    "plan_vs_fact",
  ],
  multibrand: [
    "kpi_grid",
    "spend_section",
    "trend_chart",
    "platform_table",
    "platform_plan_fact",
    "channel_table",
    "plan_vs_fact",
  ],
  abbott_bi: [
    "kpi_grid",
    "spend_section",
    "trend_chart",
    "platform_table",
    "platform_plan_fact",
    "channel_table",
    "plan_vs_fact",
  ],
};

export function getDefaultKpiCards(type: DashboardKind, showSpend: boolean): string[] {
  if (type === "performance") {
    return showSpend
      ? ["conversions", "cpa", "clicks", "cpc", "spend"]
      : ["conversions", "clicks", "ctr", "impressions", "reach"];
  }
  if (type === "overview") {
    return showSpend
      ? ["impressions", "clicks", "ctr", "spend", "conversions"]
      : ["impressions", "clicks", "ctr", "conversions", "reach"];
  }
  return showSpend
    ? ["impressions", "clicks", "ctr", "cpm", "spend"]
    : ["impressions", "clicks", "ctr", "views", "reach"];
}

export function getDefaultSectionOrder(type: DashboardKind, showSpend: boolean): DashboardSectionId[] {
  const allowed = DEFAULT_SECTIONS[type] ?? DEFAULT_SECTIONS.awareness;
  return allowed.filter((sectionId) => showSpend || !SPEND_RELATED_SECTIONS.has(sectionId));
}

export function sanitizeSectionOrder(
  raw: unknown,
  type: DashboardKind,
  showSpend: boolean,
  fillDefaults = true,
): DashboardSectionId[] {
  const defaults = getDefaultSectionOrder(type, showSpend);
  const allowed = [...defaults, ...OPTIONAL_SECTIONS.filter((item) => showSpend || !SPEND_RELATED_SECTIONS.has(item))];
  if (!Array.isArray(raw)) {
    return defaults;
  }
  const seen = new Set<DashboardSectionId>();
  const normalized = raw
    .map((item) => String(item) as DashboardSectionId)
    .filter((item) => allowed.includes(item) && !seen.has(item) && seen.add(item));
  return fillDefaults ? [...normalized, ...defaults.filter((item) => !seen.has(item))] : normalized;
}

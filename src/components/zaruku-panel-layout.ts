export type ZarukuPanelSize = "compact" | "half" | "wide" | "full";
export type ZarukuPanelHeight = "compact" | "standard" | "tall" | "auto";
export type ZarukuPanelTab = "overview" | "seo" | "content" | "audience" | "work" | "quality";

export type ZarukuPanelDefinition = {
  panelId: string;
  tabId: ZarukuPanelTab;
  defaultOrder: number;
  defaultSize: ZarukuPanelSize;
  allowedSizes: readonly ZarukuPanelSize[];
  height: ZarukuPanelHeight;
  movable: boolean;
  visible: boolean;
};

const ALL_SIZES = ["compact", "half", "wide", "full"] as const;
const CONTENT_SIZES = ["half", "wide", "full"] as const;
const WIDE_SIZES = ["wide", "full"] as const;

function panel(
  tabId: ZarukuPanelTab,
  name: string,
  defaultOrder: number,
  defaultSize: ZarukuPanelSize,
  height: ZarukuPanelHeight,
  allowedSizes: readonly ZarukuPanelSize[] = ALL_SIZES,
): ZarukuPanelDefinition {
  return {
    panelId: `${tabId}.${name}`,
    tabId,
    defaultOrder,
    defaultSize,
    allowedSizes,
    height,
    movable: true,
    visible: true,
  };
}

export const ZARUKU_PANEL_REGISTRY: readonly ZarukuPanelDefinition[] = [
  panel("overview", "north_star", 10, "full", "compact", ["full"]),
  panel("overview", "traffic_health", 20, "full", "compact", WIDE_SIZES),
  panel("overview", "channels", 30, "half", "standard", CONTENT_SIZES),
  panel("overview", "organic_search", 40, "half", "standard", CONTENT_SIZES),

  panel("seo", "executive_snapshot", 10, "full", "compact", WIDE_SIZES),
  panel("seo", "traffic_visibility", 20, "full", "standard", WIDE_SIZES),
  panel("seo", "ai_visibility", 30, "half", "standard", CONTENT_SIZES),
  panel("seo", "semantic_health", 40, "half", "standard", CONTENT_SIZES),
  panel("seo", "position_analytics", 50, "full", "tall", WIDE_SIZES),
  panel("seo", "query_comparison", 60, "full", "tall", ["full"]),
  panel("seo", "page_comparison", 70, "full", "tall", ["full"]),
  panel("seo", "diagnostics", 80, "full", "standard", WIDE_SIZES),

  panel("content", "status", 10, "full", "compact", WIDE_SIZES),
  panel("content", "popular_pages", 20, "half", "standard", CONTENT_SIZES),
  panel("content", "best_engagement", 30, "half", "standard", CONTENT_SIZES),
  panel("content", "bounce_risk", 40, "half", "standard", CONTENT_SIZES),
  panel("content", "returning", 50, "half", "standard", CONTENT_SIZES),
  panel("content", "all_pages", 60, "full", "tall", ["full"]),

  panel("audience", "map", 10, "full", "tall", WIDE_SIZES),
  panel("audience", "devices", 20, "half", "standard", CONTENT_SIZES),
  panel("audience", "technical", 30, "half", "standard", CONTENT_SIZES),
  panel("audience", "demographics", 40, "full", "standard", WIDE_SIZES),

  panel("work", "weekly_focus", 10, "full", "compact", WIDE_SIZES),
  panel("work", "opportunities", 20, "full", "tall", WIDE_SIZES),
  panel("work", "tasks", 30, "half", "standard", CONTENT_SIZES),
  panel("work", "rhythm", 40, "half", "standard", CONTENT_SIZES),

  panel("quality", "trust", 10, "full", "compact", WIDE_SIZES),
  panel("quality", "coverage", 20, "full", "standard", WIDE_SIZES),
  panel("quality", "freshness", 30, "full", "tall", WIDE_SIZES),
  panel("quality", "pending", 40, "full", "standard", WIDE_SIZES),
];

export function resolveZarukuPanels(tabId: ZarukuPanelTab): ZarukuPanelDefinition[] {
  return ZARUKU_PANEL_REGISTRY
    .filter((item) => item.tabId === tabId && item.visible)
    .sort((left, right) => left.defaultOrder - right.defaultOrder);
}

export function panelGridClass(size: ZarukuPanelSize): string {
  const span = {
    compact: "xl:col-span-3",
    half: "xl:col-span-6",
    wide: "xl:col-span-8",
    full: "xl:col-span-12",
  }[size];

  return `min-w-0 ${span}`;
}

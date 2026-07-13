import type { ZarukuSeoKpi } from "@/lib/types";
import type { NorthStarKpi, NorthStarKpis } from "@/components/zaruku-north-star";

export type NorthStarStripItem = {
  key: NorthStarKpi["key"];
  label: string;
  value: number | null;
  arrow: "↑" | "↓";
  delta: number | null;
  showDelta: boolean;
  deltaTone: "good" | "bad" | "neutral";
  tooltip: string;
};

export type TrafficHealthItem = {
  key: string;
  label: string;
  value: string;
};

const NORTH_STAR_LABELS: Record<NorthStarKpi["key"], string> = {
  noise: "Шум",
  medicalIntent: "Мед. интент",
  aiVisibility: "Алиса AI",
  approveRate: "Approve",
};

const PRIMARY_TRAFFIC_KEYS = ["visits", "users", "organic_share", "bounce", "avg_duration"];
const SECONDARY_TRAFFIC_KEYS = ["pageviews", "direct_share", "russia_share", "mobile_share", "depth"];
const TRAFFIC_LABELS: Record<string, string> = {
  visits: "Визиты",
  users: "Пользователи",
  pageviews: "Просмотры",
  organic_share: "Organic",
  direct_share: "Direct",
  russia_share: "Россия",
  mobile_share: "Mobile",
  avg_duration: "Время",
  bounce: "Отказы",
  depth: "Глубина",
};

function formatTooltipPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function deltaTone(kpi: NorthStarKpi) {
  if (kpi.delta == null || !Number.isFinite(kpi.delta) || Math.abs(kpi.delta) < 0.05) return "neutral";
  return kpi.goal === "up" ? (kpi.delta > 0 ? "good" : "bad") : kpi.delta < 0 ? "good" : "bad";
}

function tooltipForKpi(kpi: NorthStarKpi) {
  const parts = [
    kpi.tooltip,
    kpi.period ? `Окно: ${kpi.period}` : null,
    kpi.guardValue != null ? `guard clicks_share ${formatTooltipPercent(kpi.guardValue)}` : null,
    kpi.provenance ? `provenance ${kpi.provenance}` : null,
    kpi.note,
    "Корреляционные показатели.",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function buildNorthStarStripItems(kpis: NorthStarKpis): NorthStarStripItem[] {
  return Object.values(kpis).map((kpi) => ({
    key: kpi.key,
    label: NORTH_STAR_LABELS[kpi.key],
    value: kpi.value,
    arrow: kpi.goal === "down" ? "↓" : "↑",
    delta: kpi.delta,
    showDelta: kpi.delta != null && Number.isFinite(kpi.delta) && Math.abs(kpi.delta) >= 0.05,
    deltaTone: deltaTone(kpi),
    tooltip: tooltipForKpi(kpi),
  }));
}

function findKpi(kpis: ZarukuSeoKpi[], key: string): TrafficHealthItem | null {
  const kpi = kpis.find((item) => item.key === key);
  if (!kpi) return null;
  return {
    key,
    label: TRAFFIC_LABELS[key] ?? kpi.label,
    value: kpi.value,
  };
}

export function buildTrafficHealthRows(kpis: ZarukuSeoKpi[]) {
  return {
    primary: PRIMARY_TRAFFIC_KEYS.map((key) => findKpi(kpis, key)).filter((item): item is TrafficHealthItem => Boolean(item)),
    secondary: SECONDARY_TRAFFIC_KEYS.map((key) => findKpi(kpis, key)).filter((item): item is TrafficHealthItem => Boolean(item)),
  };
}

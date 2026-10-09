import type { ZarukuSeoKpi } from "@/lib/types";
import type { NorthStarKpi, NorthStarKpis } from "@/components/zaruku-north-star";
import { ZARUKU_NORTH_STAR_TOOLTIP_COPY } from "@/components/zaruku-client-copy";

export type NorthStarStripItem = {
  key: NorthStarKpi["key"];
  label: string;
  value: number | null;
  arrow: "↑" | "↓" | null;
  delta: number | null;
  showDelta: boolean;
  deltaTone: "good" | "bad" | "neutral";
  tooltipTitle: string;
  tooltipDescription: string;
  tooltipImportance: string;
  tooltip: string;
  period: string | null;
  source: NorthStarKpi["source"];
  comparisonPeriod: string | null;
  availabilityNote: string | null;
  visibleAvailability: string | null;
  comparisonState: "unavailable" | "unchanged" | "changed";
  guardValue: number | null;
  guardCount: number | null;
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
  approveRate: "Принято",
};

const OVERVIEW_NORTH_STAR_KEYS: Array<NorthStarKpi["key"]> = ["noise", "medicalIntent", "aiVisibility"];

const PRIMARY_TRAFFIC_KEYS = ["visits", "users", "organic_share", "bounce", "avg_duration"];
const SECONDARY_TRAFFIC_KEYS = ["pageviews", "direct_share", "russia_share", "mobile_share", "depth"];
const TRAFFIC_LABELS: Record<string, string> = {
  visits: "Визиты",
  users: "Пользователи",
  pageviews: "Просмотры",
  organic_share: "Органика",
  direct_share: "Прямые",
  russia_share: "Россия",
  mobile_share: "Мобильные",
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
    kpi.source === "webmaster_intent" ? "Яндекс Вебмастер" : null,
    kpi.tooltip,
    kpi.note,
    kpi.period ? `Период: ${kpi.period}` : null,
    kpi.comparisonPeriod ? `Сравнение: ${kpi.comparisonPeriod}` : null,
    kpi.availabilityNote,
    kpi.guardValue != null ? `контроль кликов ${formatTooltipPercent(kpi.guardValue)}` : null,
    "Корреляционные показатели.",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function buildNorthStarStripItems(kpis: NorthStarKpis): NorthStarStripItem[] {
  return OVERVIEW_NORTH_STAR_KEYS.map((key) => kpis[key]).map((kpi) => ({
    key: kpi.key,
    label: NORTH_STAR_LABELS[kpi.key],
    value: kpi.value,
    source: kpi.source,
    period: kpi.period,
    comparisonPeriod: kpi.comparisonPeriod ?? null,
    availabilityNote: kpi.availabilityNote ?? null,
    visibleAvailability: kpi.visibleAvailability ?? null,
    comparisonState: kpi.delta == null ? "unavailable" : Math.abs(kpi.delta) < 0.05 ? "unchanged" : "changed",
    guardValue: kpi.guardValue ?? null,
    guardCount: kpi.guardCount ?? null,
    arrow: kpi.delta != null && Number.isFinite(kpi.delta) && Math.abs(kpi.delta) >= 0.05 ? (kpi.delta > 0 ? "↑" : "↓") : null,
    delta: kpi.delta,
    showDelta: kpi.delta != null && Number.isFinite(kpi.delta) && Math.abs(kpi.delta) >= 0.05,
    deltaTone: deltaTone(kpi),
    tooltipTitle: ZARUKU_NORTH_STAR_TOOLTIP_COPY[kpi.key].title,
    tooltipDescription: kpi.source === "alice_official" ? "Официальная SoV из Яндекс Вебмастера; она отличается от доли присутствия в строках выгрузки." : ZARUKU_NORTH_STAR_TOOLTIP_COPY[kpi.key].description,
    tooltipImportance: ZARUKU_NORTH_STAR_TOOLTIP_COPY[kpi.key].importance,
    tooltip: tooltipForKpi(kpi),
  }));
}

function findKpi(kpis: ZarukuSeoKpi[], key: string): TrafficHealthItem | null {
  const kpi = kpis.find((item) => item.key === key);
  if (!kpi) return null;
  const valueText = String(kpi.value).trim();
  if (valueText === "—" || valueText.length === 0) {
    return null;
  }
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

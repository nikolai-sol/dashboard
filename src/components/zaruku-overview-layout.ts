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
  tooltipTitle: string;
  tooltipDescription: string;
  tooltipImportance: string;
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
  approveRate: "Принято",
};

const NORTH_STAR_TOOLTIP_COPY: Record<NorthStarKpi["key"], { title: string; description: string; importance: string }> = {
  noise: {
    title: "Что такое шум",
    description: "Доля показов по чужим брендам лабораторий и организаций, где портал виден не за счёт собственных медицинских тем.",
    importance: "Почему важно: если шум высокий, основная видимость уходит в нерелевантную конкуренцию, а показы хуже превращаются в целевой спрос.",
  },
  medicalIntent: {
    title: "Что такое медицинский интент",
    description: "Доля показов по запросам, где пользователь ищет медицинскую информацию, маршрутизацию или помощь по онкологическим темам.",
    importance: "Почему важно: рост этой доли показывает, что SEO приводит целевой органический трафик, а не просто увеличивает общий объём показов.",
  },
  aiVisibility: {
    title: "Что такое Алиса AI",
    description: "Доля проверенных AI-сценариев, где портал «За руку» присутствует в ответе Алисы или связанном источнике.",
    importance: "Почему важно: присутствие в ИИ-ответах становится отдельным каналом видимости до клика и влияет на то, какие источники пользователь увидит первыми.",
  },
  approveRate: {
    title: "Что такое доля принятия",
    description: "Доля SEO-возможностей, которые прошли отбор и были приняты в работу среди принятых и отклонённых решений недели.",
    importance: "Почему важно: это скорость превращения инсайтов SEO OS в реальные задачи без перегруза команды нерелевантными рекомендациями.",
  },
};

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
    kpi.tooltip,
    kpi.period ? `Окно: ${kpi.period}` : null,
    kpi.guardValue != null ? `контроль кликов ${formatTooltipPercent(kpi.guardValue)}` : null,
    kpi.provenance ? `источник данных ${kpi.provenance}` : null,
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
    tooltipTitle: NORTH_STAR_TOOLTIP_COPY[kpi.key].title,
    tooltipDescription: NORTH_STAR_TOOLTIP_COPY[kpi.key].description,
    tooltipImportance: NORTH_STAR_TOOLTIP_COPY[kpi.key].importance,
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

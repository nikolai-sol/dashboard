import { ACTIVE_PLATFORM_IDS, PLATFORM_COLORS } from "@/lib/platform-colors";
import type { DashboardData, PlanVsFactRow, PlatformStats, TimeSeriesPoint } from "@/lib/types";

type Profile = {
  platform: string;
  cpmMin: number;
  cpmMax: number;
  ctrMin: number;
  ctrMax: number;
  budgetPlan: number;
  budgetFact: number;
  targetCpm: number;
};

const PROFILES: Profile[] = [
  {
    platform: "linkedin",
    cpmMin: 25,
    cpmMax: 35,
    ctrMin: 0.5,
    ctrMax: 1.5,
    budgetPlan: 5200,
    budgetFact: 4890,
    targetCpm: 29.8,
  },
  {
    platform: "reddit",
    cpmMin: 8,
    cpmMax: 15,
    ctrMin: 0.3,
    ctrMax: 0.8,
    budgetPlan: 3200,
    budgetFact: 2910,
    targetCpm: 11.2,
  },
  {
    platform: "meta",
    cpmMin: 12,
    cpmMax: 20,
    ctrMin: 0.8,
    ctrMax: 1.5,
    budgetPlan: 5100,
    budgetFact: 5340,
    targetCpm: 15.6,
  },
  {
    platform: "google",
    cpmMin: 3,
    cpmMax: 8,
    ctrMin: 0.3,
    ctrMax: 0.5,
    budgetPlan: 3900,
    budgetFact: 3640,
    targetCpm: 5.3,
  },
  {
    platform: "git",
    cpmMin: 2,
    cpmMax: 5,
    ctrMin: 0.1,
    ctrMax: 0.3,
    budgetPlan: 2400,
    budgetFact: 2060,
    targetCpm: 3.3,
  },
  {
    platform: "vk",
    cpmMin: 1,
    cpmMax: 3,
    ctrMin: 0.2,
    ctrMax: 0.5,
    budgetPlan: 1700,
    budgetFact: 1510,
    targetCpm: 2.0,
  },
];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function buildDateRange(from: string, to: string): string[] {
  const list: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (cur <= end) {
    list.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return list;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function generateTimeSeries(): TimeSeriesPoint[] {
  const rng = seededRandom(20250310);
  const dates = buildDateRange("2025-01-01", "2025-03-31");
  const points: TimeSeriesPoint[] = [];

  PROFILES.forEach((profile) => {
    const rawWeights = dates.map((date, idx) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekdayBoost = weekday === 0 || weekday === 6 ? 0.82 : 1.06;
      const monthBoost = 0.9 + (idx / dates.length) * 0.28;
      const pulse = 0.92 + Math.sin((idx / 14) * Math.PI) * 0.12;
      const noise = 0.88 + rng() * 0.34;
      return weekdayBoost * monthBoost * pulse * noise;
    });

    const totalWeight = rawWeights.reduce((sum, value) => sum + value, 0);
    dates.forEach((date, idx) => {
      const spend = (profile.budgetFact * rawWeights[idx]) / totalWeight;
      const cpm = profile.cpmMin + rng() * (profile.cpmMax - profile.cpmMin);
      const ctrPct = profile.ctrMin + rng() * (profile.ctrMax - profile.ctrMin);
      const impressions = Math.max(10, Math.round((spend / cpm) * 1000));
      const clicks = Math.max(1, Math.round(impressions * (ctrPct / 100)));

      points.push({
        date,
        platform: profile.platform,
        impressions,
        clicks,
        spend: Number(spend.toFixed(2)),
      });
    });
  });

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function aggregatePlatform(points: TimeSeriesPoint[]): PlatformStats[] {
  const byPlatform = new Map<string, PlatformStats>();
  const rng = seededRandom(7788);

  points.forEach((point) => {
    if (!byPlatform.has(point.platform)) {
      const color = PLATFORM_COLORS[point.platform]?.hex ?? "#64748b";
      const name = PLATFORM_COLORS[point.platform]?.label ?? point.platform;
      byPlatform.set(point.platform, {
        id: point.platform,
        name,
        color,
        impressions: 0,
        clicks: 0,
        spend: 0,
        ctr: 0,
        cpm: 0,
        conversions: 0,
      });
    }

    const stat = byPlatform.get(point.platform)!;
    stat.impressions += point.impressions;
    stat.clicks += point.clicks;
    stat.spend += point.spend;
  });

  return [...byPlatform.values()].map((stat) => {
    const ctr = stat.impressions > 0 ? (stat.clicks / stat.impressions) * 100 : 0;
    const cpm = stat.impressions > 0 ? (stat.spend / stat.impressions) * 1000 : 0;
    const baseCvRate = clamp(0.015 + rng() * 0.02, 0.01, 0.05);
    return {
      ...stat,
      spend: Number(stat.spend.toFixed(2)),
      ctr: Number(ctr.toFixed(2)),
      cpm: Number(cpm.toFixed(2)),
      conversions: Math.round(stat.clicks * baseCvRate),
    };
  });
}

function buildPlanVsFact(platforms: PlatformStats[]): PlanVsFactRow[] {
  return PROFILES.map((profile) => {
    const stats = platforms.find((item) => item.id === profile.platform)!;
    const impressionsPlan = Math.round((profile.budgetPlan / profile.targetCpm) * 1000);
    const cpmFact = stats.impressions > 0 ? (stats.spend / stats.impressions) * 1000 : 0;
    return {
      platform: profile.platform,
      platform_label: PLATFORM_COLORS[profile.platform].label,
      color: PLATFORM_COLORS[profile.platform].hex,
      budget_plan: profile.budgetPlan,
      budget_fact: Number(stats.spend.toFixed(2)),
      impressions_plan: impressionsPlan,
      impressions_fact: stats.impressions,
      cpm_plan: profile.targetCpm,
      cpm_fact: Number(cpmFact.toFixed(2)),
      pacing: Number((stats.spend / profile.budgetPlan).toFixed(3)),
    };
  });
}

function buildKpi(platforms: PlatformStats[]) {
  const totalImpressions = platforms.reduce((sum, item) => sum + item.impressions, 0);
  const totalClicks = platforms.reduce((sum, item) => sum + item.clicks, 0);
  const totalSpend = platforms.reduce((sum, item) => sum + item.spend, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;

  return {
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    total_spend: Number(totalSpend.toFixed(2)),
    avg_ctr: Number(avgCtr.toFixed(2)),
    avg_cpm: Number(avgCpm.toFixed(2)),
    prev_impressions: Math.round(totalImpressions * 0.91),
    prev_clicks: Math.round(totalClicks * 0.88),
    prev_spend: Number((totalSpend * 0.94).toFixed(2)),
    prev_ctr: Number((avgCtr * 0.96).toFixed(2)),
    prev_cpm: Number((avgCpm * 1.03).toFixed(2)),
  };
}

const timeseries = generateTimeSeries();
const platforms = aggregatePlatform(timeseries).filter((item) => ACTIVE_PLATFORM_IDS.includes(item.id));
const planVsFact = buildPlanVsFact(platforms);
const kpi = buildKpi(platforms);

export const mockDashboardData: DashboardData = {
  dashboard: {
    client_name: "RAG_MP",
    dashboard_name: "Awareness Campaign Q1 2025",
    type: "awareness",
    period: {
      from: "2025-01-01",
      to: "2025-03-31",
    },
    currency: "EUR",
  },
  kpi,
  platforms,
  timeseries,
  plan_vs_fact: planVsFact,
};

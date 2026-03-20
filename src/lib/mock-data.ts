import { ACTIVE_PLATFORM_IDS, PLATFORM_COLORS } from "@/lib/platform-colors";
import type {
  ChannelPerformanceItem,
  DashboardData,
  PlanVsFactItem,
  PlatformStats,
  TimeSeriesPoint,
} from "@/lib/types";

type Profile = {
  platform: string;
  cpmMin: number;
  cpmMax: number;
  ctrMin: number;
  ctrMax: number;
  budgetPlan: number;
  budgetFact: number;
};

type PlanBlueprint = {
  channel: string;
  buyType: "CPM" | "CPC" | "CPV" | "CPA";
  impressionsPlan?: number;
  clicksPlan?: number;
  viewsPlan?: number;
  conversionsPlan?: number;
  reachPlan?: number;
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
  },
  {
    platform: "reddit",
    cpmMin: 8,
    cpmMax: 15,
    ctrMin: 0.3,
    ctrMax: 0.8,
    budgetPlan: 3200,
    budgetFact: 2910,
  },
  {
    platform: "meta",
    cpmMin: 12,
    cpmMax: 20,
    ctrMin: 0.8,
    ctrMax: 1.5,
    budgetPlan: 5100,
    budgetFact: 5340,
  },
  {
    platform: "google",
    cpmMin: 3,
    cpmMax: 8,
    ctrMin: 0.3,
    ctrMax: 0.5,
    budgetPlan: 3900,
    budgetFact: 3640,
  },
  {
    platform: "git",
    cpmMin: 2,
    cpmMax: 5,
    ctrMin: 0.1,
    ctrMax: 0.3,
    budgetPlan: 2400,
    budgetFact: 2060,
  },
  {
    platform: "vk",
    cpmMin: 1,
    cpmMax: 3,
    ctrMin: 0.2,
    ctrMax: 0.5,
    budgetPlan: 1700,
    budgetFact: 1510,
  },
];

const PLAN_BLUEPRINTS: Record<string, PlanBlueprint> = {
  linkedin: {
    channel: "LinkedIn Lead Gen",
    buyType: "CPA",
    impressionsPlan: 150000,
    clicksPlan: 2250,
    conversionsPlan: 500,
    reachPlan: 50000,
  },
  reddit: {
    channel: "Reddit Contextual",
    buyType: "CPC",
    impressionsPlan: 285000,
    clicksPlan: 1850,
    reachPlan: 110000,
  },
  meta: {
    channel: "Meta Video Views",
    buyType: "CPV",
    impressionsPlan: 340000,
    clicksPlan: 3100,
    viewsPlan: 178000,
    reachPlan: 120000,
  },
  google: {
    channel: "Google Display Awareness",
    buyType: "CPM",
    impressionsPlan: 730000,
    clicksPlan: 2500,
    reachPlan: 300000,
  },
  git: {
    channel: "Programmatic OLV",
    buyType: "CPV",
    impressionsPlan: 660000,
    clicksPlan: 1600,
    viewsPlan: 420000,
    reachPlan: 220000,
  },
  vk: {
    channel: "VK Feed Posts",
    buyType: "CPC",
    impressionsPlan: 710000,
    clicksPlan: 4100,
    reachPlan: 175000,
  },
};

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
        views: 0,
        reach: 0,
        frequency: 0,
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
    const reach = Math.max(1, Math.round(stat.impressions * clamp(0.32 + rng() * 0.18, 0.2, 0.65)));
    const views = Math.round(stat.impressions * clamp(0.12 + rng() * 0.2, 0.05, 0.45));
    return {
      ...stat,
      spend: Number(stat.spend.toFixed(2)),
      ctr: Number(ctr.toFixed(2)),
      cpm: Number(cpm.toFixed(2)),
      conversions: Math.round(stat.clicks * baseCvRate),
      views,
      reach,
      frequency: Number((stat.impressions / Math.max(reach, 1)).toFixed(2)),
    };
  });
}

function buildPlanVsFact(platforms: PlatformStats[]): PlanVsFactItem[] {
  return PROFILES.map((profile) => {
    const stats = platforms.find((item) => item.id === profile.platform)!;
    const blueprint = PLAN_BLUEPRINTS[profile.platform];

    const budgetPlan = profile.budgetPlan;
    const impressionsPlan = blueprint.impressionsPlan ?? Math.round((budgetPlan / 8) * 1000);
    const reachPlan = blueprint.reachPlan ?? Math.max(1, Math.round(impressionsPlan * 0.45));
    const clicksPlan = blueprint.clicksPlan ?? Math.round(impressionsPlan * 0.008);
    const viewsPlan = blueprint.viewsPlan ?? Math.round(impressionsPlan * 0.2);
    const conversionsPlan = blueprint.conversionsPlan ?? Math.round(clicksPlan * 0.05);

    const frequencyPlan = reachPlan > 0 ? impressionsPlan / reachPlan : 0;
    const cpmPlan = impressionsPlan > 0 ? (budgetPlan / impressionsPlan) * 1000 : 0;
    const cpcPlan = clicksPlan > 0 ? budgetPlan / clicksPlan : 0;
    const cpvPlan = viewsPlan > 0 ? budgetPlan / viewsPlan : 0;
    const cpaPlan = conversionsPlan > 0 ? budgetPlan / conversionsPlan : 0;

    const cpmFact = stats.impressions > 0 ? (stats.spend / stats.impressions) * 1000 : 0;
    const cpcFact = stats.clicks > 0 ? stats.spend / stats.clicks : 0;
    const cpvFact = stats.views > 0 ? stats.spend / stats.views : 0;
    const cpaFact = stats.conversions > 0 ? stats.spend / stats.conversions : 0;

    return {
      channel: blueprint.channel,
      instrument: profile.platform.toUpperCase(),
      format: "",
      buy_type: blueprint.buyType,
      platforms: [
        {
          source_key: profile.platform,
          label: PLATFORM_COLORS[profile.platform].label,
          color: PLATFORM_COLORS[profile.platform].hex,
        },
      ],
      campaign_count: 1,
      budget_plan: Number(budgetPlan.toFixed(2)),
      impressions_plan: impressionsPlan,
      reach_plan: reachPlan,
      clicks_plan: clicksPlan,
      views_plan: viewsPlan,
      conversions_plan: conversionsPlan,
      monthly_plan: {},
      monthly_breakdown: {},
      budget_fact: Number(stats.spend.toFixed(2)),
      pacing: budgetPlan > 0 ? Number((stats.spend / budgetPlan).toFixed(3)) : 0,
      impressions_fact: stats.impressions,
      reach_fact: stats.reach,
      clicks_fact: stats.clicks,
      views_fact: stats.views,
      conversions_fact: stats.conversions,
      frequency_plan: Number(frequencyPlan.toFixed(4)),
      frequency_fact: stats.frequency,
      cpm_plan: Number(cpmPlan.toFixed(2)),
      cpm_fact: Number(cpmFact.toFixed(2)),
      cpc_plan: Number(cpcPlan.toFixed(2)),
      cpc_fact: Number(cpcFact.toFixed(2)),
      cpv_plan: Number(cpvPlan.toFixed(4)),
      cpv_fact: Number(cpvFact.toFixed(4)),
      cpa_plan: Number(cpaPlan.toFixed(2)),
      cpa_fact: Number(cpaFact.toFixed(2)),
    };
  });
}

function buildChannelPerformance(rows: PlanVsFactItem[]): ChannelPerformanceItem[] {
  return rows.map((row) => ({
    channel: row.channel,
    instrument: row.instrument,
    buy_type: row.buy_type,
    platforms: row.platforms,
    campaign_count: row.campaign_count,
    plan_only: row.campaign_count === 0,
    metrics: {
      impressions: { fact: row.impressions_fact, plan: row.impressions_plan, completion_pct: row.impressions_plan > 0 ? (row.impressions_fact / row.impressions_plan) * 100 : null, status: null },
      reach: { fact: row.reach_fact, plan: row.reach_plan, completion_pct: row.reach_plan > 0 ? (row.reach_fact / row.reach_plan) * 100 : null, status: null },
      frequency: { fact: row.frequency_fact, plan: row.frequency_plan, completion_pct: row.frequency_plan > 0 ? (row.frequency_fact / row.frequency_plan) * 100 : null, status: null },
      clicks: { fact: row.clicks_fact, plan: row.clicks_plan, completion_pct: row.clicks_plan > 0 ? (row.clicks_fact / row.clicks_plan) * 100 : null, status: null },
      views: { fact: row.views_fact, plan: row.views_plan, completion_pct: row.views_plan > 0 ? (row.views_fact / row.views_plan) * 100 : null, status: null },
      conversions: { fact: row.conversions_fact, plan: row.conversions_plan, completion_pct: row.conversions_plan > 0 ? (row.conversions_fact / row.conversions_plan) * 100 : null, status: null },
      spend: { fact: row.budget_fact, plan: row.budget_plan, completion_pct: row.budget_plan > 0 ? (row.budget_fact / row.budget_plan) * 100 : null, status: null },
      ctr: { fact: row.impressions_fact > 0 ? (row.clicks_fact / row.impressions_fact) * 100 : 0, plan: row.impressions_plan > 0 ? (row.clicks_plan / row.impressions_plan) * 100 : 0, completion_pct: null, status: null },
      cpm: { fact: row.cpm_fact, plan: row.cpm_plan, completion_pct: null, status: null },
      cpc: { fact: row.cpc_fact, plan: row.cpc_plan, completion_pct: null, status: null },
      cpv: { fact: row.cpv_fact, plan: row.cpv_plan, completion_pct: null, status: null },
      cpa: { fact: row.cpa_fact, plan: row.cpa_plan, completion_pct: null, status: null },
    },
  }));
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
const channelPerformance = buildChannelPerformance(planVsFact);
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
    language: "en",
    show_spend: true,
    filter_scope: "both",
    section_order: ["kpi_grid", "spend_section", "trend_chart", "platform_table", "platform_plan_fact", "channel_table", "plan_vs_fact"],
  },
  kpi_config: ["impressions", "clicks", "ctr", "cpm", "spend"],
  kpi,
  platforms,
  timeseries,
  plan_vs_fact: planVsFact,
  channel_performance: channelPerformance,
};

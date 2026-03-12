export type DashboardKind = "awareness" | "performance" | "overview";

export interface DashboardMeta {
  client_name: string;
  dashboard_name: string;
  type: DashboardKind;
  period: {
    from: string;
    to: string;
  };
  currency: string;
}

export interface DashboardKPI {
  total_impressions: number;
  total_clicks: number;
  total_spend: number;
  avg_ctr: number;
  avg_cpm: number;
  prev_impressions: number;
  prev_clicks: number;
  prev_spend: number;
  prev_ctr: number;
  prev_cpm: number;
}

export interface PlatformStats {
  id: string;
  name: string;
  color: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpm: number;
  conversions: number;
  views: number;
  reach: number;
  frequency: number;
}

export interface TimeSeriesPoint {
  date: string;
  platform: string;
  impressions: number;
  clicks: number;
  spend: number;
}

export interface PlanVsFactRow {
  channel: string;
  buy_type: string;
  platforms: string[];
  platform_colors: string[];
  budget_plan: number;
  budget_fact: number;
  pacing: number;
  impressions_plan: number;
  impressions_fact: number;
  clicks_plan: number;
  clicks_fact: number;
  views_plan: number;
  views_fact: number;
  conversions_plan: number;
  conversions_fact: number;
  cpm_plan: number;
  cpm_fact: number;
  cpc_plan: number;
  cpc_fact: number;
  cpv_plan: number;
  cpv_fact: number;
  cpa_plan: number;
  cpa_fact: number;
}

export interface DashboardData {
  dashboard: DashboardMeta;
  kpi_config: string[];
  kpi: DashboardKPI;
  platforms: PlatformStats[];
  timeseries: TimeSeriesPoint[];
  plan_vs_fact: PlanVsFactRow[];
}

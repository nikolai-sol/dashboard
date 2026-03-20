import type { DashboardLanguage } from "@/lib/dashboard-i18n";

export type DashboardKind = "awareness" | "performance" | "overview";
export type DashboardSectionId =
  | "kpi_grid"
  | "spend_section"
  | "trend_chart"
  | "channel_table"
  | "plan_vs_fact"
  | "platform_plan_fact"
  | "platform_table";

export interface DashboardMeta {
  client_name: string;
  dashboard_name: string;
  logo_url?: string | null;
  type: DashboardKind;
  period: {
    from: string;
    to: string;
  };
  currency: string;
  language: DashboardLanguage;
  show_spend: boolean;
  filter_scope: "both" | "platform" | "channel";
  section_order: DashboardSectionId[];
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

export interface PlanVsFactItem {
  channel: string;
  instrument: string;
  format: string;
  buy_type: string;
  platforms: Array<{ source_key: string; label: string; color: string }>;
  campaign_count: number;

  budget_plan: number;
  impressions_plan: number;
  reach_plan: number;
  clicks_plan: number;
  views_plan: number;
  conversions_plan: number;
  monthly_plan: Record<string, number>;
  monthly_breakdown: Record<
    string,
    {
      units: number;
      budget: number;
      impressions: number;
      clicks: number;
      views: number;
      conversions: number;
      reach: number;
      ctr: number;
    }
  >;

  budget_fact: number;
  impressions_fact: number;
  reach_fact: number;
  clicks_fact: number;
  views_fact: number;
  conversions_fact: number;

  pacing: number;
  frequency_plan: number;
  frequency_fact: number;

  cpm_plan: number;
  cpm_fact: number;
  cpc_plan: number;
  cpc_fact: number;
  cpv_plan: number;
  cpv_fact: number;
  cpa_plan: number;
  cpa_fact: number;
}

export interface ChannelPerformanceMetric {
  fact: number;
  plan: number;
  completion_pct: number | null;
  status?: "green" | "yellow" | "red" | null;
}

export interface ChannelPerformanceMonth {
  month: string;
  from: string;
  to: string;
  metrics: Partial<
    Record<
      "impressions" | "reach" | "frequency" | "clicks" | "views" | "conversions" | "spend" | "ctr" | "cpm" | "cpc" | "cpv" | "cpa",
      ChannelPerformanceMetric
    >
  >;
}

export interface ChannelPerformanceItem {
  channel: string;
  instrument: string;
  buy_type: string;
  platforms: Array<{ source_key: string; label: string; color: string }>;
  campaign_count: number;
  plan_only: boolean;
  metrics: Partial<
    Record<
      "impressions" | "reach" | "frequency" | "clicks" | "views" | "conversions" | "spend" | "ctr" | "cpm" | "cpc" | "cpv" | "cpa",
      ChannelPerformanceMetric
    >
  >;
  months?: ChannelPerformanceMonth[];
}

export interface AnalyticsKPI {
  total_visits: number;
  total_users: number;
  total_pageviews: number;
  avg_bounce_rate: number;
  avg_visit_duration: number;
}

export interface AnalyticsTimeSeriesPoint {
  date: string;
  visits: number;
  users: number;
  pageviews: number;
  bounce_rate: number;
}

export interface CustomTableData {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface ManualChannelData {
  platform: string;
  channel: string;
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
  sessions: number;
}

export interface DashboardData {
  dashboard: DashboardMeta;
  kpi_config: string[];
  kpi: DashboardKPI;
  platforms: PlatformStats[];
  timeseries: TimeSeriesPoint[];
  plan_vs_fact: PlanVsFactItem[];
  channel_performance?: ChannelPerformanceItem[];
  custom_tables?: CustomTableData[];
  manual_channels?: ManualChannelData[];
  manual_table_title?: string;
  analytics?: {
    kpi: AnalyticsKPI;
    timeseries: AnalyticsTimeSeriesPoint[];
  };
  // optional channel timeseries for future "by channel" view
  channel_timeseries?: Array<{
    date: string;
    channel: string;
    instrument?: string;
    impressions: number;
    reach?: number;
    clicks: number;
    spend: number;
    views: number;
    conversions: number;
  }>;
}

import type { DashboardLanguage } from "@/lib/dashboard-i18n";
import type { DashboardMetrikaTrafficMetricId } from "@/lib/admin-ui-types";
import type { MultibrandConfig } from "@/lib/multibrand";

export type DashboardKind = "awareness" | "performance" | "overview" | "multibrand" | "abbott_bi";
export type DashboardSectionId =
  | "kpi_grid"
  | "spend_section"
  | "trend_chart"
  | "analytics"
  | "postclick_analytics"
  | "conversion_funnel"
  | "campaign_table"
  | "scatter_plot"
  | "channel_table"
  | "plan_vs_fact"
  | "platform_plan_fact"
  | "platform_table"
  | "promopages";

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
  multibrand?: (MultibrandConfig & { active_brand_id?: string | null }) | null;
}

export interface CustomKpiCard {
  id: string;
  title: string;
  value: number;
  trend_source: string;
}

export interface DashboardKPI {
  total_impressions: number;
  total_clicks: number;
  total_spend: number;
  total_conversions: number;
  avg_ctr: number;
  avg_cpm: number;
  prev_impressions: number;
  prev_clicks: number;
  prev_spend: number;
  prev_conversions: number;
  prev_ctr: number;
  prev_cpm: number;
}

export interface ComparisonMetricDelta {
  value_a: number;
  value_b: number;
  delta: number;
  delta_pct: number;
  direction: "up" | "down" | "same";
}

export interface ComparisonPlatformMetrics {
  [metric: string]: ComparisonMetricDelta;
}

export interface ComparisonPlatformItem {
  platform: string;
  platform_label: string;
  color: string;
  metrics: ComparisonPlatformMetrics;
}

export interface ComparisonChannelItem {
  channel: string;
  instrument?: string;
  metrics: ComparisonPlatformMetrics;
}

export interface ComparisonTimeSeriesPoint {
  date: string;
  day_index: number;
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
}

export interface ComparisonData {
  period_a: { from: string; to: string; label: string };
  period_b: { from: string; to: string; label: string };
  kpi_comparison: Record<string, ComparisonMetricDelta>;
  platforms_comparison: ComparisonPlatformItem[];
  channels_comparison: ComparisonChannelItem[];
  timeseries_b: ComparisonTimeSeriesPoint[];
  timeseries_b_raw: TimeSeriesPoint[];
  channel_timeseries_b: Array<{
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

export interface FunnelStep {
  id: string;
  label: string;
  value: number;
  conversion_rate?: number;
}

export interface CampaignBreakdownItem {
  campaign_id: string;
  campaign_name: string;
  source_key: string;
  platform_label: string;
  platform_color: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  cpa: number;
  cpc: number;
  ctr: number;
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
  views?: number;
  conversions?: number;
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

export interface DashboardAnalyticsData {
  kpi: AnalyticsKPI;
  timeseries: AnalyticsTimeSeriesPoint[];
  selected_metrics?: DashboardMetrikaTrafficMetricId[];
}

export interface PostClickAnalyticsRow {
  line_key: string;
  channel: string;
  instrument: string;
  buy_type: string;
  utm_sources: string[];
  visits: number;
  users: number;
  pageviews: number;
  goal_reaches: number;
  bounce_rate: number;
  avg_visit_duration: number;
  conversion_rate: number;
}

export interface PostClickAnalyticsTimeSeriesPoint {
  date: string;
  line_key: string;
  channel: string;
  visits: number;
  users: number;
  pageviews: number;
  goal_reaches: number;
  bounce_rate: number;
  avg_visit_duration: number;
  conversion_rate: number;
}

export interface AbbottBiUserSummaryRow {
  user_id: string;
  traffic_source: string;
  direction: string | null;
  visits: number;
  users: number;
  new_users: number;
  page_depth: number;
  avg_duration: number;
  bounce_rate: number;
}

export interface AbbottBiUserActionRow {
  user_id: string;
  traffic_source: string;
  direction: string | null;
  start_url: string;
  end_url: string;
  visits: number;
  page_depth: number;
  avg_duration: number;
}

export interface AbbottBiPageStatRow {
  page_title: string;
  url: string;
  direction: string | null;
  material_type: string | null;
  access: string | null;
  pageviews: number;
  users: number;
}

export interface AbbottBiExternalEventRow {
  title: string;
  direction: string | null;
  registration_url: string;
  access: string | null;
}

export interface AbbottBiExternalClickRow {
  title: string | null;
  direction: string | null;
  external_url: string;
  outbound_clicks: number;
}

export interface AbbottBiTimeBucketRow {
  bucket_id: "lt_1m" | "1_2m" | "2_5m" | "gt_5m";
  label: string;
  users: number;
}

export interface AbbottBiTimeBucketPage {
  url: string;
  buckets: AbbottBiTimeBucketRow[];
}

export interface AbbottBiTimeBuckets {
  overall: AbbottBiTimeBucketRow[];
  materials: AbbottBiTimeBucketRow[];
  by_page: AbbottBiTimeBucketPage[];
}

export interface AbbottBiReturningRow {
  url: string;
  direction: string | null;
  visits: number;
  returning_1_day: number;
  returning_2_7_days: number;
  returning_8_31_days: number;
}

export interface AbbottBiMaterialRow {
  material_name: string;
  url: string;
  pageviews: number;
  users: number;
}

export interface AbbottBiData {
  counters: string[];
  users_summary: AbbottBiUserSummaryRow[];
  user_actions: AbbottBiUserActionRow[];
  page_stats: AbbottBiPageStatRow[];
  external_events: AbbottBiExternalEventRow[];
  external_clicks: AbbottBiExternalClickRow[];
  time_buckets: AbbottBiTimeBuckets;
  returning: AbbottBiReturningRow[];
  general_materials: AbbottBiMaterialRow[];
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
  reach: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
  sessions: number;
}

export interface PromopagesKPI {
  total_impressions: number;
  total_reach: number;
  total_views: number;
  total_clicks: number;
  total_budget: number;
  avg_ctr: number;
  avg_cpm: number;
  total_clickouts: number;
  total_full_reads: number;
  total_metrica_visits: number;
}

export interface PromopagesCampaignItem {
  platform_account_id: string;
  account_name: string;
  platform_campaign_id: string;
  campaign_name: string;
  report_date?: string;
  impressions: number;
  reach: number;
  views: number;
  clicks: number;
  ctr: number;
  budget: number;
  cpm: number;
  clickouts: number;
  clickout_cost: number;
  clickout_percent: number;
  full_reads: number;
  full_read_percent: number;
  full_read_time_sec: number;
  metrica_visits: number;
  metrica_visit_percent: number;
  metrica_visit_cost: number;
}

export interface PromopagesTimeSeriesPoint {
  date: string;
  impressions: number;
  reach: number;
  views: number;
  clicks: number;
  budget: number;
  clickouts: number;
  full_reads: number;
  metrica_visits: number;
}

export interface PromopagesData {
  kpi: PromopagesKPI;
  timeseries: PromopagesTimeSeriesPoint[];
  campaigns: PromopagesCampaignItem[];
}

export interface BoundPromopagesChannelOverlay {
  channel: string;
  instrument: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  views: number;
}

export interface BoundPromopagesTimeSeriesOverlay {
  date: string;
  channel: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  views: number;
}

export type DashboardAiSummaryStatus = "ready" | "unavailable" | "timeout" | "error";

export type DashboardAiSummaryReason =
  | "insufficient_data"
  | "provider_not_configured"
  | "request_failed"
  | "invalid_response"
  | "response_empty"
  | "timeout";

export interface DashboardAiSummary {
  status: DashboardAiSummaryStatus;
  headline?: string;
  bullets?: string[];
  watchout?: string | null;
  reason?: DashboardAiSummaryReason;
  generated_at?: string;
}

export interface DashboardData {
  dashboard: DashboardMeta;
  kpi_config: string[];
  visible_metrics?: string[];
  custom_kpi_cards?: CustomKpiCard[];
  kpi: DashboardKPI;
  platforms: PlatformStats[];
  timeseries: TimeSeriesPoint[];
  plan_vs_fact: PlanVsFactItem[];
  channel_performance?: ChannelPerformanceItem[];
  custom_tables?: CustomTableData[];
  manual_channels?: ManualChannelData[];
  manual_table_title?: string;
  analytics?: DashboardAnalyticsData;
  postclick_analytics?: {
    rows: PostClickAnalyticsRow[];
    timeseries: PostClickAnalyticsTimeSeriesPoint[];
  };
  abbott_bi?: AbbottBiData;
  promopages?: PromopagesData;
  bound_promopages?: {
    by_channel: BoundPromopagesChannelOverlay[];
    timeseries: BoundPromopagesTimeSeriesOverlay[];
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
  campaign_breakdown?: CampaignBreakdownItem[];
  funnel?: FunnelStep[];
  comparison?: ComparisonData;
  ai_summary?: DashboardAiSummary;
  ai_summary_enabled?: boolean;
}

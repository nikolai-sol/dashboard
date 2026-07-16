import type { DashboardLanguage } from "@/lib/dashboard-i18n";
import type {
  DashboardMetrikaTrafficMetricId,
  DashboardPostClickFieldId,
  DashboardPromopagesFieldId,
} from "@/lib/admin-ui-types";
import type { MultibrandConfig } from "@/lib/multibrand";

export type DashboardKind = "awareness" | "performance" | "overview" | "multibrand" | "abbott_bi" | "zaruku_bi";
export type DashboardSectionId =
  | "kpi_grid"
  | "spend_section"
  | "trend_chart"
  | "analytics"
  | "traffic_sources"
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

export interface TrafficSourceRow {
  traffic_source: string;
  visits: number;
  users: number;
  new_users: number;
  pageviews: number;
  bounce_rate: number;
  page_depth: number;
  avg_visit_duration: number;
}

export interface PostClickAnalyticsRow {
  line_key: string;
  channel: string;
  instrument: string;
  buy_type: string;
  utm_sources: string[];
  source_keys: string[];
  platform_account_ids: string[];
  platform_campaign_ids: string[];
  platform_delivery_entity_ids: string[];
  platform_creative_ids: string[];
  visits: number;
  users: number;
  pageviews: number;
  page_depth: number;
  goal_reaches: number;
  bounce_rate: number;
  avg_visit_duration: number;
  conversion_rate: number;
  impressions: number;
  clicks: number;
  views: number;
  reach: number;
  spend: number;
  ctr: number;
  cpm: number;
  cpc: number;
  video_views_25: number;
  video_views_50: number;
  video_views_75: number;
  video_views_100: number;
}

export interface PostClickAnalyticsTimeSeriesPoint {
  date: string;
  line_key: string;
  channel: string;
  source_keys: string[];
  platform_account_ids: string[];
  platform_campaign_ids: string[];
  platform_delivery_entity_ids: string[];
  platform_creative_ids: string[];
  visits: number;
  users: number;
  pageviews: number;
  page_depth: number;
  goal_reaches: number;
  bounce_rate: number;
  avg_visit_duration: number;
  conversion_rate: number;
  impressions: number;
  clicks: number;
  views: number;
  reach: number;
  spend: number;
  ctr: number;
  cpm: number;
  cpc: number;
  video_views_25: number;
  video_views_50: number;
  video_views_75: number;
  video_views_100: number;
  campaign_breakdown?: PostClickAnalyticsCampaignPoint[];
}

export interface PostClickAnalyticsCampaignPoint {
  date: string;
  line_key: string;
  channel: string;
  utm_campaign: string;
  source_keys: string[];
  platform_account_ids: string[];
  platform_campaign_ids: string[];
  platform_delivery_entity_ids: string[];
  platform_creative_ids: string[];
  visits: number;
  users: number;
  pageviews: number;
  page_depth: number;
  goal_reaches: number;
  bounce_rate: number;
  avg_visit_duration: number;
  conversion_rate: number;
  impressions: number;
  clicks: number;
  views: number;
  reach: number;
  spend: number;
  ctr: number;
  cpm: number;
  cpc: number;
  video_views_25: number;
  video_views_50: number;
  video_views_75: number;
  video_views_100: number;
}

export interface AbbottBiUserSummaryRow {
  user_id: string;
  has_user_id: boolean;
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
  has_user_id: boolean;
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
  bitrix_pageviews: number;
  bitrix_sessions: number;
  bitrix_users: number;
  bitrix_logged_in_sessions: number;
  bitrix_anonymous_sessions: number;
  bitrix_avg_session_duration: number;
}

export interface AbbottBiBitrixPageRow {
  url: string;
  path: string;
  direction: string | null;
  material_type: string | null;
  access: string | null;
  pageviews: number;
  sessions: number;
  users: number;
  guests: number;
  logged_in_hits: number;
  anonymous_hits: number;
  logged_in_sessions: number;
  anonymous_sessions: number;
  entry_sessions: number;
  exit_sessions: number;
  avg_session_duration: number;
  top_utm_source: string;
  top_utm_medium: string;
  top_utm_campaign: string;
}

export interface AbbottBiBitrixSummary {
  raw_hit_rows: number;
  clean_hit_rows: number;
  raw_date_from: string;
  raw_date_to: string;
  date_from: string;
  date_to: string;
  sessions_loaded: number;
  unique_clean_urls: number;
  excluded: Record<string, number>;
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

export interface AbbottBiSessionJourneyRow {
  session_id: number;
  user_id: string | null;
  has_user_id: boolean;
  entry_url_day: string;
  exit_url_day: string;
  entry_url_session: string;
  exit_url_session: string;
  hits_total: number;
  hits_clean: number;
  hits_content: number;
  steps_content: number;
  events_count: number;
  duration_seconds: number;
  content_path: string[];
  content_path_summary: string;
  all_path_summary: string;
  events_available: boolean;
}

export interface AbbottBiSessionJourneySchema {
  grain: string;
  sources: string[];
  entry_exit_day: string;
  entry_exit_session: string;
  content_path: string;
  all_path: string;
  events: string;
  duration: string;
}

export interface AbbottBiSessionJourneySummary {
  sessions_in_day: number;
  sessions_exported: number;
  sessions_with_user_id: number;
  sessions_with_content_path: number;
  hits_total: number;
  hits_clean: number;
  events_available: boolean;
}

export interface AbbottBiSessionJourneysData {
  report_date: string;
  schema: AbbottBiSessionJourneySchema | null;
  summary: AbbottBiSessionJourneySummary | null;
  rows: AbbottBiSessionJourneyRow[];
}

export interface AbbottBiData {
  counters: string[];
  users_summary: AbbottBiUserSummaryRow[];
  traffic_summary?: AbbottBiUserSummaryRow[];
  user_actions: AbbottBiUserActionRow[];
  page_stats: AbbottBiPageStatRow[];
  bitrix_pages: AbbottBiBitrixPageRow[];
  bitrix_summary: AbbottBiBitrixSummary | null;
  bitrix_period_active: boolean;
  session_journeys: AbbottBiSessionJourneysData;
  external_events: AbbottBiExternalEventRow[];
  external_clicks: AbbottBiExternalClickRow[];
  time_buckets: AbbottBiTimeBuckets;
  returning: AbbottBiReturningRow[];
  general_materials: AbbottBiMaterialRow[];
}

export type ZarukuSeoLayerId = "onsite" | "serp" | "ai";
export type ZarukuSeoSourceId = "metrika" | "gsc" | "webmaster" | "seo_os" | "yandex_gen_search";
export type ZarukuSeoSourceStatus = "connected" | "pending" | "partial" | "unavailable";

export interface ZarukuSeoLayer {
  id: ZarukuSeoLayerId;
  label: string;
  hint: string;
}

export interface ZarukuSeoSource {
  id: ZarukuSeoSourceId;
  label: string;
  layer: ZarukuSeoLayerId;
  color: string;
  status: ZarukuSeoSourceStatus;
  note?: string;
}

export interface ZarukuSeoKpi {
  key: string;
  label: string;
  value: string;
  raw_value?: number | null;
  note?: string;
  source: ZarukuSeoSourceId;
  layer: ZarukuSeoLayerId;
  coverage?: number | null;
}

export interface ZarukuSeoMetricRow {
  id?: string | null;
  label: string;
  secondary_label?: string | null;
  url?: string | null;
  visits: number;
  users: number;
  pageviews: number;
  bounce_rate?: number | null;
  avg_duration_seconds?: number | null;
  page_depth?: number | null;
  share?: number | null;
  source?: ZarukuSeoSourceId;
  layer?: ZarukuSeoLayerId;
}

export interface ZarukuSeoPendingRequirement {
  source: ZarukuSeoSourceId;
  layer: ZarukuSeoLayerId;
  title: string;
  status: "pending" | "partial";
  reason: string;
  expected_fields: string[];
}

export interface ZarukuSeoDataQualityItem {
  title: string;
  value: string;
  note: string;
  severity: "ok" | "info" | "warning";
}

export interface ZarukuSeoSectionPattern {
  section: string;
  url_pattern: string;
  priority: number;
}

export interface ZarukuSeoPositionTrendPoint {
  week: string;
  section: string;
  average_position: number | null;
  coverage: number;
  found_rows: number;
  tracked_rows: number;
}

export type ZarukuSeoClusterStatus = "found" | "no_data";

export interface ZarukuSeoClusterRow {
  week: string;
  section: string;
  cluster_id: string;
  query: string;
  serp_position: number | null;
  delta_prev: number | null;
  matched_url: string | null;
  status: ZarukuSeoClusterStatus;
}

export type ZarukuSeoOpportunityDecision = "pending" | "approved" | "rejected" | "carried_over";
export type ZarukuSeoOpportunityPriority = "high" | "medium" | "low";

export interface ZarukuSeoOpportunityRow {
  week: string;
  opportunity_id: string;
  section: string | null;
  opportunity_type: string;
  title: string;
  target_url: string | null;
  decision: ZarukuSeoOpportunityDecision;
  reject_reason: string | null;
  confidence: number;
  priority: ZarukuSeoOpportunityPriority;
}

export interface ZarukuSeoOpportunitySummary {
  week: string;
  decision: ZarukuSeoOpportunityDecision;
  count: number;
}

export type ZarukuSeoTaskStatus = "draft" | "awaiting_medical_review" | "needs_target_page" | "in_progress" | "done" | "cancelled";

export interface ZarukuSeoTaskRow {
  week: string;
  task_id: string;
  section: string | null;
  title: string;
  status: ZarukuSeoTaskStatus;
  notion_url: string | null;
}

export interface ZarukuSeoTaskSummary {
  week: string;
  status: ZarukuSeoTaskStatus;
  count: number;
}

export type ZarukuSeoRunStatus = "completed" | "failed" | "noop" | "missing";

export interface ZarukuSeoRunRow {
  week: string;
  status: ZarukuSeoRunStatus;
  serp_requests: number | null;
  llm_tokens: number | null;
  digest_count: number | null;
  stages?: Record<string, unknown>;
}

export interface ZarukuSeoTrafficVisibilityRow {
  week: string;
  section: string;
  visits: number;
  users: number;
  pageviews: number;
  average_position: number | null;
  coverage: number | null;
}

export interface ZarukuYandexWebmasterQueryRow {
  week: string;
  query_id: string;
  query: string;
  device: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
  week_from: string;
  week_to: string;
  is_partial_week?: boolean;
}

export interface ZarukuYandexWebmasterPageRow {
  week: string;
  url: string;
  device: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
  week_from: string;
  week_to: string;
  is_partial_week?: boolean;
}

export interface ZarukuYandexWebmasterSummaryRow {
  week: string;
  device: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
  week_from: string;
  week_to: string;
  is_partial_week: boolean;
}

export interface ZarukuYandexWebmasterData {
  available: boolean;
  status: "available" | "partial" | "unavailable";
  error: string | null;
  data_availability: {
    queries: boolean;
    pages: boolean;
  };
  weeks: string[];
  latest_week: string | null;
  summary: ZarukuYandexWebmasterSummaryRow[];
  queries: ZarukuYandexWebmasterQueryRow[];
  pages: ZarukuYandexWebmasterPageRow[];
}

export interface ZarukuAiVisibilityRow {
  week: string;
  cluster_id: string;
  query: string;
  engine: string;
  region: string;
  language: string;
  device: string;
  mentioned: boolean;
  mention_count: number;
  citation_count: number;
  cited_urls: string[];
  checked_at: string | null;
}

export interface ZarukuAiVisibilityData {
  available: boolean;
  status: "available" | "unavailable";
  error: string | null;
  weeks: string[];
  latest_week: string | null;
  rows: ZarukuAiVisibilityRow[];
}

export interface ZarukuSeoSovWeeklyRow {
  week: string;
  period_label: string;
  snapshot_date: string | null;
  date_start: string | null;
  date_end: string | null;
  cluster: string;
  query_count: number;
  impressions: number;
  clicks: number;
  impressions_share: number;
  clicks_share: number;
  ctr: number;
  average_position: number | null;
  is_noise: boolean;
  is_medical: boolean;
  ingestion_run_id: string | null;
}

export interface ZarukuSeoAiVisibilityAggregateRow {
  engine: string;
  period: string;
  presence_rate: number;
  mentions: number;
  citations: number;
  provenance: string | null;
  captured_at: string | null;
  ingestion_run_id: string | null;
}

export interface ZarukuSeoIntelligenceData {
  available: boolean;
  status: "available" | "partial" | "unavailable";
  error: string | null;
  sov: {
    available: boolean;
    weeks: string[];
    latest_week: string | null;
    rows: ZarukuSeoSovWeeklyRow[];
  };
  ai: {
    available: boolean;
    periods: string[];
    latest_period: string | null;
    rows: ZarukuSeoAiVisibilityAggregateRow[];
  };
}

export interface ZarukuSeoOsData {
  available: boolean;
  status: "available" | "partial" | "unavailable";
  error: string | null;
  data_availability: {
    section_patterns: boolean;
    positions: boolean;
    opportunities: boolean;
    tasks: boolean;
    runs: boolean;
    traffic_visibility: boolean;
  };
  weeks: string[];
  latest_week: string | null;
  section_patterns: ZarukuSeoSectionPattern[];
  position_trend: ZarukuSeoPositionTrendPoint[];
  clusters: ZarukuSeoClusterRow[];
  opportunities: ZarukuSeoOpportunityRow[];
  tasks: ZarukuSeoTaskRow[];
  runs: ZarukuSeoRunRow[];
  traffic_visibility: ZarukuSeoTrafficVisibilityRow[];
}

export interface ZarukuSeoData {
  counters: string[];
  domain: string;
  period: { from: string; to: string };
  layers: ZarukuSeoLayer[];
  sources: ZarukuSeoSource[];
  pending_requirements: ZarukuSeoPendingRequirement[];
  kpis: ZarukuSeoKpi[];
  traffic_channels: ZarukuSeoMetricRow[];
  technical_tail: ZarukuSeoMetricRow[];
  organic_trend: Array<{ label: string; visits: number; users: number; pageviews: number }>;
  search_engines: ZarukuSeoMetricRow[];
  search_phrases: ZarukuSeoMetricRow[];
  organic_landing_pages: ZarukuSeoMetricRow[];
  top_pages: ZarukuSeoMetricRow[];
  content_sections: ZarukuSeoMetricRow[];
  high_bounce_pages: ZarukuSeoMetricRow[];
  best_engagement_pages: ZarukuSeoMetricRow[];
  map_city_demand: ZarukuSeoMetricRow[];
  geo_countries: ZarukuSeoMetricRow[];
  geo_cities: ZarukuSeoMetricRow[];
  devices: ZarukuSeoMetricRow[];
  source_devices: ZarukuSeoMetricRow[];
  browsers: ZarukuSeoMetricRow[];
  operating_systems: ZarukuSeoMetricRow[];
  age: ZarukuSeoMetricRow[];
  gender: ZarukuSeoMetricRow[];
  interests: ZarukuSeoMetricRow[];
  returning_pages: ZarukuSeoMetricRow[];
  data_quality: ZarukuSeoDataQualityItem[];
  seo_os: ZarukuSeoOsData;
  webmaster: ZarukuYandexWebmasterData;
  ai_visibility: ZarukuAiVisibilityData;
  seo_intelligence: ZarukuSeoIntelligenceData;
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
  traffic_sources?: TrafficSourceRow[];
  postclick_analytics?: {
    rows: PostClickAnalyticsRow[];
    timeseries: PostClickAnalyticsTimeSeriesPoint[];
    selected_columns?: DashboardPostClickFieldId[];
  };
  abbott_bi?: AbbottBiData;
  zaruku_bi?: AbbottBiData;
  zaruku_seo?: ZarukuSeoData;
  promopages?: PromopagesData;
  section_field_overrides?: {
    trend_chart?: {
      visible_metrics: string[];
    };
    promopages?: {
      visible_metrics: DashboardPromopagesFieldId[];
    };
    platform_table?: {
      visible_metrics: string[];
    };
    plan_vs_fact?: {
      visible_metrics: string[];
    };
    platform_plan_fact?: {
      visible_metrics: string[];
    };
    channel_table?: {
      visible_metrics: string[];
    };
  };
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

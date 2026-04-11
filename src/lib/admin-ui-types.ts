import type { DashboardLanguage } from "@/lib/dashboard-i18n";
import type { MultibrandConfig } from "@/lib/multibrand";

export type DashboardType = "awareness" | "performance" | "overview" | "multibrand" | "abbott_bi";
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

export type PlatformMeta = {
  id: string;
  display_name: string;
  source: "mysql" | "gsheet";
  schema_file: string;
  source_key?: string;
  source_type?: "ads" | "analytics" | "gsheet" | "manual" | "leads" | "promopages" | null;
  canonical_table?: string | null;
};

export type DashboardFilterForm = {
  filter_type: "all" | "name_pattern" | "id_list";
  filter_value: string | null;
};

export type DashboardSourceForm = {
  id?: number;
  platform: string;
  schema_file: string;
  role: "actual" | "plan" | "custom_table";
  source_config: Record<string, unknown> | null;
  filters: DashboardFilterForm[];
};

export type MediaPlanBindingForm = {
  line_key?: string;
  channel: string;
  source_key: string;
  platform_campaign_id: string;
};

export type DashboardUtmSourceBindingForm = {
  utm_source: string;
  line_key: string;
  channel: string;
  source_key?: string | null;
};

export type DashboardMetrikaTrafficMetricId =
  | "visits"
  | "users"
  | "pageviews"
  | "bounce_rate"
  | "avg_visit_duration";

export type DashboardMetrikaSettingsForm = {
  selected_traffic_metrics: DashboardMetrikaTrafficMetricId[];
  goal_mode: "all" | "selected";
  selected_goal_ids: string[];
};

export type DashboardPostClickFieldId =
  | "visits"
  | "users"
  | "pageviews"
  | "goal_reaches"
  | "conversion_rate"
  | "bounce_rate"
  | "avg_visit_duration";

export type DashboardPromopagesFieldId =
  | "impressions"
  | "reach"
  | "views"
  | "budget"
  | "ctr"
  | "cpm"
  | "clickouts"
  | "full_reads"
  | "metrica_visits";

export type DashboardSectionFieldOverridesForm = {
  postclick_analytics?: {
    visible_fields: DashboardPostClickFieldId[];
  };
  promopages?: {
    visible_metrics: DashboardPromopagesFieldId[];
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

export type CampaignFrequencyOverrideForm = {
  source_key: string;
  platform_campaign_id: string;
  month_key: string;
  frequency: number;
};

export type DashboardFilterScope = "both" | "platform" | "channel";

export type CustomKpiCardForm = {
  id: string;
  title: string;
  value: number;
  trend_source: string;
};

export type DashboardFormData = {
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: DashboardType;
  config: {
    currency: "EUR" | "USD" | "RUB";
    language?: DashboardLanguage;
    period_from: string;
    period_to: string;
    logo_url?: string;
    spend_source?: "platform_actual" | "media_plan_derived";
    filter_scope?: DashboardFilterScope;
    visible_metrics: string[];
    section_order?: DashboardSectionId[];
    show_spend: boolean;
    show_ai_summary: boolean;
    kpi_cards: string[];
    custom_kpi_cards?: CustomKpiCardForm[];
    campaign_frequency_overrides?: CampaignFrequencyOverrideForm[];
    metrika_settings?: DashboardMetrikaSettingsForm;
    section_field_overrides?: DashboardSectionFieldOverridesForm;
    multibrand?: MultibrandConfig | null;
  };
  sources: DashboardSourceForm[];
  media_plan_bindings: MediaPlanBindingForm[];
};

export type DashboardMetrikaObservedGoalRow = {
  goal_id: string;
  goal_name: string;
  total_goal_reaches: number;
  rows_count: number;
  min_date: string | null;
  max_date: string | null;
  selected: boolean;
};

export type DashboardMetrikaSettingsPayload = {
  dashboard: {
    id: number;
    client_id: string;
    dashboard_name: string;
    period_from: string | null;
    period_to: string | null;
    metrika_account_ids: string[];
  };
  traffic_metrics: Array<{
    id: DashboardMetrikaTrafficMetricId;
    label: string;
    description: string;
  }>;
  goals: DashboardMetrikaObservedGoalRow[];
};

export type DashboardUtmObservedSourceRow = {
  utm_source: string;
  visits: number;
  users: number;
  pageviews: number;
  goal_reaches: number;
  first_seen: string | null;
  last_seen: string | null;
  mediums_preview: string[];
  campaigns_preview: string[];
  medium_count: number;
  campaign_count: number;
  current_line_key: string | null;
  current_channel: string | null;
  current_source_key: string | null;
  suggested_line_key: string | null;
};

export type DashboardUtmMatchingPayload = {
  dashboard: {
    id: number;
    client_id: string;
    client_name: string;
    dashboard_name: string;
    period_from: string | null;
    period_to: string | null;
    metrika_account_ids: string[];
  };
  media_plan_rows: Array<{
    line_key: string;
    channel: string;
    instrument: string;
    platform: string;
    bound_source_keys: string[];
  }>;
  observed_sources: DashboardUtmObservedSourceRow[];
};

export type DashboardListItem = {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: DashboardType;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  sources_count: number;
  url: string;
};

export type SourceCollectionMode =
  | "ads_only"
  | "ads_plus_seo"
  | "ads_plus_seo_plus_user_behavior";

export type SourceAccountCollectionRow = {
  source_key: string;
  source_label: string;
  platform_account_id: string;
  account_name: string;
  is_active: boolean;
  cron_enabled: boolean;
  collection_mode: SourceCollectionMode | null;
  collection_mode_supported: boolean;
  settings_exists: boolean;
  last_run_at: string | null;
  last_run_status: "running" | "success" | "partial" | "failed" | null;
  latest_data_date: string | null;
};

export type SourceAccountCollectionSettingInput = {
  source_key: string;
  platform_account_id: string;
  is_active: boolean;
  cron_enabled: boolean;
  collection_mode: SourceCollectionMode | null;
};

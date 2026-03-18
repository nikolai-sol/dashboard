export type DashboardType = "awareness" | "performance" | "overview";
export type DashboardSectionId =
  | "kpi_grid"
  | "spend_section"
  | "trend_chart"
  | "channel_table"
  | "plan_vs_fact"
  | "platform_table";

export type PlatformMeta = {
  id: string;
  display_name: string;
  source: "mysql" | "gsheet";
  schema_file: string;
  source_key?: string;
  source_type?: "ads" | "analytics" | "gsheet" | null;
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
  role: "actual" | "plan";
  source_config: Record<string, unknown> | null;
  filters: DashboardFilterForm[];
};

export type MediaPlanBindingForm = {
  channel: string;
  source_key: string;
  platform_campaign_id: string;
};

export type CampaignFrequencyOverrideForm = {
  source_key: string;
  platform_campaign_id: string;
  month_key: string;
  frequency: number;
};

export type DashboardFormData = {
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: DashboardType;
  config: {
    currency: "EUR" | "USD" | "RUB";
    period_from: string;
    period_to: string;
    logo_url?: string;
    spend_source?: "platform_actual" | "media_plan_derived";
    visible_metrics: string[];
    section_order?: DashboardSectionId[];
    show_spend: boolean;
    show_ai_summary: boolean;
    kpi_cards: string[];
    campaign_frequency_overrides?: CampaignFrequencyOverrideForm[];
  };
  sources: DashboardSourceForm[];
  media_plan_bindings: MediaPlanBindingForm[];
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

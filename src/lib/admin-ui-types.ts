export type DashboardType = "awareness" | "performance" | "overview";

export type PlatformMeta = {
  id: string;
  display_name: string;
  source: "mysql" | "gsheet";
  schema_file: string;
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

export type DashboardFormData = {
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: DashboardType;
  config: {
    currency: "EUR" | "USD" | "RUB";
    period_from: string;
    period_to: string;
    visible_metrics: string[];
    show_spend: boolean;
    show_ai_summary: boolean;
    kpi_cards: string[];
  };
  sources: DashboardSourceForm[];
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

import type { RowDataPacket } from "mysql2";
import { normalizeAbbottIdentifier } from "@reportingdash/runtime-contract";
import pool from "./db";
import { getDefaultAbbottCounterIds, loadAbbottBiData, type AbbottDashboardAudience } from "./abbott-bi";
import { ABBOTT_BUSINESS_TIME_ZONE, businessCalendarIsoDate } from "./abbott-date-range";
import { resolveDashboardDateRange } from "./dashboard-date-range";
import { normalizeDashboardLanguage } from "./dashboard-i18n";
import {
  buildDashboardAiSummaryFromOverrideText,
  getMatchingDashboardAiSummarySnapshot,
  normalizeDashboardAiSummaryAuthoring,
} from "./dashboard-ai-summary";
import { loadSchema } from "./schema-parser";
import { resolveSourceKey, resolveSourceType } from "./source-mapping";
import type { DashboardAiSummary, DashboardData } from "./types";

type JsonRecord = Record<string, unknown>;

export type AbbottDashboardRow = {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: DashboardData["dashboard"]["type"];
  config: string | JsonRecord | null;
};

type AbbottSourceRow = RowDataPacket & {
  platform: string;
  schema_file: string;
  role: "actual" | "plan" | "custom_table";
  source_config: string | JsonRecord | null;
};

export type LoadedAbbottDashboardData = {
  dashboard_id: number;
  data: DashboardData;
  previous_platforms: [];
  leads_rows: [];
  ai_summary_enabled: boolean;
  ai_summary_override_text: string | null;
  ai_summary_override: DashboardAiSummary | null;
  ai_summary_snapshot: DashboardAiSummary | null;
  server_timing: undefined;
};

export type AbbottDashboardLoaderDependencies = {
  findDashboard(identifier: string): Promise<AbbottDashboardRow | undefined>;
  findCounterIds(dashboardId: number): Promise<string[]>;
  loadBi(
    dashboardId: number, counterIds: string[], from: string, to: string, audience: AbbottDashboardAudience,
  ): ReturnType<typeof loadAbbottBiData>;
};

function parseJson(value: unknown): JsonRecord {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as JsonRecord;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as JsonRecord;
  return {};
}

export const abbottDashboardLoaderDependencies: AbbottDashboardLoaderDependencies = {
  async findDashboard(identifier) {
    const [rows] = await pool.execute<(RowDataPacket & AbbottDashboardRow)[]>(
      "SELECT * FROM dashboards WHERE is_active = TRUE AND (id = ? OR client_id = ?) LIMIT 1",
      [identifier, identifier],
    );
    return rows[0];
  },
  async findCounterIds(dashboardId) {
    const [rows] = await pool.execute<AbbottSourceRow[]>(
      `SELECT ds.*, dcf.filter_type, dcf.filter_value
       FROM dashboard_sources ds
       LEFT JOIN dashboard_campaign_filters dcf ON dcf.dashboard_source_id = ds.id
       WHERE ds.dashboard_id = ?`,
      [dashboardId],
    );
    const ids = rows.flatMap((source) => {
      if (source.role === "custom_table") return [];
      // These YAML files describe source configuration; facts remain canonical MySQL reads.
      const schema = loadSchema(source.schema_file);
      const sourceKey = schema.source_key ?? resolveSourceKey(source.platform);
      const sourceType = schema.source_type ?? resolveSourceType(sourceKey);
      if (sourceType !== "analytics" || sourceKey !== "yandex_metrika") return [];
      const accountIds = parseJson(source.source_config).account_ids;
      return Array.isArray(accountIds) ? accountIds.map((item) => String(item).trim()).filter(Boolean) : [];
    });
    return Array.from(new Set(ids)).filter(Boolean);
  },
  loadBi: loadAbbottBiData,
};

export async function loadAbbottDashboardDataWithDependencies(
  request: Request,
  identifier: string,
  audience: AbbottDashboardAudience,
  dependencies: AbbottDashboardLoaderDependencies,
): Promise<LoadedAbbottDashboardData> {
  if (audience !== "manager" && audience !== "embed") throw new Error("Abbott trusted audience is required");
  if (normalizeAbbottIdentifier(identifier) !== "abbott") throw new Error("Dashboard not found");
  const dashboard = await dependencies.findDashboard(identifier);
  if (!dashboard || dashboard.client_id.trim().toLowerCase() !== "abbott" || dashboard.dashboard_type !== "abbott_bi") {
    throw new Error("Dashboard not found");
  }
  const config = parseJson(dashboard.config);
  const aiSummaryEnabled = Boolean(config.show_ai_summary ?? false);
  const aiSummaryAuthoring = normalizeDashboardAiSummaryAuthoring(config.ai_summary_authoring);
  const aiSummaryOverride = aiSummaryAuthoring
    ? buildDashboardAiSummaryFromOverrideText(aiSummaryAuthoring.override_text, aiSummaryAuthoring.updated_at)
    : null;
  const range = resolveDashboardDateRange({
    requestUrl: request.url, configFrom: null, configTo: null, dashboardType: "abbott_bi",
  });
  const configured = await dependencies.findCounterIds(dashboard.id);
  const counterIds = configured.length > 0 ? configured : getDefaultAbbottCounterIds();
  // Retain the existing validation of a configured business timezone.
  const businessTimeZone = typeof config.business_timezone === "string" && config.business_timezone.trim()
    ? config.business_timezone.trim() : ABBOTT_BUSINESS_TIME_ZONE;
  businessCalendarIsoDate(new Date(), businessTimeZone);
  const abbottBi = await dependencies.loadBi(dashboard.id, counterIds, range.from, range.to, audience);
  const response: DashboardData = {
    dashboard: {
      client_name: dashboard.client_name,
      dashboard_name: dashboard.dashboard_name,
      logo_url: typeof config.logo_url === "string" ? config.logo_url : null,
      type: dashboard.dashboard_type,
      period: { from: range.from, to: range.to },
      currency: String(config.currency ?? "RUB"),
      language: normalizeDashboardLanguage(config.language),
      show_spend: false,
      filter_scope: "platform",
      section_order: [],
      multibrand: null,
    },
    ai_summary_enabled: aiSummaryEnabled,
    kpi_config: [],
    visible_metrics: [],
    kpi: {
      total_impressions: 0,
      total_clicks: 0,
      total_spend: 0,
      total_conversions: 0,
      avg_ctr: 0,
      avg_cpm: 0,
      prev_impressions: 0,
      prev_clicks: 0,
      prev_spend: 0,
      prev_conversions: 0,
      prev_ctr: 0,
      prev_cpm: 0,
    },
    platforms: [],
    timeseries: [],
    plan_vs_fact: [],
    abbott_bi: abbottBi,
  };
  const aiSummarySnapshot = getMatchingDashboardAiSummarySnapshot(config.ai_summary_snapshot, response);
  return {
    dashboard_id: dashboard.id,
    data: response,
    previous_platforms: [],
    leads_rows: [],
    ai_summary_enabled: aiSummaryEnabled,
    ai_summary_override_text: aiSummaryAuthoring?.override_text ?? null,
    ai_summary_override: aiSummaryOverride,
    ai_summary_snapshot: aiSummarySnapshot?.summary ?? null,
    server_timing: undefined,
  };
}

export function loadAbbottDashboardData(
  request: Request, identifier: string, audience: AbbottDashboardAudience,
): Promise<LoadedAbbottDashboardData> {
  return loadAbbottDashboardDataWithDependencies(request, identifier, audience, abbottDashboardLoaderDependencies);
}

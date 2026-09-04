import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { ABBOTT_BUSINESS_TIME_ZONE, businessCalendarIsoDate } from "@/lib/abbott-date-range";
import { resolveDashboardDateRange } from "@/lib/dashboard-date-range";
import { normalizeDashboardLanguage } from "@/lib/dashboard-i18n";
import type { DashboardAudience } from "@/lib/dashboard-access-policy";
import {
  buildDashboardAiSummaryFromOverrideText,
  getMatchingDashboardAiSummarySnapshot,
  normalizeDashboardAiSummaryAuthoring,
} from "@/lib/dashboard-ai-summary";
import type { DashboardAiSummary, DashboardData, PlatformStats } from "@/lib/types";
import { loadZarukuSeoData } from "./zaruku-seo";

export type LoadedZarukuDashboardData = {
  dashboard_id: number;
  data: DashboardData;
  previous_platforms: PlatformStats[];
  leads_rows?: unknown[];
  ai_summary_enabled: boolean;
  ai_summary_override_text?: string | null;
  ai_summary_override?: DashboardAiSummary | null;
  ai_summary_snapshot?: DashboardAiSummary | null;
  server_timing?: DashboardServerTiming;
};

const SAFE_SERVER_TIMING_NAMES = ["metrika-db", "gsc-db", "webmaster-db", "seo-db", "total"] as const;
export type DashboardServerTimingName = typeof SAFE_SERVER_TIMING_NAMES[number];
export type DashboardServerTiming = Partial<Record<DashboardServerTimingName, number>>;

export function formatPrivateServerTiming(timings: DashboardServerTiming): string {
  return SAFE_SERVER_TIMING_NAMES.flatMap((name) => {
    const duration = timings[name];
    return typeof duration === "number" && Number.isFinite(duration) && duration >= 0
      ? [`${name};dur=${duration.toFixed(1)}`]
      : [];
  }).join(", ");
}

type DashboardRow = RowDataPacket & {
  id: number; client_id: string; client_name: string; dashboard_name: string;
  dashboard_type: DashboardData["dashboard"]["type"];
  config: string | Record<string, unknown> | null;
};
type SourceRow = RowDataPacket & {
  platform: string; role: string; source_config: string | Record<string, unknown> | null;
};

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function loadZarukuDashboardData(
  request: Request,
  dashboardId: string,
  audience?: DashboardAudience,
): Promise<LoadedZarukuDashboardData> {
  if (String(dashboardId).trim().toLowerCase() !== "zaruku") throw new Error("Dashboard not found");
  void audience; // Shared authorization supplies the audience; Zaruku has one canonical fact projection.
  const [dashboardRows] = await pool.execute<DashboardRow[]>(
    "SELECT * FROM dashboards WHERE is_active = TRUE AND (id = ? OR client_id = ?) LIMIT 1",
    ["zaruku", "zaruku"],
  );
  const dashboard = dashboardRows[0];
  if (!dashboard || dashboard.client_id !== "zaruku" || dashboard.dashboard_type !== "zaruku_bi") throw new Error("Dashboard not found");

  const config = parseJson(dashboard.config);
  const aiSummaryEnabled = Boolean(config.show_ai_summary ?? false);
  const aiSummaryAuthoring = normalizeDashboardAiSummaryAuthoring(config.ai_summary_authoring);
  const aiSummaryOverride = aiSummaryAuthoring
    ? buildDashboardAiSummaryFromOverrideText(aiSummaryAuthoring.override_text, aiSummaryAuthoring.updated_at)
    : null;
  const range = resolveDashboardDateRange({
    requestUrl: request.url,
    configFrom: config.period_from == null ? null : String(config.period_from),
    configTo: config.period_to == null ? null : String(config.period_to),
    dashboardType: dashboard.dashboard_type,
  });
  const [sourceRows] = await pool.execute<SourceRow[]>(
    `SELECT ds.*, dcf.filter_type, dcf.filter_value
     FROM dashboard_sources ds
     LEFT JOIN dashboard_campaign_filters dcf ON dcf.dashboard_source_id = ds.id
     WHERE ds.dashboard_id = ?`,
    [dashboard.id],
  );
  const counterIds = sourceRows.flatMap(source => {
    if (source.role === "custom_table" || source.platform !== "yandex_metrika") return [];
    const ids = parseJson(source.source_config).account_ids;
    return Array.isArray(ids) ? ids.map(id => String(id).trim()).filter(Boolean) : [];
  });
  // The canonical Zaruku reader already hard-scopes all facts to active account 66624469.
  // It does not need advertising YAML schemas or stored media plans to resolve that authority.
  const effectiveCounterIds = counterIds.length ? [...new Set(counterIds)] : ["66624469"];
  const serverTiming: DashboardServerTiming = {};
  const businessTimeZone = typeof config.business_timezone === "string" && config.business_timezone.trim()
    ? config.business_timezone.trim() : ABBOTT_BUSINESS_TIME_ZONE;
  const businessToday = businessCalendarIsoDate(new Date(), businessTimeZone);
  const zarukuSeo = await loadZarukuSeoData(effectiveCounterIds, range.from, range.to, {
    today: businessToday,
    recordTiming: (name, durationMs) => { serverTiming[name] = durationMs; },
  });
  const response: DashboardData = {
    dashboard: {
      client_name: dashboard.client_name, dashboard_name: dashboard.dashboard_name,
      logo_url: typeof config.logo_url === "string" ? config.logo_url : null,
      type: "zaruku_bi", period: { from: range.from, to: range.to },
      currency: String(config.currency ?? "RUB"), language: normalizeDashboardLanguage(config.language),
      show_spend: false, filter_scope: "platform", section_order: [], multibrand: null,
    },
    ai_summary_enabled: aiSummaryEnabled, kpi_config: [], visible_metrics: [],
    kpi: {
      total_impressions: 0, total_clicks: 0, total_spend: 0, total_conversions: 0,
      avg_ctr: 0, avg_cpm: 0, prev_impressions: 0, prev_clicks: 0, prev_spend: 0,
      prev_conversions: 0, prev_ctr: 0, prev_cpm: 0,
    },
    platforms: [], timeseries: [], plan_vs_fact: [], zaruku_seo: zarukuSeo,
  };
  const aiSummarySnapshot = getMatchingDashboardAiSummarySnapshot(config.ai_summary_snapshot, response);
  return {
    dashboard_id: dashboard.id, data: response, previous_platforms: [], leads_rows: [],
    ai_summary_enabled: aiSummaryEnabled,
    ai_summary_override_text: aiSummaryAuthoring?.override_text ?? null,
    ai_summary_override: aiSummaryOverride, ai_summary_snapshot: aiSummarySnapshot?.summary ?? null,
    server_timing: serverTiming,
  };
}

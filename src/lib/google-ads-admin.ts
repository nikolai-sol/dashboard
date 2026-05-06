import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { loadDashboardWithSources } from "@/lib/admin-dashboards";

const execFileAsync = promisify(execFile);
const SOURCE_KEY = "google";
const COLLECTOR_SCRIPT = "fetch_google_ads_canonical.py";

export type GoogleAdsCampaignOption = {
  customer_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
  objective: string | null;
};

export type GoogleAdsRecommendationRow = {
  id: number;
  customer_id: string;
  campaign_id: string;
  date_from: string | null;
  date_to: string | null;
  search_term: string;
  suggested_negative_keyword: string;
  original_suggested_negative_keyword: string | null;
  match_type: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversion_value: number;
  reason_code: string | null;
  reason_text: string | null;
  confidence: number;
  status: "pending" | "approved" | "rejected" | "applied" | string;
  reviewed_at: string | null;
  review_note: string | null;
  edited_by: string | null;
  edited_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  applied_at: string | null;
};

export type GoogleAdsRecommendationSummaryRow = {
  status: string;
  recommendation_count: number;
  total_cost: number;
  total_clicks: number;
  total_impressions: number;
};

export type GoogleAdsMutationLogRow = {
  id: number;
  customer_id: string;
  campaign_id: string | null;
  recommendation_id: number | null;
  mutation_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string | null;
  applied_at: string | null;
};

export type GoogleAdsSearchTermPerformanceRow = {
  search_term: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversion_value: number;
  first_date: string | null;
  last_date: string | null;
  ad_groups_count: number;
};

export type GoogleAdsDashboardContext = {
  dashboard: {
    id: number;
    client_id: string;
    client_name: string;
    dashboard_name: string;
  };
  customer_ids: string[];
  campaigns: GoogleAdsCampaignOption[];
  selected_customer_id: string;
  selected_campaign_id: string;
};

export type GoogleAdsControlSettings = {
  dashboard_id: number;
  customer_id: string;
  campaign_id: string;
  control_enabled: boolean;
  negative_recommendations_enabled: boolean;
  ai_analysis_enabled: boolean;
  apply_enabled: boolean;
  auto_collect_enabled: boolean;
  lookback_days: number;
  min_cost_threshold: number;
  min_clicks_threshold: number;
  max_apply_per_run: number;
  created_at: string | null;
  updated_at: string | null;
};

export type GoogleAdsRecommendationAiAnalysisRow = {
  id: number;
  recommendation_id: number;
  model: string;
  prompt_version: string;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  intent_classification: string;
  recommended_action: string;
  refined_negative_keyword: string | null;
  match_type: string;
  risk_level: string;
  confidence: string;
  reasoning_short: string | null;
  specialist_note: string | null;
  created_at: string | null;
};

type GoogleAdsRecommendationContext = GoogleAdsRecommendationRow & {
  campaign_name: string | null;
  campaign_objective: string | null;
  source_account: string | null;
};

type SqlParam = string | number | boolean | null;

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function boolValue(value: unknown): boolean {
  return Number(value ?? 0) > 0;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export async function loadGoogleAdsDashboardContext(dashboardId: number): Promise<GoogleAdsDashboardContext | null> {
  const conn = await pool.getConnection();
  try {
    const dashboard = await loadDashboardWithSources(conn, dashboardId);
    if (!dashboard) return null;

    const googleSources = dashboard.sources.filter(
      (source) => source.role === "actual" && (source.platform === "google" || source.platform === "google_ads"),
    );
    const customerIds = Array.from(
      new Set(
        googleSources.flatMap((source) => parseStringArray(source.source_config?.account_ids)),
      ),
    );
    if (!customerIds.length) {
      return {
        dashboard: {
          id: dashboard.id,
          client_id: dashboard.client_id,
          client_name: dashboard.client_name,
          dashboard_name: dashboard.dashboard_name,
        },
        customer_ids: [],
        campaigns: [],
        selected_customer_id: "",
        selected_campaign_id: "",
      };
    }

    const [campaignRows] = await conn.execute<RowDataPacket[]>(
      `
      SELECT
        platform_account_id AS customer_id,
        platform_campaign_id AS campaign_id,
        campaign_name,
        campaign_status,
        objective
      FROM canonical_source_campaigns
      WHERE source_key = ?
        AND platform_account_id IN (${customerIds.map(() => "?").join(",")})
      ORDER BY campaign_name, platform_campaign_id
      LIMIT 500
      `,
      [SOURCE_KEY, ...customerIds],
    );
    const campaigns = campaignRows.map((row) => ({
      customer_id: String(row.customer_id ?? ""),
      campaign_id: String(row.campaign_id ?? ""),
      campaign_name: String(row.campaign_name ?? row.campaign_id ?? ""),
      campaign_status: row.campaign_status ? String(row.campaign_status) : null,
      objective: row.objective ? String(row.objective) : null,
    }));

    return {
      dashboard: {
        id: dashboard.id,
        client_id: dashboard.client_id,
        client_name: dashboard.client_name,
        dashboard_name: dashboard.dashboard_name,
      },
      customer_ids: customerIds,
      campaigns,
      selected_customer_id: campaigns[0]?.customer_id ?? customerIds[0] ?? "",
      selected_campaign_id: campaigns[0]?.campaign_id ?? "",
    };
  } finally {
    conn.release();
  }
}

export async function listGoogleAdsRecommendations(options: {
  customerId: string;
  campaignId: string;
  status?: string;
  limit?: number;
}): Promise<GoogleAdsRecommendationRow[]> {
  const filters = ["customer_id = ?", "campaign_id = ?"];
  const params: SqlParam[] = [options.customerId, options.campaignId];
  const limit = Math.max(Number(options.limit ?? 50), 1);
  if (options.status && options.status !== "all") {
    filters.push("status = ?");
    params.push(options.status);
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      id, customer_id, campaign_id, date_from, date_to, search_term,
      suggested_negative_keyword, original_suggested_negative_keyword, match_type, impressions, clicks, cost,
      conversions, conversion_value, reason_code, reason_text, confidence,
      status, reviewed_at, review_note, edited_by, edited_at, created_at, updated_at, applied_at
    FROM google_ads_negative_keyword_recommendations
    WHERE ${filters.join(" AND ")}
    ORDER BY cost DESC, created_at DESC
    LIMIT ${limit}
    `,
    params,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    customer_id: String(row.customer_id),
    campaign_id: String(row.campaign_id),
    date_from: dateString(row.date_from),
    date_to: dateString(row.date_to),
    search_term: String(row.search_term ?? ""),
    suggested_negative_keyword: String(row.suggested_negative_keyword ?? ""),
    original_suggested_negative_keyword: row.original_suggested_negative_keyword
      ? String(row.original_suggested_negative_keyword)
      : null,
    match_type: String(row.match_type ?? "PHRASE"),
    impressions: numberValue(row.impressions),
    clicks: numberValue(row.clicks),
    cost: numberValue(row.cost),
    conversions: numberValue(row.conversions),
    conversion_value: numberValue(row.conversion_value),
    reason_code: row.reason_code ? String(row.reason_code) : null,
    reason_text: row.reason_text ? String(row.reason_text) : null,
    confidence: numberValue(row.confidence),
    status: String(row.status ?? ""),
    reviewed_at: dateString(row.reviewed_at),
    review_note: row.review_note ? String(row.review_note) : null,
    edited_by: row.edited_by ? String(row.edited_by) : null,
    edited_at: dateString(row.edited_at),
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at),
    applied_at: dateString(row.applied_at),
  }));
}

export async function getGoogleAdsRecommendationSummary(customerId: string, campaignId: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      status,
      COUNT(*) AS recommendation_count,
      ROUND(COALESCE(SUM(cost), 0), 6) AS total_cost,
      COALESCE(SUM(clicks), 0) AS total_clicks,
      COALESCE(SUM(impressions), 0) AS total_impressions
    FROM google_ads_negative_keyword_recommendations
    WHERE customer_id = ?
      AND campaign_id = ?
    GROUP BY status
    `,
    [customerId, campaignId],
  );
  const byStatus = new Map(rows.map((row) => [String(row.status), row]));
  return ["pending", "approved", "rejected", "applied"].map((status) => {
    const row = byStatus.get(status);
    return {
      status,
      recommendation_count: numberValue(row?.recommendation_count),
      total_cost: numberValue(row?.total_cost),
      total_clicks: numberValue(row?.total_clicks),
      total_impressions: numberValue(row?.total_impressions),
    };
  });
}

export async function listGoogleAdsMutationLog(customerId: string, campaignId: string, limit = 20) {
  const safeLimit = Math.max(Number(limit), 1);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      id, customer_id, campaign_id, recommendation_id, mutation_type, entity_type,
      entity_id, status, error_message, created_at, applied_at
    FROM google_ads_mutation_log
    WHERE customer_id = ?
      AND campaign_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ${safeLimit}
    `,
    [customerId, campaignId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    customer_id: String(row.customer_id),
    campaign_id: row.campaign_id ? String(row.campaign_id) : null,
    recommendation_id: row.recommendation_id ? Number(row.recommendation_id) : null,
    mutation_type: row.mutation_type ? String(row.mutation_type) : null,
    entity_type: row.entity_type ? String(row.entity_type) : null,
    entity_id: row.entity_id ? String(row.entity_id) : null,
    status: String(row.status ?? ""),
    error_message: row.error_message ? String(row.error_message) : null,
    created_at: dateString(row.created_at),
    applied_at: dateString(row.applied_at),
  }));
}

export async function listGoogleAdsSearchTerms(options: {
  customerId: string;
  campaignId: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<GoogleAdsSearchTermPerformanceRow[]> {
  const filters = ["customer_id = ?", "campaign_id = ?"];
  const params: SqlParam[] = [options.customerId, options.campaignId];
  if (options.dateFrom) {
    filters.push("report_date >= ?");
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    filters.push("report_date <= ?");
    params.push(options.dateTo);
  }
  const limit = Math.min(Math.max(Number(options.limit ?? 500), 1), 1000);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      search_term,
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(clicks), 0) AS clicks,
      ROUND(COALESCE(SUM(cost), 0), 6) AS cost,
      ROUND(COALESCE(SUM(conversions), 0), 6) AS conversions,
      ROUND(COALESCE(SUM(conversion_value), 0), 6) AS conversion_value,
      MIN(report_date) AS first_date,
      MAX(report_date) AS last_date,
      COUNT(DISTINCT NULLIF(ad_group_id, '')) AS ad_groups_count
    FROM google_ads_search_term_performance_daily
    WHERE ${filters.join(" AND ")}
    GROUP BY search_term
    ORDER BY cost DESC, clicks DESC, impressions DESC, search_term
    LIMIT ${limit}
    `,
    params,
  );
  return rows.map((row) => ({
    search_term: String(row.search_term ?? ""),
    impressions: numberValue(row.impressions),
    clicks: numberValue(row.clicks),
    cost: numberValue(row.cost),
    conversions: numberValue(row.conversions),
    conversion_value: numberValue(row.conversion_value),
    first_date: dateString(row.first_date),
    last_date: dateString(row.last_date),
    ad_groups_count: numberValue(row.ad_groups_count),
  }));
}

export async function getGoogleAdsControlSettings(
  dashboardId: number,
  customerId: string,
  campaignId: string,
): Promise<GoogleAdsControlSettings> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      dashboard_id, customer_id, campaign_id, control_enabled,
      negative_recommendations_enabled, ai_analysis_enabled, apply_enabled,
      auto_collect_enabled, lookback_days, min_cost_threshold,
      min_clicks_threshold, max_apply_per_run, created_at, updated_at
    FROM google_ads_control_settings
    WHERE dashboard_id = ?
      AND customer_id = ?
      AND campaign_id = ?
    LIMIT 1
    `,
    [dashboardId, customerId, campaignId],
  );
  if (!rows.length) {
    return {
      dashboard_id: dashboardId,
      customer_id: customerId,
      campaign_id: campaignId,
      control_enabled: false,
      negative_recommendations_enabled: false,
      ai_analysis_enabled: false,
      apply_enabled: false,
      auto_collect_enabled: true,
      lookback_days: 14,
      min_cost_threshold: 0,
      min_clicks_threshold: 1,
      max_apply_per_run: 20,
      created_at: null,
      updated_at: null,
    };
  }
  const row = rows[0];
  return {
    dashboard_id: Number(row.dashboard_id),
    customer_id: String(row.customer_id),
    campaign_id: String(row.campaign_id),
    control_enabled: boolValue(row.control_enabled),
    negative_recommendations_enabled: boolValue(row.negative_recommendations_enabled),
    ai_analysis_enabled: boolValue(row.ai_analysis_enabled),
    apply_enabled: boolValue(row.apply_enabled),
    auto_collect_enabled: boolValue(row.auto_collect_enabled),
    lookback_days: numberValue(row.lookback_days),
    min_cost_threshold: numberValue(row.min_cost_threshold),
    min_clicks_threshold: numberValue(row.min_clicks_threshold),
    max_apply_per_run: numberValue(row.max_apply_per_run),
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at),
  };
}

export async function upsertGoogleAdsControlSettings(
  settings: Omit<GoogleAdsControlSettings, "created_at" | "updated_at">,
) {
  await pool.execute(
    `
    INSERT INTO google_ads_control_settings (
      dashboard_id, customer_id, campaign_id, control_enabled,
      negative_recommendations_enabled, ai_analysis_enabled, apply_enabled,
      auto_collect_enabled, lookback_days, min_cost_threshold,
      min_clicks_threshold, max_apply_per_run
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      control_enabled = VALUES(control_enabled),
      negative_recommendations_enabled = VALUES(negative_recommendations_enabled),
      ai_analysis_enabled = VALUES(ai_analysis_enabled),
      apply_enabled = VALUES(apply_enabled),
      auto_collect_enabled = VALUES(auto_collect_enabled),
      lookback_days = VALUES(lookback_days),
      min_cost_threshold = VALUES(min_cost_threshold),
      min_clicks_threshold = VALUES(min_clicks_threshold),
      max_apply_per_run = VALUES(max_apply_per_run),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      settings.dashboard_id,
      settings.customer_id,
      settings.campaign_id,
      settings.control_enabled ? 1 : 0,
      settings.negative_recommendations_enabled ? 1 : 0,
      settings.ai_analysis_enabled ? 1 : 0,
      settings.apply_enabled ? 1 : 0,
      settings.auto_collect_enabled ? 1 : 0,
      settings.lookback_days,
      settings.min_cost_threshold,
      settings.min_clicks_threshold,
      settings.max_apply_per_run,
    ],
  );
}

export async function approveGoogleAdsRecommendation(id: number) {
  await pool.execute(
    `
    UPDATE google_ads_negative_keyword_recommendations
    SET status = 'approved',
        reviewed_at = NOW(),
        applied_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('pending', 'approved')
    `,
    [id],
  );
}

export async function rejectGoogleAdsRecommendation(id: number, note: string) {
  await pool.execute(
    `
    UPDATE google_ads_negative_keyword_recommendations
    SET status = 'rejected',
        reviewed_at = NOW(),
        review_note = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('pending', 'approved', 'rejected')
    `,
    [note, id],
  );
}

export async function updateGoogleAdsRecommendation(
  id: number,
  suggestedNegativeKeyword: string,
  matchType: "PHRASE" | "EXACT" | "BROAD",
  reviewNote: string | null,
  editedBy: string,
) {
  await pool.execute(
    `
    UPDATE google_ads_negative_keyword_recommendations
    SET
      original_suggested_negative_keyword = CASE
        WHEN original_suggested_negative_keyword IS NULL THEN suggested_negative_keyword
        ELSE original_suggested_negative_keyword
      END,
      suggested_negative_keyword = ?,
      match_type = ?,
      review_note = COALESCE(?, review_note),
      edited_by = ?,
      edited_at = NOW(),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('pending', 'approved')
    `,
    [suggestedNegativeKeyword, matchType, reviewNote, editedBy, id],
  );

  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      id, customer_id, campaign_id, date_from, date_to, search_term,
      suggested_negative_keyword, original_suggested_negative_keyword, match_type, impressions, clicks, cost,
      conversions, conversion_value, reason_code, reason_text, confidence,
      status, reviewed_at, review_note, edited_by, edited_at, created_at, updated_at, applied_at
    FROM google_ads_negative_keyword_recommendations
    WHERE id = ?
    LIMIT 1
    `,
    [id],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    customer_id: String(row.customer_id),
    campaign_id: String(row.campaign_id),
    date_from: dateString(row.date_from),
    date_to: dateString(row.date_to),
    search_term: String(row.search_term ?? ""),
    suggested_negative_keyword: String(row.suggested_negative_keyword ?? ""),
    original_suggested_negative_keyword: row.original_suggested_negative_keyword
      ? String(row.original_suggested_negative_keyword)
      : null,
    match_type: String(row.match_type ?? "PHRASE"),
    impressions: numberValue(row.impressions),
    clicks: numberValue(row.clicks),
    cost: numberValue(row.cost),
    conversions: numberValue(row.conversions),
    conversion_value: numberValue(row.conversion_value),
    reason_code: row.reason_code ? String(row.reason_code) : null,
    reason_text: row.reason_text ? String(row.reason_text) : null,
    confidence: numberValue(row.confidence),
    status: String(row.status ?? ""),
    reviewed_at: dateString(row.reviewed_at),
    review_note: row.review_note ? String(row.review_note) : null,
    edited_by: row.edited_by ? String(row.edited_by) : null,
    edited_at: dateString(row.edited_at),
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at),
    applied_at: dateString(row.applied_at),
  } satisfies GoogleAdsRecommendationRow;
}

export async function getGoogleAdsRecommendationById(id: number): Promise<GoogleAdsRecommendationContext | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      r.id, r.customer_id, r.campaign_id, r.date_from, r.date_to, r.search_term,
      r.suggested_negative_keyword, r.original_suggested_negative_keyword, r.match_type, r.impressions, r.clicks, r.cost,
      r.conversions, r.conversion_value, r.reason_code, r.reason_text, r.confidence,
      r.status, r.reviewed_at, r.review_note, r.edited_by, r.edited_at, r.created_at, r.updated_at, r.applied_at,
      c.campaign_name,
      c.objective AS campaign_objective,
      c.platform_account_id AS source_account
    FROM google_ads_negative_keyword_recommendations r
    LEFT JOIN canonical_source_campaigns c
      ON c.source_key = ?
     AND c.platform_account_id = r.customer_id
     AND c.platform_campaign_id = r.campaign_id
    WHERE r.id = ?
    LIMIT 1
    `,
    [SOURCE_KEY, id],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    customer_id: String(row.customer_id),
    campaign_id: String(row.campaign_id),
    date_from: dateString(row.date_from),
    date_to: dateString(row.date_to),
    search_term: String(row.search_term ?? ""),
    suggested_negative_keyword: String(row.suggested_negative_keyword ?? ""),
    original_suggested_negative_keyword: row.original_suggested_negative_keyword
      ? String(row.original_suggested_negative_keyword)
      : null,
    match_type: String(row.match_type ?? "PHRASE"),
    impressions: numberValue(row.impressions),
    clicks: numberValue(row.clicks),
    cost: numberValue(row.cost),
    conversions: numberValue(row.conversions),
    conversion_value: numberValue(row.conversion_value),
    reason_code: row.reason_code ? String(row.reason_code) : null,
    reason_text: row.reason_text ? String(row.reason_text) : null,
    confidence: numberValue(row.confidence),
    status: String(row.status ?? ""),
    reviewed_at: dateString(row.reviewed_at),
    review_note: row.review_note ? String(row.review_note) : null,
    edited_by: row.edited_by ? String(row.edited_by) : null,
    edited_at: dateString(row.edited_at),
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at),
    applied_at: dateString(row.applied_at),
    campaign_name: row.campaign_name ? String(row.campaign_name) : null,
    campaign_objective: row.campaign_objective ? String(row.campaign_objective) : null,
    source_account: row.source_account ? String(row.source_account) : null,
  };
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return null;
}

function getAiConfig() {
  const apiKey = process.env.AI_SUMMARY_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.AI_SUMMARY_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, ""),
    model: process.env.AI_SUMMARY_MODEL?.trim() || "gemini-2.5-flash",
    maxTokens: Number(process.env.GOOGLE_ADS_AI_MAX_TOKENS || process.env.AI_SUMMARY_MAX_TOKENS || 1200) || 1200,
  };
}

function buildGoogleAdsAiPrompt(promptVersion: string, input: Record<string, unknown>) {
  return {
    system: "You are a Google Ads specialist assistant. Return only strict JSON with required fields and enum values.",
    user:
      `prompt_version=${promptVersion}\n` +
      "Analyze recommendation and return JSON exactly with fields: intent_classification, recommended_action, refined_negative_keyword, match_type, risk_level, confidence, reasoning_short, specialist_note.\n" +
      "Allowed intent_classification: research_comparison | competitor_brand | price_sensitive | informational | irrelevant | relevant_uncertain.\n" +
      "Allowed recommended_action: approve | reject | edit | monitor.\n" +
      "Allowed match_type: PHRASE | EXACT | BROAD.\n" +
      "Allowed risk_level: low | medium | high.\n" +
      "Allowed confidence: low | medium | high.\n" +
      "Rules: do not recommend blocking high-intent product terms unless evidence clearly suggests irrelevance; for Shopping campaigns, prefer reject/monitor when data volume is tiny; keep reasoning_short under 240 characters.\n" +
      `Input JSON:\n${JSON.stringify(input)}`,
  };
}

function sanitizeAiAnalysisOutput(value: Record<string, unknown>) {
  const intentAllowed = new Set(["research_comparison", "competitor_brand", "price_sensitive", "informational", "irrelevant", "relevant_uncertain"]);
  const actionAllowed = new Set(["approve", "reject", "edit", "monitor"]);
  const matchAllowed = new Set(["PHRASE", "EXACT", "BROAD"]);
  const levelAllowed = new Set(["low", "medium", "high"]);
  const intent = String(value.intent_classification ?? "").trim();
  const action = String(value.recommended_action ?? "").trim();
  const refined = String(value.refined_negative_keyword ?? "").trim();
  const matchType = String(value.match_type ?? "").trim().toUpperCase();
  const riskLevel = String(value.risk_level ?? "").trim().toLowerCase();
  const confidence = String(value.confidence ?? "").trim().toLowerCase();
  if (!intentAllowed.has(intent)) throw new Error("Invalid AI intent_classification");
  if (!actionAllowed.has(action)) throw new Error("Invalid AI recommended_action");
  if (!matchAllowed.has(matchType)) throw new Error("Invalid AI match_type");
  if (!levelAllowed.has(riskLevel)) throw new Error("Invalid AI risk_level");
  if (!levelAllowed.has(confidence)) throw new Error("Invalid AI confidence");
  if ((action === "approve" || action === "edit") && !refined) {
    throw new Error("AI refined_negative_keyword is required for approve/edit");
  }
  return {
    intent_classification: intent,
    recommended_action: action,
    refined_negative_keyword: refined || null,
    match_type: matchType,
    risk_level: riskLevel,
    confidence,
    reasoning_short: String(value.reasoning_short ?? "").trim() || null,
    specialist_note: String(value.specialist_note ?? "").trim() || null,
  };
}

export async function analyzeGoogleAdsRecommendationWithAi(
  recommendation: GoogleAdsRecommendationContext,
): Promise<GoogleAdsRecommendationAiAnalysisRow> {
  const config = getAiConfig();
  if (!config) throw new Error("AI API is not configured");
  const promptVersion = "google_ads_negative_keyword_analysis_v1";
  const input = {
    recommendation: {
      id: recommendation.id,
      customer_id: recommendation.customer_id,
      campaign_id: recommendation.campaign_id,
      search_term: recommendation.search_term,
      suggested_negative_keyword: recommendation.suggested_negative_keyword,
      match_type: recommendation.match_type,
      impressions: recommendation.impressions,
      clicks: recommendation.clicks,
      cost: recommendation.cost,
      conversions: recommendation.conversions,
      conversion_value: recommendation.conversion_value,
      reason_code: recommendation.reason_code,
      reason_text: recommendation.reason_text,
      confidence: recommendation.confidence,
      status: recommendation.status,
    },
    campaign_context: {
      campaign_name: recommendation.campaign_name,
      campaign_type_objective: recommendation.campaign_objective,
      source_account: recommendation.source_account,
    },
  };
  const prompt = buildGoogleAdsAiPrompt(promptVersion, input);
  const isKimiModel = config.model.toLowerCase().startsWith("kimi-");

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: isKimiModel ? 0.6 : 1,
      max_tokens: config.maxTokens,
      ...(isKimiModel ? { thinking: { type: "disabled" } } : {}),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: prompt.system,
        },
        {
          role: "user",
          content: prompt.user,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`AI request failed: ${response.status}`);
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  const rawContent = body.choices?.[0]?.message?.content;
  const contentText = Array.isArray(rawContent)
    ? rawContent.map((part) => String(part?.text ?? "")).join("\n")
    : String(rawContent ?? "");
  const jsonText = extractJsonObject(contentText);
  if (!jsonText) throw new Error("AI returned empty JSON");
  const output = JSON.parse(jsonText) as Record<string, unknown>;
  const clean = sanitizeAiAnalysisOutput(output);

  await pool.execute(
    `
    INSERT INTO google_ads_recommendation_ai_analysis (
      recommendation_id, model, prompt_version, input_json, output_json,
      intent_classification, recommended_action, refined_negative_keyword, match_type,
      risk_level, confidence, reasoning_short, specialist_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      recommendation.id,
      config.model,
      promptVersion,
      JSON.stringify(input),
      JSON.stringify(output),
      clean.intent_classification,
      clean.recommended_action,
      clean.refined_negative_keyword,
      clean.match_type,
      clean.risk_level,
      clean.confidence,
      clean.reasoning_short,
      clean.specialist_note,
    ],
  );

  const latest = await getLatestGoogleAdsRecommendationAiAnalysis(recommendation.id);
  if (!latest) throw new Error("AI analysis not saved");
  return latest;
}

export async function getLatestGoogleAdsRecommendationAiAnalysis(
  recommendationId: number,
): Promise<GoogleAdsRecommendationAiAnalysisRow | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      id, recommendation_id, model, prompt_version, input_json, output_json,
      intent_classification, recommended_action, refined_negative_keyword,
      match_type, risk_level, confidence, reasoning_short, specialist_note, created_at
    FROM google_ads_recommendation_ai_analysis
    WHERE recommendation_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [recommendationId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    recommendation_id: Number(row.recommendation_id),
    model: String(row.model ?? ""),
    prompt_version: String(row.prompt_version ?? ""),
    input_json: parseJsonObject(row.input_json),
    output_json: parseJsonObject(row.output_json),
    intent_classification: String(row.intent_classification ?? ""),
    recommended_action: String(row.recommended_action ?? ""),
    refined_negative_keyword: row.refined_negative_keyword ? String(row.refined_negative_keyword) : null,
    match_type: String(row.match_type ?? "PHRASE"),
    risk_level: String(row.risk_level ?? ""),
    confidence: String(row.confidence ?? ""),
    reasoning_short: row.reasoning_short ? String(row.reasoning_short) : null,
    specialist_note: row.specialist_note ? String(row.specialist_note) : null,
    created_at: dateString(row.created_at),
  };
}

export async function getLatestGoogleAdsRecommendationAiAnalyses(
  recommendationIds: number[],
): Promise<Record<number, GoogleAdsRecommendationAiAnalysisRow>> {
  const ids = recommendationIds.filter((id) => Number.isFinite(id));
  if (!ids.length) return {};
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      id, recommendation_id, model, prompt_version, input_json, output_json,
      intent_classification, recommended_action, refined_negative_keyword,
      match_type, risk_level, confidence, reasoning_short, specialist_note, created_at
    FROM google_ads_recommendation_ai_analysis
    WHERE recommendation_id IN (${ids.map(() => "?").join(",")})
    ORDER BY recommendation_id, created_at DESC, id DESC
    `,
    ids,
  );
  const map: Record<number, GoogleAdsRecommendationAiAnalysisRow> = {};
  for (const row of rows) {
    const key = Number(row.recommendation_id);
    if (map[key]) continue;
    map[key] = {
      id: Number(row.id),
      recommendation_id: key,
      model: String(row.model ?? ""),
      prompt_version: String(row.prompt_version ?? ""),
      input_json: parseJsonObject(row.input_json),
      output_json: parseJsonObject(row.output_json),
      intent_classification: String(row.intent_classification ?? ""),
      recommended_action: String(row.recommended_action ?? ""),
      refined_negative_keyword: row.refined_negative_keyword ? String(row.refined_negative_keyword) : null,
      match_type: String(row.match_type ?? "PHRASE"),
      risk_level: String(row.risk_level ?? ""),
      confidence: String(row.confidence ?? ""),
      reasoning_short: row.reasoning_short ? String(row.reasoning_short) : null,
      specialist_note: row.specialist_note ? String(row.specialist_note) : null,
      created_at: dateString(row.created_at),
    };
  }
  return map;
}

export async function validateDashboardGoogleAdsTarget(
  conn: PoolConnection,
  dashboardId: number,
  customerId: string,
  campaignId: string,
) {
  const dashboard = await loadDashboardWithSources(conn, dashboardId);
  if (!dashboard) {
    throw new Error("Dashboard not found");
  }
  const allowedCustomerIds = new Set(
    dashboard.sources
      .filter((source) => source.role === "actual" && (source.platform === "google" || source.platform === "google_ads"))
      .flatMap((source) => parseStringArray(source.source_config?.account_ids)),
  );
  if (!allowedCustomerIds.has(customerId)) {
    throw new Error("Google Ads customer is not connected to this dashboard");
  }
  const [rows] = await conn.execute<RowDataPacket[]>(
    `
    SELECT 1
    FROM canonical_source_campaigns
    WHERE source_key = ?
      AND platform_account_id = ?
      AND platform_campaign_id = ?
    LIMIT 1
    `,
    [SOURCE_KEY, customerId, campaignId],
  );
  if (!rows.length) {
    throw new Error("Google Ads campaign is not available in canonical campaigns for this dashboard account");
  }
}

export async function runGoogleAdsCollectorCommand(args: string[]) {
  const envScriptPath = process.env.GOOGLE_ADS_COLLECTOR_SCRIPT_PATH?.trim();
  const envRoot = process.env.GOOGLE_ADS_REPO_ROOT?.trim();
  const candidates: string[] = [];
  if (envScriptPath) candidates.push(path.resolve(envScriptPath));
  if (envRoot) candidates.push(path.resolve(envRoot, COLLECTOR_SCRIPT));

  let cursor = path.resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(path.join(cursor, COLLECTOR_SCRIPT));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const scriptPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!scriptPath) {
    throw new Error(
      `Google Ads collector script not found (${COLLECTOR_SCRIPT}). Set GOOGLE_ADS_COLLECTOR_SCRIPT_PATH or GOOGLE_ADS_REPO_ROOT.`,
    );
  }
  const repoRoot = path.dirname(scriptPath);
  const python = process.env.GOOGLE_ADS_PYTHON_BIN
    ?? (fs.existsSync("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : "python3");
  const env = {
    ...process.env,
    PYTHONPATH: [path.join(repoRoot, ".pydeps"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONWARNINGS: process.env.PYTHONWARNINGS || "ignore",
  };
  const { stdout, stderr } = await execFileAsync(
    python,
    [scriptPath, ...args],
    {
      cwd: repoRoot,
      env,
      maxBuffer: 1024 * 1024 * 3,
      timeout: 180000,
    },
  );
  return { stdout, stderr };
}

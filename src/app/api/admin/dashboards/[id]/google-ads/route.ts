import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from "@/lib/access-auth";
import {
  analyzeGoogleAdsRecommendationWithAi,
  approveGoogleAdsRecommendation,
  listGoogleAdsCampaignHealth,
  getGoogleAdsRecommendationById,
  getGoogleAdsControlSettings,
  getLatestGoogleAdsRecommendationAiAnalyses,
  getGoogleAdsRecommendationSummary,
  listGoogleAdsMutationLog,
  listGoogleAdsKeywords,
  listGoogleAdsRecommendations,
  listGoogleAdsSearchTerms,
  loadGoogleAdsDashboardContext,
  rejectGoogleAdsRecommendation,
  runGoogleAdsCollectorCommand,
  upsertGoogleAdsControlSettings,
  updateGoogleAdsRecommendation,
  validateDashboardGoogleAdsTarget,
} from "@/lib/google-ads-admin";

export const runtime = "nodejs";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const STATUS_VALUES = new Set(["all", "pending", "approved", "rejected", "applied"]);
const HEALTH_FILTER_VALUES = new Set(["active", "all", "campaign"]);

function normalizeDate(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

function normalizePage(value: unknown): number {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(Math.trunc(parsed), 1);
}

function normalizeStatus(value: unknown): string {
  const status = String(value ?? "pending").trim();
  return STATUS_VALUES.has(status) ? status : "pending";
}

function normalizeBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function normalizeMatchType(value: unknown): "PHRASE" | "EXACT" | "BROAD" | null {
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "PHRASE" || text === "EXACT" || text === "BROAD") return text;
  return null;
}

function normalizeHealthFilter(value: unknown): "active" | "all" | "campaign" {
  const filter = String(value ?? "active").trim().toLowerCase();
  if (HEALTH_FILTER_VALUES.has(filter)) return filter as "active" | "all" | "campaign";
  return "active";
}

async function buildPayload(options: {
  dashboardId: number;
  customerId?: string;
  campaignId?: string;
  healthFilter?: "active" | "all" | "campaign";
  healthCampaignId?: string;
  status?: string;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  keywordPage?: number;
  commandOutput?: { stdout: string; stderr: string } | null;
}) {
  const context = await loadGoogleAdsDashboardContext(options.dashboardId);
  if (!context) {
    return null;
  }
  const customerId = options.customerId || context.selected_customer_id;
  const campaignId = options.campaignId || context.selected_campaign_id;
  const status = normalizeStatus(options.status);
  const limit = normalizeLimit(options.limit);
  const recommendations =
    customerId && campaignId
      ? await listGoogleAdsRecommendations({ customerId, campaignId, status, limit })
      : [];
  const summary =
    customerId && campaignId
      ? await getGoogleAdsRecommendationSummary(customerId, campaignId)
      : [];
  const mutationLog =
    customerId && campaignId
      ? await listGoogleAdsMutationLog(customerId, campaignId, 20)
      : [];
  const settings =
    customerId && campaignId
      ? await getGoogleAdsControlSettings(options.dashboardId, customerId, campaignId)
      : null;
  const dateFrom = normalizeDate(options.dateFrom);
  const dateTo = normalizeDate(options.dateTo);
  const healthFilter = normalizeHealthFilter(options.healthFilter);
  const healthCampaignId = String(options.healthCampaignId ?? "").trim();
  const campaignHealth = await listGoogleAdsCampaignHealth({
    customerIds: context.customer_ids,
    campaigns: context.campaigns,
    filterMode: healthFilter,
    filterCampaignId: healthCampaignId,
    dateFrom,
    dateTo,
  });

  const aiAnalysisByRecommendation = recommendations.length
    ? await getLatestGoogleAdsRecommendationAiAnalyses(recommendations.map((row) => row.id))
    : {};
  const keywords =
    customerId && campaignId
      ? await listGoogleAdsKeywords({
        customerId,
        campaignId,
        dateFrom,
        dateTo,
        page: normalizePage(options.keywordPage),
        perPage: 15,
      })
      : { rows: [], total: 0, page: 1, per_page: 15, total_pages: 1 };
  const searchTerms =
    customerId && campaignId
      ? await listGoogleAdsSearchTerms({
        customerId,
        campaignId,
        dateFrom,
        dateTo,
        limit: 1000,
      })
      : [];

  return {
    context,
    selected: {
      customer_id: customerId,
      campaign_id: campaignId,
      status,
      limit,
      date_from: dateFrom,
      date_to: dateTo,
      health_filter: healthFilter,
      health_campaign_id: healthCampaignId,
    },
    campaign_health: campaignHealth,
    summary,
    recommendations,
    mutation_log: mutationLog,
    ai_analysis_by_recommendation: aiAnalysisByRecommendation,
    keywords: keywords.rows,
    keyword_pagination: {
      total: keywords.total,
      page: keywords.page,
      per_page: keywords.per_page,
      total_pages: keywords.total_pages,
    },
    search_terms: searchTerms,
    settings,
    command_output: options.commandOutput ?? null,
  };
}

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(routeContext.params);
  const dashboardId = Number(id);
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }
  const url = new URL(request.url);
  try {
    const payload = await buildPayload({
      dashboardId,
      customerId: String(url.searchParams.get("customer_id") ?? "").trim(),
      campaignId: String(url.searchParams.get("campaign_id") ?? "").trim(),
      status: String(url.searchParams.get("status") ?? "pending"),
      healthFilter: normalizeHealthFilter(url.searchParams.get("health_filter")),
      healthCampaignId: String(url.searchParams.get("health_campaign_id") ?? "").trim(),
      limit: normalizeLimit(url.searchParams.get("limit"), 50),
      dateFrom: String(url.searchParams.get("date_from") ?? "").trim(),
      dateTo: String(url.searchParams.get("date_to") ?? "").trim(),
      keywordPage: normalizePage(url.searchParams.get("keyword_page")),
    });
    if (!payload) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[google-ads-admin] failed to load dashboard payload", error);
    return NextResponse.json(
      {
        error: "Failed to load Google Ads admin data",
        ...(IS_PRODUCTION ? {} : { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(routeContext.params);
  const dashboardId = Number(id);
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "").trim();
  const customerId = String(body.customer_id ?? "").trim();
  const campaignId = String(body.campaign_id ?? "").trim();
  const status = normalizeStatus(body.status);
  const healthFilter = normalizeHealthFilter(body.health_filter);
  const healthCampaignId = String(body.health_campaign_id ?? "").trim();
  const limit = normalizeLimit(body.limit, 50);
  const keywordPage = normalizePage(body.keyword_page);
  let commandOutput: { stdout: string; stderr: string } | null = null;
  const controlActions = new Set(["approve", "reject", "recommend", "apply-dry-run", "apply-confirm", "update-recommendation", "analyze-recommendation-ai"]);
  const readOnlyActions = new Set(["validate"]);

  try {
    if (action === "update-settings" || controlActions.has(action) || readOnlyActions.has(action)) {
      if (!customerId || !campaignId) {
        return NextResponse.json({ error: "customer_id and campaign_id are required" }, { status: 400 });
      }
      const conn = await pool.getConnection();
      try {
        await validateDashboardGoogleAdsTarget(conn, dashboardId, customerId, campaignId);
      } finally {
        conn.release();
      }
    }

    if (action === "update-settings") {
      await upsertGoogleAdsControlSettings({
        dashboard_id: dashboardId,
        customer_id: customerId,
        campaign_id: campaignId,
        control_enabled: normalizeBool(body.control_enabled, false),
        negative_recommendations_enabled: normalizeBool(body.negative_recommendations_enabled, false),
        ai_analysis_enabled: normalizeBool(body.ai_analysis_enabled, false),
        apply_enabled: normalizeBool(body.apply_enabled, false),
        auto_collect_enabled: normalizeBool(body.auto_collect_enabled, true),
        lookback_days: normalizeLimit(body.lookback_days, 14),
        min_cost_threshold: Number(body.min_cost_threshold ?? 0) || 0,
        min_clicks_threshold: normalizeLimit(body.min_clicks_threshold, 1),
        max_apply_per_run: normalizeLimit(body.max_apply_per_run, 20),
      });
    } else if (controlActions.has(action) || readOnlyActions.has(action)) {
      const settings = await getGoogleAdsControlSettings(dashboardId, customerId, campaignId);
      if (controlActions.has(action) && !settings.control_enabled) {
        const message = "Google Ads control actions are disabled: control_enabled=false";
        console.warn(`[google-ads-admin] blocked action=${action} dashboard=${dashboardId} customer=${customerId} campaign=${campaignId}: ${message}`);
        return NextResponse.json({ error: message }, { status: 403 });
      }
      if (action === "recommend" && !settings.negative_recommendations_enabled) {
        const message = "Recommendation generation is disabled: negative_recommendations_enabled=false";
        console.warn(`[google-ads-admin] blocked action=${action} dashboard=${dashboardId} customer=${customerId} campaign=${campaignId}: ${message}`);
        return NextResponse.json({ error: message }, { status: 403 });
      }
      if (action === "apply-confirm" && !settings.apply_enabled) {
        const message = "Live apply is disabled: apply_enabled=false";
        console.warn(`[google-ads-admin] blocked action=${action} dashboard=${dashboardId} customer=${customerId} campaign=${campaignId}: ${message}`);
        return NextResponse.json({ error: message }, { status: 403 });
      }
      if (action === "analyze-recommendation-ai" && !settings.ai_analysis_enabled) {
        const message = "AI analysis is disabled: ai_analysis_enabled=false";
        console.warn(`[google-ads-admin] blocked action=${action} dashboard=${dashboardId} customer=${customerId} campaign=${campaignId}: ${message}`);
        return NextResponse.json({ error: message }, { status: 403 });
      }
    }

    if (action === "update-settings") {
      // settings are already saved above, payload refresh below
    } else if (action === "analyze-recommendation-ai") {
      const recommendationId = Number(body.recommendation_id);
      if (!Number.isFinite(recommendationId) || recommendationId <= 0) {
        return NextResponse.json({ error: "recommendation_id is required" }, { status: 400 });
      }
      const recommendation = await getGoogleAdsRecommendationById(recommendationId);
      if (!recommendation) {
        return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
      }
      if (recommendation.customer_id !== customerId || recommendation.campaign_id !== campaignId) {
        return NextResponse.json({ error: "Recommendation does not belong to selected customer/campaign" }, { status: 409 });
      }
      if (!(recommendation.status === "pending" || recommendation.status === "approved")) {
        return NextResponse.json(
          { error: `AI analysis is allowed only for pending/approved recommendations, got ${recommendation.status}` },
          { status: 409 },
        );
      }
      await analyzeGoogleAdsRecommendationWithAi(recommendation);
    } else if (action === "update-recommendation") {
      const recommendationId = Number(body.recommendation_id);
      if (!Number.isFinite(recommendationId) || recommendationId <= 0) {
        return NextResponse.json({ error: "recommendation_id is required" }, { status: 400 });
      }
      const suggestedNegativeKeyword = String(body.suggested_negative_keyword ?? "").trim();
      if (!suggestedNegativeKeyword) {
        return NextResponse.json({ error: "suggested_negative_keyword must be non-empty" }, { status: 400 });
      }
      const matchType = normalizeMatchType(body.match_type);
      if (!matchType) {
        return NextResponse.json({ error: "match_type must be one of PHRASE, EXACT, BROAD" }, { status: 400 });
      }
      const reviewNoteRaw = String(body.review_note ?? "").trim();
      const reviewNote = reviewNoteRaw ? reviewNoteRaw : null;
      const adminToken = parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
      const adminSession = verifyAdminSession(adminToken);
      const editedBy = adminSession?.email || "admin";
      const updated = await updateGoogleAdsRecommendation(
        recommendationId,
        suggestedNegativeKeyword,
        matchType,
        reviewNote,
        editedBy,
      );
      if (!updated) {
        return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
      }
      if (updated.status === "applied") {
        return NextResponse.json({ error: "Applied recommendations cannot be edited" }, { status: 409 });
      }
      if (!(updated.status === "pending" || updated.status === "approved")) {
        return NextResponse.json({ error: `Recommendation status ${updated.status} cannot be edited` }, { status: 409 });
      }
    } else if (action === "approve") {
      await approveGoogleAdsRecommendation(Number(body.recommendation_id));
    } else if (action === "reject") {
      await rejectGoogleAdsRecommendation(Number(body.recommendation_id), String(body.note ?? "").trim());
    } else if (action === "recommend") {
      const dateFrom = normalizeDate(body.date_from);
      const dateTo = normalizeDate(body.date_to);
      if (!dateFrom || !dateTo) {
        return NextResponse.json({ error: "date_from and date_to are required as YYYY-MM-DD" }, { status: 400 });
      }
      commandOutput = await runGoogleAdsCollectorCommand([
        "recommend-negatives",
        "--customer-id",
        customerId,
        "--campaign-id",
        campaignId,
        "--from",
        dateFrom,
        "--to",
        dateTo,
      ]);
    } else if (action === "validate") {
      const dateFrom = normalizeDate(body.date_from);
      const dateTo = normalizeDate(body.date_to);
      if (!dateFrom || !dateTo) {
        return NextResponse.json({ error: "date_from and date_to are required as YYYY-MM-DD" }, { status: 400 });
      }
      commandOutput = await runGoogleAdsCollectorCommand([
        "validate",
        "--customer-id",
        customerId,
        "--campaign-id",
        campaignId,
        "--from",
        dateFrom,
        "--to",
        dateTo,
      ]);
    } else if (action === "apply-dry-run") {
      const settings = await getGoogleAdsControlSettings(dashboardId, customerId, campaignId);
      commandOutput = await runGoogleAdsCollectorCommand([
        "apply-approved-negatives",
        "--customer-id",
        customerId,
        "--campaign-id",
        campaignId,
        "--dry-run",
        "--limit",
        String(normalizeLimit(body.apply_limit, settings.max_apply_per_run || 20)),
      ]);
    } else if (action === "apply-confirm") {
      if (String(body.confirm_text ?? "").trim() !== "APPLY") {
        return NextResponse.json({ error: "Type APPLY to confirm live Google Ads mutation" }, { status: 400 });
      }
      const settings = await getGoogleAdsControlSettings(dashboardId, customerId, campaignId);
      commandOutput = await runGoogleAdsCollectorCommand([
        "apply-approved-negatives",
        "--customer-id",
        customerId,
        "--campaign-id",
        campaignId,
        "--confirm-apply",
        "--limit",
        String(normalizeLimit(body.apply_limit, settings.max_apply_per_run || 20)),
      ]);
    } else {
      return NextResponse.json({ error: "Unknown Google Ads admin action" }, { status: 400 });
    }

    const payload = await buildPayload({
      dashboardId,
      customerId,
      campaignId,
      status,
      healthFilter,
      healthCampaignId,
      limit,
      dateFrom: String(body.date_from ?? "").trim(),
      dateTo: String(body.date_to ?? "").trim(),
      keywordPage,
      commandOutput,
    });
    if (!payload) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[google-ads-admin] action failed", error);
    return NextResponse.json(
      {
        error: "Google Ads admin action failed",
        ...(IS_PRODUCTION ? {} : { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 },
    );
  }
}

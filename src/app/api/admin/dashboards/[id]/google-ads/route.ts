import { NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  approveGoogleAdsRecommendation,
  getGoogleAdsRecommendationSummary,
  listGoogleAdsMutationLog,
  listGoogleAdsRecommendations,
  loadGoogleAdsDashboardContext,
  rejectGoogleAdsRecommendation,
  runGoogleAdsCollectorCommand,
  validateDashboardGoogleAdsTarget,
} from "@/lib/google-ads-admin";

export const runtime = "nodejs";

const STATUS_VALUES = new Set(["all", "pending", "approved", "rejected", "applied"]);

function normalizeDate(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

function normalizeStatus(value: unknown): string {
  const status = String(value ?? "pending").trim();
  return STATUS_VALUES.has(status) ? status : "pending";
}

async function buildPayload(options: {
  dashboardId: number;
  customerId?: string;
  campaignId?: string;
  status?: string;
  limit?: number;
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

  return {
    context,
    selected: {
      customer_id: customerId,
      campaign_id: campaignId,
      status,
      limit,
    },
    summary,
    recommendations,
    mutation_log: mutationLog,
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
      limit: normalizeLimit(url.searchParams.get("limit"), 50),
    });
    if (!payload) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load Google Ads admin data", details: error instanceof Error ? error.message : String(error) },
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
  const limit = normalizeLimit(body.limit, 50);
  let commandOutput: { stdout: string; stderr: string } | null = null;

  try {
    if (["recommend", "validate", "apply-dry-run", "apply-confirm"].includes(action)) {
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

    if (action === "approve") {
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
      commandOutput = await runGoogleAdsCollectorCommand([
        "apply-approved-negatives",
        "--customer-id",
        customerId,
        "--campaign-id",
        campaignId,
        "--dry-run",
        "--limit",
        String(normalizeLimit(body.apply_limit, 20)),
      ]);
    } else if (action === "apply-confirm") {
      if (String(body.confirm_text ?? "").trim() !== "APPLY") {
        return NextResponse.json({ error: "Type APPLY to confirm live Google Ads mutation" }, { status: 400 });
      }
      commandOutput = await runGoogleAdsCollectorCommand([
        "apply-approved-negatives",
        "--customer-id",
        customerId,
        "--campaign-id",
        campaignId,
        "--confirm-apply",
        "--limit",
        String(normalizeLimit(body.apply_limit, 20)),
      ]);
    } else {
      return NextResponse.json({ error: "Unknown Google Ads admin action" }, { status: 400 });
    }

    const payload = await buildPayload({
      dashboardId,
      customerId,
      campaignId,
      status,
      limit,
      commandOutput,
    });
    if (!payload) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Google Ads admin action failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

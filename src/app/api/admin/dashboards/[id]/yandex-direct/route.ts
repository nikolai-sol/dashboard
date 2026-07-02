import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from "@/lib/access-auth";
import {
  approveYandexDirectMutation,
  getYandexDirectControlSettings,
  listYandexDirectCampaignHealth,
  listYandexDirectKeywords,
  listYandexDirectMutationLog,
  loadYandexDirectDashboardContext,
  planYandexDirectMutation,
  rejectYandexDirectMutation,
  runYandexDirectCollectorCommand,
  upsertYandexDirectControlSettings,
  validateDashboardYandexDirectTarget,
} from "@/lib/yandex-direct-admin";

export const runtime = "nodejs";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const STATUS_VALUES = new Set(["all", "planned", "approved", "rejected", "applied", "failed"]);

function normalizeDate(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function defaultDateRange() {
  const to = new Date();
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 13);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
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

function normalizeBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function normalizeStatus(value: unknown): string {
  const status = String(value ?? "planned").trim();
  return STATUS_VALUES.has(status) ? status : "planned";
}

function adminEmail(request: Request) {
  const adminToken = parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
  const adminSession = verifyAdminSession(adminToken);
  return adminSession?.email || "admin";
}

async function buildPayload(options: {
  dashboardId: number;
  clientLogin?: string;
  campaignId?: string;
  status?: string;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  keywordPage?: number;
  commandOutput?: { stdout: string; stderr: string } | null;
}) {
  const context = await loadYandexDirectDashboardContext(options.dashboardId);
  if (!context) return null;
  const campaignId = options.campaignId || context.selected_campaign_id;
  const selectedCampaign =
    context.campaigns.find((campaign) => campaign.campaign_id === campaignId && (!options.clientLogin || campaign.client_login === options.clientLogin))
    ?? context.campaigns.find((campaign) => campaign.campaign_id === campaignId)
    ?? context.campaigns[0];
  const clientLogin = options.clientLogin || selectedCampaign?.client_login || context.selected_client_login;
  const accountId = selectedCampaign?.account_id || "";
  const status = normalizeStatus(options.status);
  const limit = normalizeLimit(options.limit);
  const defaults = defaultDateRange();
  const dateFrom = normalizeDate(options.dateFrom) || defaults.dateFrom;
  const dateTo = normalizeDate(options.dateTo) || defaults.dateTo;

  const settings =
    clientLogin && campaignId
      ? await getYandexDirectControlSettings(options.dashboardId, clientLogin, accountId, campaignId)
      : null;
  const mutationLog =
    clientLogin && campaignId
      ? await listYandexDirectMutationLog({
        dashboardId: options.dashboardId,
        clientLogin,
        campaignId,
        status,
        limit,
      })
      : [];
  const keywords =
    clientLogin && campaignId
      ? await listYandexDirectKeywords({
        clientLogin,
        campaignId,
        dateFrom,
        dateTo,
        page: normalizePage(options.keywordPage),
        perPage: 20,
      })
      : { rows: [], total: 0, page: 1, per_page: 20, total_pages: 1 };
  const campaignHealth = await listYandexDirectCampaignHealth({
    campaigns: context.campaigns,
    dateFrom,
    dateTo,
  });

  return {
    context,
    selected: {
      client_login: clientLogin,
      account_id: accountId,
      campaign_id: campaignId,
      status,
      limit,
      date_from: dateFrom,
      date_to: dateTo,
    },
    campaign_health: campaignHealth,
    mutation_log: mutationLog,
    keywords: keywords.rows,
    keyword_pagination: {
      total: keywords.total,
      page: keywords.page,
      per_page: keywords.per_page,
      total_pages: keywords.total_pages,
    },
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
      clientLogin: String(url.searchParams.get("client_login") ?? "").trim(),
      campaignId: String(url.searchParams.get("campaign_id") ?? "").trim(),
      status: String(url.searchParams.get("status") ?? "planned"),
      limit: normalizeLimit(url.searchParams.get("limit"), 50),
      dateFrom: String(url.searchParams.get("date_from") ?? "").trim(),
      dateTo: String(url.searchParams.get("date_to") ?? "").trim(),
      keywordPage: normalizePage(url.searchParams.get("keyword_page")),
    });
    if (!payload) return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[yandex-direct-admin] failed to load dashboard payload", error);
    return NextResponse.json(
      {
        error: "Failed to load Yandex Direct admin data",
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
  const clientLogin = String(body.client_login ?? "").trim();
  const accountId = String(body.account_id ?? "").trim();
  const campaignId = String(body.campaign_id ?? "").trim();
  const status = normalizeStatus(body.status);
  const limit = normalizeLimit(body.limit, 50);
  const keywordPage = normalizePage(body.keyword_page);
  const dateFrom = normalizeDate(body.date_from);
  const dateTo = normalizeDate(body.date_to);
  let commandOutput: { stdout: string; stderr: string } | null = null;

  try {
    if (["update-settings", "plan-mutation", "approve", "reject", "apply-dry-run", "apply-confirm"].includes(action)) {
      if (!clientLogin || !campaignId) {
        return NextResponse.json({ error: "client_login and campaign_id are required" }, { status: 400 });
      }
      const conn = await pool.getConnection();
      try {
        await validateDashboardYandexDirectTarget(conn, dashboardId, campaignId, clientLogin);
      } finally {
        conn.release();
      }
    }

    if (action === "collect") {
      const from = dateFrom || defaultDateRange().dateFrom;
      const to = dateTo || defaultDateRange().dateTo;
      const context = await loadYandexDirectDashboardContext(dashboardId);
      if (!context) return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
      const collectCampaignIds = context.campaign_ids.length ? context.campaign_ids : [campaignId].filter(Boolean);
      const campaignClientLogins = Array.from(
        new Set(
          context.campaigns
            .filter((campaign) => collectCampaignIds.includes(campaign.campaign_id))
            .map((campaign) => campaign.client_login)
            .filter(Boolean),
        ),
      );
      const collectArgs = [
        "collect",
        "--date-from",
        from,
        "--date-to",
        to,
        "--run-type",
        "manual",
        "--keywords-only",
      ];
      if (campaignClientLogins.length === 1) {
        collectArgs.push("--client-login", campaignClientLogins[0]);
      }
      if (collectCampaignIds.length) {
        collectArgs.push("--campaign-ids", collectCampaignIds.join(","));
      }
      commandOutput = await runYandexDirectCollectorCommand([
        ...collectArgs,
      ]);
    } else if (action === "update-settings") {
      await upsertYandexDirectControlSettings({
        dashboard_id: dashboardId,
        client_login: clientLogin,
        account_id: accountId,
        campaign_id: campaignId,
        control_enabled: normalizeBool(body.control_enabled, false),
        campaign_mutations_enabled: normalizeBool(body.campaign_mutations_enabled, false),
        bid_mutations_enabled: normalizeBool(body.bid_mutations_enabled, false),
        apply_enabled: normalizeBool(body.apply_enabled, false),
        auto_collect_enabled: normalizeBool(body.auto_collect_enabled, true),
        lookback_days: normalizeLimit(body.lookback_days, 14),
        max_apply_per_run: normalizeLimit(body.max_apply_per_run, 10),
      });
    } else if (action === "plan-mutation") {
      const settings = await getYandexDirectControlSettings(dashboardId, clientLogin, accountId, campaignId);
      if (!settings.control_enabled) {
        return NextResponse.json({ error: "Yandex Direct control actions are disabled: control_enabled=false" }, { status: 403 });
      }
      const mutationType = String(body.mutation_type ?? "").trim().toUpperCase();
      const isBidMutation = mutationType === "SET_KEYWORD_BID";
      if (isBidMutation && !settings.bid_mutations_enabled) {
        return NextResponse.json({ error: "Bid mutations are disabled: bid_mutations_enabled=false" }, { status: 403 });
      }
      if (!isBidMutation && !settings.campaign_mutations_enabled) {
        return NextResponse.json({ error: "Campaign mutations are disabled: campaign_mutations_enabled=false" }, { status: 403 });
      }
      await planYandexDirectMutation({
        dashboardId,
        clientLogin,
        accountId,
        campaignId,
        mutationType,
        entityId: String(body.entity_id ?? "").trim(),
        payload: body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
          ? body.payload as Record<string, unknown>
          : {},
      });
    } else if (action === "approve") {
      const settings = await getYandexDirectControlSettings(dashboardId, clientLogin, accountId, campaignId);
      if (!settings.control_enabled) {
        return NextResponse.json({ error: "Yandex Direct control actions are disabled: control_enabled=false" }, { status: 403 });
      }
      const mutationId = Number(body.mutation_id);
      if (!Number.isFinite(mutationId) || mutationId <= 0) {
        return NextResponse.json({ error: "mutation_id is required" }, { status: 400 });
      }
      await approveYandexDirectMutation(mutationId, adminEmail(request), String(body.note ?? "").trim() || null);
    } else if (action === "reject") {
      const settings = await getYandexDirectControlSettings(dashboardId, clientLogin, accountId, campaignId);
      if (!settings.control_enabled) {
        return NextResponse.json({ error: "Yandex Direct control actions are disabled: control_enabled=false" }, { status: 403 });
      }
      const mutationId = Number(body.mutation_id);
      if (!Number.isFinite(mutationId) || mutationId <= 0) {
        return NextResponse.json({ error: "mutation_id is required" }, { status: 400 });
      }
      await rejectYandexDirectMutation(mutationId, adminEmail(request), String(body.note ?? "").trim() || null);
    } else if (action === "apply-dry-run") {
      const settings = await getYandexDirectControlSettings(dashboardId, clientLogin, accountId, campaignId);
      if (!settings.control_enabled) {
        return NextResponse.json({ error: "Yandex Direct control actions are disabled: control_enabled=false" }, { status: 403 });
      }
      commandOutput = await runYandexDirectCollectorCommand([
        "apply-approved-mutations",
        "--client-login",
        clientLogin,
        "--campaign-id",
        campaignId,
        "--dry-run",
        "--limit",
        String(normalizeLimit(body.apply_limit, settings.max_apply_per_run || 10)),
      ]);
    } else if (action === "apply-confirm") {
      const settings = await getYandexDirectControlSettings(dashboardId, clientLogin, accountId, campaignId);
      if (!settings.control_enabled) {
        return NextResponse.json({ error: "Yandex Direct control actions are disabled: control_enabled=false" }, { status: 403 });
      }
      if (!settings.apply_enabled) {
        return NextResponse.json({ error: "Live apply is disabled: apply_enabled=false" }, { status: 403 });
      }
      if (String(body.confirm_text ?? "").trim() !== "APPLY") {
        return NextResponse.json({ error: "Type APPLY to confirm live Yandex Direct mutation" }, { status: 400 });
      }
      commandOutput = await runYandexDirectCollectorCommand([
        "apply-approved-mutations",
        "--client-login",
        clientLogin,
        "--campaign-id",
        campaignId,
        "--confirm-apply",
        "--limit",
        String(normalizeLimit(body.apply_limit, settings.max_apply_per_run || 10)),
      ]);
    } else {
      return NextResponse.json({ error: "Unknown Yandex Direct admin action" }, { status: 400 });
    }

    const payload = await buildPayload({
      dashboardId,
      clientLogin,
      campaignId,
      status,
      limit,
      dateFrom: dateFrom || String(body.date_from ?? "").trim(),
      dateTo: dateTo || String(body.date_to ?? "").trim(),
      keywordPage,
      commandOutput,
    });
    if (!payload) return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[yandex-direct-admin] action failed", error);
    return NextResponse.json(
      {
        error: "Yandex Direct admin action failed",
        ...(IS_PRODUCTION ? {} : { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 },
    );
  }
}

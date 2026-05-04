import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { loadDashboardWithSources } from "@/lib/admin-dashboards";

const execFileAsync = promisify(execFile);
const SOURCE_KEY = "google";

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
      suggested_negative_keyword, match_type, impressions, clicks, cost,
      conversions, conversion_value, reason_code, reason_text, confidence,
      status, reviewed_at, review_note, created_at, updated_at, applied_at
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
  const repoRoot = fs.existsSync(path.join(process.cwd(), "fetch_google_ads_canonical.py"))
    ? process.cwd()
    : path.resolve(process.cwd(), "..");
  const python = process.env.GOOGLE_ADS_PYTHON_BIN
    ?? (fs.existsSync("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : "python3");
  const env = {
    ...process.env,
    PYTHONPATH: [path.join(repoRoot, ".pydeps"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
  const { stdout, stderr } = await execFileAsync(
    python,
    ["fetch_google_ads_canonical.py", ...args],
    {
      cwd: repoRoot,
      env,
      maxBuffer: 1024 * 1024 * 3,
      timeout: 180000,
    },
  );
  return { stdout, stderr };
}

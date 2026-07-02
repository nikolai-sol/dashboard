import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { loadDashboardWithSources } from "@/lib/admin-dashboards";

const execFileAsync = promisify(execFile);
const SOURCE_KEYS = ["yandex_direct", "yandex_direct_api_shadow"];
const COLLECTOR_SCRIPT = "fetch_yandex_direct_canonical_api.py";

type SqlParam = string | number | boolean | null;

export type YandexDirectCampaignOption = {
  account_id: string;
  client_login: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
  objective: string | null;
};

export type YandexDirectDashboardContext = {
  dashboard: {
    id: number;
    client_id: string;
    client_name: string;
    dashboard_name: string;
  };
  account_ids: string[];
  campaign_ids: string[];
  campaigns: YandexDirectCampaignOption[];
  selected_client_login: string;
  selected_campaign_id: string;
};

export type YandexDirectControlSettings = {
  dashboard_id: number;
  client_login: string;
  account_id: string;
  campaign_id: string;
  control_enabled: boolean;
  campaign_mutations_enabled: boolean;
  bid_mutations_enabled: boolean;
  apply_enabled: boolean;
  auto_collect_enabled: boolean;
  lookback_days: number;
  max_apply_per_run: number;
  created_at: string | null;
  updated_at: string | null;
};

export type YandexDirectMutationLogRow = {
  id: number;
  dashboard_id: number;
  client_login: string;
  account_id: string;
  campaign_id: string;
  mutation_type: string;
  entity_type: string;
  entity_id: string;
  payload_json: Record<string, unknown>;
  status: string;
  error_message: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  applied_at: string | null;
};

export type YandexDirectKeywordPerformanceRow = {
  criterion_id: string;
  criterion_text: string;
  criterion_type: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number | null;
  avg_cpc: number | null;
  conversion_rate: number | null;
  first_date: string | null;
  last_date: string | null;
  ad_groups_count: number;
};

export type YandexDirectCampaignHealthRow = {
  account_id: string;
  client_login: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
  objective: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  keywords_total: number;
  keywords_with_clicks: number;
  pending_mutations: number;
  approved_mutations: number;
  last_fact_date: string | null;
  health_status: "critical" | "warning" | "ok";
};

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

function sourceKeyClause() {
  return SOURCE_KEYS.map(() => "?").join(",");
}

function campaignIdFromAccountId(accountId: string): string {
  return accountId.startsWith("campaign::") ? accountId.slice("campaign::".length) : "";
}

function sourceAccountIds(sourceConfig: Record<string, unknown> | null | undefined): string[] {
  return parseStringArray(sourceConfig?.account_ids);
}

function isCampaignMutation(mutationType: string) {
  return ["SUSPEND_CAMPAIGN", "RESUME_CAMPAIGN", "ARCHIVE_CAMPAIGN", "UNARCHIVE_CAMPAIGN"].includes(mutationType);
}

export async function loadYandexDirectDashboardContext(dashboardId: number): Promise<YandexDirectDashboardContext | null> {
  const conn = await pool.getConnection();
  try {
    const dashboard = await loadDashboardWithSources(conn, dashboardId);
    if (!dashboard) return null;

    const yandexSources = dashboard.sources.filter(
      (source) => source.role === "actual" && (source.platform === "yandex" || source.platform === "yandex_direct"),
    );
    const accountIds = Array.from(new Set(yandexSources.flatMap((source) => sourceAccountIds(source.source_config))));
    const campaignIds = Array.from(new Set(accountIds.map(campaignIdFromAccountId).filter(Boolean)));
    if (!accountIds.length && !campaignIds.length) {
      return {
        dashboard: {
          id: dashboard.id,
          client_id: dashboard.client_id,
          client_name: dashboard.client_name,
          dashboard_name: dashboard.dashboard_name,
        },
        account_ids: [],
        campaign_ids: [],
        campaigns: [],
        selected_client_login: "",
        selected_campaign_id: "",
      };
    }

    const filters: string[] = [];
    const params: SqlParam[] = [...SOURCE_KEYS];
    if (campaignIds.length) {
      filters.push(`c.platform_campaign_id IN (${campaignIds.map(() => "?").join(",")})`);
      params.push(...campaignIds);
    }
    if (accountIds.length) {
      filters.push(`c.platform_account_id IN (${accountIds.map(() => "?").join(",")})`);
      params.push(...accountIds);
    }
    const [campaignRows] = await conn.execute<RowDataPacket[]>(
      `
      SELECT
        c.platform_account_id AS account_id,
        c.platform_campaign_id AS campaign_id,
        c.campaign_name,
        c.campaign_status,
        c.objective,
        COALESCE(k.client_login, JSON_UNQUOTE(JSON_EXTRACT(c.raw_payload, '$.client_login')), '') AS client_login
      FROM canonical_source_campaigns c
      LEFT JOIN (
        SELECT campaign_id, MAX(client_login) AS client_login
        FROM yandex_direct_keyword_performance_daily
        GROUP BY campaign_id
      ) k
        ON k.campaign_id = c.platform_campaign_id
      WHERE c.source_key IN (${sourceKeyClause()})
        AND (${filters.join(" OR ")})
      ORDER BY c.campaign_name, c.platform_campaign_id
      LIMIT 500
      `,
      params,
    );

    const campaignsById = new Map<string, YandexDirectCampaignOption>();
    for (const row of campaignRows) {
      const campaignId = String(row.campaign_id ?? "");
      if (!campaignId) continue;
      campaignsById.set(campaignId, {
        account_id: String(row.account_id ?? `campaign::${campaignId}`),
        client_login: String(row.client_login ?? ""),
        campaign_id: campaignId,
        campaign_name: String(row.campaign_name ?? campaignId),
        campaign_status: row.campaign_status ? String(row.campaign_status) : null,
        objective: row.objective ? String(row.objective) : null,
      });
    }
    for (const campaignId of campaignIds) {
      if (!campaignsById.has(campaignId)) {
        campaignsById.set(campaignId, {
          account_id: `campaign::${campaignId}`,
          client_login: "",
          campaign_id: campaignId,
          campaign_name: `Yandex campaign ${campaignId}`,
          campaign_status: null,
          objective: null,
        });
      }
    }

    const campaigns = Array.from(campaignsById.values()).sort((a, b) =>
      `${a.client_login ? "0" : "1"}:${a.campaign_name}:${a.campaign_id}`.localeCompare(
        `${b.client_login ? "0" : "1"}:${b.campaign_name}:${b.campaign_id}`,
      ),
    );

    return {
      dashboard: {
        id: dashboard.id,
        client_id: dashboard.client_id,
        client_name: dashboard.client_name,
        dashboard_name: dashboard.dashboard_name,
      },
      account_ids: accountIds,
      campaign_ids: campaignIds,
      campaigns,
      selected_client_login: campaigns[0]?.client_login ?? "",
      selected_campaign_id: campaigns[0]?.campaign_id ?? "",
    };
  } finally {
    conn.release();
  }
}

export async function validateDashboardYandexDirectTarget(
  conn: PoolConnection,
  dashboardId: number,
  campaignId: string,
  clientLogin?: string,
) {
  const dashboard = await loadDashboardWithSources(conn, dashboardId);
  if (!dashboard) throw new Error("Dashboard not found");
  const yandexSources = dashboard.sources.filter(
    (source) => source.role === "actual" && (source.platform === "yandex" || source.platform === "yandex_direct"),
  );
  const campaignIds = new Set(
    yandexSources
      .flatMap((source) => sourceAccountIds(source.source_config))
      .map(campaignIdFromAccountId)
      .filter(Boolean),
  );
  if (!campaignIds.has(campaignId)) {
    throw new Error("Yandex Direct campaign is not connected to this dashboard");
  }
  if (!clientLogin) return;
  const [rows] = await conn.execute<RowDataPacket[]>(
    `
    SELECT 1
    FROM yandex_direct_keyword_performance_daily
    WHERE campaign_id = ?
      AND client_login = ?
    LIMIT 1
    `,
    [campaignId, clientLogin],
  );
  if (!rows.length) {
    const [campaignRows] = await conn.execute<RowDataPacket[]>(
      `
      SELECT 1
      FROM canonical_source_campaigns
      WHERE source_key IN (${sourceKeyClause()})
        AND platform_campaign_id = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.client_login')) = ?
      LIMIT 1
      `,
      [...SOURCE_KEYS, campaignId, clientLogin],
    );
    if (!campaignRows.length) throw new Error("Yandex Direct client login is not available for this dashboard campaign");
  }
}

export async function getYandexDirectControlSettings(
  dashboardId: number,
  clientLogin: string,
  accountId: string,
  campaignId: string,
): Promise<YandexDirectControlSettings> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      dashboard_id, client_login, account_id, campaign_id, control_enabled,
      campaign_mutations_enabled, bid_mutations_enabled, apply_enabled,
      auto_collect_enabled, lookback_days, max_apply_per_run, created_at, updated_at
    FROM yandex_direct_control_settings
    WHERE dashboard_id = ?
      AND client_login = ?
      AND campaign_id = ?
    LIMIT 1
    `,
    [dashboardId, clientLogin, campaignId],
  );
  if (!rows.length) {
    return {
      dashboard_id: dashboardId,
      client_login: clientLogin,
      account_id: accountId,
      campaign_id: campaignId,
      control_enabled: false,
      campaign_mutations_enabled: false,
      bid_mutations_enabled: false,
      apply_enabled: false,
      auto_collect_enabled: true,
      lookback_days: 14,
      max_apply_per_run: 10,
      created_at: null,
      updated_at: null,
    };
  }
  const row = rows[0];
  return {
    dashboard_id: Number(row.dashboard_id),
    client_login: String(row.client_login),
    account_id: String(row.account_id ?? accountId),
    campaign_id: String(row.campaign_id),
    control_enabled: boolValue(row.control_enabled),
    campaign_mutations_enabled: boolValue(row.campaign_mutations_enabled),
    bid_mutations_enabled: boolValue(row.bid_mutations_enabled),
    apply_enabled: boolValue(row.apply_enabled),
    auto_collect_enabled: boolValue(row.auto_collect_enabled),
    lookback_days: numberValue(row.lookback_days),
    max_apply_per_run: numberValue(row.max_apply_per_run),
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at),
  };
}

export async function upsertYandexDirectControlSettings(
  settings: Omit<YandexDirectControlSettings, "created_at" | "updated_at">,
) {
  await pool.execute(
    `
    INSERT INTO yandex_direct_control_settings (
      dashboard_id, client_login, account_id, campaign_id, control_enabled,
      campaign_mutations_enabled, bid_mutations_enabled, apply_enabled,
      auto_collect_enabled, lookback_days, max_apply_per_run
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      account_id = VALUES(account_id),
      control_enabled = VALUES(control_enabled),
      campaign_mutations_enabled = VALUES(campaign_mutations_enabled),
      bid_mutations_enabled = VALUES(bid_mutations_enabled),
      apply_enabled = VALUES(apply_enabled),
      auto_collect_enabled = VALUES(auto_collect_enabled),
      lookback_days = VALUES(lookback_days),
      max_apply_per_run = VALUES(max_apply_per_run),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      settings.dashboard_id,
      settings.client_login,
      settings.account_id,
      settings.campaign_id,
      settings.control_enabled ? 1 : 0,
      settings.campaign_mutations_enabled ? 1 : 0,
      settings.bid_mutations_enabled ? 1 : 0,
      settings.apply_enabled ? 1 : 0,
      settings.auto_collect_enabled ? 1 : 0,
      settings.lookback_days,
      settings.max_apply_per_run,
    ],
  );
}

export async function listYandexDirectMutationLog(options: {
  dashboardId: number;
  clientLogin: string;
  campaignId: string;
  status?: string;
  limit?: number;
}): Promise<YandexDirectMutationLogRow[]> {
  const filters = ["dashboard_id = ?", "client_login = ?", "campaign_id = ?"];
  const params: SqlParam[] = [options.dashboardId, options.clientLogin, options.campaignId];
  if (options.status && options.status !== "all") {
    filters.push("status = ?");
    params.push(options.status);
  }
  const limit = Math.min(Math.max(Number(options.limit ?? 50), 1), 200);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      id, dashboard_id, client_login, account_id, campaign_id,
      mutation_type, entity_type, entity_id, payload_json, status,
      error_message, review_note, reviewed_by, reviewed_at, created_at, applied_at
    FROM yandex_direct_mutation_log
    WHERE ${filters.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
    `,
    params,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    dashboard_id: Number(row.dashboard_id),
    client_login: String(row.client_login),
    account_id: String(row.account_id ?? ""),
    campaign_id: String(row.campaign_id),
    mutation_type: String(row.mutation_type ?? ""),
    entity_type: String(row.entity_type ?? ""),
    entity_id: String(row.entity_id ?? ""),
    payload_json: parseJsonObject(row.payload_json),
    status: String(row.status ?? ""),
    error_message: row.error_message ? String(row.error_message) : null,
    review_note: row.review_note ? String(row.review_note) : null,
    reviewed_by: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewed_at: dateString(row.reviewed_at),
    created_at: dateString(row.created_at),
    applied_at: dateString(row.applied_at),
  }));
}

export async function listYandexDirectKeywords(options: {
  clientLogin: string;
  campaignId: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
}): Promise<{ rows: YandexDirectKeywordPerformanceRow[]; total: number; page: number; per_page: number; total_pages: number }> {
  const filters = ["client_login = ?", "campaign_id = ?"];
  const params: SqlParam[] = [options.clientLogin, options.campaignId];
  if (options.dateFrom) {
    filters.push("report_date >= ?");
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    filters.push("report_date <= ?");
    params.push(options.dateTo);
  }
  const whereSql = filters.join(" AND ");
  const perPage = Math.min(Math.max(Number(options.perPage ?? 20), 1), 50);
  const page = Math.max(Math.trunc(Number(options.page ?? 1)), 1);
  const offset = (page - 1) * perPage;
  const [countRows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT COUNT(*) AS total
    FROM (
      SELECT criterion_id, criterion_text, criterion_type
      FROM yandex_direct_keyword_performance_daily
      WHERE ${whereSql}
      GROUP BY criterion_id, criterion_text, criterion_type
    ) grouped
    `,
    params,
  );
  const total = numberValue(countRows[0]?.total);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      criterion_id,
      criterion_text,
      criterion_type,
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(clicks), 0) AS clicks,
      ROUND(COALESCE(SUM(cost), 0), 6) AS cost,
      ROUND(COALESCE(SUM(conversions), 0), 6) AS conversions,
      ROUND(CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN COALESCE(SUM(clicks), 0) / COALESCE(SUM(impressions), 0) ELSE NULL END, 6) AS ctr,
      ROUND(CASE WHEN COALESCE(SUM(clicks), 0) > 0 THEN COALESCE(SUM(cost), 0) / COALESCE(SUM(clicks), 0) ELSE NULL END, 6) AS avg_cpc,
      ROUND(CASE WHEN COALESCE(SUM(clicks), 0) > 0 THEN COALESCE(SUM(conversions), 0) / COALESCE(SUM(clicks), 0) ELSE NULL END, 6) AS conversion_rate,
      MIN(report_date) AS first_date,
      MAX(report_date) AS last_date,
      COUNT(DISTINCT NULLIF(ad_group_id, '')) AS ad_groups_count
    FROM yandex_direct_keyword_performance_daily
    WHERE ${whereSql}
    GROUP BY criterion_id, criterion_text, criterion_type
    ORDER BY cost DESC, clicks DESC, impressions DESC, criterion_text
    LIMIT ${perPage} OFFSET ${offset}
    `,
    params,
  );
  return {
    rows: rows.map((row) => ({
      criterion_id: String(row.criterion_id ?? ""),
      criterion_text: String(row.criterion_text ?? ""),
      criterion_type: row.criterion_type ? String(row.criterion_type) : null,
      impressions: numberValue(row.impressions),
      clicks: numberValue(row.clicks),
      cost: numberValue(row.cost),
      conversions: numberValue(row.conversions),
      ctr: row.ctr === null ? null : numberValue(row.ctr),
      avg_cpc: row.avg_cpc === null ? null : numberValue(row.avg_cpc),
      conversion_rate: row.conversion_rate === null ? null : numberValue(row.conversion_rate),
      first_date: dateString(row.first_date),
      last_date: dateString(row.last_date),
      ad_groups_count: numberValue(row.ad_groups_count),
    })),
    total,
    page,
    per_page: perPage,
    total_pages: Math.max(Math.ceil(total / perPage), 1),
  };
}

export async function listYandexDirectCampaignHealth(options: {
  campaigns: YandexDirectCampaignOption[];
  dateFrom?: string;
  dateTo?: string;
}): Promise<YandexDirectCampaignHealthRow[]> {
  const campaignIds = options.campaigns.map((campaign) => campaign.campaign_id).filter(Boolean);
  if (!campaignIds.length) return [];
  const factFilters = [
    `source_key IN (${sourceKeyClause()})`,
    `platform_campaign_id IN (${campaignIds.map(() => "?").join(",")})`,
  ];
  const factParams: SqlParam[] = [...SOURCE_KEYS, ...campaignIds];
  if (options.dateFrom) {
    factFilters.push("report_date >= ?");
    factParams.push(options.dateFrom);
  }
  if (options.dateTo) {
    factFilters.push("report_date <= ?");
    factParams.push(options.dateTo);
  }
  const [factRows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      platform_campaign_id AS campaign_id,
      ROUND(COALESCE(SUM(spend), 0), 6) AS cost,
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(clicks), 0) AS clicks,
      ROUND(COALESCE(SUM(conversions), 0), 6) AS conversions,
      MAX(report_date) AS last_fact_date
    FROM canonical_fact_ads_daily
    WHERE ${factFilters.join(" AND ")}
    GROUP BY platform_campaign_id
    `,
    factParams,
  );
  const factByCampaign = new Map(factRows.map((row) => [String(row.campaign_id), row]));

  const keywordFilters = [`campaign_id IN (${campaignIds.map(() => "?").join(",")})`];
  const keywordParams: SqlParam[] = [...campaignIds];
  if (options.dateFrom) {
    keywordFilters.push("report_date >= ?");
    keywordParams.push(options.dateFrom);
  }
  if (options.dateTo) {
    keywordFilters.push("report_date <= ?");
    keywordParams.push(options.dateTo);
  }
  const [keywordRows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      campaign_id,
      COUNT(DISTINCT criterion_id) AS keywords_total,
      COUNT(DISTINCT CASE WHEN clicks > 0 THEN criterion_id END) AS keywords_with_clicks
    FROM yandex_direct_keyword_performance_daily
    WHERE ${keywordFilters.join(" AND ")}
    GROUP BY campaign_id
    `,
    keywordParams,
  );
  const keywordByCampaign = new Map(keywordRows.map((row) => [String(row.campaign_id), row]));

  const [mutationRows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      campaign_id,
      SUM(CASE WHEN status = 'planned' THEN 1 ELSE 0 END) AS pending_mutations,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_mutations
    FROM yandex_direct_mutation_log
    WHERE campaign_id IN (${campaignIds.map(() => "?").join(",")})
    GROUP BY campaign_id
    `,
    campaignIds,
  );
  const mutationsByCampaign = new Map(mutationRows.map((row) => [String(row.campaign_id), row]));

  return options.campaigns.map((campaign) => {
    const fact = factByCampaign.get(campaign.campaign_id);
    const keywords = keywordByCampaign.get(campaign.campaign_id);
    const mutations = mutationsByCampaign.get(campaign.campaign_id);
    const cost = numberValue(fact?.cost);
    const impressions = numberValue(fact?.impressions);
    const clicks = numberValue(fact?.clicks);
    const conversions = numberValue(fact?.conversions);
    const ctr = impressions > 0 ? clicks / impressions : null;
    const cpc = clicks > 0 ? cost / clicks : null;
    const cpa = conversions > 0 ? cost / conversions : null;
    const approvedMutations = numberValue(mutations?.approved_mutations);
    const healthStatus: "critical" | "warning" | "ok" =
      !campaign.client_login || approvedMutations > 0
        ? "critical"
        : impressions === 0 || clicks === 0
          ? "warning"
          : "ok";
    return {
      ...campaign,
      cost,
      impressions,
      clicks,
      conversions,
      ctr,
      cpc,
      cpa,
      keywords_total: numberValue(keywords?.keywords_total),
      keywords_with_clicks: numberValue(keywords?.keywords_with_clicks),
      pending_mutations: numberValue(mutations?.pending_mutations),
      approved_mutations: approvedMutations,
      last_fact_date: dateString(fact?.last_fact_date),
      health_status: healthStatus,
    };
  });
}

export async function planYandexDirectMutation(options: {
  dashboardId: number;
  clientLogin: string;
  accountId: string;
  campaignId: string;
  mutationType: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  const mutationType = options.mutationType.trim().toUpperCase();
  const payload = options.payload ?? {};
  let entityType = "campaign";
  let entityId = options.campaignId;
  if (mutationType === "SET_KEYWORD_BID") {
    entityType = "keyword";
    entityId = String(options.entityId || payload.criterion_id || "").trim();
    if (!entityId) throw new Error("criterion_id is required for SET_KEYWORD_BID");
    const bidUnits = numberValue(payload.bid_units);
    if (bidUnits <= 0) throw new Error("bid_units must be positive");
  } else if (!isCampaignMutation(mutationType)) {
    throw new Error(`Unsupported Yandex Direct mutation type: ${mutationType}`);
  }
  const [result] = await pool.execute<ResultSetHeader>(
    `
    INSERT INTO yandex_direct_mutation_log (
      dashboard_id, client_login, account_id, campaign_id,
      mutation_type, entity_type, entity_id, payload_json,
      operation_type, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', 'planned')
    `,
    [
      options.dashboardId,
      options.clientLogin,
      options.accountId,
      options.campaignId,
      mutationType,
      entityType,
      entityId,
      JSON.stringify(payload),
    ],
  );
  return Number(result.insertId || 0);
}

export async function approveYandexDirectMutation(id: number, reviewedBy: string, note: string | null) {
  await pool.execute(
    `
    UPDATE yandex_direct_mutation_log
    SET status = 'approved',
        approval_ref = COALESCE(approval_ref, CONCAT('YD-', id)),
        reviewed_by = ?,
        review_note = COALESCE(?, review_note),
        reviewed_at = NOW(),
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('planned', 'approved')
    `,
    [reviewedBy, note, id],
  );
}

export async function rejectYandexDirectMutation(id: number, reviewedBy: string, note: string | null) {
  await pool.execute(
    `
    UPDATE yandex_direct_mutation_log
    SET status = 'rejected',
        reviewed_by = ?,
        review_note = ?,
        reviewed_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('planned', 'approved', 'rejected')
    `,
    [reviewedBy, note, id],
  );
}

export async function runYandexDirectCollectorCommand(args: string[]) {
  const envScriptPath = process.env.YANDEX_DIRECT_COLLECTOR_SCRIPT_PATH?.trim();
  const envRoot = process.env.YANDEX_DIRECT_REPO_ROOT?.trim();
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
      `Yandex Direct collector script not found (${COLLECTOR_SCRIPT}). Set YANDEX_DIRECT_COLLECTOR_SCRIPT_PATH or YANDEX_DIRECT_REPO_ROOT.`,
    );
  }
  const repoRoot = path.dirname(scriptPath);
  const python = process.env.YANDEX_DIRECT_PYTHON_BIN
    ?? (fs.existsSync("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : "python3");
  const env = {
    ...process.env,
    PYTHONPATH: [path.join(repoRoot, ".pydeps"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONWARNINGS: process.env.PYTHONWARNINGS || "ignore",
  };
  try {
    const { stdout, stderr } = await execFileAsync(
      python,
      [scriptPath, ...args],
      {
        cwd: repoRoot,
        env,
        maxBuffer: 1024 * 1024 * 3,
        timeout: 240000,
      },
    );
    return { stdout, stderr };
  } catch (error) {
    const execError = error as {
      message?: string;
      stdout?: string;
      stderr?: string;
      code?: number | string | null;
    };
    const stderr = String(execError?.stderr ?? "").trim();
    const stdout = String(execError?.stdout ?? "").trim();
    const tail = (value: string) => (value.length > 1200 ? value.slice(-1200) : value);
    const details = [stderr ? `stderr: ${tail(stderr)}` : "", stdout ? `stdout: ${tail(stdout)}` : ""]
      .filter(Boolean)
      .join(" | ");
    const codePart = execError?.code != null ? ` (exit=${String(execError.code)})` : "";
    throw new Error(
      `Yandex Direct collector command failed${codePart}: ${execError?.message || "unknown error"}${details ? ` | ${details}` : ""}`,
    );
  }
}

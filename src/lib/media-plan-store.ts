import type { PoolConnection, RowDataPacket } from "mysql2/promise";

type SqlExecutor = Pick<PoolConnection, "execute">;

export type StoredMediaPlanRow = {
  line_key: string;
  platform: string;
  channel: string;
  format: string;
  buy_type: string;
  units_plan: number;
  unit_price: number;
  budget_plan: number;
  impressions_plan: number;
  reach_plan: number;
  frequency_plan: number;
  views_plan: number;
  clicks_plan: number;
  conversions_plan: number;
  ctr_plan: number;
  cpm_plan: number;
  cpc_plan: number;
  cpv_plan: number;
  cpa_plan: number;
  monthly: Record<string, number>;
  row_order?: number;
  [key: string]: unknown;
};

export type StoredMediaPlanAlias = {
  platform: string;
  alias_key: string;
  source_key: string | null;
  campaign_id: string;
  campaign_name: string;
};

type MediaPlanRowDb = RowDataPacket & {
  line_key: string;
  row_order: number;
  platform: string;
  channel: string;
  format: string;
  buy_type: string;
  units_plan: number | string | null;
  unit_price: number | string | null;
  budget_plan: number | string | null;
  impressions_plan: number | string | null;
  reach_plan: number | string | null;
  frequency_plan: number | string | null;
  views_plan: number | string | null;
  clicks_plan: number | string | null;
  conversions_plan: number | string | null;
  ctr_plan: number | string | null;
  cpm_plan: number | string | null;
  cpc_plan: number | string | null;
  cpv_plan: number | string | null;
  cpa_plan: number | string | null;
  monthly_json: string | Record<string, unknown> | null;
  raw_json: string | Record<string, unknown> | null;
};

type MediaPlanAliasDb = RowDataPacket & {
  platform: string;
  alias_key: string;
  source_key: string | null;
  platform_campaign_id: string;
  campaign_name: string;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function roundMetric(value: unknown): number {
  return Number(asNumber(value).toFixed(6));
}

function normalizeMonthly(input: unknown): Record<string, number> {
  const monthly = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const next: Record<string, number> = {};
  for (const [month, value] of Object.entries(monthly)) {
    next[month] = roundMetric(value);
  }
  return next;
}

function normalizeRowForStorage(row: Record<string, unknown>, rowOrder: number): StoredMediaPlanRow | null {
  const lineKey = String(row.line_key ?? "").trim();
  const platform = String(row.platform ?? "").trim();
  const channel = String(row.channel ?? "").trim();
  if (!lineKey || !platform || !channel) return null;

  return {
    ...row,
    line_key: lineKey,
    row_order: rowOrder,
    platform,
    channel,
    format: String(row.format ?? "").trim(),
    buy_type: String(row.buy_type ?? "CPM").trim().toUpperCase() || "CPM",
    units_plan: roundMetric(row.units_plan),
    unit_price: roundMetric(row.unit_price),
    budget_plan: roundMetric(row.budget_plan),
    impressions_plan: roundMetric(row.impressions_plan),
    reach_plan: roundMetric(row.reach_plan),
    frequency_plan: roundMetric(row.frequency_plan),
    views_plan: roundMetric(row.views_plan),
    clicks_plan: roundMetric(row.clicks_plan),
    conversions_plan: roundMetric(row.conversions_plan),
    ctr_plan: roundMetric(row.ctr_plan),
    cpm_plan: roundMetric(row.cpm_plan),
    cpc_plan: roundMetric(row.cpc_plan),
    cpv_plan: roundMetric(row.cpv_plan),
    cpa_plan: roundMetric(row.cpa_plan),
    monthly: normalizeMonthly(row.monthly),
  };
}

export function normalizeMediaPlanRowsForStorage(rows: unknown): StoredMediaPlanRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) =>
      normalizeRowForStorage((row ?? {}) as Record<string, unknown>, index),
    )
    .filter((row): row is StoredMediaPlanRow => Boolean(row));
}

export function flattenMediaPlanAliasesForStorage(value: unknown): StoredMediaPlanAlias[] {
  if (!value || typeof value !== "object") return [];
  const aliasesRoot = value as Record<string, unknown>;
  const result: StoredMediaPlanAlias[] = [];

  for (const [platform, aliases] of Object.entries(aliasesRoot)) {
    if (!aliases || typeof aliases !== "object") continue;
    for (const [aliasKey, rawEntry] of Object.entries(aliases as Record<string, unknown>)) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const entry = rawEntry as Record<string, unknown>;
      const campaignId = String(entry.campaign_id ?? "").trim();
      const campaignName = String(entry.campaign_name ?? "").trim();
      const sourceKeyRaw = String(entry.source_key ?? "").trim();
      const normalizedAliasKey = String(aliasKey ?? "").trim();
      const normalizedPlatform = String(platform ?? "").trim();
      if (!normalizedPlatform || !normalizedAliasKey || !campaignId || !campaignName) continue;
      result.push({
        platform: normalizedPlatform,
        alias_key: normalizedAliasKey,
        source_key: sourceKeyRaw || null,
        campaign_id: campaignId,
        campaign_name: campaignName,
      });
    }
  }

  return result.sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) ||
      a.alias_key.localeCompare(b.alias_key) ||
      a.campaign_id.localeCompare(b.campaign_id),
  );
}

export function buildAliasMemoryFromRows(rows: StoredMediaPlanAlias[]): Record<string, Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, Record<string, string>>> = {};
  for (const row of rows) {
    if (!result[row.platform]) result[row.platform] = {};
    result[row.platform][row.alias_key] = {
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      ...(row.source_key ? { source_key: row.source_key } : {}),
    };
  }
  return result;
}

export async function replaceDashboardMediaPlanRows(
  conn: SqlExecutor,
  dashboardId: number,
  rowsInput: unknown,
): Promise<void> {
  const rows = normalizeMediaPlanRowsForStorage(rowsInput);
  await conn.execute(`DELETE FROM dashboard_media_plan_rows WHERE dashboard_id = ?`, [dashboardId]);
  if (!rows.length) return;

  for (const row of rows) {
    await conn.execute(
      `INSERT INTO dashboard_media_plan_rows (
         dashboard_id,
         line_key,
         row_order,
         platform,
         channel,
         format,
         buy_type,
         units_plan,
         unit_price,
         budget_plan,
         impressions_plan,
         reach_plan,
         frequency_plan,
         views_plan,
         clicks_plan,
         conversions_plan,
         ctr_plan,
         cpm_plan,
         cpc_plan,
         cpv_plan,
         cpa_plan,
         monthly_json,
         raw_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dashboardId,
        row.line_key,
        row.row_order ?? 0,
        row.platform,
        row.channel,
        row.format,
        row.buy_type,
        row.units_plan,
        row.unit_price,
        row.budget_plan,
        row.impressions_plan,
        row.reach_plan,
        row.frequency_plan,
        row.views_plan,
        row.clicks_plan,
        row.conversions_plan,
        row.ctr_plan,
        row.cpm_plan,
        row.cpc_plan,
        row.cpv_plan,
        row.cpa_plan,
        JSON.stringify(row.monthly ?? {}),
        JSON.stringify(row),
      ],
    );
  }
}

export async function replaceDashboardMediaPlanAliases(
  conn: SqlExecutor,
  dashboardId: number,
  aliasesInput: unknown,
): Promise<void> {
  const aliases = flattenMediaPlanAliasesForStorage(aliasesInput);
  await conn.execute(`DELETE FROM dashboard_media_plan_aliases WHERE dashboard_id = ?`, [dashboardId]);
  if (!aliases.length) return;

  for (const alias of aliases) {
    await conn.execute(
      `INSERT INTO dashboard_media_plan_aliases (
         dashboard_id,
         platform,
         alias_key,
         source_key,
         platform_campaign_id,
         campaign_name
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        dashboardId,
        alias.platform,
        alias.alias_key,
        alias.source_key,
        alias.campaign_id,
        alias.campaign_name,
      ],
    );
  }
}

export async function loadDashboardMediaPlanRows(
  conn: SqlExecutor,
  dashboardId: number,
): Promise<StoredMediaPlanRow[]> {
  const [rows] = await conn.execute<MediaPlanRowDb[]>(
    `SELECT *
     FROM dashboard_media_plan_rows
     WHERE dashboard_id = ?
     ORDER BY row_order, line_key`,
    [dashboardId],
  );

  return rows.map((row) => {
    const rawJson = parseJsonObject(row.raw_json);
    return {
      ...rawJson,
      line_key: String(row.line_key ?? "").trim(),
      row_order: asNumber(row.row_order),
      platform: String(row.platform ?? "").trim(),
      channel: String(row.channel ?? "").trim(),
      format: String(row.format ?? "").trim(),
      buy_type: String(row.buy_type ?? "CPM").trim().toUpperCase() || "CPM",
      units_plan: roundMetric(row.units_plan),
      unit_price: roundMetric(row.unit_price),
      budget_plan: roundMetric(row.budget_plan),
      impressions_plan: roundMetric(row.impressions_plan),
      reach_plan: roundMetric(row.reach_plan),
      frequency_plan: roundMetric(row.frequency_plan),
      views_plan: roundMetric(row.views_plan),
      clicks_plan: roundMetric(row.clicks_plan),
      conversions_plan: roundMetric(row.conversions_plan),
      ctr_plan: roundMetric(row.ctr_plan),
      cpm_plan: roundMetric(row.cpm_plan),
      cpc_plan: roundMetric(row.cpc_plan),
      cpv_plan: roundMetric(row.cpv_plan),
      cpa_plan: roundMetric(row.cpa_plan),
      monthly: normalizeMonthly(parseJsonObject(row.monthly_json)),
    };
  });
}

export async function loadDashboardMediaPlanAliases(
  conn: SqlExecutor,
  dashboardId: number,
): Promise<StoredMediaPlanAlias[]> {
  const [rows] = await conn.execute<MediaPlanAliasDb[]>(
    `SELECT platform, alias_key, source_key, platform_campaign_id, campaign_name
     FROM dashboard_media_plan_aliases
     WHERE dashboard_id = ?
     ORDER BY platform, alias_key`,
    [dashboardId],
  );

  return rows.map((row) => ({
    platform: String(row.platform ?? "").trim(),
    alias_key: String(row.alias_key ?? "").trim(),
    source_key: row.source_key ? String(row.source_key).trim().toLowerCase() : null,
    campaign_id: String(row.platform_campaign_id ?? "").trim(),
    campaign_name: String(row.campaign_name ?? "").trim(),
  }));
}

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "./db";
import { loadDashboardMediaPlanRows, type StoredMediaPlanRow } from "./media-plan-store";
import { resolveSourceKey } from "./source-mapping";

type SqlExecutor = Pick<PoolConnection, "execute">;

type MetricValues = {
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
  reach: number;
};

export type BoundAdvertisingDailyFact = MetricValues & {
  date: string;
  lineKey: string;
  channel: string;
  canonicalCampaignId: number;
  sourceKey: string;
  platformAccountId: string;
  platformCampaignId: string;
  campaignName: string;
};

export type BoundAdvertisingLine = MetricValues & {
  lineKey: string;
  channel: string;
  campaignIds: number[];
  campaigns: Array<{
    canonicalCampaignId: number;
    sourceKey: string;
    platformAccountId: string;
    platformCampaignId: string;
    campaignName: string;
  }>;
  plan: StoredMediaPlanRow | null;
  monthlyPlan: Record<string, number>;
  selectedMonthlyPlan: Record<string, number>;
};

export type UnboundAdvertisingFact = MetricValues & {
  date: string;
  canonicalCampaignId: number | null;
  sourceKey: string;
  platformAccountId: string;
  platformCampaignId: string;
  campaignName: string;
};

export type AdvertisingBindingReadModel = {
  daily: BoundAdvertisingDailyFact[];
  lineDaily: Array<MetricValues & { date: string; lineKey: string; channel: string }>;
  lines: Map<string, BoundAdvertisingLine>;
  unboundFacts: UnboundAdvertisingFact[];
  unresolvedLegacyBindings: Array<{
    lineKey: string;
    channel: string;
    sourceKey: string;
    platformCampaignId: string;
  }>;
};

type DashboardConfigRow = RowDataPacket & {
  dashboard_type: string;
  config: string | Record<string, unknown> | null;
};

type SourceRow = RowDataPacket & {
  platform: string;
  source_config: string | Record<string, unknown> | null;
};

type BoundFactRow = RowDataPacket & {
  line_key: string;
  channel: string;
  canonical_campaign_id: number | string;
  source_key: string;
  platform_account_id: string;
  platform_campaign_id: string;
  campaign_name: string | null;
  report_date: string | Date;
  impressions: number | string | null;
  clicks: number | string | null;
  spend: number | string | null;
  views: number | string | null;
  conversions: number | string | null;
  reach: number | string | null;
};

type BindingCatalogRow = RowDataPacket & {
  line_key: string;
  channel: string;
  canonical_campaign_id: number | string;
  source_key: string;
  platform_account_id: string;
  platform_campaign_id: string;
  campaign_name: string | null;
};

type UnresolvedBindingRow = RowDataPacket & {
  line_key: string | null;
  channel: string;
  source_key: string;
  platform_campaign_id: string;
};

type UnboundFactRow = RowDataPacket & {
  canonical_campaign_id: number | string | null;
  source_key: string;
  platform_account_id: string;
  platform_campaign_id: string;
  campaign_name: string | null;
  report_date: string | Date;
  impressions: number | string | null;
  clicks: number | string | null;
  spend: number | string | null;
  views: number | string | null;
  conversions: number | string | null;
  reach: number | string | null;
};

function parseObject(value: unknown): Record<string, unknown> {
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
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isoDate(value: unknown, field: string): string {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field} must be an ISO date`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${field} must be an ISO date`);
  }
  return text;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metrics(row: BoundFactRow | UnboundFactRow): MetricValues {
  return {
    impressions: numberValue(row.impressions),
    clicks: numberValue(row.clicks),
    spend: numberValue(row.spend),
    views: numberValue(row.views),
    conversions: numberValue(row.conversions),
    reach: numberValue(row.reach),
  };
}

function selectedSourceAccounts(rows: SourceRow[]): Array<{ sourceKey: string; accountId: string }> {
  const result = new Map<string, { sourceKey: string; accountId: string }>();
  for (const row of rows) {
    const config = parseObject(row.source_config);
    const sourceKey = String(config.source_key ?? resolveSourceKey(row.platform)).trim();
    const rawAccounts = Array.isArray(config.account_ids)
      ? config.account_ids
      : [config.platform_account_id];
    for (const rawAccount of rawAccounts) {
      const accountId = String(rawAccount ?? "").trim();
      if (!sourceKey || !accountId) continue;
      result.set(`${sourceKey}\u0000${accountId}`, { sourceKey, accountId });
    }
  }
  return Array.from(result.values());
}

function frequencyOverrides(config: Record<string, unknown>): Map<string, number> {
  const rows = Array.isArray(config.campaign_frequency_overrides)
    ? config.campaign_frequency_overrides
    : [];
  const result = new Map<string, number>();
  for (const raw of rows) {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const sourceKey = String(row.source_key ?? "").trim();
    const campaignId = String(row.platform_campaign_id ?? "").trim();
    const month = String(row.month_key ?? "").trim();
    const frequency = numberValue(row.frequency);
    if (sourceKey && campaignId && /^\d{4}-\d{2}$/.test(month) && frequency > 0) {
      result.set(`${sourceKey}\u0000${campaignId}\u0000${month}`, frequency);
    }
  }
  return result;
}

function addMetrics(target: MetricValues, addition: MetricValues): void {
  target.impressions += addition.impressions;
  target.clicks += addition.clicks;
  target.spend += addition.spend;
  target.views += addition.views;
  target.conversions += addition.conversions;
  target.reach += addition.reach;
}

function zeroMetrics(): MetricValues {
  return { impressions: 0, clicks: 0, spend: 0, views: 0, conversions: 0, reach: 0 };
}

export async function loadBoundAdvertisingFacts(
  dashboardId: number,
  from: string,
  to: string,
  executor: SqlExecutor = pool as unknown as SqlExecutor,
): Promise<AdvertisingBindingReadModel> {
  if (!Number.isSafeInteger(dashboardId) || dashboardId <= 0) throw new Error("dashboard id is invalid");
  const dateFrom = isoDate(from, "from");
  const dateTo = isoDate(to, "to");
  if (dateFrom > dateTo) throw new Error("advertising read range is invalid");

  const [dashboardRows] = await executor.execute<DashboardConfigRow[]>(
    "SELECT dashboard_type, config FROM dashboards WHERE id = ? LIMIT 1",
    [dashboardId],
  );
  const dashboard = dashboardRows[0];
  if (!dashboard) throw new Error("dashboard was not found");
  if (["abbott_bi", "zaruku_bi"].includes(String(dashboard.dashboard_type))) {
    throw new Error("canonical advertising read model is not available for this dashboard");
  }
  const overrideMap = frequencyOverrides(parseObject(dashboard.config));

  const [sourceRows] = await executor.execute<SourceRow[]>(
    `SELECT platform, source_config
     FROM dashboard_sources
     WHERE dashboard_id = ? AND role = 'actual'
     ORDER BY id`,
    [dashboardId],
  );
  const selectedAccounts = selectedSourceAccounts(sourceRows);
  const plans = await loadDashboardMediaPlanRows(executor as never, dashboardId);

  const [bindingCatalogRows] = await executor.execute<BindingCatalogRow[]>(
    `/* binding_catalog */
     SELECT
       b.line_key,
       b.channel,
       c.id AS canonical_campaign_id,
       c.source_key,
       c.platform_account_id,
       c.platform_campaign_id,
       c.campaign_name
     FROM media_plan_bindings b
     JOIN canonical_source_campaigns c ON c.id = b.canonical_campaign_id
     WHERE b.dashboard_id = ?
       AND b.canonical_campaign_id IS NOT NULL
       AND COALESCE(b.effective_from, ?) <= ?
       AND COALESCE(b.effective_to, ?) >= ?
     ORDER BY b.line_key, c.source_key, c.platform_account_id, c.platform_campaign_id`,
    [dashboardId, dateFrom, dateTo, dateTo, dateFrom],
  );

  const [boundRows] = await executor.execute<BoundFactRow[]>(
    `/* bound_advertising_fact */
     SELECT
       b.line_key,
       MAX(b.channel) AS channel,
       c.id AS canonical_campaign_id,
       c.source_key,
       c.platform_account_id,
       c.platform_campaign_id,
       MAX(c.campaign_name) AS campaign_name,
       f.report_date,
       COALESCE(SUM(f.impressions), 0) AS impressions,
       COALESCE(SUM(f.clicks), 0) AS clicks,
       COALESCE(SUM(f.spend), 0) AS spend,
       COALESCE(SUM(f.views), 0) AS views,
       COALESCE(SUM(f.conversions), 0) AS conversions,
       COALESCE(SUM(f.reach), 0) AS reach
     FROM media_plan_bindings b
     JOIN canonical_source_campaigns c ON c.id = b.canonical_campaign_id
     JOIN canonical_source_platforms p ON p.source_key = c.source_key
     JOIN canonical_advertising_facts_current f
       ON f.source_key = c.source_key
      AND f.platform_account_id = c.platform_account_id
      AND f.platform_campaign_id = c.platform_campaign_id
      AND f.report_date >= COALESCE(b.effective_from, ?)
      AND f.report_date <= COALESCE(b.effective_to, ?)
      AND f.fact_scope = p.default_fact_scope
      AND f.breakdown_scope = 'default'
     WHERE b.dashboard_id = ?
       AND b.canonical_campaign_id IS NOT NULL
       AND f.report_date BETWEEN ? AND ?
     GROUP BY b.line_key, c.id, c.source_key, c.platform_account_id,
              c.platform_campaign_id, f.report_date
     ORDER BY f.report_date, b.line_key, c.id`,
    [dateFrom, dateTo, dashboardId, dateFrom, dateTo],
  );

  const [legacyRows] = await executor.execute<UnresolvedBindingRow[]>(
    `/* unresolved_legacy_binding */
     SELECT line_key, channel, source_key, platform_campaign_id
     FROM media_plan_bindings
     WHERE dashboard_id = ? AND canonical_campaign_id IS NULL
     ORDER BY line_key, source_key, platform_campaign_id`,
    [dashboardId],
  );

  let unboundRows: UnboundFactRow[] = [];
  if (selectedAccounts.length) {
    const accountFilter = selectedAccounts.map(() => "(f.source_key = ? AND f.platform_account_id = ?)").join(" OR ");
    const accountParams = selectedAccounts.flatMap((item) => [item.sourceKey, item.accountId]);
    const [rows] = await executor.execute<UnboundFactRow[]>(
      `/* unbound_advertising_fact */
       SELECT
         c.id AS canonical_campaign_id,
         f.source_key,
         f.platform_account_id,
         f.platform_campaign_id,
         MAX(c.campaign_name) AS campaign_name,
         f.report_date,
         COALESCE(SUM(f.impressions), 0) AS impressions,
         COALESCE(SUM(f.clicks), 0) AS clicks,
         COALESCE(SUM(f.spend), 0) AS spend,
         COALESCE(SUM(f.views), 0) AS views,
         COALESCE(SUM(f.conversions), 0) AS conversions,
         COALESCE(SUM(f.reach), 0) AS reach
       FROM canonical_advertising_facts_current f
       JOIN canonical_source_platforms p ON p.source_key = f.source_key
       LEFT JOIN canonical_source_campaigns c
         ON c.source_key = f.source_key
        AND c.platform_account_id = f.platform_account_id
        AND c.platform_campaign_id = f.platform_campaign_id
       LEFT JOIN media_plan_bindings b
         ON b.dashboard_id = ?
        AND b.canonical_campaign_id = c.id
        AND f.report_date >= COALESCE(b.effective_from, ?)
        AND f.report_date <= COALESCE(b.effective_to, ?)
       WHERE f.report_date BETWEEN ? AND ?
         AND (${accountFilter})
         AND f.fact_scope = p.default_fact_scope
         AND f.breakdown_scope = 'default'
         AND b.id IS NULL
       GROUP BY c.id, f.source_key, f.platform_account_id, f.platform_campaign_id, f.report_date
       ORDER BY f.report_date, f.source_key, f.platform_account_id, f.platform_campaign_id`,
      [dashboardId, dateFrom, dateTo, dateFrom, dateTo, ...accountParams],
    );
    unboundRows = rows;
  }

  const daily: BoundAdvertisingDailyFact[] = boundRows.map((row) => {
    const date = isoDate(row.report_date, "fact report_date");
    const values = metrics(row);
    const override = overrideMap.get(
      `${String(row.source_key)}\u0000${String(row.platform_campaign_id)}\u0000${date.slice(0, 7)}`,
    );
    if (override && values.impressions > 0) values.reach = values.impressions / override;
    return {
      ...values,
      date,
      lineKey: String(row.line_key),
      channel: String(row.channel),
      canonicalCampaignId: Number(row.canonical_campaign_id),
      sourceKey: String(row.source_key),
      platformAccountId: String(row.platform_account_id),
      platformCampaignId: String(row.platform_campaign_id),
      campaignName: String(row.campaign_name ?? row.platform_campaign_id),
    };
  });

  type MutableLine = BoundAdvertisingLine & { campaignMap: Map<number, BoundAdvertisingLine["campaigns"][number]> };
  const mutableLines = new Map<string, MutableLine>();
  for (const plan of plans) {
    const monthlyPlan = { ...plan.monthly };
    mutableLines.set(plan.line_key, {
      ...zeroMetrics(),
      lineKey: plan.line_key,
      channel: plan.channel,
      campaignIds: [],
      campaigns: [],
      campaignMap: new Map(),
      plan,
      monthlyPlan,
      selectedMonthlyPlan: Object.fromEntries(
        Object.entries(monthlyPlan).filter(([month]) => month >= dateFrom.slice(0, 7) && month <= dateTo.slice(0, 7)),
      ),
    });
  }

  for (const binding of bindingCatalogRows) {
    const lineKey = String(binding.line_key);
    if (!mutableLines.has(lineKey)) {
      mutableLines.set(lineKey, {
        ...zeroMetrics(),
        lineKey,
        channel: String(binding.channel),
        campaignIds: [],
        campaigns: [],
        campaignMap: new Map(),
        plan: null,
        monthlyPlan: {},
        selectedMonthlyPlan: {},
      });
    }
    mutableLines.get(lineKey)!.campaignMap.set(Number(binding.canonical_campaign_id), {
      canonicalCampaignId: Number(binding.canonical_campaign_id),
      sourceKey: String(binding.source_key),
      platformAccountId: String(binding.platform_account_id),
      platformCampaignId: String(binding.platform_campaign_id),
      campaignName: String(binding.campaign_name ?? binding.platform_campaign_id),
    });
  }

  const lineDailyMap = new Map<string, MetricValues & { date: string; lineKey: string; channel: string }>();
  for (const row of daily) {
    if (!mutableLines.has(row.lineKey)) {
      mutableLines.set(row.lineKey, {
        ...zeroMetrics(),
        lineKey: row.lineKey,
        channel: row.channel,
        campaignIds: [],
        campaigns: [],
        campaignMap: new Map(),
        plan: null,
        monthlyPlan: {},
        selectedMonthlyPlan: {},
      });
    }
    const line = mutableLines.get(row.lineKey)!;
    addMetrics(line, row);
    line.campaignMap.set(row.canonicalCampaignId, {
      canonicalCampaignId: row.canonicalCampaignId,
      sourceKey: row.sourceKey,
      platformAccountId: row.platformAccountId,
      platformCampaignId: row.platformCampaignId,
      campaignName: row.campaignName,
    });

    const lineDateKey = `${row.lineKey}\u0000${row.date}`;
    if (!lineDailyMap.has(lineDateKey)) {
      lineDailyMap.set(lineDateKey, {
        ...zeroMetrics(),
        date: row.date,
        lineKey: row.lineKey,
        channel: row.channel,
      });
    }
    addMetrics(lineDailyMap.get(lineDateKey)!, row);
  }

  const lines = new Map<string, BoundAdvertisingLine>();
  for (const [lineKey, mutable] of mutableLines) {
    const campaigns = Array.from(mutable.campaignMap.values()).sort(
      (left, right) => left.canonicalCampaignId - right.canonicalCampaignId,
    );
    lines.set(lineKey, {
      lineKey: mutable.lineKey,
      channel: mutable.channel,
      impressions: mutable.impressions,
      clicks: mutable.clicks,
      spend: mutable.spend,
      views: mutable.views,
      conversions: mutable.conversions,
      reach: mutable.reach,
      campaignIds: campaigns.map((campaign) => campaign.canonicalCampaignId),
      campaigns,
      plan: mutable.plan,
      monthlyPlan: mutable.monthlyPlan,
      selectedMonthlyPlan: mutable.selectedMonthlyPlan,
    });
  }

  return {
    daily,
    lineDaily: Array.from(lineDailyMap.values()).sort(
      (left, right) => left.date.localeCompare(right.date) || left.lineKey.localeCompare(right.lineKey),
    ),
    lines,
    unboundFacts: unboundRows.map((row) => ({
      ...metrics(row),
      date: isoDate(row.report_date, "unbound fact report_date"),
      canonicalCampaignId: row.canonical_campaign_id === null ? null : Number(row.canonical_campaign_id),
      sourceKey: String(row.source_key),
      platformAccountId: String(row.platform_account_id),
      platformCampaignId: String(row.platform_campaign_id),
      campaignName: String(row.campaign_name ?? row.platform_campaign_id),
    })),
    unresolvedLegacyBindings: legacyRows.map((row) => ({
      lineKey: String(row.line_key ?? row.channel),
      channel: String(row.channel),
      sourceKey: String(row.source_key),
      platformCampaignId: String(row.platform_campaign_id),
    })),
  };
}

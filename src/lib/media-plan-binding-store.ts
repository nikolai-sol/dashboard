import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { resolveSourceKey } from "./source-mapping";

export type EffectiveBindingInput = {
  line_key: string;
  channel: string;
  canonical_campaign_id: number;
  effective_from: string | null;
  effective_to: string | null;
};

export type ResolvedEffectiveBinding = {
  dashboard_id: number;
  line_key: string;
  channel: string;
  canonical_campaign_id: number;
  source_key: string;
  platform_account_id: string;
  platform_campaign_id: string;
  campaign_name: string;
  effective_from: string;
  effective_to: string;
};

export class BindingValidationError extends Error {}

type DashboardRow = RowDataPacket & {
  id: number;
  dashboard_type: string;
  config: string | Record<string, unknown> | null;
};

type SourceRow = RowDataPacket & {
  platform: string;
  source_config: string | Record<string, unknown> | null;
};

type CampaignRow = RowDataPacket & {
  id: number | string;
  source_key: string;
  platform_account_id: string;
  platform_campaign_id: string;
  campaign_name: string | null;
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
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new BindingValidationError(`${field} must be an ISO date`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new BindingValidationError(`${field} must be an ISO date`);
  }
  return text;
}

function selectedSourceAccounts(rows: SourceRow[]): Set<string> {
  const selected = new Set<string>();
  for (const row of rows) {
    const config = parseObject(row.source_config);
    const sourceKey = String(config.source_key ?? resolveSourceKey(row.platform)).trim();
    if (!sourceKey || sourceKey === "manual_data") continue;
    const rawAccounts = Array.isArray(config.account_ids)
      ? config.account_ids
      : [config.platform_account_id];
    for (const rawAccount of rawAccounts) {
      const accountId = String(rawAccount ?? "").trim();
      if (accountId) selected.add(`${sourceKey}\u0000${accountId}`);
    }
  }
  return selected;
}

export async function preflightBindings(
  conn: PoolConnection,
  dashboardId: number,
  inputs: EffectiveBindingInput[],
): Promise<ResolvedEffectiveBinding[]> {
  if (!Number.isInteger(dashboardId) || dashboardId <= 0) {
    throw new BindingValidationError("dashboard id is invalid");
  }
  const [dashboards] = await conn.execute<DashboardRow[]>(
    "SELECT id, dashboard_type, config FROM dashboards WHERE id = ? LIMIT 1 FOR UPDATE",
    [dashboardId],
  );
  const dashboard = dashboards[0];
  if (!dashboard) throw new BindingValidationError("dashboard was not found");
  if (["abbott_bi", "zaruku_bi"].includes(String(dashboard.dashboard_type))) {
    throw new BindingValidationError("canonical advertising bindings are not supported for this dashboard");
  }
  const dashboardConfig = parseObject(dashboard.config);
  const periodFrom = isoDate(dashboardConfig.period_from, "dashboard period_from");
  const periodTo = isoDate(dashboardConfig.period_to, "dashboard period_to");
  if (periodFrom > periodTo) throw new BindingValidationError("dashboard period is invalid");

  const [sources] = await conn.execute<SourceRow[]>(
    `SELECT platform, source_config
     FROM dashboard_sources
     WHERE dashboard_id = ? AND role = 'actual'
     ORDER BY id FOR UPDATE`,
    [dashboardId],
  );
  const selectedAccounts = selectedSourceAccounts(sources);

  const normalized = inputs.map((raw, index) => {
    const lineKey = String(raw.line_key ?? "").trim();
    const channel = String(raw.channel ?? "").trim();
    const campaignId = Number(raw.canonical_campaign_id);
    if (!lineKey || !channel || !Number.isSafeInteger(campaignId) || campaignId <= 0) {
      throw new BindingValidationError(`binding ${index + 1} has invalid identity`);
    }
    const effectiveFrom = raw.effective_from === null
      ? periodFrom
      : isoDate(raw.effective_from, `binding ${index + 1} effective_from`);
    const effectiveTo = raw.effective_to === null
      ? periodTo
      : isoDate(raw.effective_to, `binding ${index + 1} effective_to`);
    if (effectiveFrom > effectiveTo) {
      throw new BindingValidationError(`binding ${index + 1} has an invalid effective period`);
    }
    if (effectiveFrom < periodFrom || effectiveTo > periodTo) {
      throw new BindingValidationError(`binding ${index + 1} is outside the dashboard period`);
    }
    return { lineKey, channel, campaignId, effectiveFrom, effectiveTo };
  });

  const campaignIds = Array.from(new Set(normalized.map((item) => item.campaignId)));
  let campaigns: CampaignRow[] = [];
  if (campaignIds.length) {
    const [rows] = await conn.execute<CampaignRow[]>(
      `SELECT id, source_key, platform_account_id, platform_campaign_id, campaign_name
       FROM canonical_source_campaigns
       WHERE id IN (${campaignIds.map(() => "?").join(", ")})
       ORDER BY id FOR UPDATE`,
      campaignIds,
    );
    campaigns = rows;
  }
  const campaignById = new Map(campaigns.map((row) => [Number(row.id), row]));
  if (campaignById.size !== campaignIds.length) {
    throw new BindingValidationError("canonical campaign was not found");
  }

  const resolved = normalized.map((input) => {
    const campaign = campaignById.get(input.campaignId)!;
    const sourceKey = String(campaign.source_key);
    const accountId = String(campaign.platform_account_id);
    if (!selectedAccounts.has(`${sourceKey}\u0000${accountId}`)) {
      throw new BindingValidationError("canonical campaign is outside the dashboard selected source account");
    }
    return {
      dashboard_id: dashboardId,
      line_key: input.lineKey,
      channel: input.channel,
      canonical_campaign_id: input.campaignId,
      source_key: sourceKey,
      platform_account_id: accountId,
      platform_campaign_id: String(campaign.platform_campaign_id),
      campaign_name: String(campaign.campaign_name ?? campaign.platform_campaign_id),
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo,
    };
  });

  const byCampaign = new Map<number, ResolvedEffectiveBinding[]>();
  for (const item of resolved) {
    const existing = byCampaign.get(item.canonical_campaign_id) ?? [];
    for (const other of existing) {
      if (item.effective_from <= other.effective_to && other.effective_from <= item.effective_to) {
        throw new BindingValidationError(
          `overlapping binding for canonical campaign ${item.canonical_campaign_id}`,
        );
      }
    }
    existing.push(item);
    byCampaign.set(item.canonical_campaign_id, existing);
  }
  return resolved;
}

export async function replaceEffectiveBindings(
  conn: PoolConnection,
  dashboardId: number,
  actor: string,
  inputs: EffectiveBindingInput[],
): Promise<ResolvedEffectiveBinding[]> {
  const reviewedActor = actor.trim();
  if (!reviewedActor) throw new BindingValidationError("authenticated actor is required");
  const resolved = await preflightBindings(conn, dashboardId, inputs);
  const [beforeRows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, dashboard_id, line_key, channel, source_key, canonical_campaign_id,
            platform_account_id, platform_campaign_id, effective_from, effective_to, created_by
     FROM media_plan_bindings
     WHERE dashboard_id = ?
     ORDER BY id FOR UPDATE`,
    [dashboardId],
  );

  for (const row of beforeRows) {
    await conn.execute(
      `INSERT INTO media_plan_binding_audit
         (dashboard_id, binding_id, action, actor, before_json, after_json)
       VALUES (?, ?, 'delete', ?, ?, NULL)`,
      [dashboardId, Number(row.id), reviewedActor, JSON.stringify(row)],
    );
  }
  await conn.execute("DELETE FROM media_plan_bindings WHERE dashboard_id = ?", [dashboardId]);

  for (const binding of resolved) {
    const [inserted] = await conn.execute<ResultSetHeader>(
      `INSERT INTO media_plan_bindings
         (dashboard_id, line_key, channel, source_key, canonical_campaign_id,
          platform_account_id, platform_campaign_id, effective_from, effective_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dashboardId, binding.line_key, binding.channel, binding.source_key,
        binding.canonical_campaign_id, binding.platform_account_id,
        binding.platform_campaign_id, binding.effective_from, binding.effective_to,
        reviewedActor,
      ],
    );
    await conn.execute(
      `INSERT INTO media_plan_binding_audit
         (dashboard_id, binding_id, action, actor, before_json, after_json)
       VALUES (?, ?, 'create', ?, NULL, ?)`,
      [
        dashboardId,
        inserted.insertId,
        reviewedActor,
        JSON.stringify({ ...binding, created_by: reviewedActor }),
      ],
    );
  }
  return resolved;
}

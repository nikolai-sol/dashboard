import type { DashboardUpsertPayload } from '@/lib/admin-dashboards';
import { getActiveAccounts, getCampaignCatalog } from '@/lib/canonical-adapter';
import { parseMediaPlanSource, type MediaPlanRow, type MediaPlanFormat } from '@/lib/gsheet-fetcher';
import { fetchManualData, aggregateByChannel } from '@/lib/manual-data-fetcher';
import { resolveSourceKey, resolveSourceType } from '@/lib/source-mapping';

export type MediaPlanIssueSeverity = 'error' | 'warn' | 'info';

export type MediaPlanIssue = {
  severity: MediaPlanIssueSeverity;
  code: string;
  message: string;
  platform?: string;
};

export type MediaPlanSourceReview = {
  platform: string;
  source_key: string;
  selected_account_ids: number;
  active_accounts: number;
  suggested_accounts: number;
  has_plan_rows: boolean;
  status: 'matched' | 'actual_without_plan' | 'inactive_source';
};

export type MediaPlanPlatformReview = {
  platform: string;
  row_count: number;
  channels: string[];
  status: 'matched' | 'missing_source';
};

export type MediaPlanSampleRow = {
  platform: string;
  channel: string;
  buy_type: string;
  budget_plan: number;
  cpm_plan: number;
  cpc_plan: number;
  cpv_plan: number;
  cpa_plan: number;
};

export type MediaPlanRowBindingStatus = 'canonical_bound' | 'plan_only' | 'unresolved';

export type MediaPlanBindingCandidate = {
  campaign_id: string;
  campaign_name: string;
  score: number;
};

export type MediaPlanAliasMemoryEntry = {
  source_key?: string | null;
  campaign_id: string;
  campaign_name: string;
};

export type MediaPlanAliasMemory = Record<string, Record<string, MediaPlanAliasMemoryEntry>>;

export type MediaPlanRowOverride = {
  action: 'bind' | 'plan_only';
  campaign_id?: string | null;
  campaign_name?: string | null;
};

export type MediaPlanRowOverrideMap = Record<string, MediaPlanRowOverride>;

export type MediaPlanRowBinding = {
  row_key: string;
  platform: string;
  channel: string;
  buy_type: string;
  status: MediaPlanRowBindingStatus;
  bound_campaign_id: string | null;
  bound_campaign_name: string | null;
  match_score: number | null;
  candidates: MediaPlanBindingCandidate[];
};

export type MediaPlanBindingSummary = {
  canonical_bound: number;
  plan_only: number;
  unresolved: number;
};

export type MediaPlanPreflightResult = {
  status: 'ok' | 'warn' | 'error';
  sheet_url_input: string;
  sheet_url_fetch: string;
  format: MediaPlanFormat;
  rows_total: number;
  rows_parsed: number;
  channels: number;
  platforms: string[];
  matched_platforms: string[];
  missing_source_platforms: string[];
  actual_without_plan_platforms: string[];
  issues: MediaPlanIssue[];
  platform_review: MediaPlanPlatformReview[];
  source_review: MediaPlanSourceReview[];
  binding_summary: MediaPlanBindingSummary;
  row_bindings: MediaPlanRowBinding[];
  alias_memory: MediaPlanAliasMemory;
  sample_rows: MediaPlanSampleRow[];
};

export type MediaPlanResolutionAction = 'connect_source' | 'plan_only' | 'ignore';

export type MediaPlanResolutionMap = Record<string, MediaPlanResolutionAction>;

export type MediaPlanReviewedConfig = {
  review_version: 1;
  status: 'confirmed';
  confirmed_at: string;
  format: MediaPlanFormat;
  sheet_url_input: string;
  sheet_url_fetch: string;
  rows_total: number;
  rows_parsed: number;
  channels: number;
  platforms: string[];
  matched_platforms: string[];
  missing_source_platforms: string[];
  actual_without_plan_platforms: string[];
  plan_only_platforms: string[];
  ignored_platforms: string[];
  connect_source_platforms: string[];
  resolutions: MediaPlanResolutionMap;
  issues: MediaPlanIssue[];
  binding_summary: MediaPlanBindingSummary;
  row_bindings: MediaPlanRowBinding[];
  alias_memory: MediaPlanAliasMemory;
};

export type MediaPlanApplyResult = {
  analysis: MediaPlanPreflightResult;
  reviewed_source_config: Record<string, unknown>;
  updated_sources: DashboardUpsertPayload['sources'];
};

function parseAccountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function parseAliasMemory(value: unknown): MediaPlanAliasMemory {
  if (!value || typeof value !== 'object') return {};
  const result: MediaPlanAliasMemory = {};
  for (const [platform, aliases] of Object.entries(value as Record<string, unknown>)) {
    if (!aliases || typeof aliases !== 'object') continue;
    result[platform] = {};
    for (const [alias, entry] of Object.entries(aliases as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const data = entry as Record<string, unknown>;
      const campaignId = String(data.campaign_id ?? '').trim();
      const campaignName = String(data.campaign_name ?? '').trim();
      const sourceKey = String(data.source_key ?? '').trim().toLowerCase() || null;
      if (!campaignId || !campaignName) continue;
      result[platform][alias] = {
        source_key: sourceKey,
        campaign_id: campaignId,
        campaign_name: campaignName,
      };
    }
  }
  return result;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function aliasKey(row: Pick<MediaPlanRow, 'channel' | 'format'>): string {
  const primary = normalizeText(String(row.channel ?? ''));
  if (primary) return primary;
  return normalizeText(String(row.format ?? ''));
}

function buildRowKey(row: MediaPlanRow, index: number): string {
  return `${index}:${row.platform}:${row.channel}:${row.buy_type}:${row.budget_plan.toFixed(2)}`;
}

function toSampleRow(row: MediaPlanRow): MediaPlanSampleRow {
  return {
    platform: row.platform,
    channel: row.channel,
    buy_type: row.buy_type,
    budget_plan: Number(row.budget_plan.toFixed(2)),
    cpm_plan: Number(row.cpm_plan.toFixed(4)),
    cpc_plan: Number(row.cpc_plan.toFixed(4)),
    cpv_plan: Number(row.cpv_plan.toFixed(4)),
    cpa_plan: Number(row.cpa_plan.toFixed(4)),
  };
}

function summarizeRowsByPlatform(rows: MediaPlanRow[]): MediaPlanPlatformReview[] {
  const byPlatform = new Map<string, { row_count: number; channels: Set<string> }>();
  for (const row of rows) {
    if (!row.platform) continue;
    if (!byPlatform.has(row.platform)) {
      byPlatform.set(row.platform, { row_count: 0, channels: new Set<string>() });
    }
    const agg = byPlatform.get(row.platform)!;
    agg.row_count += 1;
    if (row.channel) agg.channels.add(row.channel);
  }
  return [...byPlatform.entries()]
    .map(([platform, agg]) => ({
      platform,
      row_count: agg.row_count,
      channels: [...agg.channels].slice(0, 5),
      status: 'missing_source' as const,
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));
}

function buildBindingSummary(rowBindings: MediaPlanRowBinding[]): MediaPlanBindingSummary {
  return rowBindings.reduce<MediaPlanBindingSummary>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { canonical_bound: 0, plan_only: 0, unresolved: 0 },
  );
}

function scoreCandidate(
  row: MediaPlanRow,
  campaign: { id: string; name: string },
  aliasEntry?: MediaPlanAliasMemoryEntry,
): number {
  const rowValues = [row.channel, row.format].map((value) => String(value ?? '').trim()).filter(Boolean);
  if (!rowValues.length) return 0;

  const campaignId = String(campaign.id).trim().toLowerCase();
  const campaignName = String(campaign.name).trim();
  const normalizedCampaignName = normalizeText(campaignName);

  let best = 0;
  if (aliasEntry && String(aliasEntry.campaign_id).trim() === String(campaign.id).trim()) {
    best = Math.max(best, 0.98);
  }

  for (const value of rowValues) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) continue;

    if (normalizedValue === campaignId || normalizedValue === normalizedCampaignName) {
      best = Math.max(best, 1);
      continue;
    }

    if (normalizedCampaignName.includes(normalizedValue) || normalizedValue.includes(normalizedCampaignName)) {
      best = Math.max(best, 0.93);
    }

    const rowTokens = tokenize(normalizedValue);
    const campaignTokens = tokenize(normalizedCampaignName);
    if (!rowTokens.length || !campaignTokens.length) continue;
    const overlap = rowTokens.filter((token) => campaignTokens.includes(token)).length;
    if (!overlap) continue;
    const score =
      (overlap * 2) / Math.max(rowTokens.length + campaignTokens.length, 1);
    if (score >= 0.6) {
      best = Math.max(best, Number((0.65 + score * 0.25).toFixed(2)));
    }
  }

  return best;
}

function scoreManualCandidate(row: MediaPlanRow, manual: { id: string; name: string }): number {
  const rowChannel = normalizeText(String(row.channel ?? ''));
  const name = String(manual.name).trim();
  const normalizedName = normalizeText(name);
  if (!rowChannel) return 0.5;
  if (rowChannel === normalizedName) return 0.95;
  if (normalizedName.includes(rowChannel) || rowChannel.includes(normalizedName)) return 0.85;
  const rowTokens = tokenize(rowChannel);
  const nameTokens = tokenize(normalizedName);
  const overlap = rowTokens.filter((t) => nameTokens.includes(t)).length;
  if (overlap > 0) return Math.max(0.5, 0.5 + overlap * 0.1);
  return 0.5;
}

async function buildRowBindings(
  rows: MediaPlanRow[],
  actualSources: DashboardUpsertPayload['sources'],
  aliasMemory: MediaPlanAliasMemory,
  rowOverrides: MediaPlanRowOverrideMap = {},
  periodFrom?: string,
  periodTo?: string,
): Promise<MediaPlanRowBinding[]> {
  const catalogByPlatform = new Map<string, Array<{ id: string; name: string }>>();
  const manualChannelsByPlatform = new Map<string, Array<{ id: string; name: string }>>();

  for (const source of actualSources) {
    const sourceKey = resolveSourceKey(source.platform);
    const sourceType = resolveSourceType(sourceKey);

    if (source.platform === 'manual_data' && sourceType === 'manual') {
      const sheetUrl = String(source.source_config?.sheet_url ?? '').trim();
      if (sheetUrl) {
        try {
          const manualRows = await fetchManualData(sheetUrl);
          const byChannel = aggregateByChannel(manualRows);
          for (const ch of byChannel) {
            const platform = ch.platform.toLowerCase();
            const id = `manual:${ch.platform}|${ch.channel}`;
            const name = `${ch.platform} / ${ch.channel}`;
            if (!manualChannelsByPlatform.has(platform)) {
              manualChannelsByPlatform.set(platform, []);
            }
            manualChannelsByPlatform.get(platform)!.push({ id, name });
          }
        } catch {
          // skip failed manual fetch
        }
      }
      continue;
    }

    if (sourceType !== 'ads') continue;
    const accountIds = parseAccountIds(source.source_config?.account_ids);
    const isYandex = sourceKey === 'yandex_direct';
    const opts =
      isYandex && periodFrom && periodTo
        ? {
            accountIds,
            dateFrom: periodFrom,
            dateTo: periodTo,
            requireFactInRange: true,
          }
        : accountIds;
    catalogByPlatform.set(source.platform, await getCampaignCatalog(sourceKey, opts));
  }

  return rows.map((row, index) => {
    const rowKey = buildRowKey(row, index);
    const override = rowOverrides[rowKey];
    if (override?.action === 'plan_only') {
      return {
        row_key: rowKey,
        platform: row.platform,
        channel: row.channel,
        buy_type: row.buy_type,
        status: 'plan_only',
        bound_campaign_id: null,
        bound_campaign_name: null,
        match_score: null,
        candidates: [],
      };
    }

    const catalog = catalogByPlatform.get(row.platform) ?? [];
    const manualChannels = manualChannelsByPlatform.get(row.platform) ?? [];
    const allCandidates = [
      ...catalog.map((c) => ({ campaign_id: c.id, campaign_name: c.name, score: scoreCandidate(row, { id: c.id, name: c.name }, aliasMemory[row.platform]?.[aliasKey(row)]) })),
      ...manualChannels.map((m) => ({
        campaign_id: m.id,
        campaign_name: m.name,
        score: scoreManualCandidate(row, m),
      })),
    ];

    if (catalog.length === 0 && manualChannels.length === 0) {
      return {
        row_key: rowKey,
        platform: row.platform,
        channel: row.channel,
        buy_type: row.buy_type,
        status: 'plan_only',
        bound_campaign_id: null,
        bound_campaign_name: null,
        match_score: null,
        candidates: [],
      };
    }

    const candidates = allCandidates
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (override?.action === 'bind') {
      const chosen = candidates.find((candidate) => candidate.campaign_id === override.campaign_id);
      return {
        row_key: rowKey,
        platform: row.platform,
        channel: row.channel,
        buy_type: row.buy_type,
        status: 'canonical_bound',
        bound_campaign_id: String(override.campaign_id ?? '').trim() || chosen?.campaign_id || null,
        bound_campaign_name: String(override.campaign_name ?? '').trim() || chosen?.campaign_name || null,
        match_score: chosen?.score ?? 1,
        candidates,
      };
    }

    const best = candidates[0];
    if (best && best.score >= 0.93) {
      return {
        row_key: rowKey,
        platform: row.platform,
        channel: row.channel,
        buy_type: row.buy_type,
        status: 'canonical_bound',
        bound_campaign_id: best.campaign_id,
        bound_campaign_name: best.campaign_name,
        match_score: best.score,
        candidates,
      };
    }

    return {
      row_key: rowKey,
      platform: row.platform,
      channel: row.channel,
      buy_type: row.buy_type,
      status: 'unresolved',
      bound_campaign_id: null,
      bound_campaign_name: null,
      match_score: best?.score ?? null,
      candidates,
    };
  });
}

function buildAliasMemoryFromBindings(
  rowBindings: MediaPlanRowBinding[],
  existing: MediaPlanAliasMemory,
): MediaPlanAliasMemory {
  const next: MediaPlanAliasMemory = { ...existing };

  for (const binding of rowBindings) {
    if (binding.status !== 'canonical_bound' || !binding.bound_campaign_id || !binding.bound_campaign_name) {
      continue;
    }
    const key = aliasKey({ channel: binding.channel, format: '' } as Pick<MediaPlanRow, 'channel' | 'format'>);
    if (!key) continue;
    next[binding.platform] = next[binding.platform] ?? {};
    next[binding.platform][key] = {
      campaign_id: binding.bound_campaign_id,
      campaign_name: binding.bound_campaign_name,
    };
  }

  return next;
}

function defaultSchemaFileForPlatform(platform: string): string {
  const map: Record<string, string> = {
    linkedin: 'schemas/linkedin.yaml',
    reddit: 'schemas/reddit.yaml',
    vk: 'schemas/vk.yaml',
    hybrid: 'schemas/hybrid.yaml',
    between: 'schemas/between.yaml',
    git: 'schemas/git.yaml',
    yandex: 'schemas/yandex.yaml',
    google: 'schemas/google.yaml',
    meta: 'schemas/meta.yaml',
    x: 'schemas/x.yaml',
    dv360: 'schemas/dv360.yaml',
  };
  return map[platform] ?? `schemas/${platform}.yaml`;
}

export async function analyzeMediaPlanPayload(
  payload: DashboardUpsertPayload,
  rowOverrides: MediaPlanRowOverrideMap = {},
): Promise<MediaPlanPreflightResult> {
  const actualSources = payload.sources.filter((source) => source.role === 'actual');
  const planSource = payload.sources.find((source) => source.role === 'plan');
  const sheetUrl = String(planSource?.source_config?.sheet_url ?? '').trim();
  const existingAliasMemory = parseAliasMemory(
    planSource?.source_config &&
      typeof planSource.source_config.review === 'object' &&
      planSource.source_config.review
      ? (planSource.source_config.review as Record<string, unknown>).alias_memory
      : undefined,
  );

  const issues: MediaPlanIssue[] = [];

  if (!planSource || (!sheetUrl && !planSource.source_config?.inline_rows && !planSource.source_config?.upload_file)) {
    issues.push({
      severity: 'error',
      code: 'missing_sheet_url',
      message: 'Media plan source is not configured: provide sheet URL or upload csv/xlsx.',
    });
    return {
      status: 'error',
      sheet_url_input: sheetUrl,
      sheet_url_fetch: '',
      format: 'unknown',
      rows_total: 0,
      rows_parsed: 0,
      channels: 0,
      platforms: [],
      matched_platforms: [],
      missing_source_platforms: [],
      actual_without_plan_platforms: actualSources.map((source) => source.platform),
      issues,
      platform_review: [],
      source_review: [],
      binding_summary: { canonical_bound: 0, plan_only: 0, unresolved: 0 },
      row_bindings: [],
      alias_memory: existingAliasMemory,
      sample_rows: [],
    };
  }

  const parsed = await parseMediaPlanSource(planSource.source_config ?? {});

  if (parsed.format === 'unknown') {
    issues.push({
      severity: 'warn',
      code: 'unknown_format',
      message: 'Media plan format is not one of the known templates. Parsed rows may be incomplete.',
    });
  }

  if (parsed.rows.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no_parsed_rows',
      message: 'Sheet fetched successfully, but no parsable media plan rows were found.',
    });
  }

  const platformReview = summarizeRowsByPlatform(parsed.rows);
  const planPlatforms = platformReview.map((item) => item.platform);
  const actualPlatforms = actualSources.map((source) => source.platform);
  const actualPlatformSet = new Set(actualPlatforms);

  platformReview.forEach((item) => {
    item.status = actualPlatformSet.has(item.platform) ? 'matched' : 'missing_source';
    if (item.status === 'missing_source') {
      issues.push({
        severity: 'warn',
        code: 'missing_actual_source',
        message: `Media plan has rows for platform '${item.platform}', but dashboard actual sources do not include it.`,
        platform: item.platform,
      });
    }
  });

  const matchedPlatforms = platformReview.filter((item) => item.status === 'matched').map((item) => item.platform);
  const missingSourcePlatforms = platformReview.filter((item) => item.status === 'missing_source').map((item) => item.platform);
  const actualWithoutPlanPlatforms = actualPlatforms.filter((platform) => !planPlatforms.includes(platform));

  for (const platform of actualWithoutPlanPlatforms) {
    issues.push({
      severity: 'info',
      code: 'actual_without_plan',
      message: `Dashboard actual source '${platform}' has no rows in media plan.`,
      platform,
    });
  }

  const sourceReview: MediaPlanSourceReview[] = [];
  for (const source of actualSources) {
    const sourceKey = resolveSourceKey(source.platform);
    const sourceType = resolveSourceType(sourceKey);
    if (sourceType !== 'ads' && sourceType !== 'analytics') continue;

    const isYandex = sourceKey === 'yandex_direct';
    const periodFrom = String(payload.config?.period_from ?? '').trim();
    const periodTo = String(payload.config?.period_to ?? '').trim();
    const activeAccounts = await getActiveAccounts(sourceKey, sourceType, {
      client_name: payload.client_name,
      date_from: isYandex && periodFrom.length === 10 ? periodFrom : undefined,
      date_to: isYandex && periodTo.length === 10 ? periodTo : undefined,
    });
    const selectedAccountIds = parseAccountIds(source.source_config?.account_ids);
    const hasPlanRows = planPlatforms.includes(source.platform);

    sourceReview.push({
      platform: source.platform,
      source_key: sourceKey,
      selected_account_ids: selectedAccountIds.length,
      active_accounts: activeAccounts.length,
      suggested_accounts: activeAccounts.filter((item) => item.suggested).length,
      has_plan_rows: hasPlanRows,
      status: hasPlanRows ? 'matched' : activeAccounts.length > 0 ? 'actual_without_plan' : 'inactive_source',
    });
  }

  const periodFrom = String(payload.config?.period_from ?? '').trim();
  const periodTo = String(payload.config?.period_to ?? '').trim();
  const rowBindings = await buildRowBindings(
    parsed.rows,
    actualSources,
    existingAliasMemory,
    rowOverrides,
    periodFrom.length === 10 ? periodFrom : undefined,
    periodTo.length === 10 ? periodTo : undefined,
  );
  const bindingSummary = buildBindingSummary(rowBindings);
  const aliasMemory = buildAliasMemoryFromBindings(rowBindings, existingAliasMemory);

  if (bindingSummary.unresolved > 0) {
    issues.push({
      severity: 'warn',
      code: 'unresolved_row_bindings',
      message: `${bindingSummary.unresolved} media plan row(s) could not be confidently bound to canonical campaigns.`,
    });
  }

  const rowsWithoutBudget = parsed.rows.filter((row) => row.budget_plan <= 0).length;
  if (rowsWithoutBudget > 0) {
    issues.push({
      severity: 'warn',
      code: 'rows_without_budget',
      message: `${rowsWithoutBudget} parsed row(s) have zero or missing planned budget.`,
    });
  }

  const rowsWithoutPrice = parsed.rows.filter((row) => {
    if (row.buy_type === 'CPC') return row.cpc_plan <= 0;
    if (row.buy_type === 'CPV') return row.cpv_plan <= 0;
    if (row.buy_type === 'CPA') return row.cpa_plan <= 0;
    return row.cpm_plan <= 0;
  }).length;
  if (rowsWithoutPrice > 0) {
    issues.push({
      severity: 'warn',
      code: 'rows_without_price',
      message: `${rowsWithoutPrice} parsed row(s) are missing KPI unit price for their buy type.`,
    });
  }

  const status: MediaPlanPreflightResult['status'] = issues.some((item) => item.severity === 'error')
    ? 'error'
    : issues.some((item) => item.severity === 'warn')
      ? 'warn'
      : 'ok';

  return {
    status,
    sheet_url_input: parsed.input_url,
    sheet_url_fetch: parsed.fetch_url,
    format: parsed.format,
    rows_total: parsed.raw_rows,
    rows_parsed: parsed.rows.length,
    channels: new Set(parsed.rows.map((row) => row.channel).filter(Boolean)).size,
    platforms: planPlatforms,
    matched_platforms: matchedPlatforms,
    missing_source_platforms: missingSourcePlatforms,
    actual_without_plan_platforms: actualWithoutPlanPlatforms,
    issues,
    platform_review: platformReview,
    source_review: sourceReview,
    binding_summary: bindingSummary,
    row_bindings: rowBindings,
    alias_memory: aliasMemory,
    sample_rows: parsed.rows.slice(0, 8).map((row) => toSampleRow(row)),
  };
}

export async function applyMediaPlanReview(
  payload: DashboardUpsertPayload,
  resolutions: MediaPlanResolutionMap,
  rowOverrides: MediaPlanRowOverrideMap = {},
): Promise<MediaPlanApplyResult> {
  const analysis = await analyzeMediaPlanPayload(payload, rowOverrides);
  const actualSources = payload.sources.filter((source) => source.role === 'actual');
  const planSource = payload.sources.find((source) => source.role === 'plan');

  if (!planSource) {
    throw new Error('Media plan source is not configured.');
  }

  const parsedSource = await parseMediaPlanSource(planSource.source_config ?? {});

  const normalizedResolutions: MediaPlanResolutionMap = {};
  for (const platform of analysis.missing_source_platforms) {
    const action = resolutions[platform] ?? 'plan_only';
    normalizedResolutions[platform] = action;
  }

  const connectSourcePlatforms = analysis.missing_source_platforms.filter(
    (platform) => normalizedResolutions[platform] === 'connect_source',
  );
  const planOnlyPlatforms = analysis.missing_source_platforms.filter(
    (platform) => normalizedResolutions[platform] === 'plan_only',
  );
  const ignoredPlatforms = analysis.missing_source_platforms.filter(
    (platform) => normalizedResolutions[platform] === 'ignore',
  );

  const reviewedSourceConfig: Record<string, unknown> = {
    ...(planSource.source_config ?? {}),
    inline_rows: parsedSource.rows.map((row) => ({ ...row })),
    upload_file: undefined,
    review: {
      review_version: 1,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      format: analysis.format,
      sheet_url_input: analysis.sheet_url_input,
      sheet_url_fetch: analysis.sheet_url_fetch,
      rows_total: analysis.rows_total,
      rows_parsed: analysis.rows_parsed,
      channels: analysis.channels,
      platforms: analysis.platforms,
      matched_platforms: analysis.matched_platforms,
      missing_source_platforms: analysis.missing_source_platforms,
      actual_without_plan_platforms: analysis.actual_without_plan_platforms,
      plan_only_platforms: planOnlyPlatforms,
      ignored_platforms: ignoredPlatforms,
      connect_source_platforms: connectSourcePlatforms,
      resolutions: normalizedResolutions,
      issues: analysis.issues,
      binding_summary: analysis.binding_summary,
      row_bindings: analysis.row_bindings,
      alias_memory: analysis.alias_memory,
    } satisfies MediaPlanReviewedConfig,
  };

  const existingPlatformSet = new Set(actualSources.map((source) => source.platform));
  const appendedSources = connectSourcePlatforms
    .filter((platform) => !existingPlatformSet.has(platform))
    .map((platform) => ({
      platform,
      schema_file: defaultSchemaFileForPlatform(platform),
      role: 'actual' as const,
      source_config: { account_ids: [] },
      filters: [{ filter_type: 'all' as const, filter_value: null }],
    }));

  const updatedSources = [
    ...actualSources,
    ...appendedSources,
    {
      ...planSource,
      source_config: reviewedSourceConfig,
    },
  ];

  return {
    analysis,
    reviewed_source_config: reviewedSourceConfig,
    updated_sources: updatedSources,
  };
}

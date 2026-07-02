import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { normalizeMultibrandConfig } from "@/lib/multibrand";
import { buildManualSourceKey, deleteDashboardManualFactsExceptKeys } from "@/lib/manual-data-store";
import {
  buildAliasMemoryFromRows,
  loadDashboardMediaPlanAliases,
  loadDashboardMediaPlanRows,
  replaceDashboardMediaPlanAliases,
  replaceDashboardMediaPlanRows,
} from "@/lib/media-plan-store";

export type DashboardFilterInput = {
  filter_type: "name_pattern" | "id_list" | "all";
  filter_value: string | null;
};

export type DashboardSourceInput = {
  id?: number;
  platform: string;
  schema_file: string;
  role: "actual" | "plan" | "custom_table";
  source_config: Record<string, unknown> | null;
  filters: DashboardFilterInput[];
};

export type MediaPlanBindingInput = {
  line_key?: string;
  channel: string;
  source_key: string;
  platform_campaign_id: string;
};

export type DashboardUpsertPayload = {
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: "awareness" | "performance" | "overview" | "multibrand" | "abbott_bi" | "zaruku_bi";
  config: Record<string, unknown>;
  sources: DashboardSourceInput[];
  media_plan_bindings: MediaPlanBindingInput[];
};

export type DashboardWithSources = {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: "awareness" | "performance" | "overview" | "multibrand" | "abbott_bi" | "zaruku_bi";
  is_active: number | boolean;
  config: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  sources: Array<{
    id: number;
    platform: string;
    schema_file: string;
    role: "actual" | "plan" | "custom_table";
    source_config: Record<string, unknown> | null;
    filters: DashboardFilterInput[];
  }>;
  media_plan_bindings: MediaPlanBindingInput[];
};

export type DashboardPayloadLogSummary = {
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: DashboardUpsertPayload["dashboard_type"];
  config: {
    period_from?: string;
    period_to?: string;
    currency?: string;
    language?: string;
    show_spend?: boolean;
    spend_source?: string;
    kpi_cards_count: number;
    visible_metrics_count: number;
    section_order_count: number;
    custom_kpi_cards_count?: number;
    multibrand_enabled?: boolean;
    multibrand_brands_count?: number;
  };
  sources: Array<{
    platform: string;
    role: DashboardSourceInput["role"];
    schema_file: string;
    filters_count: number;
    has_sheet_url: boolean;
    account_ids_count: number;
    has_inline_rows: boolean;
    has_review: boolean;
  }>;
  media_plan_bindings_count: number;
  campaign_frequency_overrides_count: number;
};

function parseJsonField(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function countAliasEntries(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  let count = 0;
  for (const aliases of Object.values(value as Record<string, unknown>)) {
    if (!aliases || typeof aliases !== "object") continue;
    count += Object.keys(aliases as Record<string, unknown>).length;
  }
  return count;
}

function normalizeFilter(raw: unknown): DashboardFilterInput {
  const input = (raw ?? {}) as Partial<DashboardFilterInput>;
  const filterType = input.filter_type ?? "all";
  if (!["all", "name_pattern", "id_list"].includes(filterType)) {
    return { filter_type: "all", filter_value: null };
  }
  return {
    filter_type: filterType as DashboardFilterInput["filter_type"],
    filter_value: input.filter_value ? String(input.filter_value) : null,
  };
}

function normalizeSource(raw: unknown): DashboardSourceInput {
  const input = (raw ?? {}) as Partial<DashboardSourceInput>;
  const role =
    input.role === "plan"
      ? "plan"
      : input.role === "custom_table"
        ? "custom_table"
        : "actual";
  const filtersInput = Array.isArray(input.filters) ? input.filters : [{ filter_type: "all", filter_value: null }];
  const filters = filtersInput.map((filter) => normalizeFilter(filter));
  const platform =
    role === "custom_table"
      ? "custom_table"
      : String(input.platform ?? "").trim().toLowerCase();
  const schemaFile =
    role === "custom_table"
      ? "custom_table"
      : String(input.schema_file ?? "").trim();

  const sourceConfigBase =
    input.source_config && typeof input.source_config === "object"
      ? { ...(input.source_config as Record<string, unknown>) }
      : {};
  const sourceConfig: Record<string, unknown> | null = sourceConfigBase;

  if (role === "plan" && sourceConfig) {
    const inlineRows = Array.isArray(sourceConfig.inline_rows) ? sourceConfig.inline_rows : [];
    const hasInlineRows = inlineRows.length > 0;
    if (hasInlineRows) {
      delete sourceConfig.upload_file;
    }
    const review =
      sourceConfig.review && typeof sourceConfig.review === "object"
        ? { ...(sourceConfig.review as Record<string, unknown>) }
        : null;
    const aliasEntriesCount = countAliasEntries(review?.alias_memory);
    if (review && Object.prototype.hasOwnProperty.call(review, "alias_memory")) {
      delete review.alias_memory;
      sourceConfig.review = review;
    }
    sourceConfig.storage_mode = "db_backed";
    sourceConfig.stored_rows_count = inlineRows.length;
    sourceConfig.stored_aliases_count = aliasEntriesCount;
  }

  if (platform === "manual_data") {
    const sourceKey = String(sourceConfig?.manual_source_key ?? "").trim();
    if (!sourceKey) {
      sourceConfig.manual_source_key = buildManualSourceKey();
    }
  }

  return {
    id: input.id,
    platform,
    schema_file: schemaFile,
    role,
    source_config: sourceConfig,
    filters: filters.length ? filters : [{ filter_type: "all", filter_value: null }],
  };
}

function normalizeMediaPlanBinding(raw: unknown): MediaPlanBindingInput | null {
  const input = (raw ?? {}) as Partial<MediaPlanBindingInput>;
  const channel = String(input.channel ?? "").trim();
  const lineKey = String(input.line_key ?? channel).trim();
  const sourceKey = String(input.source_key ?? "").trim().toLowerCase();
  const campaignId = String(input.platform_campaign_id ?? "").trim();
  if (!channel || !lineKey || !sourceKey || !campaignId) {
    return null;
  }
  return {
    line_key: lineKey,
    channel,
    source_key: sourceKey,
    platform_campaign_id: campaignId,
  };
}

function normalizeCampaignFrequencyOverride(raw: unknown) {
  const input = (raw ?? {}) as {
    source_key?: unknown;
    platform_campaign_id?: unknown;
    month_key?: unknown;
    frequency?: unknown;
  };
  const sourceKey = String(input.source_key ?? "").trim().toLowerCase();
  const campaignId = String(input.platform_campaign_id ?? "").trim();
  const monthKey = String(input.month_key ?? "").trim();
  const frequency = Number(input.frequency ?? 0);
  if (!sourceKey || !campaignId || !/^\d{4}-\d{2}$/.test(monthKey) || !Number.isFinite(frequency) || frequency <= 0) {
    return null;
  }
  return {
    source_key: sourceKey,
    platform_campaign_id: campaignId,
    month_key: monthKey,
    frequency: Number(frequency.toFixed(4)),
  };
}

function normalizeCustomKpiCard(raw: unknown) {
  const input = (raw ?? {}) as {
    id?: unknown;
    title?: unknown;
    value?: unknown;
    trend_source?: unknown;
  };
  const id = String(input.id ?? "").trim();
  const title = String(input.title ?? "").trim();
  const value = Number(input.value ?? 0);
  const trendSource = String(input.trend_source ?? "").trim().toLowerCase();
  if (!id || !title || !Number.isFinite(value) || !trendSource) {
    return null;
  }
  return {
    id,
    title,
    value,
    trend_source: trendSource,
  };
}

export function normalizeDashboardPayload(raw: unknown): DashboardUpsertPayload {
  const input = (raw ?? {}) as Partial<DashboardUpsertPayload>;
  const dashboardType =
    input.dashboard_type === "performance" ||
    input.dashboard_type === "overview" ||
    input.dashboard_type === "multibrand" ||
    input.dashboard_type === "abbott_bi" ||
    input.dashboard_type === "zaruku_bi"
      ? input.dashboard_type
      : "awareness";

  const config =
    input.config && typeof input.config === "object"
      ? { ...(input.config as Record<string, unknown>) }
      : {};
  const frequencyOverridesInput = Array.isArray(config.campaign_frequency_overrides)
    ? config.campaign_frequency_overrides
    : [];
  config.campaign_frequency_overrides = frequencyOverridesInput
    .map((item) => normalizeCampaignFrequencyOverride(item))
    .filter(Boolean);
  const customKpiCardsInput = Array.isArray(config.custom_kpi_cards) ? config.custom_kpi_cards : [];
  config.custom_kpi_cards = customKpiCardsInput
    .map((item) => normalizeCustomKpiCard(item))
    .filter(Boolean);
  config.multibrand = normalizeMultibrandConfig(config.multibrand);
  config.language = String(config.language ?? "en") === "ru" ? "ru" : "en";
  config.filter_scope =
    String(config.filter_scope ?? "both") === "channel"
      ? "channel"
      : String(config.filter_scope ?? "both") === "platform"
        ? "platform"
        : "both";

  const sourcesInput = Array.isArray(input.sources) ? input.sources : [];
  const sources = sourcesInput.map((source) => normalizeSource(source));
  const bindingsInput = Array.isArray(input.media_plan_bindings) ? input.media_plan_bindings : [];
  const mediaPlanBindings = bindingsInput
    .map((binding) => normalizeMediaPlanBinding(binding))
    .filter((binding): binding is MediaPlanBindingInput => Boolean(binding));

  return {
    client_id: String(input.client_id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\-]/g, "_"),
    client_name: String(input.client_name ?? "").trim(),
    dashboard_name: String(input.dashboard_name ?? "").trim(),
    dashboard_type: dashboardType,
    config,
    sources,
    media_plan_bindings: mediaPlanBindings,
  };
}

export function validateDashboardPayload(payload: DashboardUpsertPayload): string | null {
  if (!payload.client_id) return "client_id is required";
  if (!payload.client_name) return "client_name is required";
  if (!payload.dashboard_name) return "dashboard_name is required";
  if (!Array.isArray(payload.sources) || payload.sources.length === 0) {
    return "At least one source is required";
  }

  const planSources = payload.sources.filter((source) => source.role === "plan");
  if (planSources.length > 1) return "Only one plan source is allowed";

  const hasCustomTable = payload.sources.some((source) => source.role === "custom_table");
  const hasRenderableActual = payload.sources.some(
    (source) => source.role === "actual" && source.platform !== "leads",
  );
  if (!hasRenderableActual && !hasCustomTable) {
    return "At least one actual source (excluding leads-only intake) or custom_table source is required";
  }

  for (const source of payload.sources) {
    if (!source.platform) return "Source platform is required";
    if (source.role !== "custom_table" && !source.schema_file) return "Source schema_file is required";
    if (source.role === "custom_table") {
      const sheetUrl =
        source.source_config && typeof source.source_config.sheet_url === "string"
          ? String(source.source_config.sheet_url).trim()
          : "";
      if (!sheetUrl) return "Custom table source requires source_config.sheet_url";
    }
    if (source.platform === "manual_data") {
      const sheetUrl =
        source.source_config && typeof source.source_config.sheet_url === "string"
          ? String(source.source_config.sheet_url).trim()
          : "";
      const hasUpload =
        Boolean(source.source_config) &&
        typeof source.source_config?.upload_file === "object" &&
        source.source_config?.upload_file;
      const hasConfirmed =
        Boolean(source.source_config) &&
        typeof source.source_config?.confirmed_manual_data === "object" &&
        source.source_config?.confirmed_manual_data;
      if (!sheetUrl && !hasUpload && !hasConfirmed) {
        return "Manual data source requires source_config.sheet_url, upload_file, or confirmed stored data";
      }
    }
    if (source.platform === "leads") {
      const sheetUrl =
        source.source_config && typeof source.source_config.sheet_url === "string"
          ? String(source.source_config.sheet_url).trim()
          : "";
      const hasUpload =
        Boolean(source.source_config) &&
        typeof source.source_config?.upload_file === "object" &&
        source.source_config?.upload_file;
      const hasInline =
        Boolean(source.source_config) && Array.isArray(source.source_config?.inline_rows);
      if (!sheetUrl && !hasUpload && !hasInline) {
        return "Leads source requires source_config.sheet_url, upload_file, or inline_rows";
      }
    }
  }

  for (const binding of payload.media_plan_bindings) {
    if (!binding.channel || !(binding.line_key ?? binding.channel) || !binding.source_key || !binding.platform_campaign_id) {
      return "Each media plan binding must include line_key, channel, source_key and platform_campaign_id";
    }
  }

  const frequencyOverrides = Array.isArray(payload.config.campaign_frequency_overrides)
    ? payload.config.campaign_frequency_overrides
    : [];
  for (const item of frequencyOverrides) {
    const row = item as {
      source_key?: unknown;
      platform_campaign_id?: unknown;
      month_key?: unknown;
      frequency?: unknown;
    };
    if (
      !String(row.source_key ?? "").trim() ||
      !String(row.platform_campaign_id ?? "").trim() ||
      !/^\d{4}-\d{2}$/.test(String(row.month_key ?? "").trim()) ||
      !Number.isFinite(Number(row.frequency ?? 0)) ||
      Number(row.frequency ?? 0) <= 0
    ) {
      return "Each campaign frequency override must include source_key, platform_campaign_id, month_key and positive frequency";
    }
  }

  return null;
}

export function summarizeDashboardPayloadForLog(
  payload: DashboardUpsertPayload,
): DashboardPayloadLogSummary {
  return {
    client_id: payload.client_id,
    client_name: payload.client_name,
    dashboard_name: payload.dashboard_name,
    dashboard_type: payload.dashboard_type,
    config: {
      period_from:
        typeof payload.config.period_from === "string" ? payload.config.period_from : undefined,
      period_to:
        typeof payload.config.period_to === "string" ? payload.config.period_to : undefined,
      currency:
        typeof payload.config.currency === "string" ? payload.config.currency : undefined,
      language:
        typeof payload.config.language === "string" ? payload.config.language : undefined,
      show_spend:
        typeof payload.config.show_spend === "boolean" ? payload.config.show_spend : undefined,
      spend_source:
        typeof payload.config.spend_source === "string"
          ? payload.config.spend_source
          : undefined,
      kpi_cards_count: Array.isArray(payload.config.kpi_cards) ? payload.config.kpi_cards.length : 0,
      visible_metrics_count: Array.isArray(payload.config.visible_metrics)
        ? payload.config.visible_metrics.length
        : 0,
      section_order_count: Array.isArray(payload.config.section_order)
        ? payload.config.section_order.length
        : 0,
      custom_kpi_cards_count: Array.isArray(payload.config.custom_kpi_cards)
        ? payload.config.custom_kpi_cards.length
        : 0,
      multibrand_enabled:
        !!payload.config.multibrand &&
        typeof payload.config.multibrand === "object" &&
        Boolean((payload.config.multibrand as { enabled?: unknown }).enabled),
      multibrand_brands_count:
        !!payload.config.multibrand &&
        typeof payload.config.multibrand === "object" &&
        Array.isArray((payload.config.multibrand as { brands?: unknown[] }).brands)
          ? ((payload.config.multibrand as { brands?: unknown[] }).brands?.length ?? 0)
          : 0,
    },
    sources: payload.sources.map((source) => {
      const sourceConfig = source.source_config ?? {};
      const accountIds = Array.isArray(sourceConfig.account_ids) ? sourceConfig.account_ids : [];
      const inlineRows = Array.isArray(sourceConfig.inline_rows) ? sourceConfig.inline_rows : [];
      return {
        platform: source.platform,
        role: source.role,
        schema_file: source.schema_file,
        filters_count: Array.isArray(source.filters) ? source.filters.length : 0,
        has_sheet_url:
          typeof sourceConfig.sheet_url === "string" && sourceConfig.sheet_url.trim().length > 0,
        account_ids_count: accountIds.length,
        has_inline_rows: inlineRows.length > 0,
        has_review:
          Boolean(sourceConfig.review) && typeof sourceConfig.review === "object",
      };
    }),
    media_plan_bindings_count: payload.media_plan_bindings.length,
    campaign_frequency_overrides_count: Array.isArray(payload.config.campaign_frequency_overrides)
      ? payload.config.campaign_frequency_overrides.length
      : 0,
  };
}

export async function insertSourcesWithFilters(
  conn: PoolConnection,
  dashboardId: number,
  sources: DashboardSourceInput[],
): Promise<void> {
  for (const source of sources) {
    const [sourceResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO dashboard_sources (dashboard_id, platform, schema_file, role, source_config)
       VALUES (?, ?, ?, ?, ?)`,
      [
        dashboardId,
        source.platform,
        source.schema_file,
        source.role,
        source.source_config ? JSON.stringify(source.source_config) : null,
      ],
    );

    const sourceId = sourceResult.insertId;
    const filters = source.filters.length
      ? source.filters
      : [{ filter_type: "all", filter_value: null as string | null }];

    for (const filter of filters) {
      await conn.execute(
        `INSERT INTO dashboard_campaign_filters (dashboard_source_id, filter_type, filter_value)
         VALUES (?, ?, ?)`,
        [sourceId, filter.filter_type, filter.filter_value],
      );
    }
  }
}

export async function replaceMediaPlanBindings(
  conn: PoolConnection,
  dashboardId: number,
  bindings: MediaPlanBindingInput[],
): Promise<void> {
  await conn.execute("DELETE FROM media_plan_bindings WHERE dashboard_id = ?", [dashboardId]);
  if (!bindings.length) {
    return;
  }

  for (const binding of bindings) {
    await conn.execute(
      `INSERT INTO media_plan_bindings (dashboard_id, line_key, channel, source_key, platform_campaign_id)
       VALUES (?, ?, ?, ?, ?)`,
      [dashboardId, binding.line_key ?? binding.channel, binding.channel, binding.source_key, binding.platform_campaign_id],
    );
  }
}

export async function syncDashboardMediaPlanStorage(
  conn: PoolConnection,
  dashboardId: number,
  sources: DashboardSourceInput[],
): Promise<void> {
  const planSource = sources.find((source) => source.role === "plan");
  if (!planSource) {
    await replaceDashboardMediaPlanRows(conn, dashboardId, []);
    await replaceDashboardMediaPlanAliases(conn, dashboardId, {});
    return;
  }

  const sourceConfig = planSource.source_config ?? {};
  const review =
    sourceConfig.review && typeof sourceConfig.review === "object"
      ? (sourceConfig.review as Record<string, unknown>)
      : {};

  await replaceDashboardMediaPlanRows(conn, dashboardId, sourceConfig.inline_rows);
  await replaceDashboardMediaPlanAliases(conn, dashboardId, review.alias_memory);
}

export async function cleanupRemovedManualDataSources(
  conn: PoolConnection,
  dashboardId: number,
  sources: DashboardSourceInput[],
): Promise<void> {
  const retainedKeys = sources
    .filter((source) => source.platform === "manual_data")
    .map((source) => String(source.source_config?.manual_source_key ?? "").trim())
    .filter(Boolean);

  await deleteDashboardManualFactsExceptKeys(conn, dashboardId, retainedKeys);
}

export async function loadDashboardWithSources(
  conn: PoolConnection,
  dashboardId: number,
): Promise<DashboardWithSources | null> {
  const [dashboardRows] = await conn.execute<RowDataPacket[]>(
    "SELECT * FROM dashboards WHERE id = ? LIMIT 1",
    [dashboardId],
  );
  const dash = dashboardRows[0];
  if (!dash) return null;

  const [sourceRows] = await conn.execute<RowDataPacket[]>(
    `SELECT ds.*, dcf.filter_type, dcf.filter_value
     FROM dashboard_sources ds
     LEFT JOIN dashboard_campaign_filters dcf ON dcf.dashboard_source_id = ds.id
     WHERE ds.dashboard_id = ?
     ORDER BY ds.id`,
    [dashboardId],
  );
  const [bindingRows] = await conn.execute<RowDataPacket[]>(
    `SELECT line_key, channel, source_key, platform_campaign_id
     FROM media_plan_bindings
     WHERE dashboard_id = ?
     ORDER BY COALESCE(line_key, channel), source_key, platform_campaign_id`,
    [dashboardId],
  );
  const storedPlanRows = await loadDashboardMediaPlanRows(conn, dashboardId);
  const storedPlanAliases = await loadDashboardMediaPlanAliases(conn, dashboardId);
  const aliasMemory = buildAliasMemoryFromRows(storedPlanAliases);

  const sourceMap = new Map<number, DashboardWithSources["sources"][number]>();
  for (const row of sourceRows) {
    const sourceId = Number(row.id);
    if (!sourceMap.has(sourceId)) {
      sourceMap.set(sourceId, {
        id: sourceId,
        platform: String(row.platform),
        schema_file: String(row.schema_file),
        role: row.role === "plan" ? "plan" : row.role === "custom_table" ? "custom_table" : "actual",
        source_config: parseJsonField(row.source_config),
        filters: [],
      });
    }

    if (row.filter_type) {
      sourceMap.get(sourceId)!.filters.push({
        filter_type: String(row.filter_type) as DashboardFilterInput["filter_type"],
        filter_value: row.filter_value ? String(row.filter_value) : null,
      });
    }
  }

  const sources = Array.from(sourceMap.values()).map((source) => {
    const sourceConfig = source.source_config ?? {};
    if (source.role === "plan") {
      const review =
        sourceConfig.review && typeof sourceConfig.review === "object"
          ? { ...(sourceConfig.review as Record<string, unknown>) }
          : {};
      if (storedPlanRows.length) {
        sourceConfig.inline_rows = storedPlanRows.map((row) => ({ ...row }));
      }
      if (storedPlanAliases.length) {
        review.alias_memory = aliasMemory;
      }
      if (Object.keys(review).length) {
        sourceConfig.review = review;
      }
    }

    return {
      ...source,
      source_config: sourceConfig,
      filters: source.filters.length
        ? source.filters
        : [{ filter_type: "all" as const, filter_value: null }],
    };
  });

  return {
    id: Number(dash.id),
    client_id: String(dash.client_id),
    client_name: String(dash.client_name),
    dashboard_name: String(dash.dashboard_name),
    dashboard_type: dash.dashboard_type as DashboardWithSources["dashboard_type"],
    is_active: dash.is_active,
    config: parseJsonField(dash.config),
    created_at: dash.created_at ? new Date(dash.created_at).toISOString() : undefined,
    updated_at: dash.updated_at ? new Date(dash.updated_at).toISOString() : undefined,
    sources,
    media_plan_bindings: bindingRows.map((row) => ({
      line_key: String(row.line_key ?? row.channel ?? ""),
      channel: String(row.channel ?? ""),
      source_key: String(row.source_key ?? ""),
      platform_campaign_id: String(row.platform_campaign_id ?? ""),
    })),
  };
}

import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type DashboardFilterInput = {
  filter_type: "name_pattern" | "id_list" | "all";
  filter_value: string | null;
};

export type DashboardSourceInput = {
  id?: number;
  platform: string;
  schema_file: string;
  role: "actual" | "plan";
  source_config: Record<string, unknown> | null;
  filters: DashboardFilterInput[];
};

export type MediaPlanBindingInput = {
  channel: string;
  source_key: string;
  platform_campaign_id: string;
};

export type DashboardUpsertPayload = {
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: "awareness" | "performance" | "overview";
  config: Record<string, unknown>;
  sources: DashboardSourceInput[];
  media_plan_bindings: MediaPlanBindingInput[];
};

export type DashboardWithSources = {
  id: number;
  client_id: string;
  client_name: string;
  dashboard_name: string;
  dashboard_type: "awareness" | "performance" | "overview";
  is_active: number | boolean;
  config: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  sources: Array<{
    id: number;
    platform: string;
    schema_file: string;
    role: "actual" | "plan";
    source_config: Record<string, unknown> | null;
    filters: DashboardFilterInput[];
  }>;
  media_plan_bindings: MediaPlanBindingInput[];
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
  const role = input.role === "plan" ? "plan" : "actual";
  const filtersInput = Array.isArray(input.filters) ? input.filters : [{ filter_type: "all", filter_value: null }];
  const filters = filtersInput.map((filter) => normalizeFilter(filter));

  return {
    id: input.id,
    platform: String(input.platform ?? "").trim().toLowerCase(),
    schema_file: String(input.schema_file ?? "").trim(),
    role,
    source_config:
      input.source_config && typeof input.source_config === "object"
        ? (input.source_config as Record<string, unknown>)
        : null,
    filters: filters.length ? filters : [{ filter_type: "all", filter_value: null }],
  };
}

function normalizeMediaPlanBinding(raw: unknown): MediaPlanBindingInput | null {
  const input = (raw ?? {}) as Partial<MediaPlanBindingInput>;
  const channel = String(input.channel ?? "").trim();
  const sourceKey = String(input.source_key ?? "").trim().toLowerCase();
  const campaignId = String(input.platform_campaign_id ?? "").trim();
  if (!channel || !sourceKey || !campaignId) {
    return null;
  }
  return {
    channel,
    source_key: sourceKey,
    platform_campaign_id: campaignId,
  };
}

export function normalizeDashboardPayload(raw: unknown): DashboardUpsertPayload {
  const input = (raw ?? {}) as Partial<DashboardUpsertPayload>;
  const dashboardType =
    input.dashboard_type === "performance" || input.dashboard_type === "overview"
      ? input.dashboard_type
      : "awareness";

  const config =
    input.config && typeof input.config === "object"
      ? { ...(input.config as Record<string, unknown>) }
      : {};

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

  for (const source of payload.sources) {
    if (!source.platform) return "Source platform is required";
    if (!source.schema_file) return "Source schema_file is required";
  }

  for (const binding of payload.media_plan_bindings) {
    if (!binding.channel || !binding.source_key || !binding.platform_campaign_id) {
      return "Each media plan binding must include channel, source_key and platform_campaign_id";
    }
  }

  return null;
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
      `INSERT INTO media_plan_bindings (dashboard_id, channel, source_key, platform_campaign_id)
       VALUES (?, ?, ?, ?)`,
      [dashboardId, binding.channel, binding.source_key, binding.platform_campaign_id],
    );
  }
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
    `SELECT channel, source_key, platform_campaign_id
     FROM media_plan_bindings
     WHERE dashboard_id = ?
     ORDER BY channel, source_key, platform_campaign_id`,
    [dashboardId],
  );

  const sourceMap = new Map<number, DashboardWithSources["sources"][number]>();
  for (const row of sourceRows) {
    const sourceId = Number(row.id);
    if (!sourceMap.has(sourceId)) {
      sourceMap.set(sourceId, {
        id: sourceId,
        platform: String(row.platform),
        schema_file: String(row.schema_file),
        role: row.role === "plan" ? "plan" : "actual",
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
    sources: Array.from(sourceMap.values()).map((source) => ({
      ...source,
      filters: source.filters.length ? source.filters : [{ filter_type: "all", filter_value: null }],
    })),
    media_plan_bindings: bindingRows.map((row) => ({
      channel: String(row.channel ?? ""),
      source_key: String(row.source_key ?? ""),
      platform_campaign_id: String(row.platform_campaign_id ?? ""),
    })),
  };
}

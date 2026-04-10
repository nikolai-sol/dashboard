import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { loadDashboardWithSources } from "@/lib/admin-dashboards";
import { fetchMediaPlanFromSourceConfig } from "@/lib/gsheet-fetcher";
import type {
  DashboardUtmMatchingPayload,
  DashboardUtmObservedSourceRow,
  DashboardUtmSourceBindingForm,
} from "@/lib/admin-ui-types";
import { resolveSourceKey, resolveSourceType } from "@/lib/source-mapping";

type ObservedSourceRow = RowDataPacket & {
  utm_source: string | null;
  visits: number | string | null;
  users: number | string | null;
  pageviews: number | string | null;
  first_seen: string | null;
  last_seen: string | null;
  medium_count: number | string | null;
  campaign_count: number | string | null;
  mediums_preview: string | null;
  campaigns_preview: string | null;
  current_line_key: string | null;
  current_channel: string | null;
  current_source_key: string | null;
};

type GoalSourceRow = RowDataPacket & {
  utm_source: string | null;
  goal_reaches: number | string | null;
};

type BindingRow = RowDataPacket & {
  utm_source: string | null;
  line_key: string | null;
  channel: string | null;
  source_key: string | null;
};

type MediaPlanBindingRow = RowDataPacket & {
  line_key: string | null;
  channel: string | null;
  source_key: string | null;
};

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function splitPreview(value: string | null): string[] {
  return String(value ?? "")
    .split("|||")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim();
}

function includesAllTokens(haystack: string, needles: string[]): boolean {
  if (!needles.length) return false;
  return needles.every((token) => haystack.includes(token));
}

function suggestLineKey(
  utmSource: string,
  mediaPlanRows: Array<{ line_key: string; channel: string; bound_source_keys: string[] }>,
): string | null {
  const normalized = normalizeText(utmSource);
  if (!normalized) return null;

  const candidates = mediaPlanRows.map((row) => ({
    ...row,
    normalized_channel: normalizeText(row.channel),
  }));

  const byBoundSource = (sourceKey: string) =>
    candidates.filter((row) => row.bound_source_keys.includes(sourceKey));

  if (normalized === "yandex promopages" || normalized === "promopages") {
    const bound = byBoundSource("yandex_promopages");
    const named =
      bound.find((row) => row.normalized_channel.includes("промо")) ??
      candidates.find((row) => row.normalized_channel.includes("промо"));
    return named?.line_key ?? bound[0]?.line_key ?? null;
  }

  if (normalized === "programmatic" || normalized === "getintent") {
    const bound = byBoundSource("getintent");
    const named =
      bound.find((row) => row.normalized_channel.includes("программатик")) ??
      candidates.find((row) => row.normalized_channel.includes("программатик"));
    return named?.line_key ?? bound[0]?.line_key ?? null;
  }

  if (normalized === "yandex rsy") {
    const bound = byBoundSource("yandex_direct");
    const named =
      bound.find((row) => includesAllTokens(row.normalized_channel, ["rsy"])) ??
      candidates.find((row) => includesAllTokens(row.normalized_channel, ["rsy"]));
    return named?.line_key ?? bound[0]?.line_key ?? null;
  }

  if (normalized === "yandex first page") {
    const bound = byBoundSource("yandex_direct");
    const named =
      bound.find((row) => includesAllTokens(row.normalized_channel, ["первой", "странице"])) ??
      candidates.find((row) => includesAllTokens(row.normalized_channel, ["первой", "странице"]));
    return named?.line_key ?? bound[0]?.line_key ?? null;
  }

  if (normalized === "yandex search banner") {
    const bound = byBoundSource("yandex_direct");
    const named =
      bound.find((row) => includesAllTokens(row.normalized_channel, ["поиске"])) ??
      candidates.find((row) => includesAllTokens(row.normalized_channel, ["поиске"]));
    return named?.line_key ?? bound[0]?.line_key ?? null;
  }

  if (normalized.startsWith("yandex")) {
    const bound = byBoundSource("yandex_direct");
    return bound[0]?.line_key ?? null;
  }

  return null;
}

export function normalizeDashboardUtmSourceBindings(value: unknown): DashboardUtmSourceBindingForm[] {
  if (!Array.isArray(value)) return [];
  const next: DashboardUtmSourceBindingForm[] = [];
  for (const item of value) {
    const input = (item ?? {}) as Partial<DashboardUtmSourceBindingForm>;
    const utmSource = String(input.utm_source ?? "").trim();
    const lineKey = String(input.line_key ?? "").trim();
    const channel = String(input.channel ?? "").trim();
    const sourceKey = String(input.source_key ?? "").trim().toLowerCase() || null;
    if (!utmSource || !lineKey || !channel) continue;
    next.push({ utm_source: utmSource, line_key: lineKey, channel, source_key: sourceKey });
  }
  return next;
}

export async function replaceDashboardUtmSourceBindings(
  conn: PoolConnection,
  dashboardId: number,
  bindings: DashboardUtmSourceBindingForm[],
): Promise<void> {
  await conn.execute("DELETE FROM dashboard_utm_source_bindings WHERE dashboard_id = ?", [dashboardId]);
  if (!bindings.length) return;

  for (const binding of bindings) {
    const params: Array<string | number | null> = [
      dashboardId,
      binding.utm_source,
      binding.line_key,
      binding.channel,
      binding.source_key ?? null,
    ];
    await conn.execute(
      `INSERT INTO dashboard_utm_source_bindings (dashboard_id, utm_source, line_key, channel, source_key)
       VALUES (?, ?, ?, ?, ?)`,
      params,
    );
  }
}

export async function loadDashboardUtmMatchingPayload(
  conn: PoolConnection,
  dashboardId: number,
): Promise<DashboardUtmMatchingPayload | null> {
  const dashboard = await loadDashboardWithSources(conn, dashboardId);
  if (!dashboard) return null;

  const config = (dashboard.config ?? {}) as Record<string, unknown>;
  const periodFrom = String(config.period_from ?? "").trim() || null;
  const periodTo = String(config.period_to ?? "").trim() || null;

  const actualSources = dashboard.sources.filter((source) => source.role === "actual");
  const adsSources = actualSources
    .map((source) => resolveSourceKey(source.platform))
    .filter((sourceKey) => {
      const sourceType = resolveSourceType(sourceKey);
      return sourceType === "ads" || sourceType === "promopages";
    });

  const metrikaAccountIds = Array.from(
    new Set(
      actualSources
        .filter((source) => resolveSourceKey(source.platform) === "yandex_metrika")
        .flatMap((source) => asStringArray(parseJson(source.source_config).account_ids)),
    ),
  );

  const planSource = dashboard.sources.find((source) => source.role === "plan");
  const planRows = planSource?.source_config
    ? await fetchMediaPlanFromSourceConfig(parseJson(planSource.source_config))
    : [];

  const [mediaPlanBindingRows] = await conn.execute<MediaPlanBindingRow[]>(
    `SELECT line_key, channel, source_key
     FROM media_plan_bindings
     WHERE dashboard_id = ?`,
    [dashboardId],
  );
  const sourceKeysByLineKey = mediaPlanBindingRows.reduce((acc, row) => {
    const lineKey = String(row.line_key ?? row.channel ?? "").trim();
    if (!lineKey) return acc;
    if (!acc.has(lineKey)) acc.set(lineKey, new Set<string>());
    const sourceKey = String(row.source_key ?? "").trim().toLowerCase();
    if (sourceKey) acc.get(lineKey)!.add(sourceKey);
    return acc;
  }, new Map<string, Set<string>>());

  const mediaPlanRows = planRows.map((row) => ({
    line_key: row.line_key,
    channel: row.channel,
    instrument: row.platform,
    platform: row.platform,
    bound_source_keys: Array.from(sourceKeysByLineKey.get(row.line_key) ?? []),
  }));

  const [bindingRows] = await conn.execute<BindingRow[]>(
    `SELECT utm_source, line_key, channel, source_key
     FROM dashboard_utm_source_bindings
     WHERE dashboard_id = ?`,
    [dashboardId],
  );
  const bindingMap = new Map(
    bindingRows.map((row) => [
      String(row.utm_source ?? "").trim(),
      {
        line_key: String(row.line_key ?? "").trim() || null,
        channel: String(row.channel ?? "").trim() || null,
        source_key: String(row.source_key ?? "").trim() || null,
      },
    ] as const),
  );

  if (!metrikaAccountIds.length) {
    return {
      dashboard: {
        id: dashboard.id,
        client_id: dashboard.client_id,
        client_name: dashboard.client_name,
        dashboard_name: dashboard.dashboard_name,
        period_from: periodFrom,
        period_to: periodTo,
        metrika_account_ids: [],
      },
      media_plan_rows: mediaPlanRows,
      observed_sources: [],
    };
  }

  const dateFrom = periodFrom ?? "1900-01-01";
  const dateTo = periodTo ?? "2999-12-31";
  const accountPlaceholders = metrikaAccountIds.map(() => "?").join(",");
  const accountParams = [...metrikaAccountIds];

  const [observedRows] = await conn.execute<ObservedSourceRow[]>(
    `
      SELECT
        NULLIF(TRIM(f.utm_source), '') AS utm_source,
        COALESCE(SUM(f.visits), 0) AS visits,
        COALESCE(SUM(f.users), 0) AS users,
        COALESCE(SUM(f.pageviews), 0) AS pageviews,
        MIN(f.report_date) AS first_seen,
        MAX(f.report_date) AS last_seen,
        COUNT(DISTINCT NULLIF(TRIM(f.utm_medium), '')) AS medium_count,
        COUNT(DISTINCT NULLIF(TRIM(f.utm_campaign), '')) AS campaign_count,
        SUBSTRING_INDEX(
          GROUP_CONCAT(DISTINCT NULLIF(TRIM(f.utm_medium), '') ORDER BY f.utm_medium SEPARATOR '|||'),
          '|||',
          6
        ) AS mediums_preview,
        SUBSTRING_INDEX(
          GROUP_CONCAT(DISTINCT NULLIF(TRIM(f.utm_campaign), '') ORDER BY f.utm_campaign SEPARATOR '|||'),
          '|||',
          6
        ) AS campaigns_preview,
        MAX(b.line_key) AS current_line_key,
        MAX(b.channel) AS current_channel,
        MAX(b.source_key) AS current_source_key
      FROM canonical_fact_site_analytics_daily f
      LEFT JOIN dashboard_utm_source_bindings b
        ON b.dashboard_id = ?
       AND b.utm_source = f.utm_source
      WHERE f.source_key = 'yandex_metrika'
        AND f.analytics_scope = 'traffic'
        AND f.report_date >= ?
        AND f.report_date <= ?
        AND f.analytics_account_id IN (${accountPlaceholders})
        AND COALESCE(NULLIF(TRIM(f.utm_source), ''), NULLIF(TRIM(f.utm_medium), ''), NULLIF(TRIM(f.utm_campaign), '')) IS NOT NULL
      GROUP BY NULLIF(TRIM(f.utm_source), '')
      HAVING utm_source IS NOT NULL
      ORDER BY visits DESC, utm_source ASC
    `,
    [dashboardId, dateFrom, dateTo, ...accountParams],
  );

  const [goalRows] = await conn.execute<GoalSourceRow[]>(
    `
      SELECT
        NULLIF(TRIM(f.utm_source), '') AS utm_source,
        COALESCE(SUM(f.goal_reaches), 0) AS goal_reaches
      FROM canonical_fact_site_analytics_daily f
      WHERE f.source_key = 'yandex_metrika'
        AND f.analytics_scope = 'goal'
        AND f.report_date >= ?
        AND f.report_date <= ?
        AND f.analytics_account_id IN (${accountPlaceholders})
        AND COALESCE(NULLIF(TRIM(f.utm_source), ''), NULLIF(TRIM(f.utm_medium), ''), NULLIF(TRIM(f.utm_campaign), '')) IS NOT NULL
      GROUP BY NULLIF(TRIM(f.utm_source), '')
      HAVING utm_source IS NOT NULL
    `,
    [dateFrom, dateTo, ...accountParams],
  );

  const goalsBySource = new Map(
    goalRows.map((row) => [String(row.utm_source ?? "").trim(), Number(row.goal_reaches ?? 0)] as const),
  );

  const observedSources: DashboardUtmObservedSourceRow[] = observedRows.map((row) => {
    const utmSource = String(row.utm_source ?? "").trim();
    const current = bindingMap.get(utmSource);
    return {
      utm_source: utmSource,
      visits: Number(row.visits ?? 0),
      users: Number(row.users ?? 0),
      pageviews: Number(row.pageviews ?? 0),
      goal_reaches: goalsBySource.get(utmSource) ?? 0,
      first_seen: row.first_seen ? String(row.first_seen).slice(0, 10) : null,
      last_seen: row.last_seen ? String(row.last_seen).slice(0, 10) : null,
      mediums_preview: splitPreview(row.mediums_preview),
      campaigns_preview: splitPreview(row.campaigns_preview),
      medium_count: Number(row.medium_count ?? 0),
      campaign_count: Number(row.campaign_count ?? 0),
      current_line_key: current?.line_key ?? null,
      current_channel: current?.channel ?? null,
      current_source_key: current?.source_key ?? null,
      suggested_line_key: suggestLineKey(utmSource, mediaPlanRows),
    };
  });

  return {
    dashboard: {
      id: dashboard.id,
      client_id: dashboard.client_id,
      client_name: dashboard.client_name,
      dashboard_name: dashboard.dashboard_name,
      period_from: periodFrom,
      period_to: periodTo,
      metrika_account_ids: metrikaAccountIds,
    },
    media_plan_rows: mediaPlanRows.filter(
      (row) => adsSources.length === 0 || row.bound_source_keys.length > 0 || adsSources.includes(row.platform),
    ),
    observed_sources: observedSources,
  };
}

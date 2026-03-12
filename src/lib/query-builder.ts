import type { PlatformSchema } from "./schema-parser";

export interface CampaignFilter {
  filter_type: "name_pattern" | "id_list" | "all";
  filter_value: string | null;
}

type SqlParam =
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | Buffer
  | Uint8Array;

function getTables(schema: PlatformSchema) {
  if (!schema.tables) {
    throw new Error(`Schema ${schema.platform} does not define mysql tables`);
  }
  return schema.tables;
}

function hasMetric(schema: PlatformSchema, metricCol: string): boolean {
  const tables = getTables(schema);
  return tables.stats.metrics.some((metric) => metric.col === metricCol);
}

function resolveMetricColumn(schema: PlatformSchema, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (hasMetric(schema, candidate)) {
      return candidate;
    }
  }
  return null;
}

function sumExpr(column: string | null): string {
  return column ? `SUM(s.${column})` : "0";
}

function qualifyFilter(filter: string, alias: "s" | "c"): string {
  if (filter.includes(".")) {
    return filter;
  }
  return filter.replace(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)/, `${alias}.$1`);
}

function buildWhereClause(
  schema: PlatformSchema,
  filter: CampaignFilter,
  dateFrom: string,
  dateTo: string,
): { whereSql: string; params: SqlParam[] } {
  const { campaigns, stats } = getTables(schema);
  const wheres: string[] = [];
  const params: SqlParam[] = [];

  if (stats.filter) {
    wheres.push(qualifyFilter(stats.filter, "s"));
  }
  if (campaigns.filter) {
    wheres.push(qualifyFilter(campaigns.filter, "c"));
  }

  wheres.push(`s.${stats.date_col} >= ?`);
  params.push(dateFrom);
  wheres.push(`s.${stats.date_col} <= ?`);
  params.push(dateTo);

  if (filter.filter_type === "name_pattern" && filter.filter_value) {
    wheres.push(`c.${campaigns.name_col} LIKE ?`);
    params.push(filter.filter_value);
  }

  if (filter.filter_type === "id_list" && filter.filter_value) {
    const ids = filter.filter_value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length) {
      wheres.push(`c.${campaigns.id_col} IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }

  return {
    whereSql: wheres.length ? ` WHERE ${wheres.join(" AND ")}` : "",
    params,
  };
}

export function buildStatsQuery(
  schema: PlatformSchema,
  filter: CampaignFilter,
  dateFrom: string,
  dateTo: string,
): { sql: string; params: SqlParam[] } {
  const { campaigns, stats } = getTables(schema);
  const metricCols = stats.metrics.length
    ? stats.metrics.map((metric) => `s.${metric.col} as ${metric.col}`).join(",\n      ")
    : "0 as impressions";

  const { whereSql, params } = buildWhereClause(schema, filter, dateFrom, dateTo);

  const sql = `
    SELECT
      s.${stats.date_col} as date,
      c.${campaigns.name_col} as campaign_name,
      c.${campaigns.id_col} as campaign_id,
      ${metricCols}
    FROM ${stats.table} s
    JOIN ${campaigns.table} c
      ON s.${stats.join_on} = c.${campaigns.id_col}
    ${whereSql}
    ORDER BY s.${stats.date_col}
  `;

  return { sql, params };
}

export function buildAggregateQuery(
  schema: PlatformSchema,
  filter: CampaignFilter,
  dateFrom: string,
  dateTo: string,
): { sql: string; params: SqlParam[] } {
  const { campaigns, stats } = getTables(schema);

  const impressionCol = resolveMetricColumn(schema, ["impressions"]);
  const clickCol = resolveMetricColumn(schema, ["clicks", "link_clicks"]);
  const spendCol = resolveMetricColumn(schema, ["spend", "cost_local", "cost_usd", "cost"]);
  const conversionCol = resolveMetricColumn(schema, ["conversions", "leads"]);
  const viewsCol = resolveMetricColumn(schema, ["video_views", "views"]);

  const imprExpr = sumExpr(impressionCol);
  const clickExpr = sumExpr(clickCol);
  const spendExpr = sumExpr(spendCol);
  const convExpr = sumExpr(conversionCol);
  const viewsExpr = sumExpr(viewsCol);
  const reachExpr = "0";
  const freqExpr = "0";

  const { whereSql, params } = buildWhereClause(schema, filter, dateFrom, dateTo);

  const sql = `
    SELECT
      ${imprExpr} as total_impressions,
      ${clickExpr} as total_clicks,
      ${spendExpr} as total_spend,
      ${convExpr} as total_conversions,
      ${viewsExpr} as total_views,
      ${reachExpr} as total_reach,
      ${freqExpr} as avg_frequency,
      CASE WHEN ${imprExpr} > 0
        THEN ${clickExpr} / ${imprExpr} * 100
        ELSE 0 END as avg_ctr,
      CASE WHEN ${imprExpr} > 0
        THEN ${spendExpr} / ${imprExpr} * 1000
        ELSE 0 END as avg_cpm
    FROM ${stats.table} s
    JOIN ${campaigns.table} c
      ON s.${stats.join_on} = c.${campaigns.id_col}
    ${whereSql}
  `;

  return { sql, params };
}

export function buildTimeseriesQuery(
  schema: PlatformSchema,
  filter: CampaignFilter,
  dateFrom: string,
  dateTo: string,
): { sql: string; params: SqlParam[] } {
  const { campaigns, stats } = getTables(schema);

  const impressionCol = resolveMetricColumn(schema, ["impressions"]);
  const clickCol = resolveMetricColumn(schema, ["clicks", "link_clicks"]);
  const spendCol = resolveMetricColumn(schema, ["spend", "cost_local", "cost_usd", "cost"]);

  const imprExpr = sumExpr(impressionCol);
  const clickExpr = sumExpr(clickCol);
  const spendExpr = sumExpr(spendCol);

  const { whereSql, params } = buildWhereClause(schema, filter, dateFrom, dateTo);

  const sql = `
    SELECT
      s.${stats.date_col} as date,
      ${imprExpr} as impressions,
      ${clickExpr} as clicks,
      ${spendExpr} as spend
    FROM ${stats.table} s
    JOIN ${campaigns.table} c
      ON s.${stats.join_on} = c.${campaigns.id_col}
    ${whereSql}
    GROUP BY s.${stats.date_col}
    ORDER BY s.${stats.date_col}
  `;

  return { sql, params };
}

import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type {
  ZarukuGscBrandSplitRow,
  ZarukuGscCountrySummaryRow,
  ZarukuGscData,
  ZarukuGscLandingPageRow,
  ZarukuGscQueryRow,
  ZarukuGscSearchAppearanceRow,
  ZarukuGscSearchTypeRow,
  ZarukuGscSummaryRow,
} from "@/lib/types";

export type SqlQuery = { sql: string; params: string[] };
export type GscQueryExecutor = (query: SqlQuery) => Promise<unknown[]>;
export const ZARUKU_GSC_COUNTRY = "rus";

type GscQueryDbRow = {
  week_key: string;
  query_id: string;
  query: string;
  page: string;
  country: string;
  device: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

type GscSummaryDbRow = {
  week_key: string;
  device: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

type GscCountrySummaryDbRow = {
  week_key: string;
  country: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

type GscLandingPageDbRow = {
  week_key: string;
  page: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

type GscBrandSplitDbRow = {
  week_key: string;
  brand_bucket: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

type GscSearchAppearanceDbRow = {
  week_key: string;
  search_type: string;
  search_appearance: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

type GscSearchTypeDbRow = {
  week_key: string;
  search_type: string;
  impressions: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  average_position: number | string | null;
  week_from: string | Date;
  week_to: string | Date;
  is_partial_week?: number | string | boolean | null;
};

function buildInClause(values: readonly string[]) {
  return values.map(() => "?").join(", ");
}

function normalizeAccountIds(counterIds: string[]) {
  const normalized = counterIds.map((counterId) => counterId.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : ["66624469"];
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asNullableNumber(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function formatDate(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function weekClause(weeks: string[] | undefined, params: string[]) {
  const normalizedWeeks = (weeks ?? []).map((week) => week.trim()).filter(Boolean);
  if (normalizedWeeks.length === 0) return "";
  params.push(...normalizedWeeks);
  return `AND CONCAT(LEFT(YEARWEEK(report_date, 3), 4), '-W', RIGHT(YEARWEEK(report_date, 3), 2)) IN (${buildInClause(normalizedWeeks)})`;
}

function countryClause(
  params: string[],
  country = ZARUKU_GSC_COUNTRY,
  emptyAsDefault: boolean = false,
) {
  if (emptyAsDefault) {
    params.push(country);
    params.push(country);
    return "AND LOWER(COALESCE(NULLIF(country, ''), ?)) = ?";
  }
  params.push(country);
  return "AND LOWER(COALESCE(country, '')) = ?";
}

function weightedAveragePositionSql(positionColumn = "position") {
  return `
          CASE
            WHEN SUM(CASE WHEN ${positionColumn} IS NULL THEN 0 ELSE impressions END) > 0
              THEN SUM(CASE WHEN ${positionColumn} IS NULL THEN 0 ELSE ${positionColumn} * impressions END)
                / NULLIF(SUM(CASE WHEN ${positionColumn} IS NULL THEN 0 ELSE impressions END), 0)
            ELSE AVG(${positionColumn})
          END`;
}

const WEEK_KEY_SQL = "CONCAT(LEFT(YEARWEEK(report_date, 3), 4), '-W', RIGHT(YEARWEEK(report_date, 3), 2))";
const WEEK_FROM_SQL = "DATE_SUB(report_date, INTERVAL WEEKDAY(report_date) DAY)";
const WEEK_END_SQL = `DATE_ADD(${WEEK_FROM_SQL}, INTERVAL 6 DAY)`;

export function buildGscAccountQueries(counterIds: string[], weeks?: string[]): Record<
  "queries" | "summary" | "country_summary" | "landing_pages" | "brand_split" | "search_appearance" | "search_type_summary",
  SqlQuery
> {
  const normalizedCounterIds = normalizeAccountIds(counterIds);
  const queryParams = [...normalizedCounterIds];
  const summaryParams = [...normalizedCounterIds];
  const countrySummaryParams = [...normalizedCounterIds];
  const landingPageParams = [...normalizedCounterIds];
  const brandSplitParams = [...normalizedCounterIds];
  const searchAppearanceParams = [...normalizedCounterIds];
  const searchTypeSummaryParams = [...normalizedCounterIds];
  const queryCountryClause = countryClause(queryParams);
  const summaryCountryClause = countryClause(summaryParams);
  const countrySummaryCountryClause = countryClause(countrySummaryParams);
  const landingPageCountryClause = countryClause(landingPageParams);
  const brandSplitCountryClause = countryClause(brandSplitParams);
  const searchAppearanceCountryClause = countryClause(searchAppearanceParams, ZARUKU_GSC_COUNTRY, true);
  const searchTypeSummaryCountryClause = countryClause(searchTypeSummaryParams);
  const queryWeekClause = weekClause(weeks, queryParams);
  const summaryWeekClause = weekClause(weeks, summaryParams);
  const countrySummaryWeekClause = weekClause(weeks, countrySummaryParams);
  const landingPageWeekClause = weekClause(weeks, landingPageParams);
  const brandSplitWeekClause = weekClause(weeks, brandSplitParams);
  const searchAppearanceWeekClause = weekClause(weeks, searchAppearanceParams);
  const searchTypeSummaryWeekClause = weekClause(weeks, searchTypeSummaryParams);
  const accountScope = buildInClause(normalizedCounterIds);

  return {
    queries: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          query_hash AS query_id,
          query,
          page,
          country,
          device,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_queries_daily
        WHERE analytics_account_id IN (${accountScope})
          ${queryCountryClause}
          ${queryWeekClause}
        GROUP BY week_key, query_hash, query, page, country, device
        ORDER BY week_key ASC, impressions DESC, clicks DESC, query ASC
      `,
      params: queryParams,
    },
    summary: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          COALESCE(NULLIF(device, ''), 'ALL') AS device,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_queries_daily
        WHERE analytics_account_id IN (${accountScope})
          ${summaryCountryClause}
          ${summaryWeekClause}
        GROUP BY week_key, device
        ORDER BY week_key ASC, impressions DESC
      `,
      params: summaryParams,
    },
    country_summary: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          COALESCE(NULLIF(country, ''), 'unknown') AS country,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_queries_daily
        WHERE analytics_account_id IN (${accountScope})
          ${countrySummaryCountryClause}
          ${countrySummaryWeekClause}
        GROUP BY week_key, country
        ORDER BY week_key ASC, impressions DESC, clicks DESC, country ASC
        LIMIT 120
      `,
      params: countrySummaryParams,
    },
    landing_pages: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          page,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_queries_daily
        WHERE analytics_account_id IN (${accountScope})
          AND COALESCE(page, '') <> ''
          ${landingPageCountryClause}
          ${landingPageWeekClause}
        GROUP BY week_key, page
        ORDER BY week_key ASC, impressions DESC, clicks DESC, page ASC
        LIMIT 200
      `,
      params: landingPageParams,
    },
    brand_split: {
      sql: `
        SELECT
          week_key,
          brand_bucket,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          CASE
            WHEN SUM(CASE WHEN average_position_source IS NULL THEN 0 ELSE impressions END) > 0
              THEN SUM(CASE WHEN average_position_source IS NULL THEN 0 ELSE average_position_source * impressions END)
                / NULLIF(SUM(CASE WHEN average_position_source IS NULL THEN 0 ELSE impressions END), 0)
            ELSE AVG(average_position_source)
          END AS average_position,
          MIN(week_from_source) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(week_end_source) AS is_partial_week
        FROM (
          SELECT
            ${WEEK_KEY_SQL} AS week_key,
            CASE
              WHEN LOWER(COALESCE(query, '')) REGEXP 'zaruku|заруку|за[[:space:]-]*руку|зараку' THEN 'brand'
              ELSE 'non_brand'
            END AS brand_bucket,
            report_date,
            impressions,
            clicks,
            position AS average_position_source,
            ${WEEK_FROM_SQL} AS week_from_source,
            ${WEEK_END_SQL} AS week_end_source
          FROM canonical_fact_gsc_queries_daily
          WHERE analytics_account_id IN (${accountScope})
            ${brandSplitCountryClause}
            ${brandSplitWeekClause}
        ) branded
        GROUP BY week_key, brand_bucket
        ORDER BY week_key ASC, impressions DESC, clicks DESC
      `,
      params: brandSplitParams,
    },
    search_appearance: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          COALESCE(NULLIF(search_type, ''), 'web') AS search_type,
          COALESCE(NULLIF(search_appearance, ''), 'unknown') AS search_appearance,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_search_appearance_daily
        WHERE analytics_account_id IN (${accountScope})
          ${searchAppearanceCountryClause}
          ${searchAppearanceWeekClause}
        GROUP BY week_key, search_type, search_appearance
        ORDER BY week_key ASC, impressions DESC, clicks DESC, search_appearance ASC
        LIMIT 160
      `,
      params: searchAppearanceParams,
    },
    search_type_summary: {
      sql: `
        SELECT
          ${WEEK_KEY_SQL} AS week_key,
          COALESCE(NULLIF(search_type, ''), 'web') AS search_type,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
          ${weightedAveragePositionSql()} AS average_position,
          MIN(${WEEK_FROM_SQL}) AS week_from,
          MAX(report_date) AS week_to,
          MAX(report_date) < MAX(${WEEK_END_SQL}) AS is_partial_week
        FROM canonical_fact_gsc_search_type_daily
        WHERE analytics_account_id IN (${accountScope})
          ${searchTypeSummaryCountryClause}
          ${searchTypeSummaryWeekClause}
        GROUP BY week_key, search_type
        ORDER BY week_key ASC, FIELD(search_type, 'web', 'image', 'video', 'news', 'discover', 'googleNews'), impressions DESC
      `,
      params: searchTypeSummaryParams,
    },
  };
}

export function normalizeGscQueryRow(row: GscQueryDbRow): ZarukuGscQueryRow {
  return {
    week: String(row.week_key),
    query_id: String(row.query_id),
    query: String(row.query),
    page: String(row.page),
    country: String(row.country),
    device: String(row.device),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

export function normalizeGscSummaryRow(row: GscSummaryDbRow): ZarukuGscSummaryRow {
  return {
    week: String(row.week_key),
    device: String(row.device),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

export function normalizeGscCountrySummaryRow(row: GscCountrySummaryDbRow): ZarukuGscCountrySummaryRow {
  return {
    week: String(row.week_key),
    country: String(row.country),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

export function normalizeGscLandingPageRow(row: GscLandingPageDbRow): ZarukuGscLandingPageRow {
  return {
    week: String(row.week_key),
    page: String(row.page),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

export function normalizeGscBrandSplitRow(row: GscBrandSplitDbRow): ZarukuGscBrandSplitRow {
  const bucket = row.brand_bucket === "brand" ? "brand" : "non_brand";
  return {
    week: String(row.week_key),
    bucket,
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

export function normalizeGscSearchAppearanceRow(row: GscSearchAppearanceDbRow): ZarukuGscSearchAppearanceRow {
  return {
    week: String(row.week_key),
    search_type: String(row.search_type),
    search_appearance: String(row.search_appearance),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

export function normalizeGscSearchTypeRow(row: GscSearchTypeDbRow): ZarukuGscSearchTypeRow {
  return {
    week: String(row.week_key),
    search_type: String(row.search_type),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: asNullableNumber(row.ctr),
    average_position: asNullableNumber(row.average_position),
    week_from: formatDate(row.week_from),
    week_to: formatDate(row.week_to),
    is_partial_week: asBoolean(row.is_partial_week),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type SettledRowsResult<DbRow, ResultRow> = {
  rows: ResultRow[];
  available: boolean;
  error: string | null;
  required: boolean;
};

function asNormalizedResult<DbRow, ResultRow>(
  result: PromiseSettledResult<unknown[]>,
  label: string,
  normalize: (row: DbRow) => ResultRow,
  errors: string[],
  required: boolean,
): SettledRowsResult<DbRow, ResultRow> {
  if (result.status === "rejected") {
    const errorText = `${label}: ${errorMessage(result.reason)}`;
    if (required) {
      errors.push(errorText);
    }
    return { rows: [] as ResultRow[], available: false, error: errorText, required };
  }
  try {
    return { rows: result.value.map((row) => normalize(row as DbRow)), available: true, error: null, required };
  } catch (error) {
    const errorText = `${label}: ${errorMessage(error)}`;
    if (required) {
      errors.push(errorText);
    }
    return { rows: [] as ResultRow[], available: false, error: errorText, required };
  }
}

async function executeGscQuery(query: SqlQuery) {
  const [rows] = await pool.execute<RowDataPacket[]>(query.sql, query.params);
  return rows;
}

export async function loadGoogleSearchConsoleFacts(
  counterIds: string[],
  weeks?: string[],
  executeQuery: GscQueryExecutor = executeGscQuery,
): Promise<ZarukuGscData> {
  const queries = buildGscAccountQueries(counterIds, weeks);
  const results = await Promise.allSettled([
    executeQuery(queries.queries),
    executeQuery(queries.summary),
    executeQuery(queries.country_summary),
    executeQuery(queries.landing_pages),
    executeQuery(queries.brand_split),
    executeQuery(queries.search_appearance),
    executeQuery(queries.search_type_summary),
  ]);
  const errors: string[] = [];
  const queryResult = asNormalizedResult<GscQueryDbRow, ZarukuGscQueryRow>(
    results[0],
    "queries",
    normalizeGscQueryRow,
    errors,
    true,
  );
  const summaryResult = asNormalizedResult<GscSummaryDbRow, ZarukuGscSummaryRow>(
    results[1],
    "summary",
    normalizeGscSummaryRow,
    errors,
    true,
  );
  const countrySummaryResult = asNormalizedResult<GscCountrySummaryDbRow, ZarukuGscCountrySummaryRow>(
    results[2],
    "country_summary",
    normalizeGscCountrySummaryRow,
    errors,
    true,
  );
  const landingPageResult = asNormalizedResult<GscLandingPageDbRow, ZarukuGscLandingPageRow>(
    results[3],
    "landing_pages",
    normalizeGscLandingPageRow,
    errors,
    true,
  );
  const brandSplitResult = asNormalizedResult<GscBrandSplitDbRow, ZarukuGscBrandSplitRow>(
    results[4],
    "brand_split",
    normalizeGscBrandSplitRow,
    errors,
    true,
  );
  const searchAppearanceResult = asNormalizedResult<GscSearchAppearanceDbRow, ZarukuGscSearchAppearanceRow>(
    results[5],
    "search_appearance",
    normalizeGscSearchAppearanceRow,
    errors,
    false,
  );
  const searchTypeSummaryResult = asNormalizedResult<GscSearchTypeDbRow, ZarukuGscSearchTypeRow>(
    results[6],
    "search_type_summary",
    normalizeGscSearchTypeRow,
    errors,
    false,
  );
  const queryRows = queryResult.rows;
  const summaryRows = summaryResult.rows;
  const countrySummaryRows = countrySummaryResult.rows;
  const landingPageRows = landingPageResult.rows;
  const brandSplitRows = brandSplitResult.rows;
  const searchAppearanceRows = searchAppearanceResult.rows;
  const searchTypeSummaryRows = searchTypeSummaryResult.rows;
  const requiredResults = [
    queryResult.available,
    summaryResult.available,
    countrySummaryResult.available,
    landingPageResult.available,
    brandSplitResult.available,
  ];
  const successfulRequiredQueries = requiredResults.filter(Boolean).length;
  const status =
    successfulRequiredQueries === requiredResults.length && errors.length === 0
      ? "available"
      : successfulRequiredQueries > 0
        ? "partial"
        : "unavailable";
  const weeksList = Array.from(new Set([
    ...summaryRows.map((row) => row.week),
    ...countrySummaryRows.map((row) => row.week),
    ...queryRows.map((row) => row.week),
    ...landingPageRows.map((row) => row.week),
    ...brandSplitRows.map((row) => row.week),
    ...searchAppearanceRows.map((row) => row.week),
    ...searchTypeSummaryRows.map((row) => row.week),
  ])).sort();
  return {
    available: status !== "unavailable",
    status,
    error: errors.length > 0 ? errors.join("; ") : null,
    data_availability: {
      queries: queryResult.available && queryRows.length > 0,
      summary: summaryResult.available && summaryRows.length > 0,
      country_summary: countrySummaryResult.available && countrySummaryRows.length > 0,
      landing_pages: landingPageResult.available && landingPageRows.length > 0,
      brand_split: brandSplitResult.available && brandSplitRows.length > 0,
      search_appearance: searchAppearanceResult.available && searchAppearanceRows.length > 0,
      search_type_summary: searchTypeSummaryResult.available && searchTypeSummaryRows.length > 0,
    },
    weeks: weeksList,
    latest_week: weeksList.at(-1) ?? null,
    summary: summaryRows,
    country_summary: countrySummaryRows,
    queries: queryRows,
    landing_pages: landingPageRows,
    brand_split: brandSplitRows,
    search_appearance: searchAppearanceRows,
    search_type_summary: searchTypeSummaryRows,
  };
}

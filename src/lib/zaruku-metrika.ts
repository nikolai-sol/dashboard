import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type {
  ZarukuMetrikaBreakdownReadModel,
  ZarukuMetrikaBreakdownReportKey,
  ZarukuMetrikaBreakdownReportReadModel,
  ZarukuSeoMetricRow,
} from "@/lib/types";

type DateRange = { from: string; to: string };

type SqlQuery = {
  sql: string;
  params: Array<string | number>;
};

export type ZarukuMetrikaQueryExecutor = (
  query: SqlQuery,
) => Promise<unknown[]>;

export const ZARUKU_METRIKA_BREAKDOWN_REPORTS: ReadonlyArray<{
  key: ZarukuMetrikaBreakdownReportKey;
  limit: number;
}> = [
  { key: "search_engines", limit: 12 },
  { key: "search_phrases", limit: 30 },
  { key: "organic_landing", limit: 30 },
  { key: "section_entrances", limit: 10_000 },
  { key: "map_city_demand", limit: 10_000 },
  { key: "devices", limit: 8 },
  { key: "browsers", limit: 10 },
  { key: "operating_systems", limit: 10 },
  { key: "age_intervals", limit: 8 },
  { key: "genders", limit: 4 },
  { key: "interests", limit: 12 },
  { key: "source_devices", limit: 20 },
];

type BreakdownDbRow = RowDataPacket & {
  report_key: string;
  row_kind: "detail" | "total";
  dimension_1_id: string | null;
  dimension_1_value: string | null;
  dimension_2_id: string | null;
  dimension_2_value: string | null;
  page_url: string | null;
  visits: number | string | null;
  users: number | string | null;
  pageviews: number | string | null;
  bounce_rate: number | string | null;
  avg_visit_duration_seconds: number | string | null;
  page_depth: number | string | null;
  share: number | string | null;
};

type CoverageDbRow = RowDataPacket & {
  report_key: string;
  coverage_rows: number | string | null;
  complete_rows: number | string | null;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAccountIds(accountIds: string[]) {
  const normalized = Array.from(
    new Set(accountIds.map((accountId) => accountId.trim()).filter(Boolean)),
  );
  return normalized.length > 0 ? normalized : ["66624469"];
}

function buildInClause(values: readonly unknown[]) {
  return values.map(() => "?").join(", ");
}

function reportDetailSql(
  report: (typeof ZARUKU_METRIKA_BREAKDOWN_REPORTS)[number],
  accountIds: string[],
  exactUsersAvailable: boolean,
) {
  const includesTotal = report.key === "devices";
  const rowKindFilter = includesTotal
    ? "row_kind IN ('detail', 'total')"
    : "row_kind = 'detail'";
  const groupBy = [
    "report_key",
    ...(includesTotal ? ["row_kind"] : []),
    "dimension_1_id",
    "dimension_1_value",
    "dimension_2_id",
    "dimension_2_value",
    "page_url",
  ].join(", ");
  const share = includesTotal
    ? "visits / NULLIF(SUM(visits) OVER (PARTITION BY row_kind), 0) * 100 AS share"
    : "visits / NULLIF(SUM(visits) OVER (), 0) * 100 AS share";
  const rowKind = includesTotal ? "row_kind" : "'detail' AS row_kind";
  const ordering = includesTotal
    ? "row_kind = 'total' DESC, visits DESC, pageviews DESC"
    : "visits DESC, pageviews DESC";
  const users = exactUsersAvailable
    ? "MAX(COALESCE(users, 0)) AS users"
    : "0 AS users";

  return `
    /* report_key: ${report.key} */
    SELECT
      report_key,
      ${rowKind},
      dimension_1_id,
      dimension_1_value,
      dimension_2_id,
      dimension_2_value,
      page_url,
      visits,
      users,
      pageviews,
      bounce_rate,
      avg_visit_duration_seconds,
      page_depth,
      ${share}
    FROM (
      SELECT
        report_key,
        ${rowKind},
        dimension_1_id,
        dimension_1_value,
        dimension_2_id,
        dimension_2_value,
        page_url,
        SUM(COALESCE(visits, 0)) AS visits,
        ${users},
        SUM(COALESCE(pageviews, 0)) AS pageviews,
        SUM(COALESCE(bounce_rate, 0) * COALESCE(visits, 0)) / NULLIF(SUM(COALESCE(visits, 0)), 0) AS bounce_rate,
        SUM(COALESCE(avg_visit_duration_seconds, 0) * COALESCE(visits, 0)) / NULLIF(SUM(COALESCE(visits, 0)), 0) AS avg_visit_duration_seconds,
        SUM(COALESCE(page_depth, 0) * COALESCE(visits, 0)) / NULLIF(SUM(COALESCE(visits, 0)), 0) AS page_depth
      FROM canonical_fact_metrika_breakdowns_daily
      WHERE source_key = 'yandex_metrika'
        AND analytics_account_id IN (${buildInClause(accountIds)})
        AND report_key = ?
        AND segment_key = 'russia'
        AND report_date BETWEEN ? AND ?
        AND ${rowKindFilter}
      GROUP BY ${groupBy}
    ) AS aggregated_${report.key}
    ORDER BY ${ordering}
    LIMIT ?
  `;
}

export function buildZarukuMetrikaBreakdownQueries(
  accountIds: string[],
  range: DateRange,
): { detail: SqlQuery; coverage: SqlQuery } {
  const normalizedAccountIds = normalizeAccountIds(accountIds);
  const exactUsersAvailable =
    range.from === range.to && normalizedAccountIds.length === 1;
  const detailBlocks = ZARUKU_METRIKA_BREAKDOWN_REPORTS.map((report) =>
    `(${reportDetailSql(report, normalizedAccountIds, exactUsersAvailable)})`
  );
  const detailParams = ZARUKU_METRIKA_BREAKDOWN_REPORTS.flatMap((report) => [
    ...normalizedAccountIds,
    report.key,
    range.from,
    range.to,
    report.limit + (report.key === "devices" ? 1 : 0),
  ]);
  const reportKeys = ZARUKU_METRIKA_BREAKDOWN_REPORTS.map(
    (report) => report.key,
  );

  return {
    detail: {
      sql: `
        SELECT *
        FROM (
          ${detailBlocks.join("\nUNION ALL\n")}
        ) AS bounded_metrika_breakdowns
        ORDER BY report_key, row_kind, visits DESC, pageviews DESC
      `,
      params: detailParams,
    },
    coverage: {
      sql: `
        SELECT
          report_key,
          COUNT(*) AS coverage_rows,
          SUM(
            CASE
              WHEN pagination_complete = 1
                AND status IN ('success', 'empty')
              THEN 1
              ELSE 0
            END
          ) AS complete_rows
        FROM canonical_metrika_breakdown_coverage_daily
        WHERE source_key = 'yandex_metrika'
          AND analytics_account_id IN (${buildInClause(normalizedAccountIds)})
          AND report_key IN (${buildInClause(reportKeys)})
          AND segment_key = 'russia'
          AND report_date BETWEEN ? AND ?
        GROUP BY report_key
        LIMIT 12
      `,
      params: [
        ...normalizedAccountIds,
        ...reportKeys,
        range.from,
        range.to,
      ],
    },
  };
}

function readableDimension(value: unknown) {
  const normalized =
    typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  const labels: Record<string, string> = {
    "Search engine traffic": "Поиск",
    "Direct traffic": "Прямые заходы",
    "Link traffic": "Переходы по ссылкам",
    "Social network traffic": "Соцсети",
    "Messenger traffic": "Мессенджеры",
    "Mailing traffic": "Рассылки",
    "Ad traffic": "Реклама",
    "Recommendation system traffic": "Рекомендации",
    "Internal traffic": "Внутренний трафик",
    "Cached page traffic": "Кешированные страницы",
    Unknown: "Неизвестно",
    Russia: "Россия",
    Smartphones: "Смартфоны",
    Desktop: "Десктоп",
    Tablets: "Планшеты",
    TVs: "ТВ",
    Male: "Мужчины",
    Female: "Женщины",
  };
  return labels[normalized] ?? (normalized || "Не указано");
}

function toMetricRow(
  row: BreakdownDbRow,
  exactUsersAvailable: boolean,
): ZarukuSeoMetricRow {
  const dimensionIds = [row.dimension_1_id, row.dimension_2_id].filter(Boolean);
  return {
    id: dimensionIds.join("|") || null,
    label: readableDimension(row.dimension_1_value),
    secondary_label: row.dimension_2_value
      ? readableDimension(row.dimension_2_value)
      : null,
    url: row.page_url || null,
    visits: Math.round(asNumber(row.visits)),
    users: exactUsersAvailable ? Math.round(asNumber(row.users)) : 0,
    pageviews: Math.round(asNumber(row.pageviews)),
    bounce_rate: asNullableNumber(row.bounce_rate),
    avg_duration_seconds: asNullableNumber(row.avg_visit_duration_seconds),
    page_depth: asNullableNumber(row.page_depth),
    share: asNumber(row.share),
    source: "metrika",
    layer: "onsite",
  };
}

function emptyReport(): ZarukuMetrikaBreakdownReportReadModel {
  return { available: false, rows: [], total_visits: 0 };
}

function inclusiveDayCount(range: DateRange) {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000) + 1;
}

async function executeQuery(query: SqlQuery) {
  const [rows] = await pool.execute<RowDataPacket[]>(query.sql, query.params);
  return rows;
}

export async function loadZarukuMetrikaBreakdowns(
  accountIds: string[],
  range: DateRange,
  queryExecutor: ZarukuMetrikaQueryExecutor = executeQuery,
): Promise<ZarukuMetrikaBreakdownReadModel> {
  const normalizedAccountIds = normalizeAccountIds(accountIds);
  const queries = buildZarukuMetrikaBreakdownQueries(
    normalizedAccountIds,
    range,
  );
  const [detailResult, coverageResult] = await Promise.allSettled([
    queryExecutor(queries.detail),
    queryExecutor(queries.coverage),
  ]);
  const reports = Object.fromEntries(
    ZARUKU_METRIKA_BREAKDOWN_REPORTS.map((report) => [
      report.key,
      emptyReport(),
    ]),
  ) as ZarukuMetrikaBreakdownReadModel["reports"];

  if (
    detailResult.status === "rejected" ||
    coverageResult.status === "rejected"
  ) {
    return { reports, period_users: null };
  }

  const expectedCoverageRows =
    inclusiveDayCount(range) * normalizedAccountIds.length;
  const coverageByReport = new Map(
    (coverageResult.value as CoverageDbRow[]).map((row) => [
      row.report_key,
      asNumber(row.coverage_rows) === expectedCoverageRows &&
        asNumber(row.complete_rows) === expectedCoverageRows,
    ]),
  );
  const exactUsersAvailable =
    range.from === range.to && normalizedAccountIds.length === 1;
  let periodUsers: number | null = null;

  for (const row of detailResult.value as BreakdownDbRow[]) {
    if (!coverageByReport.get(row.report_key)) continue;
    if (
      !ZARUKU_METRIKA_BREAKDOWN_REPORTS.some(
        (report) => report.key === row.report_key,
      )
    ) {
      continue;
    }
    const key = row.report_key as ZarukuMetrikaBreakdownReportKey;
    reports[key].available = true;
    if (row.row_kind === "total") {
      reports[key].total_visits = Math.round(asNumber(row.visits));
      if (key === "devices" && exactUsersAvailable) {
        periodUsers = Math.round(asNumber(row.users));
      }
      continue;
    }
    reports[key].rows.push(toMetricRow(row, exactUsersAvailable));
    reports[key].total_visits += Math.round(asNumber(row.visits));
  }

  for (const report of ZARUKU_METRIKA_BREAKDOWN_REPORTS) {
    if (coverageByReport.get(report.key)) {
      reports[report.key].available = true;
    }
  }

  return { reports, period_users: periodUsers };
}

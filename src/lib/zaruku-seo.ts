import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { businessCalendarIsoDate } from "@/lib/abbott-date-range";
import { loadAccountFacts, loadSeoIntelligence, loadSeoProcess } from "@/lib/account-read-models";
import { loadZarukuMetrikaBreakdowns } from "@/lib/zaruku-metrika";
import { matchSectionPattern } from "@/lib/zaruku-seo-os";
import { makeZarukuDatasetMeta } from "@/lib/zaruku-dataset-meta";
import { resolveZarukuDailyPeriod } from "@/lib/zaruku-daily-period";
import type {
  ZarukuAiVisibilityData,
  ZarukuSeoData,
  ZarukuSeoDataQualityItem,
  ZarukuSeoKpi,
  ZarukuSeoMetricRow,
  ZarukuSeoPendingRequirement,
  ZarukuSeoSectionPattern,
  ZarukuSeoSource,
  ZarukuSeoSourceStatus,
  ZarukuSeoIntelligenceData,
  ZarukuSourceFreshnessRow,
  ZarukuGscData,
  ZarukuYandexWebmasterData,
  ZarukuDatasetKey,
  ZarukuDatasetMeta,
  ZarukuMetricAvailability,
  ZarukuMetrikaBreakdownReportReadModel,
} from "@/lib/types";

const SOURCE_KEY = "yandex_metrika";

const SOURCES: ZarukuSeoSource[] = [
  {
    id: "metrika",
    label: "Яндекс Метрика",
    layer: "onsite",
    color: "#0d9488",
    status: "connected",
    collection_mode: "automated",
    data_through: null,
    freshness_note: "Разрезы читаются из канонических ежедневных фактов за выбранный период трафика.",
  },
  {
    id: "gsc",
    label: "Google Search Console",
    layer: "serp",
    color: "#2563eb",
    status: "pending",
    collection_mode: "automated",
    data_through: null,
    note: "Показы, позиции и CTR в Google Search Console.",
  },
  {
    id: "webmaster",
    label: "Яндекс Вебмастер",
    layer: "serp",
    color: "#9333ea",
    status: "pending",
    collection_mode: "automated",
    data_through: null,
    note: "Показы, позиции и CTR в Яндекс Поиске.",
  },
  {
    id: "yandex_gen_search",
    label: "AI-видимость",
    layer: "ai",
    color: "#0891b2",
    status: "pending",
    collection_mode: "manual",
    data_through: null,
    note: "AI-видимость: Яндекс Вебмастер / внешние снимки.",
  },
];

const PENDING_REQUIREMENTS: ZarukuSeoPendingRequirement[] = [
  {
    source: "gsc",
    layer: "serp",
    title: "Google Search Console",
    status: "pending",
    reason: "Для Google нужны показы, клики, CTR и позиции из Google Search Console.",
    expected_fields: ["query", "page", "country", "device", "impressions", "clicks", "ctr", "position"],
  },
  {
    source: "webmaster",
    layer: "serp",
    title: "Яндекс Вебмастер",
    status: "pending",
    reason: "Для Яндекса нужны показы, клики и CTR из Вебмастера; SEO OS покрывает только отслеживаемые позиции.",
    expected_fields: ["query", "url", "region", "device", "impressions", "clicks", "ctr", "position"],
  },
];

const DEPRECATED_EMPTY_WEEKLY_AI_VISIBILITY: ZarukuAiVisibilityData = {
  available: false,
  status: "unavailable",
  error: null,
  weeks: [],
  latest_week: null,
  rows: [],
};

type CanonicalSiteRow = RowDataPacket & {
  label: string | null;
  secondary_label?: string | null;
  url?: string | null;
  visits: number | string | null;
  users: number | string | null;
  pageviews: number | string | null;
  returning_users?: number | string | null;
  returning_1_day_users?: number | string | null;
  returning_2_7_days_users?: number | string | null;
  returning_8_31_days_users?: number | string | null;
  bounce_rate?: number | string | null;
  avg_duration?: number | string | null;
  page_depth?: number | string | null;
};

export type SourceFreshnessDbRow = {
  source_key: string;
  source_label: string;
  collector: string;
  expected_frequency_hours: number | string | null;
  last_status: string | null;
  last_finished_at: string | Date | null;
  last_success_at: string | Date | null;
  success_date_from: string | Date | null;
  success_date_to: string | Date | null;
  confirmed_date_from?: string | Date | null;
  confirmed_date_to?: string | Date | null;
  success_rows_read: number | string | null;
  success_rows_written: number | string | null;
  last_error_at: string | Date | null;
  last_error_summary: string | null;
};

const SOURCE_FRESHNESS_CATALOG = [
  {
    source_key: "yandex_metrika",
    source_label: "Яндекс Метрика",
    collector: "fetch_yandex_metrika_canonical.py",
    run_mode: "canonical_only",
    expected_frequency_hours: 24,
  },
  {
    source_key: "yandex_metrika_returning",
    source_label: "Яндекс Метрика · возвратный контент",
    collector: "fetch_yandex_metrika_returning_canonical.py",
    run_mode: "daily",
    expected_frequency_hours: 24,
  },
  {
    source_key: "yandex_webmaster",
    source_label: "Яндекс Вебмастер",
    collector: "fetch_yandex_webmaster_canonical.py",
    run_mode: "daily",
    expected_frequency_hours: 24,
  },
  {
    source_key: "google_search_console",
    source_label: "Google Search Console",
    collector: "fetch_gsc_canonical.py",
    run_mode: "daily",
    expected_frequency_hours: 24,
  },
] as const;

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function buildInClause(values: readonly string[]) {
  return values.map(() => "?").join(", ");
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("ru-RU");
}

function formatEnglishInteger(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function formatDateTimeValue(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace("T", " ");
  const text = String(value).trim();
  if (!text) return null;
  return text.replace("T", " ").slice(0, 19);
}

function formatDateOnlyValue(value: string | Date | null | undefined): string | null {
  const formatted = formatDateTimeValue(value);
  return formatted ? formatted.slice(0, 10) : null;
}

function parseDateValue(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPercent(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function normalizeCounterIds(counterIds: string[]) {
  void counterIds;
  return ["66624469"];
}

export function readableTrafficSource(label: string) {
  const normalized = label.trim();
  const map: Record<string, string> = {
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
  };
  return map[normalized] ?? (normalized || "Неизвестно");
}

function rowFromCanonical(row: CanonicalSiteRow, totalVisits: number): ZarukuSeoMetricRow {
  const visits = Math.round(asNumber(row.visits));
  return {
    label: asString(row.label) || "Неизвестно",
    secondary_label: asString(row.secondary_label) || null,
    url: asString(row.url) || null,
    visits,
    users: Math.round(asNumber(row.users)),
    pageviews: Math.round(asNumber(row.pageviews)),
    bounce_rate: row.bounce_rate == null ? null : asNumber(row.bounce_rate),
    avg_duration_seconds: row.avg_duration == null ? null : asNumber(row.avg_duration),
    page_depth: row.page_depth == null ? null : asNumber(row.page_depth),
    share: totalVisits > 0 ? (visits / totalVisits) * 100 : 0,
    source: "metrika",
    layer: "onsite",
  };
}

function normalizedUrlKey(value: string | null | undefined) {
  const raw = asString(value).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://zaruku.ru");
    const path = url.pathname.replace(/\/{2,}/g, "/");
    return `${url.hostname.replace(/^www\./, "")}${path.endsWith("/") ? path : `${path}/`}`;
  } catch {
    return raw.split(/[?#]/, 1)[0].replace(/\/?$/, "/");
  }
}

export function mergeTopPagesWithVisitMetrics(pageRows: ZarukuSeoMetricRow[], visitRows: ZarukuSeoMetricRow[]) {
  if (visitRows.length === 0) return pageRows;
  const byUrl = new Map<string, ZarukuSeoMetricRow>();
  visitRows.forEach((row) => {
    const key = normalizedUrlKey(row.url ?? row.label);
    if (!key) return;
    byUrl.set(key, row);
  });

  return pageRows.map((row) => {
    const visitRow = byUrl.get(normalizedUrlKey(row.url ?? row.label));
    if (!visitRow) return row;
    return {
      ...row,
      visits: visitRow.visits,
      users: visitRow.users_available === false ? 0 : visitRow.users,
      ...(visitRow.users_available === undefined
        ? {}
        : { users_available: visitRow.users_available }),
      bounce_rate: visitRow.bounce_rate ?? row.bounce_rate,
      avg_duration_seconds: visitRow.avg_duration_seconds ?? row.avg_duration_seconds,
      page_depth: visitRow.page_depth ?? row.page_depth,
    };
  });
}

export function enrichRowsWithPageTitles(rows: ZarukuSeoMetricRow[], pageRows: ZarukuSeoMetricRow[]) {
  if (rows.length === 0 || pageRows.length === 0) return rows;
  const titlesByUrl = new Map<string, string>();
  pageRows.forEach((row) => {
    const key = normalizedUrlKey(row.url ?? row.label);
    if (!key || !row.label || row.label.startsWith("http") || row.label === "Unknown" || row.label === "Неизвестно") return;
    titlesByUrl.set(key, row.label);
  });

  return rows.map((row) => {
    const url = row.url ?? row.label;
    const key = normalizedUrlKey(url);
    const title = titlesByUrl.get(key) ?? (key === "zaruku.ru/" ? "Главная страница" : null);
    if (!title) return row;
    return {
      ...row,
      label: title,
      url,
    };
  });
}

export function filterSearchEngineRows(rows: ZarukuSeoMetricRow[]) {
  return rows.filter((row) => {
    const label = row.label.trim().toLowerCase();
    return label.includes("yandex") || label.includes("яндекс") || label.includes("google");
  });
}

function isMapUrl(value: string | null | undefined) {
  return normalizedUrlKey(value).includes("zaruku.ru/map/");
}

export function buildMapCityDemand(rows: ZarukuSeoMetricRow[]) {
  type CityAccumulator = ZarukuSeoMetricRow & {
    bounceWeighted: number;
    bounceVisits: number;
    durationWeighted: number;
    durationVisits: number;
    depthWeighted: number;
    depthVisits: number;
  };
  const byCity = new Map<string, CityAccumulator>();
  rows.forEach((row) => {
    const url = row.url ?? row.secondary_label;
    if (!isMapUrl(url)) return;
    const city = row.label.trim() || "Не указано";
    const current =
      byCity.get(city) ??
      ({
        label: city,
        secondary_label: url ?? null,
        visits: 0,
        users: 0,
        users_available: row.users_available,
        pageviews: 0,
        share: 0,
        source: "metrika",
        layer: "onsite",
        bounceWeighted: 0,
        bounceVisits: 0,
        durationWeighted: 0,
        durationVisits: 0,
        depthWeighted: 0,
        depthVisits: 0,
      } satisfies CityAccumulator);
    current.visits += row.visits;
    if (current.users_available !== false && row.users_available !== false) {
      current.users += row.users;
      if (row.users_available === true) current.users_available = true;
    } else {
      current.users = 0;
      current.users_available = false;
    }
    current.pageviews += row.pageviews;
    if ((row.secondary_label?.length ?? 0) < (current.secondary_label?.length ?? Infinity)) {
      current.secondary_label = row.secondary_label;
    }
    if (row.bounce_rate != null) {
      current.bounceWeighted += row.bounce_rate * row.visits;
      current.bounceVisits += row.visits;
    }
    if (row.avg_duration_seconds != null) {
      current.durationWeighted += row.avg_duration_seconds * row.visits;
      current.durationVisits += row.visits;
    }
    if (row.page_depth != null) {
      current.depthWeighted += row.page_depth * row.visits;
      current.depthVisits += row.visits;
    }
    byCity.set(city, current);
  });

  const totalVisits = Array.from(byCity.values()).reduce((sum, row) => sum + row.visits, 0);
  return Array.from(byCity.values())
    .map((row) => ({
      label: row.label,
      secondary_label: row.secondary_label,
      visits: row.visits,
      users: row.users,
      ...(row.users_available === undefined
        ? {}
        : { users_available: row.users_available }),
      pageviews: row.pageviews,
      ...(row.bounceVisits > 0 ? { bounce_rate: row.bounceWeighted / row.bounceVisits } : {}),
      ...(row.durationVisits > 0 ? { avg_duration_seconds: row.durationWeighted / row.durationVisits } : {}),
      ...(row.depthVisits > 0 ? { page_depth: row.depthWeighted / row.depthVisits } : {}),
      share: totalVisits > 0 ? (row.visits / totalVisits) * 100 : 0,
      source: row.source,
      layer: row.layer,
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 20);
}

function sourceFreshnessCatalogSql() {
  return SOURCE_FRESHNESS_CATALOG.map((source, index) => {
    const selectKeyword = index === 0 ? "SELECT" : "UNION ALL SELECT";
    return `${selectKeyword} '${source.source_key}' AS source_key, '${source.source_label}' AS source_label, '${source.collector}' AS collector, '${source.run_mode}' AS run_mode, ${source.expected_frequency_hours} AS expected_frequency_hours`;
  }).join("\n      ");
}

export function buildSourceFreshnessQuery(sourceKeys = SOURCE_FRESHNESS_CATALOG.map((source) => source.source_key)) {
  const scopedSourceKeys = sourceKeys.length > 0 ? sourceKeys : SOURCE_FRESHNESS_CATALOG.map((source) => source.source_key);
  // Collector runs have no account column, so the writer's run_mode is the
  // reliable source contract that separates Zaruku collection from Abbott releases.
  const scopedSourceParams = scopedSourceKeys.flatMap((sourceKey) => [
    sourceKey,
    SOURCE_FRESHNESS_CATALOG.find((source) => source.source_key === sourceKey)?.run_mode ?? "",
  ]);
  const coverageParams = ["66624469", "66624469"];
  return {
    sql: `
    WITH source_catalog AS (
      ${sourceFreshnessCatalogSql()}
    ),
    scoped_sources AS (
      SELECT *
      FROM source_catalog
      WHERE ${scopedSourceKeys.map(() => "(source_key = ? AND run_mode = ?)").join(" OR ")}
    ),
    confirmed_metrika_coverage AS (
      SELECT
        'yandex_metrika' AS source_key,
        MIN(report_date) AS confirmed_date_from,
        MAX(report_date) AS confirmed_date_to
      FROM canonical_fact_site_analytics_daily
      WHERE source_key = 'yandex_metrika'
        AND analytics_account_id = ?
        AND analytics_scope = 'traffic'
      UNION ALL
      SELECT
        'yandex_metrika_returning' AS source_key,
        MIN(report_date) AS confirmed_date_from,
        MAX(report_date) AS confirmed_date_to
      FROM canonical_fact_metrika_returning_pages_daily
      WHERE source_key = 'yandex_metrika'
        AND analytics_account_id = ?
    ),
    latest_run AS (
      SELECT r.*
      FROM canonical_collector_runs r
      INNER JOIN (
        SELECT r2.source_key, MAX(r2.id) AS latest_id
        FROM canonical_collector_runs r2
        INNER JOIN scoped_sources ss ON ss.source_key = r2.source_key
        WHERE r2.run_type = 'cron'
          AND r2.run_mode = ss.run_mode
        GROUP BY r2.source_key
      ) latest ON latest.latest_id = r.id
    ),
    latest_success AS (
      SELECT r.*
      FROM canonical_collector_runs r
      INNER JOIN (
        SELECT r2.source_key, MAX(r2.id) AS latest_success_id
        FROM canonical_collector_runs r2
        INNER JOIN scoped_sources ss ON ss.source_key = r2.source_key
        WHERE r2.run_type = 'cron'
          AND r2.run_mode = ss.run_mode
          AND r2.status = 'success'
        GROUP BY r2.source_key
      ) latest ON latest.latest_success_id = r.id
    ),
    latest_error AS (
      SELECT r.*
      FROM canonical_collector_runs r
      INNER JOIN (
        SELECT r2.source_key, MAX(r2.id) AS latest_error_id
        FROM canonical_collector_runs r2
        INNER JOIN scoped_sources ss ON ss.source_key = r2.source_key
        WHERE r2.run_type = 'cron'
          AND r2.run_mode = ss.run_mode
          AND r2.status IN ('failed', 'partial')
        GROUP BY r2.source_key
      ) latest ON latest.latest_error_id = r.id
    )
    SELECT
      ss.source_key,
      ss.source_label,
      ss.collector,
      ss.expected_frequency_hours,
      latest_run.status AS last_status,
      COALESCE(latest_run.finished_at, latest_run.started_at) AS last_finished_at,
      latest_success.finished_at AS last_success_at,
      latest_success.date_from AS success_date_from,
      latest_success.date_to AS success_date_to,
      CASE
        WHEN confirmed_metrika_coverage.source_key IS NOT NULL
          THEN confirmed_metrika_coverage.confirmed_date_from
        ELSE latest_success.date_from
      END AS confirmed_date_from,
      CASE
        WHEN confirmed_metrika_coverage.source_key IS NOT NULL
          THEN confirmed_metrika_coverage.confirmed_date_to
        ELSE latest_success.date_to
      END AS confirmed_date_to,
      latest_success.rows_read AS success_rows_read,
      latest_success.rows_written AS success_rows_written,
      COALESCE(latest_error.finished_at, latest_error.started_at) AS last_error_at,
      latest_error.error_summary AS last_error_summary
    FROM scoped_sources ss
    LEFT JOIN latest_run ON latest_run.source_key = ss.source_key
    LEFT JOIN latest_success ON latest_success.source_key = ss.source_key
    LEFT JOIN latest_error ON latest_error.source_key = ss.source_key
    LEFT JOIN confirmed_metrika_coverage ON confirmed_metrika_coverage.source_key = ss.source_key
    ORDER BY FIELD(ss.source_key, 'yandex_metrika', 'yandex_webmaster', 'google_search_console')
  `,
    params: [...scopedSourceParams, ...coverageParams],
  };
}

export function normalizeSourceFreshnessRow(row: SourceFreshnessDbRow, now = new Date()): ZarukuSourceFreshnessRow {
  const expectedFrequencyHours = asNumber(row.expected_frequency_hours) || 24;
  const lastFinishedAt = formatDateTimeValue(row.last_finished_at);
  const lastSuccessAt = formatDateTimeValue(row.last_success_at);
  const lastErrorAt = formatDateTimeValue(row.last_error_at);
  const lastFinishedDate = parseDateValue(row.last_finished_at);
  const lastSuccessDate = parseDateValue(row.last_success_at);
  const rowsRead = Math.round(asNumber(row.success_rows_read));
  const rowsWritten = Math.round(asNumber(row.success_rows_written));
  const importedRowsText = formatEnglishInteger(rowsWritten);
  const status = asString(row.last_status) || null;
  const hasNewerProblem =
    (status === "failed" || status === "partial") &&
    lastFinishedDate != null &&
    (lastSuccessDate == null || lastFinishedDate.getTime() >= lastSuccessDate.getTime());
  const successAgeHours = lastSuccessDate ? (now.getTime() - lastSuccessDate.getTime()) / (60 * 60 * 1000) : Infinity;

  let freshnessStatus: ZarukuSourceFreshnessRow["freshness_status"];
  let note: string;
  if (!lastFinishedAt && !lastSuccessAt) {
    freshnessStatus = "disabled";
    note = "Cron collector ещё не запускался.";
  } else if (hasNewerProblem) {
    freshnessStatus = "failed";
    note = lastSuccessAt
      ? `Последний cron collector упал после последнего successful import. Последний successful cron записал ${importedRowsText} rows.`
      : "Последний cron collector упал; successful import ещё не найден.";
  } else if (successAgeHours > expectedFrequencyHours * 1.5) {
    freshnessStatus = "delayed";
    note = `Последний successful cron collector старше ожидаемого окна; записал ${importedRowsText} rows.`;
  } else {
    freshnessStatus = "healthy";
    note = `Последний successful cron collector записал ${importedRowsText} rows.`;
  }

  const activeErrorAt = hasNewerProblem ? lastErrorAt : null;
  const activeErrorSummary = hasNewerProblem ? (row.last_error_summary ?? null) : null;

  return {
    source_key: row.source_key,
    label: row.source_label,
    collector: row.collector,
    expected_frequency_hours: expectedFrequencyHours,
    freshness_status: freshnessStatus,
    freshness_label: freshnessStatus,
    last_status: status,
    last_finished_at: lastFinishedAt,
    last_success_at: lastSuccessAt,
    date_from: formatDateOnlyValue(
      "confirmed_date_from" in row ? row.confirmed_date_from : row.success_date_from,
    ),
    date_to: formatDateOnlyValue(
      "confirmed_date_to" in row ? row.confirmed_date_to : row.success_date_to,
    ),
    rows_read: rowsRead,
    rows_written: rowsWritten,
    last_error_at: activeErrorAt,
    last_error_summary: activeErrorSummary,
    note,
  };
}

async function querySourceFreshnessRows() {
  const query = buildSourceFreshnessQuery();
  const [rows] = await pool.execute<Array<RowDataPacket & SourceFreshnessDbRow>>(query.sql, query.params);
  return rows.map((row) => normalizeSourceFreshnessRow(row));
}

export function buildHighBouncePages(rows: ZarukuSeoMetricRow[], limit = 12) {
  return rows
    .filter((row) => row.visits >= 10 && (row.bounce_rate ?? 0) >= 50)
    .sort((a, b) => {
      const aBouncedVisits = a.visits * ((a.bounce_rate ?? 0) / 100);
      const bBouncedVisits = b.visits * ((b.bounce_rate ?? 0) / 100);
      return bBouncedVisits - aBouncedVisits || (b.bounce_rate ?? 0) - (a.bounce_rate ?? 0) || b.visits - a.visits;
    })
    .slice(0, limit);
}

export function buildBestEngagementPages(rows: ZarukuSeoMetricRow[], limit = 12) {
  return rows
    .filter((row) => row.visits >= 10 && (row.bounce_rate ?? 100) <= 40)
    .sort((a, b) => {
      const score = (row: ZarukuSeoMetricRow) => {
        const retainedVisits = row.visits * ((100 - (row.bounce_rate ?? 100)) / 100);
        const durationFactor = Math.min(row.avg_duration_seconds ?? 0, 300) / 60;
        const depthFactor = row.page_depth ?? 1;
        return retainedVisits * (durationFactor + depthFactor);
      };
      return score(b) - score(a) || b.visits - a.visits;
    })
    .slice(0, limit);
}

async function queryTrafficRows(counterIds: string[], from: string, to: string) {
  const sql = `
    SELECT
      COALESCE(traffic_source, 'Unknown') AS label,
      COALESCE(SUM(visits), 0) AS visits,
      COALESCE(SUM(users), 0) AS users,
      COALESCE(SUM(pageviews), 0) AS pageviews,
      CASE WHEN COALESCE(SUM(visits), 0) > 0 THEN SUM(COALESCE(bounce_rate, 0) * visits) / SUM(visits) ELSE NULL END AS bounce_rate,
      CASE WHEN COALESCE(SUM(visits), 0) > 0 THEN SUM(COALESCE(avg_visit_duration_seconds, 0) * visits) / SUM(visits) ELSE NULL END AS avg_duration,
      CASE WHEN COALESCE(SUM(visits), 0) > 0 THEN SUM(COALESCE(page_depth, 0) * visits) / SUM(visits) ELSE NULL END AS page_depth
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = ?
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND analytics_scope = 'other'
      AND report_date >= ?
      AND report_date <= ?
    GROUP BY COALESCE(traffic_source, 'Unknown')
    HAVING visits > 0 OR users > 0 OR pageviews > 0
    ORDER BY visits DESC
  `;
  const [rows] = await pool.execute<CanonicalSiteRow[]>(sql, [SOURCE_KEY, ...counterIds, from, to]);
  const totalVisits = rows.reduce((sum, row) => sum + asNumber(row.visits), 0);
  return rows.map((row) => {
    const mapped = rowFromCanonical(row, totalVisits);
    mapped.label = readableTrafficSource(mapped.label);
    return mapped;
  });
}

export function buildCanonicalPageRowsQuery(counterIds: string[], from: string, to: string) {
  return {
    sql: `
    SELECT
      COALESCE(page_title, '') AS label,
      COALESCE(page_url, '') AS url,
      COALESCE(SUM(pageviews), 0) AS pageviews,
      COALESCE(SUM(users), 0) AS users,
      COALESCE(SUM(visits), 0) AS visits,
      CASE WHEN COALESCE(SUM(visits), 0) > 0 THEN SUM(COALESCE(bounce_rate, 0) * visits) / SUM(visits) ELSE NULL END AS bounce_rate,
      CASE WHEN COALESCE(SUM(visits), 0) > 0 THEN SUM(COALESCE(avg_visit_duration_seconds, 0) * visits) / SUM(visits) ELSE NULL END AS avg_duration,
      CASE WHEN COALESCE(SUM(visits), 0) > 0 THEN SUM(COALESCE(page_depth, 0) * visits) / SUM(visits) ELSE NULL END AS page_depth
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = ?
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND analytics_scope = 'page'
      AND report_date >= ?
      AND report_date <= ?
    GROUP BY COALESCE(page_title, ''), COALESCE(page_url, '')
    HAVING visits > 0 OR pageviews > 0 OR users > 0
    ORDER BY pageviews DESC, users DESC
  `,
    params: [SOURCE_KEY, ...counterIds, from, to],
  };
}

async function queryCanonicalPageRows(counterIds: string[], from: string, to: string) {
  const query = buildCanonicalPageRowsQuery(counterIds, from, to);
  const [rows] = await pool.execute<CanonicalSiteRow[]>(query.sql, query.params);
  const totalPageviews = rows.reduce((sum, row) => sum + asNumber(row.pageviews), 0);
  return rows.map((row) => ({
    ...rowFromCanonical(row, totalPageviews),
    share: totalPageviews > 0 ? (asNumber(row.pageviews) / totalPageviews) * 100 : 0,
  }));
}

async function queryOrganicTrend(counterIds: string[], from: string, to: string) {
  const sql = `
    SELECT
      DATE_FORMAT(report_date, '%Y-%m') AS month_key,
      COALESCE(SUM(visits), 0) AS visits,
      COALESCE(SUM(users), 0) AS users,
      COALESCE(SUM(pageviews), 0) AS pageviews
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = ?
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND analytics_scope = 'other'
      AND traffic_source = 'Search engine traffic'
      AND report_date >= ?
      AND report_date <= ?
    GROUP BY DATE_FORMAT(report_date, '%Y-%m')
    ORDER BY month_key ASC
  `;
  const [rows] = await pool.execute<Array<RowDataPacket & { month_key: string; visits: number; users: number; pageviews: number }>>(
    sql,
    [SOURCE_KEY, ...counterIds, from, to],
  );
  return rows.map((row) => ({
    label: asString(row.month_key),
    visits: Math.round(asNumber(row.visits)),
    users: Math.round(asNumber(row.users)),
    pageviews: Math.round(asNumber(row.pageviews)),
  }));
}

export function buildReturningPagesQuery(counterIds: string[], from: string, to: string) {
  return {
    sql: `
    SELECT
      COALESCE(page_url, '') AS label,
      COALESCE(page_url, '') AS url,
      COALESCE(SUM(visits), 0) AS visits,
      COALESCE(SUM(visits), 0) AS pageviews,
      COALESCE(SUM(returning_1_day_users), 0) AS returning_1_day_users,
      COALESCE(SUM(returning_2_7_days_users), 0) AS returning_2_7_days_users,
      COALESCE(SUM(returning_8_31_days_users), 0) AS returning_8_31_days_users,
      COALESCE(SUM(returning_1_day_users + returning_2_7_days_users + returning_8_31_days_users), 0) AS returning_users,
      COALESCE(SUM(returning_1_day_users + returning_2_7_days_users + returning_8_31_days_users), 0) AS users
    FROM canonical_fact_metrika_returning_pages_daily
    WHERE analytics_account_id IN (${buildInClause(counterIds)})
      AND report_date >= ?
      AND report_date <= ?
    GROUP BY COALESCE(page_url, '')
    HAVING visits > 0 OR returning_users > 0
    ORDER BY returning_users DESC, visits DESC
    LIMIT 50
  `,
    params: [...counterIds, from, to],
  };
}

async function queryReturningPages(counterIds: string[], from: string, to: string) {
  const query = buildReturningPagesQuery(counterIds, from, to);
  try {
    const [rows] = await pool.execute<CanonicalSiteRow[]>(query.sql, query.params);
    const totalReturning = rows.reduce((sum, row) => sum + asNumber(row.returning_users), 0);
    return rows.map((row) => {
      const returningUsers = Math.round(asNumber(row.returning_users));
      return {
        label: asString(row.label) || "Неизвестно",
        url: asString(row.url) || null,
        visits: Math.round(asNumber(row.visits)),
        users: returningUsers,
        pageviews: Math.round(asNumber(row.pageviews)),
        returning_users: returningUsers,
        returning_1_day_users: Math.round(asNumber(row.returning_1_day_users)),
        returning_2_7_days_users: Math.round(asNumber(row.returning_2_7_days_users)),
        returning_8_31_days_users: Math.round(asNumber(row.returning_8_31_days_users)),
        share: totalReturning > 0 ? (returningUsers / totalReturning) * 100 : 0,
        source: "metrika" as const,
        layer: "onsite" as const,
      };
    });
  } catch {
    return [];
  }
}

export function buildContentSections(pageRows: ZarukuSeoMetricRow[], patterns: ZarukuSeoSectionPattern[]) {
  type SectionAccumulator = ZarukuSeoMetricRow & {
    bounceWeighted: number;
    bounceVisits: number;
    durationWeighted: number;
    durationVisits: number;
    depthWeighted: number;
    depthVisits: number;
  };
  const bySection = new Map<
    string,
    SectionAccumulator
  >();
  pageRows.forEach((page) => {
    if (!page.url) return;
    const section = matchSectionPattern(page.url, patterns)?.section;
    if (!section) return;
    const current =
      bySection.get(section) ??
      ({
        label: section,
        visits: 0,
        users: 0,
        users_available: page.users_available,
        pageviews: 0,
        share: 0,
        source: "metrika",
        layer: "onsite",
        bounceWeighted: 0,
        bounceVisits: 0,
        durationWeighted: 0,
        durationVisits: 0,
        depthWeighted: 0,
        depthVisits: 0,
      } satisfies SectionAccumulator);
    const visits = page.visits;
    current.visits += visits;
    if (current.users_available !== false && page.users_available !== false) {
      current.users += page.users;
      if (page.users_available === true) current.users_available = true;
    } else {
      current.users = 0;
      current.users_available = false;
    }
    current.pageviews += page.pageviews;
    if (page.bounce_rate != null) {
      current.bounceWeighted += page.bounce_rate * visits;
      current.bounceVisits += visits;
    }
    if (page.avg_duration_seconds != null) {
      current.durationWeighted += page.avg_duration_seconds * visits;
      current.durationVisits += visits;
    }
    if (page.page_depth != null) {
      current.depthWeighted += page.page_depth * visits;
      current.depthVisits += visits;
    }
    bySection.set(section, current);
  });
  const totalPageviews = Array.from(bySection.values()).reduce((sum, row) => sum + row.pageviews, 0);
  return Array.from(bySection.values())
    .map((row) => ({
      label: row.label,
      visits: row.visits,
      users: row.users,
      ...(row.users_available === undefined
        ? {}
        : { users_available: row.users_available }),
      pageviews: row.pageviews,
      ...(row.bounceVisits > 0 ? { bounce_rate: row.bounceWeighted / row.bounceVisits } : {}),
      ...(row.durationVisits > 0 ? { avg_duration_seconds: row.durationWeighted / row.durationVisits } : {}),
      ...(row.depthVisits > 0 ? { page_depth: row.depthWeighted / row.depthVisits } : {}),
      share: totalPageviews > 0 ? (row.pageviews / totalPageviews) * 100 : 0,
      source: row.source,
      layer: row.layer,
    }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, 12);
}

export function buildPageCollections(
  pageRows: ZarukuSeoMetricRow[],
  patterns: ZarukuSeoSectionPattern[],
  topPageLimit = 80,
  sectionRows: ZarukuSeoMetricRow[] = pageRows,
) {
  const visitRows = sectionRows.length > 0 ? sectionRows : [];
  return {
    topPages: mergeTopPagesWithVisitMetrics(pageRows.slice(0, topPageLimit), visitRows),
    contentSections: buildContentSections(sectionRows.length > 0 ? sectionRows : pageRows, patterns),
  };
}

export function buildKpis({
  trafficChannels,
  technicalTail,
  devices,
  deviceVisitsTotal,
  periodUsers,
}: {
  trafficChannels: ZarukuSeoMetricRow[];
  technicalTail: ZarukuSeoMetricRow[];
  devices: ZarukuSeoMetricRow[];
  deviceVisitsTotal: number;
  periodUsers: number | null;
}): ZarukuSeoKpi[] {
  const trafficRows = [...trafficChannels, ...technicalTail];
  const totals = trafficRows.reduce(
    (acc, row) => {
      acc.visits += row.visits;
      acc.pageviews += row.pageviews;
      acc.bounceWeighted += (row.bounce_rate ?? 0) * row.visits;
      acc.durationWeighted += (row.avg_duration_seconds ?? 0) * row.visits;
      acc.depthWeighted += (row.page_depth ?? 0) * row.visits;
      return acc;
    },
    { visits: 0, pageviews: 0, bounceWeighted: 0, durationWeighted: 0, depthWeighted: 0 },
  );
  const organicVisits = trafficRows.find((row) => row.label === "Поиск")?.visits ?? 0;
  const directVisits = trafficRows.find((row) => row.label === "Прямые заходы")?.visits ?? 0;
  const mobileVisits = devices.find((row) => row.id === "mobile" || row.label === "Смартфоны" || row.label === "Smartphones")?.visits ?? 0;

  return [
    { key: "visits", label: "Визиты", value: formatInteger(totals.visits), raw_value: totals.visits, source: "metrika", layer: "onsite" },
    {
      key: "users",
      label: "Пользователи",
      value: periodUsers == null ? "—" : formatInteger(periodUsers),
      raw_value: periodUsers,
      note: "Уникальные пользователи за выбранный период трафика.",
      source: "metrika",
      layer: "onsite",
    },
    { key: "pageviews", label: "Просмотры", value: formatInteger(totals.pageviews), raw_value: totals.pageviews, source: "metrika", layer: "onsite" },
    {
      key: "organic_share",
      label: "Доля органики",
      value: formatPercent(totals.visits > 0 ? (organicVisits / totals.visits) * 100 : 0),
      raw_value: organicVisits,
      source: "metrika",
      layer: "onsite",
    },
    {
      key: "direct_share",
      label: "Доля прямых",
      value: formatPercent(totals.visits > 0 ? (directVisits / totals.visits) * 100 : 0),
      raw_value: directVisits,
      source: "metrika",
      layer: "onsite",
    },
    {
      key: "mobile_share",
      label: "Мобильные",
      value: mobileVisits > 0 && deviceVisitsTotal > 0
        ? formatPercent((mobileVisits / deviceVisitsTotal) * 100)
        : "—",
      raw_value: mobileVisits || null,
      source: "metrika",
      layer: "onsite",
      coverage: devices.length > 0 ? 100 : 0,
    },
    {
      key: "avg_duration",
      label: "Ср. время",
      value: formatDuration(totals.visits > 0 ? totals.durationWeighted / totals.visits : null),
      source: "metrika",
      layer: "onsite",
    },
    {
      key: "bounce",
      label: "Отказы",
      value: formatPercent(totals.visits > 0 ? totals.bounceWeighted / totals.visits : null),
      source: "metrika",
      layer: "onsite",
    },
    {
      key: "depth",
      label: "Глубина",
      value:
        totals.visits > 0
          ? (totals.depthWeighted / totals.visits).toLocaleString("ru-RU", { maximumFractionDigits: 1 })
          : "—",
      source: "metrika",
      layer: "onsite",
    },
  ];
}

function splitTrafficRows(rows: ZarukuSeoMetricRow[]) {
  const technicalLabels = new Set(["Внутренний трафик", "Кешированные страницы"]);
  return {
    trafficChannels: rows.filter((row) => !technicalLabels.has(row.label)),
    technicalTail: rows.filter((row) => technicalLabels.has(row.label)),
  };
}

function sourceStatusFromData(status: "available" | "partial" | "unavailable"): ZarukuSeoSourceStatus {
  if (status === "available") return "connected";
  return status;
}

type SourceDataThrough = Record<ZarukuSeoSource["id"], string | null>;

export type ZarukuLoadTimingName = "metrika-db" | "gsc-db" | "webmaster-db" | "seo-db" | "total";

export type ZarukuLoadOptions = {
  today?: string;
  recordTiming?: (name: ZarukuLoadTimingName, durationMs: number) => void;
};

async function measureLoadPhase<T>(
  name: ZarukuLoadTimingName,
  recordTiming: ZarukuLoadOptions["recordTiming"],
  load: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await load();
  } finally {
    recordTiming?.(name, Math.max(0, performance.now() - startedAt));
  }
}

export function deriveSourceDataThrough({
  gscSummary,
  webmasterSummary,
  seoOsLatestWeek,
  aiLatestPeriod,
  aiRows,
}: {
  gscSummary: Array<{ week_to: string }>;
  webmasterSummary: Array<{ week_to: string }>;
  seoOsLatestWeek: string | null;
  aiLatestPeriod: string | null;
  aiRows: Array<{ period: string; captured_at: string | null }>;
}): SourceDataThrough {
  const latestGscDate = gscSummary.map((row) => row.week_to).filter(Boolean).sort().at(-1) ?? null;
  const latestWebmasterDate = webmasterSummary.map((row) => row.week_to).filter(Boolean).sort().at(-1) ?? null;
  const latestAiCapture = aiRows
    .filter((row) => row.period === aiLatestPeriod)
    .map((row) => row.captured_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    metrika: null,
    gsc: latestGscDate,
    webmaster: latestWebmasterDate,
    seo_os: seoOsLatestWeek,
    yandex_gen_search: latestAiCapture ?? aiLatestPeriod,
  };
}

export function buildSources({
  seoOsStatus,
  webmaster,
  gsc,
  seoIntelligence,
  dataThrough,
}: {
  seoOsStatus: "available" | "partial" | "unavailable";
  webmaster: ZarukuYandexWebmasterData;
  gsc: ZarukuGscData;
  seoIntelligence: ZarukuSeoIntelligenceData;
  dataThrough: SourceDataThrough;
}): ZarukuSeoSource[] {
  const webmasterStatus = sourceStatusFromData(webmaster.status);
  const gscStatus = sourceStatusFromData(gsc.status);
  const aiStatus = seoIntelligence.ai.rows.length > 0 ? sourceStatusFromData(seoIntelligence.status) : "pending";
  return [
    ...SOURCES.map((source) => {
      if (source.id === "webmaster") {
        return {
          ...source,
          status: webmasterStatus,
          data_through: dataThrough.webmaster,
          note:
            webmasterStatus === "connected"
              ? "Показы, клики, CTR и средняя позиция Яндекса из Вебмастера."
              : webmasterStatus === "partial"
                ? "Часть Webmaster-таблиц доступна; панель показывает только подтвержденные факты."
                : source.note,
        };
      }
      if (source.id === "gsc") {
        return {
          ...source,
          status: gscStatus,
          collection_mode: gscStatus === "unavailable" ? "not_connected" as const : "automated" as const,
          data_through: dataThrough.gsc,
          note:
            gscStatus === "connected"
              ? "Показы, клики, CTR и средняя позиция Google из Search Console."
              : gscStatus === "partial"
                ? "Часть GSC-таблиц доступна; панель показывает только подтвержденные факты."
                : source.note,
        };
      }
      if (source.id === "yandex_gen_search") {
        return {
          ...source,
          status: aiStatus,
          data_through: dataThrough.yandex_gen_search,
          note:
            aiStatus === "connected"
              ? "AI-видимость из seo_ai_visibility: присутствие, упоминания и цитаты."
              : "Ожидаем снимки AI-видимости из SEO OS / внешнего источника.",
        };
      }
      return {
        ...source,
        data_through: dataThrough[source.id],
      };
    }),
    {
      id: "seo_os",
      label: "SEO OS",
      layer: "serp",
      color: "#16a34a",
      status: seoOsStatus === "available" ? "connected" : seoOsStatus,
      collection_mode: "external",
      data_through: dataThrough.seo_os,
      note: seoOsStatus === "available"
        ? "Еженедельные отслеживаемые позиции Яндекса, возможности, задачи и телеметрия."
        : seoOsStatus === "partial"
          ? "Часть данных SEO OS временно недоступна; успешно загруженные наборы сохранены."
          : "Еженедельный SEO OS временно недоступен; Метрика на сайте продолжает работать.",
    },
  ];
}

export function buildPendingRequirements(webmaster: ZarukuYandexWebmasterData, gsc: ZarukuGscData) {
  return PENDING_REQUIREMENTS.filter((item) => {
    if (item.source === "webmaster") return webmaster.status === "unavailable";
    if (item.source === "gsc") return gsc.status === "unavailable";
    return true;
  });
}

function buildDataQuality({
  technicalTail,
  searchPhrases,
  organicVisits,
  searchPhraseVisits,
  metrikaErrors,
}: {
  technicalTail: ZarukuSeoMetricRow[];
  searchPhrases: ZarukuSeoMetricRow[];
  organicVisits: number;
  searchPhraseVisits: number;
  metrikaErrors: string[];
}): ZarukuSeoDataQualityItem[] {
  const cached = technicalTail.find((row) => row.label === "Кешированные страницы");
  const queryCoverage = organicVisits > 0 ? (searchPhraseVisits / organicVisits) * 100 : 0;
  return [
    {
      title: "Кешированный и внутренний трафик",
      value: cached ? `${formatInteger(cached.visits)} визитов` : "0",
      note: "Служебный хвост Метрики; не выводится как основной канал привлечения.",
      severity: "info",
    },
    {
      title: "Покрытие поисковых фраз",
      value: searchPhrases.length > 0 ? formatPercent(queryCoverage) : "—",
      note: "Google часто скрывает запросы; поисковые фразы нельзя считать полной SEO-семантикой.",
      severity: queryCoverage > 0 ? "info" : "warning",
    },
    {
      title: "Запрос → посадочная",
      value: "неполный",
      note: "Метрика стабильно даёт связку поисковая система → посадочная страница, но связка поисковая фраза → посадочная страница может быть пустой.",
      severity: "warning",
    },
    {
      title: "API Метрики",
      value: metrikaErrors.length > 0 ? `${metrikaErrors.length} ожидает` : "ок",
      note: metrikaErrors.length > 0 ? "Часть расширенных разрезов недоступна в текущем окружении." : "Расширенные onsite-разрезы доступны.",
      severity: metrikaErrors.length > 0 ? "warning" : "ok",
    },
  ];
}

export async function loadZarukuSeoData(
  counterIds: string[],
  from: string,
  to: string,
  options: ZarukuLoadOptions = {},
): Promise<ZarukuSeoData> {
  const totalStartedAt = performance.now();
  const normalizedCounterIds = normalizeCounterIds(counterIds);
  const accountId = normalizedCounterIds[0];
  const dailyPeriod = resolveZarukuDailyPeriod({
    requestedFrom: from,
    requestedTo: to,
    today: options.today ?? businessCalendarIsoDate(),
  });
  const { from: effectiveFrom, to: effectiveTo } = dailyPeriod.effective;
  const [metrika, facts, seo] = await Promise.all([
    measureLoadPhase("metrika-db", options.recordTiming, () => Promise.all([
      queryTrafficRows(normalizedCounterIds, effectiveFrom, effectiveTo),
      queryCanonicalPageRows(normalizedCounterIds, effectiveFrom, effectiveTo),
      queryOrganicTrend(normalizedCounterIds, effectiveFrom, effectiveTo),
      queryReturningPages(normalizedCounterIds, effectiveFrom, effectiveTo),
      loadZarukuMetrikaBreakdowns(normalizedCounterIds, dailyPeriod.effective),
      querySourceFreshnessRows(),
    ])),
    loadAccountFacts(accountId, dailyPeriod.effective, { recordTiming: options.recordTiming }),
    measureLoadPhase("seo-db", options.recordTiming, () => Promise.all([
      loadSeoProcess(accountId),
      loadSeoIntelligence(accountId),
    ])),
  ]);
  const [
    trafficRowsRaw,
    pageRows,
    organicTrend,
    returningPages,
    metrikaBreakdowns,
    sourceFreshness,
  ] = metrika;
  const [seoOs, seoIntelligence] = seo;
  const { trafficChannels, technicalTail } = splitTrafficRows(trafficRowsRaw);

  const searchEnginesReport = metrikaBreakdowns.reports.search_engines;
  const searchPhrasesReport = metrikaBreakdowns.reports.search_phrases;
  const organicLandingReport = metrikaBreakdowns.reports.organic_landing;
  const sectionEntrancesReport = metrikaBreakdowns.reports.section_entrances;
  const mapCityDemandReport = metrikaBreakdowns.reports.map_city_demand;
  const devicesReport = metrikaBreakdowns.reports.devices;
  const browsersReport = metrikaBreakdowns.reports.browsers;
  const osReport = metrikaBreakdowns.reports.operating_systems;
  const ageReport = metrikaBreakdowns.reports.age_intervals;
  const genderReport = metrikaBreakdowns.reports.genders;
  const interestsReport = metrikaBreakdowns.reports.interests;
  const sourceDevicesReport = metrikaBreakdowns.reports.source_devices;

  const reports = [
    searchEnginesReport,
    searchPhrasesReport,
    organicLandingReport,
    sectionEntrancesReport,
    mapCityDemandReport,
    devicesReport,
    browsersReport,
    osReport,
    ageReport,
    genderReport,
    interestsReport,
    sourceDevicesReport,
  ];
  const periodUsers = metrikaBreakdowns.period_users;
  const metrikaErrors = reports.flatMap((report) =>
    report.available ? [] : ["Канонический срез Яндекс Метрики недоступен."]
  );
  const organicVisits = trafficChannels.find((row) => row.label === "Поиск")?.visits ?? 0;
  const searchPhraseVisits = searchPhrasesReport.total_visits;
  const entryPageRows = sectionEntrancesReport.available
    ? enrichRowsWithPageTitles(sectionEntrancesReport.rows, pageRows)
    : [];
  const pageCollections = buildPageCollections(
    pageRows,
    seoOs.section_patterns,
    80,
    entryPageRows,
  );
  const webmaster = facts.webmaster;
  const gsc = facts.gsc;
  const requestedPeriod = dailyPeriod.requested;
  const trafficActualTo = sourceFreshness.find((row) => row.source_key === "yandex_metrika")?.date_to ?? null;
  const returningActualTo = sourceFreshness.find((row) => row.source_key === "yandex_metrika_returning")?.date_to ?? null;
  const completeMetrics: ZarukuMetricAvailability = {
    visits: true,
    users: true,
    pageviews: true,
    bounce_rate: true,
    avg_duration_seconds: true,
    page_depth: true,
  };
  const breakdownMetrics: ZarukuMetricAvailability = {
    ...completeMetrics,
    users: effectiveFrom === effectiveTo && normalizedCounterIds.length === 1,
  };
  const pageMetrics: ZarukuMetricAvailability = {
    visits: false,
    users: true,
    pageviews: true,
    bounce_rate: false,
    avg_duration_seconds: false,
    page_depth: false,
  };
  const volumeMetrics: ZarukuMetricAvailability = {
    visits: true,
    users: true,
    pageviews: true,
    bounce_rate: false,
    avg_duration_seconds: false,
    page_depth: false,
  };
  const returningMetrics: ZarukuMetricAvailability = {
    visits: true,
    users: true,
    pageviews: false,
    bounce_rate: false,
    avg_duration_seconds: false,
    page_depth: false,
  };
  const effectiveActualTo = (actualTo: string | null) =>
    actualTo && actualTo < effectiveTo ? actualTo : effectiveTo;
  const coverageIsPartial = (actualTo: string | null) => Boolean(actualTo && actualTo < effectiveTo);
  const coverageMessage = (actualTo: string | null) => actualTo ? `Данные доступны по ${actualTo}.` : undefined;
  const canonicalMeta = (
    rowCount: number,
    actualTo: string | null,
    metrics: ZarukuMetricAvailability,
  ) => makeZarukuDatasetMeta({
    rowCount,
    sourceAvailable: true,
    fallbackVisible: coverageIsPartial(actualTo),
    sources: ["metrika"],
    requestedPeriod,
    actualTo: effectiveActualTo(actualTo),
    geography: "unsegmented",
    metrics,
    fallbackMessage: coverageMessage(actualTo),
  });
  const breakdownMeta = (
    report: ZarukuMetrikaBreakdownReportReadModel,
    rowCount: number,
  ) => makeZarukuDatasetMeta({
    rowCount,
    sourceAvailable: report.available,
    fallbackVisible: false,
    sources: ["metrika"],
    requestedPeriod,
    actualTo: report.available ? effectiveTo : null,
    geography: "russia",
    metrics: breakdownMetrics,
    unavailableMessage: "Стабильный срез Яндекс Метрики недоступен.",
  });
  const contentUsesBreakdownVisits = entryPageRows.length > 0;
  const contentFallbackMessage = contentUsesBreakdownVisits
    ? "Страница объединяет unsegmented canonical page facts и RF entry-page metrics."
    : "Показаны canonical page facts; визиты и поведенческие метрики входов недоступны.";
  const contentMeta = (rowCount: number) => makeZarukuDatasetMeta({
    rowCount,
    sourceAvailable: sectionEntrancesReport.available,
    fallbackVisible: true,
    sources: ["metrika"],
    requestedPeriod,
    actualTo: contentUsesBreakdownVisits ? effectiveTo : effectiveActualTo(trafficActualTo),
    geography: contentUsesBreakdownVisits ? "mixed" : "unsegmented",
    metrics: contentUsesBreakdownVisits ? breakdownMetrics : pageMetrics,
    fallbackMessage: contentFallbackMessage,
  });
  const datasetMeta = {
    traffic_channels: canonicalMeta(trafficChannels.length + technicalTail.length, trafficActualTo, completeMetrics),
    organic_trend: canonicalMeta(organicTrend.length, trafficActualTo, volumeMetrics),
    content_sections: contentMeta(pageCollections.contentSections.length),
    top_pages: contentMeta(pageCollections.topPages.length),
    high_bounce_pages: breakdownMeta(sectionEntrancesReport, buildHighBouncePages(entryPageRows).length),
    best_engagement_pages: breakdownMeta(sectionEntrancesReport, buildBestEngagementPages(entryPageRows).length),
    returning_pages: canonicalMeta(returningPages.length, returningActualTo, returningMetrics),
    search_engines: breakdownMeta(searchEnginesReport, searchEnginesReport.rows.length),
    search_phrases: breakdownMeta(searchPhrasesReport, searchPhrasesReport.rows.length),
    organic_landing_pages: breakdownMeta(organicLandingReport, organicLandingReport.rows.length),
    map_city_demand: breakdownMeta(mapCityDemandReport, mapCityDemandReport.rows.length),
    devices: breakdownMeta(devicesReport, devicesReport.rows.length),
    source_devices: breakdownMeta(sourceDevicesReport, sourceDevicesReport.rows.length),
    browsers: breakdownMeta(browsersReport, browsersReport.rows.length),
    operating_systems: breakdownMeta(osReport, osReport.rows.length),
    age: breakdownMeta(ageReport, ageReport.rows.length),
    gender: breakdownMeta(genderReport, genderReport.rows.length),
    interests: breakdownMeta(interestsReport, interestsReport.rows.length),
  } satisfies Record<ZarukuDatasetKey, ZarukuDatasetMeta>;

  const result: ZarukuSeoData = {
    counters: normalizedCounterIds,
    domain: "zaruku.ru",
    period: dailyPeriod.effective,
    dataset_meta: datasetMeta,
    layers: [
      { id: "onsite", label: "На сайте", hint: "что происходит после клика" },
      { id: "serp", label: "SERP", hint: "показы, позиции, CTR до клика" },
      { id: "ai", label: "AI-выдача", hint: "цитируемость и доля присутствия" },
    ],
    sources: buildSources({
      seoOsStatus: seoOs.status,
      gsc,
      webmaster,
      seoIntelligence,
      dataThrough: deriveSourceDataThrough({
        gscSummary: gsc.summary,
        webmasterSummary: webmaster.summary,
        seoOsLatestWeek: seoOs.latest_week,
        aiLatestPeriod: seoIntelligence.ai.latest_period,
        aiRows: seoIntelligence.ai.rows,
      }),
    }),
    pending_requirements: buildPendingRequirements(webmaster, gsc),
    kpis: buildKpis({
      trafficChannels,
      technicalTail,
      devices: devicesReport.rows,
      deviceVisitsTotal: devicesReport.total_visits,
      periodUsers,
    }),
    traffic_channels: trafficChannels,
    technical_tail: technicalTail,
    organic_trend: organicTrend,
    search_engines: filterSearchEngineRows(searchEnginesReport.rows),
    search_phrases: searchPhrasesReport.rows,
    organic_landing_pages: organicLandingReport.rows,
    top_pages: pageCollections.topPages,
    content_sections: pageCollections.contentSections,
    high_bounce_pages: buildHighBouncePages(entryPageRows),
    best_engagement_pages: buildBestEngagementPages(entryPageRows),
    map_city_demand: mapCityDemandReport.available ? buildMapCityDemand(mapCityDemandReport.rows) : [],
    geo_countries: [],
    geo_cities: [],
    devices: devicesReport.rows,
    source_devices: sourceDevicesReport.rows,
    browsers: browsersReport.rows,
    operating_systems: osReport.rows,
    age: ageReport.rows,
    gender: genderReport.rows,
    interests: interestsReport.rows,
    returning_pages: returningPages,
    source_freshness: sourceFreshness,
    seo_os: seoOs,
    webmaster,
    gsc,
    ai_visibility: DEPRECATED_EMPTY_WEEKLY_AI_VISIBILITY,
    seo_intelligence: seoIntelligence,
    data_quality: buildDataQuality({
      technicalTail,
      searchPhrases: searchPhrasesReport.rows,
      organicVisits,
      searchPhraseVisits,
      metrikaErrors,
    }),
  };
  options.recordTiming?.("total", Math.max(0, performance.now() - totalStartedAt));
  return result;
}

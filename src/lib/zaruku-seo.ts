import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { loadZarukuAiVisibilityData } from "@/lib/zaruku-ai-visibility";
import { loadZarukuSeoIntelligenceData } from "@/lib/zaruku-seo-intelligence";
import { loadZarukuSeoOsData, matchSectionPattern } from "@/lib/zaruku-seo-os";
import { loadZarukuYandexWebmasterData } from "@/lib/zaruku-yandex-webmaster";
import type {
  ZarukuSeoData,
  ZarukuSeoDataQualityItem,
  ZarukuSeoKpi,
  ZarukuSeoMetricRow,
  ZarukuSeoPendingRequirement,
  ZarukuSeoSectionPattern,
  ZarukuSeoSource,
  ZarukuSeoSourceStatus,
  ZarukuSeoIntelligenceData,
  ZarukuYandexWebmasterData,
} from "@/lib/types";

const SOURCE_KEY = "yandex_metrika";
const METRIKA_API_URL = "https://api-metrika.yandex.net/stat/v1/data";
const METRIKA_METRICS =
  "ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:pageDepth";

const SOURCES: ZarukuSeoSource[] = [
  {
    id: "metrika",
    label: "Яндекс Метрика",
    layer: "onsite",
    color: "#0d9488",
    status: "connected",
  },
  {
    id: "gsc",
    label: "Search Console",
    layer: "serp",
    color: "#2563eb",
    status: "pending",
    note: "Показы, позиции и CTR в Google Search.",
  },
  {
    id: "webmaster",
    label: "Яндекс Вебмастер",
    layer: "serp",
    color: "#9333ea",
    status: "pending",
    note: "Показы, позиции и CTR в Яндекс Поиске.",
  },
  {
    id: "yandex_gen_search",
    label: "AI visibility",
    layer: "ai",
    color: "#0891b2",
    status: "pending",
    note: "AI visibility: Яндекс Вебмастер / vendor snapshots.",
  },
];

const PENDING_REQUIREMENTS: ZarukuSeoPendingRequirement[] = [
  {
    source: "gsc",
    layer: "serp",
    title: "Google Search Console",
    status: "pending",
    reason: "Для Google остаются нужны показы, клики, CTR и Google-specific позиции из Search Console.",
    expected_fields: ["query", "page", "country", "device", "impressions", "clicks", "ctr", "position"],
  },
  {
    source: "webmaster",
    layer: "serp",
    title: "Яндекс Вебмастер",
    status: "pending",
    reason: "Для Яндекса остаются нужны показы, клики и CTR из Вебмастера; SEO OS покрывает только tracked-позиции.",
    expected_fields: ["query", "url", "region", "device", "impressions", "clicks", "ctr", "position"],
  },
];

type CanonicalSiteRow = RowDataPacket & {
  label: string | null;
  secondary_label?: string | null;
  url?: string | null;
  visits: number | string | null;
  users: number | string | null;
  pageviews: number | string | null;
  bounce_rate?: number | string | null;
  avg_duration?: number | string | null;
  page_depth?: number | string | null;
};

type MetrikaReportRow = {
  dimensions?: Array<{ name?: string | null; id?: string | null }>;
  metrics?: Array<number | string | null>;
};

type MetrikaReport = {
  ok: boolean;
  rows: ZarukuSeoMetricRow[];
  totals: number[];
  error?: string;
};

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
  const ids = counterIds.map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids : ["66624469"];
}

function readableTrafficSource(label: string) {
  const normalized = label.trim();
  const map: Record<string, string> = {
    "Search engine traffic": "Organic Search",
    "Direct traffic": "Direct",
    "Link traffic": "Referral",
    "Social network traffic": "Social",
    "Messenger traffic": "Messenger",
    "Mailing traffic": "Email",
    "Ad traffic": "Ads",
    "Recommendation system traffic": "Recommendations",
    "Internal traffic": "Internal",
    "Cached page traffic": "Cached pages",
  };
  return map[normalized] ?? (normalized || "Unknown");
}

function rowFromCanonical(row: CanonicalSiteRow, totalVisits: number): ZarukuSeoMetricRow {
  const visits = Math.round(asNumber(row.visits));
  return {
    label: asString(row.label) || "Unknown",
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

function rowFromMetrika(item: MetrikaReportRow, totalVisits: number): ZarukuSeoMetricRow {
  const dimensions = item.dimensions ?? [];
  const metrics = item.metrics ?? [];
  const visits = Math.round(asNumber(metrics[0]));
  return {
    id: dimensions.map((dim) => dim.id).filter(Boolean).join("|") || null,
    label: asString(dimensions[0]?.name) || "Not specified",
    secondary_label: dimensions.slice(1).map((dim) => asString(dim.name) || "Not specified").join(" · ") || null,
    url: dimensions.find((dim) => asString(dim.name).startsWith("http"))?.name ?? null,
    visits,
    users: Math.round(asNumber(metrics[1])),
    pageviews: Math.round(asNumber(metrics[2])),
    bounce_rate: asNumber(metrics[3]),
    avg_duration_seconds: asNumber(metrics[4]),
    page_depth: asNumber(metrics[5]),
    share: totalVisits > 0 ? (visits / totalVisits) * 100 : 0,
    source: "metrika",
    layer: "onsite",
  };
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
      COALESCE(SUM(visits), 0) AS visits
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

async function queryReturningPages(counterIds: string[], from: string, to: string) {
  const sql = `
    SELECT
      COALESCE(url, '') AS label,
      COALESCE(url, '') AS url,
      COALESCE(SUM(page_view), 0) AS visits,
      0 AS users,
      COALESCE(SUM(page_view), 0) AS pageviews
    FROM yandex_metrika_returned
    WHERE counter_id IN (${buildInClause(counterIds)})
      AND date >= ?
      AND date <= ?
    GROUP BY COALESCE(url, '')
    HAVING visits > 0
    ORDER BY visits DESC
    LIMIT 50
  `;
  try {
    const [rows] = await pool.execute<CanonicalSiteRow[]>(sql, [...counterIds, from, to]);
    const total = rows.reduce((sum, row) => sum + asNumber(row.visits), 0);
    return rows.map((row) => rowFromCanonical(row, total));
  } catch {
    return [];
  }
}

async function fetchMetrikaReport(counterIds: string[], from: string, to: string, dimensions: string, limit = 20): Promise<MetrikaReport> {
  const token = process.env.METRIKA_TOKEN ?? process.env.YANDEX_METRIKA_TOKEN;
  if (!token) {
    return { ok: false, rows: [], totals: [], error: "METRIKA_TOKEN is not configured" };
  }
  try {
    const params = new URLSearchParams({
      ids: counterIds[0] ?? "66624469",
      date1: from,
      date2: to,
      dimensions,
      metrics: METRIKA_METRICS,
      sort: "-ym:s:visits",
      limit: String(limit),
      accuracy: "full",
    });
    const response = await fetch(`${METRIKA_API_URL}?${params.toString()}`, {
      headers: { Authorization: `OAuth ${token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, rows: [], totals: [], error: `${response.status} ${await response.text()}`.slice(0, 300) };
    }
    const payload = (await response.json()) as { data?: MetrikaReportRow[]; totals?: number[] };
    const totals = (payload.totals ?? []).map(asNumber);
    const totalVisits = asNumber(totals[0]);
    return {
      ok: true,
      totals,
      rows: (payload.data ?? []).map((item) => rowFromMetrika(item, totalVisits)),
    };
  } catch (error) {
    return { ok: false, rows: [], totals: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMetrikaReportsSequential(
  counterIds: string[],
  from: string,
  to: string,
  reports: Array<{ key: string; dimensions: string; limit?: number }>,
) {
  const result = new Map<string, MetrikaReport>();
  for (const report of reports) {
    result.set(report.key, await fetchMetrikaReport(counterIds, from, to, report.dimensions, report.limit ?? 20));
    await sleep(180);
  }
  return result;
}

const EMPTY_REPORT: MetrikaReport = { ok: false, rows: [], totals: [], error: "Report was not requested" };

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
    current.visits += page.visits;
    current.users += page.users;
    current.pageviews += page.pageviews;
    if (page.bounce_rate != null) {
      current.bounceWeighted += page.bounce_rate * page.visits;
      current.bounceVisits += page.visits;
    }
    if (page.avg_duration_seconds != null) {
      current.durationWeighted += page.avg_duration_seconds * page.visits;
      current.durationVisits += page.visits;
    }
    if (page.page_depth != null) {
      current.depthWeighted += page.page_depth * page.visits;
      current.depthVisits += page.visits;
    }
    bySection.set(section, current);
  });
  const totalPageviews = Array.from(bySection.values()).reduce((sum, row) => sum + row.pageviews, 0);
  return Array.from(bySection.values())
    .map((row) => ({
      label: row.label,
      visits: row.visits,
      users: row.users,
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
) {
  return {
    topPages: pageRows.slice(0, topPageLimit),
    contentSections: buildContentSections(pageRows, patterns),
  };
}

function buildKpis({
  trafficChannels,
  technicalTail,
  devices,
  geoCountries,
}: {
  trafficChannels: ZarukuSeoMetricRow[];
  technicalTail: ZarukuSeoMetricRow[];
  devices: ZarukuSeoMetricRow[];
  geoCountries: ZarukuSeoMetricRow[];
}): ZarukuSeoKpi[] {
  const trafficRows = [...trafficChannels, ...technicalTail];
  const totals = trafficRows.reduce(
    (acc, row) => {
      acc.visits += row.visits;
      acc.users += row.users;
      acc.pageviews += row.pageviews;
      acc.bounceWeighted += (row.bounce_rate ?? 0) * row.visits;
      acc.durationWeighted += (row.avg_duration_seconds ?? 0) * row.visits;
      acc.depthWeighted += (row.page_depth ?? 0) * row.visits;
      return acc;
    },
    { visits: 0, users: 0, pageviews: 0, bounceWeighted: 0, durationWeighted: 0, depthWeighted: 0 },
  );
  const organicVisits = trafficRows.find((row) => row.label === "Organic Search")?.visits ?? 0;
  const directVisits = trafficRows.find((row) => row.label === "Direct")?.visits ?? 0;
  const mobileVisits = devices.find((row) => row.id === "mobile" || row.label === "Smartphones")?.visits ?? 0;
  const russiaVisits = geoCountries.find((row) => row.label === "Russia")?.visits ?? 0;

  return [
    { key: "visits", label: "Визиты", value: formatInteger(totals.visits), raw_value: totals.visits, source: "metrika", layer: "onsite" },
    { key: "users", label: "Пользователи", value: formatInteger(totals.users), raw_value: totals.users, source: "metrika", layer: "onsite" },
    { key: "pageviews", label: "Просмотры", value: formatInteger(totals.pageviews), raw_value: totals.pageviews, source: "metrika", layer: "onsite" },
    {
      key: "organic_share",
      label: "Доля organic",
      value: formatPercent(totals.visits > 0 ? (organicVisits / totals.visits) * 100 : 0),
      raw_value: organicVisits,
      source: "metrika",
      layer: "onsite",
    },
    {
      key: "direct_share",
      label: "Доля direct",
      value: formatPercent(totals.visits > 0 ? (directVisits / totals.visits) * 100 : 0),
      raw_value: directVisits,
      source: "metrika",
      layer: "onsite",
    },
    {
      key: "russia_share",
      label: "Россия",
      value: russiaVisits > 0 ? formatPercent((russiaVisits / Math.max(1, totals.visits)) * 100) : "—",
      raw_value: russiaVisits || null,
      source: "metrika",
      layer: "onsite",
      coverage: geoCountries.length > 0 ? 100 : 0,
    },
    {
      key: "mobile_share",
      label: "Mobile",
      value: mobileVisits > 0 ? formatPercent((mobileVisits / Math.max(1, totals.visits)) * 100) : "—",
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
  const technicalLabels = new Set(["Internal", "Cached pages"]);
  return {
    trafficChannels: rows.filter((row) => !technicalLabels.has(row.label)),
    technicalTail: rows.filter((row) => technicalLabels.has(row.label)),
  };
}

function sourceStatusFromData(status: "available" | "partial" | "unavailable"): ZarukuSeoSourceStatus {
  if (status === "available") return "connected";
  return status;
}

function buildSources({
  seoOsStatus,
  webmaster,
  seoIntelligence,
}: {
  seoOsStatus: "available" | "partial" | "unavailable";
  webmaster: ZarukuYandexWebmasterData;
  seoIntelligence: ZarukuSeoIntelligenceData;
}): ZarukuSeoSource[] {
  const webmasterStatus = sourceStatusFromData(webmaster.status);
  const aiStatus = seoIntelligence.ai.rows.length > 0 ? sourceStatusFromData(seoIntelligence.status) : "pending";
  return [
    ...SOURCES.map((source) => {
      if (source.id === "webmaster") {
        return {
          ...source,
          status: webmasterStatus,
          note:
            webmasterStatus === "connected"
              ? "Показы, клики, CTR и средняя позиция Яндекса из Вебмастера."
              : webmasterStatus === "partial"
                ? "Часть Webmaster-таблиц доступна; панель показывает только подтвержденные факты."
                : source.note,
        };
      }
      if (source.id === "yandex_gen_search") {
        return {
          ...source,
          status: aiStatus,
          note:
            aiStatus === "connected"
              ? "AI visibility из seo_ai_visibility: presence, mentions и citations."
              : "Ожидаем снимки AI visibility из SEO OS/vendor.",
        };
      }
      return source;
    }),
    {
      id: "seo_os",
      label: "SEO OS",
      layer: "serp",
      color: "#16a34a",
      status: seoOsStatus === "available" ? "connected" : seoOsStatus,
      note: seoOsStatus === "available"
        ? "Еженедельные tracked-позиции Яндекса, opportunities, tasks и telemetry."
        : seoOsStatus === "partial"
          ? "Часть данных SEO OS временно недоступна; успешно загруженные наборы сохранены."
          : "Еженедельный SEO OS временно недоступен; on-site Метрика продолжает работать.",
    },
  ];
}

function buildPendingRequirements(webmaster: ZarukuYandexWebmasterData) {
  return PENDING_REQUIREMENTS.filter((item) => {
    if (item.source === "webmaster") return webmaster.status === "unavailable";
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
  const cached = technicalTail.find((row) => row.label === "Cached pages");
  const queryCoverage = organicVisits > 0 ? (searchPhraseVisits / organicVisits) * 100 : 0;
  return [
    {
      title: "Cached / internal traffic",
      value: cached ? `${formatInteger(cached.visits)} визитов` : "0",
      note: "Служебный tail Метрики; не выводится как основной канал привлечения.",
      severity: "info",
    },
    {
      title: "Покрытие поисковых фраз",
      value: searchPhrases.length > 0 ? formatPercent(queryCoverage) : "—",
      note: "Google часто скрывает query; поисковые фразы нельзя считать полной SEO-семантикой.",
      severity: queryCoverage > 0 ? "info" : "warning",
    },
    {
      title: "Keyword → landing",
      value: "неполный",
      note: "Метрика стабильно дает search engine → landing page, но search phrase → landing page может быть пустым.",
      severity: "warning",
    },
    {
      title: "Metrika API",
      value: metrikaErrors.length > 0 ? `${metrikaErrors.length} pending` : "ok",
      note: metrikaErrors.length > 0 ? "Часть расширенных разрезов недоступна в текущем окружении." : "Расширенные onsite-разрезы доступны.",
      severity: metrikaErrors.length > 0 ? "warning" : "ok",
    },
  ];
}

export async function loadZarukuSeoData(counterIds: string[], from: string, to: string): Promise<ZarukuSeoData> {
  const normalizedCounterIds = normalizeCounterIds(counterIds);
  const [trafficRowsRaw, pageRows, organicTrend, returningPages, seoOs] = await Promise.all([
    queryTrafficRows(normalizedCounterIds, from, to),
    queryCanonicalPageRows(normalizedCounterIds, from, to),
    queryOrganicTrend(normalizedCounterIds, from, to),
    queryReturningPages(normalizedCounterIds, from, to),
    loadZarukuSeoOsData(normalizedCounterIds),
  ]);
  const { trafficChannels, technicalTail } = splitTrafficRows(trafficRowsRaw);

  const metrikaReports = await fetchMetrikaReportsSequential(normalizedCounterIds, from, to, [
    { key: "searchEngines", dimensions: "ym:s:searchEngine", limit: 12 },
    { key: "searchPhrases", dimensions: "ym:s:searchPhrase", limit: 30 },
    { key: "organicLanding", dimensions: "ym:s:searchEngine,ym:s:startURL", limit: 30 },
    { key: "devices", dimensions: "ym:s:deviceCategory", limit: 8 },
    { key: "browsers", dimensions: "ym:s:browser", limit: 10 },
    { key: "os", dimensions: "ym:s:operatingSystem", limit: 10 },
    { key: "countries", dimensions: "ym:s:regionCountry", limit: 12 },
    { key: "cities", dimensions: "ym:s:regionCity", limit: 20 },
    { key: "age", dimensions: "ym:s:ageInterval", limit: 8 },
    { key: "gender", dimensions: "ym:s:gender", limit: 4 },
    { key: "interests", dimensions: "ym:s:interest", limit: 12 },
    { key: "sourceDevices", dimensions: "ym:s:lastTrafficSource,ym:s:deviceCategory", limit: 20 },
  ]);

  const searchEnginesReport = metrikaReports.get("searchEngines") ?? EMPTY_REPORT;
  const searchPhrasesReport = metrikaReports.get("searchPhrases") ?? EMPTY_REPORT;
  const organicLandingReport = metrikaReports.get("organicLanding") ?? EMPTY_REPORT;
  const devicesReport = metrikaReports.get("devices") ?? EMPTY_REPORT;
  const browsersReport = metrikaReports.get("browsers") ?? EMPTY_REPORT;
  const osReport = metrikaReports.get("os") ?? EMPTY_REPORT;
  const countriesReport = metrikaReports.get("countries") ?? EMPTY_REPORT;
  const citiesReport = metrikaReports.get("cities") ?? EMPTY_REPORT;
  const ageReport = metrikaReports.get("age") ?? EMPTY_REPORT;
  const genderReport = metrikaReports.get("gender") ?? EMPTY_REPORT;
  const interestsReport = metrikaReports.get("interests") ?? EMPTY_REPORT;
  const sourceDevicesReport = metrikaReports.get("sourceDevices") ?? EMPTY_REPORT;

  const reports = [
    searchEnginesReport,
    searchPhrasesReport,
    organicLandingReport,
    devicesReport,
    browsersReport,
    osReport,
    countriesReport,
    citiesReport,
    ageReport,
    genderReport,
    interestsReport,
    sourceDevicesReport,
  ];
  const metrikaErrors = reports.flatMap((report) => (report.ok ? [] : [report.error ?? "Metrika API unavailable"]));
  const organicVisits = trafficChannels.find((row) => row.label === "Organic Search")?.visits ?? 0;
  const searchPhraseVisits = asNumber(searchPhrasesReport.totals[0]);
  const pageCollections = buildPageCollections(pageRows, seoOs.section_patterns);
  const [webmaster, aiVisibility, seoIntelligence] = await Promise.all([
    loadZarukuYandexWebmasterData(normalizedCounterIds, seoOs.weeks),
    loadZarukuAiVisibilityData(normalizedCounterIds, seoOs.weeks),
    loadZarukuSeoIntelligenceData(normalizedCounterIds),
  ]);

  return {
    counters: normalizedCounterIds,
    domain: "zaruku.ru",
    period: { from, to },
    layers: [
      { id: "onsite", label: "On-site", hint: "что происходит после клика" },
      { id: "serp", label: "SERP", hint: "показы, позиции, CTR до клика" },
      { id: "ai", label: "AI-выдача", hint: "цитируемость и presence rate" },
    ],
    sources: buildSources({ seoOsStatus: seoOs.status, webmaster, seoIntelligence }),
    pending_requirements: buildPendingRequirements(webmaster),
    kpis: buildKpis({
      trafficChannels,
      technicalTail,
      devices: devicesReport.rows,
      geoCountries: countriesReport.rows,
    }),
    traffic_channels: trafficChannels,
    technical_tail: technicalTail,
    organic_trend: organicTrend,
    search_engines: searchEnginesReport.rows,
    search_phrases: searchPhrasesReport.rows,
    organic_landing_pages: organicLandingReport.rows,
    top_pages: pageCollections.topPages,
    content_sections: pageCollections.contentSections,
    geo_countries: countriesReport.rows,
    geo_cities: citiesReport.rows,
    devices: devicesReport.rows,
    source_devices: sourceDevicesReport.rows,
    browsers: browsersReport.rows,
    operating_systems: osReport.rows,
    age: ageReport.rows,
    gender: genderReport.rows,
    interests: interestsReport.rows,
    returning_pages: returningPages,
    seo_os: seoOs,
    webmaster,
    ai_visibility: aiVisibility,
    seo_intelligence: seoIntelligence,
    data_quality: buildDataQuality({
      technicalTail,
      searchPhrases: searchPhrasesReport.rows,
      organicVisits,
      searchPhraseVisits,
      metrikaErrors,
    }),
  };
}

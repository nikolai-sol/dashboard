import type {
  ZarukuGscLandingPageRow,
  ZarukuGscQueryRow,
  ZarukuSeoAiVisibilityAggregateRow,
  ZarukuSeoClusterRow,
  ZarukuSeoMetricRow,
  ZarukuSeoPositionTrendPoint,
  ZarukuYandexWebmasterPageRow,
  ZarukuYandexWebmasterQueryRow,
} from "@/lib/types";

export type SeoSourceMetrics = {
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
};

export type UnifiedSeoQueryRow = {
  key: string;
  query: string;
  section: string | null;
  google: SeoSourceMetrics | null;
  webmaster: SeoSourceMetrics | null;
  seo_os: {
    tracked_position: number | null;
    delta_prev: number | null;
    status: "found" | "no_data";
    matched_url: string | null;
  } | null;
  google_pages: string[];
};

export type SeoQuerySortKey =
  | "google_position"
  | "webmaster_position"
  | "seo_os_position"
  | "impressions"
  | "clicks";

export type SeoQuerySort = {
  key: SeoQuerySortKey;
  direction: "asc" | "desc";
};

export type SeoQueryFilter = "all" | "top3" | "top10" | "top20" | "improved" | "declined" | "not_found";

export type UnifiedSeoPageRow = {
  key: string;
  url: string;
  label: string;
  google: SeoSourceMetrics | null;
  webmaster: SeoSourceMetrics | null;
  post_click: {
    visits: number;
    users: number;
    users_available: boolean;
    pageviews: number;
    bounce_rate: number | null;
    avg_duration_seconds: number | null;
    page_depth: number | null;
  } | null;
  seo_os_tracked_queries: number;
};

export type SeoExecutiveSnapshot = {
  google: SeoSourceMetrics | null;
  webmaster: SeoSourceMetrics | null;
  seo_os: { average_position: number | null; coverage: number | null } | null;
  ai: { presence_rate: number | null; mentions: number; citations: number } | null;
  post_click: { visits: number; users: number; users_available: boolean } | null;
};

type MetricsAccumulator = {
  impressions: number;
  clicks: number;
  weightedPosition: number;
  positionWeight: number;
  unweightedPosition: number;
  positionCount: number;
};

type MutableQueryRow = {
  key: string;
  query: string;
  section: string | null;
  google: MetricsAccumulator | null;
  webmaster: MetricsAccumulator | null;
  seo_os: UnifiedSeoQueryRow["seo_os"];
  google_pages: string[];
};

type PostClickAccumulator = {
  visits: number;
  users: number;
  usersAvailable: boolean;
  pageviews: number;
  bounceRateTotal: number;
  bounceRateWeight: number;
  durationTotal: number;
  durationWeight: number;
  depthTotal: number;
  depthWeight: number;
};

type MutablePageRow = {
  key: string;
  url: string;
  label: string;
  google: MetricsAccumulator | null;
  webmaster: MetricsAccumulator | null;
  post_click: PostClickAccumulator | null;
  seo_os_tracked_queries: number;
};

const MAX_GOOGLE_PAGES = 5;

function cleanText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeSeoQueryKey(value: string): string {
  return cleanText(value).toLocaleLowerCase("ru-RU");
}

export function normalizeSeoUrlKey(value: string): string {
  const normalizedInput = value.trim();
  if (!normalizedInput) {
    return "";
  }

  try {
    const url = new URL(normalizedInput, "https://zaruku.ru");
    const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./u, "");
    let pathname = url.pathname.replace(/\/{2,}/gu, "/");
    if (!pathname.startsWith("/")) {
      pathname = `/${pathname}`;
    }
    if (!pathname.endsWith("/")) {
      pathname += "/";
    }
    return `${hostname}${pathname}`;
  } catch {
    return normalizedInput.toLocaleLowerCase("ru-RU");
  }
}

function createMetricsAccumulator(): MetricsAccumulator {
  return {
    impressions: 0,
    clicks: 0,
    weightedPosition: 0,
    positionWeight: 0,
    unweightedPosition: 0,
    positionCount: 0,
  };
}

function addMetrics(
  accumulator: MetricsAccumulator,
  row: { impressions: number; clicks: number; average_position: number | null },
): void {
  accumulator.impressions += row.impressions;
  accumulator.clicks += row.clicks;

  if (row.average_position === null) {
    return;
  }

  accumulator.unweightedPosition += row.average_position;
  accumulator.positionCount += 1;
  if (row.impressions > 0) {
    accumulator.weightedPosition += row.average_position * row.impressions;
    accumulator.positionWeight += row.impressions;
  }
}

function finishMetrics(accumulator: MetricsAccumulator | null): SeoSourceMetrics | null {
  if (!accumulator) {
    return null;
  }

  const averagePosition = accumulator.positionWeight > 0
    ? accumulator.weightedPosition / accumulator.positionWeight
    : accumulator.positionCount > 0
      ? accumulator.unweightedPosition / accumulator.positionCount
      : null;

  return {
    impressions: accumulator.impressions,
    clicks: accumulator.clicks,
    ctr: accumulator.impressions > 0 ? (accumulator.clicks / accumulator.impressions) * 100 : null,
    average_position: averagePosition,
  };
}

function getOrCreateQueryRow(rows: Map<string, MutableQueryRow>, rawQuery: string): MutableQueryRow | null {
  const key = normalizeSeoQueryKey(rawQuery);
  if (!key) {
    return null;
  }

  const existing = rows.get(key);
  if (existing) {
    return existing;
  }

  const row: MutableQueryRow = {
    key,
    query: cleanText(rawQuery),
    section: null,
    google: null,
    webmaster: null,
    seo_os: null,
    google_pages: [],
  };
  rows.set(key, row);
  return row;
}

export function buildUnifiedSeoQueryRows({
  gscRows,
  webmasterRows,
  seoOsRows,
}: {
  gscRows: ZarukuGscQueryRow[];
  webmasterRows: ZarukuYandexWebmasterQueryRow[];
  seoOsRows: ZarukuSeoClusterRow[];
}): UnifiedSeoQueryRow[] {
  const rows = new Map<string, MutableQueryRow>();

  for (const sourceRow of gscRows) {
    const row = getOrCreateQueryRow(rows, sourceRow.query);
    if (!row) continue;
    row.google ??= createMetricsAccumulator();
    addMetrics(row.google, sourceRow);
    if (sourceRow.page && !row.google_pages.includes(sourceRow.page) && row.google_pages.length < MAX_GOOGLE_PAGES) {
      row.google_pages.push(sourceRow.page);
    }
  }

  for (const sourceRow of webmasterRows) {
    const row = getOrCreateQueryRow(rows, sourceRow.query);
    if (!row) continue;
    row.webmaster ??= createMetricsAccumulator();
    addMetrics(row.webmaster, sourceRow);
  }

  for (const sourceRow of seoOsRows) {
    const row = getOrCreateQueryRow(rows, sourceRow.query);
    if (!row) continue;
    if (!row.seo_os) {
      row.section = sourceRow.section;
      row.seo_os = {
        tracked_position: sourceRow.serp_position,
        delta_prev: sourceRow.delta_prev,
        status: sourceRow.status,
        matched_url: sourceRow.matched_url,
      };
    }
  }

  return Array.from(rows.values(), (row) => ({
    key: row.key,
    query: row.query,
    section: row.section,
    google: finishMetrics(row.google),
    webmaster: finishMetrics(row.webmaster),
    seo_os: row.seo_os,
    google_pages: row.google_pages,
  }));
}

function querySortValue(row: UnifiedSeoQueryRow, key: SeoQuerySortKey): number | null {
  switch (key) {
    case "google_position":
      return row.google?.average_position ?? null;
    case "webmaster_position":
      return row.webmaster?.average_position ?? null;
    case "seo_os_position":
      return row.seo_os?.tracked_position ?? null;
    case "impressions":
      return (row.google?.impressions ?? 0) + (row.webmaster?.impressions ?? 0);
    case "clicks":
      return (row.google?.clicks ?? 0) + (row.webmaster?.clicks ?? 0);
  }
}

export function sortUnifiedSeoQueryRows(rows: UnifiedSeoQueryRow[], sort: SeoQuerySort): UnifiedSeoQueryRow[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = querySortValue(left, sort.key);
    const rightValue = querySortValue(right, sort.key);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return (leftValue - rightValue) * direction;
    }
    return left.query.localeCompare(right.query, "ru-RU");
  });
}

export function filterUnifiedSeoQueryRows(rows: UnifiedSeoQueryRow[], filter: SeoQueryFilter): UnifiedSeoQueryRow[] {
  if (filter === "all") return rows;
  if (filter === "improved") return rows.filter((row) => (row.seo_os?.delta_prev ?? 0) < 0);
  if (filter === "declined") return rows.filter((row) => (row.seo_os?.delta_prev ?? 0) > 0);
  if (filter === "not_found") {
    return rows.filter((row) => row.seo_os?.status === "no_data" || [
      row.google?.average_position,
      row.webmaster?.average_position,
      row.seo_os?.tracked_position,
    ].every((position) => position === null || position === undefined));
  }

  const limit = filter === "top3" ? 3 : filter === "top10" ? 10 : 20;
  return rows.filter((row) => [
    row.google?.average_position,
    row.webmaster?.average_position,
    row.seo_os?.tracked_position,
  ].some((position) => position !== null && position !== undefined && position <= limit));
}

function displayUrl(rawUrl: string, key: string): string {
  const trimmed = rawUrl.trim();
  return trimmed || `https://${key}`;
}

function getOrCreatePageRow(rows: Map<string, MutablePageRow>, rawUrl: string, label?: string): MutablePageRow | null {
  const key = normalizeSeoUrlKey(rawUrl);
  if (!key) return null;
  const existing = rows.get(key);
  if (existing) {
    if (label && existing.label === existing.url) existing.label = label;
    return existing;
  }

  const url = displayUrl(rawUrl, key);
  const row: MutablePageRow = {
    key,
    url,
    label: label || url,
    google: null,
    webmaster: null,
    post_click: null,
    seo_os_tracked_queries: 0,
  };
  rows.set(key, row);
  return row;
}

function createPostClickAccumulator(): PostClickAccumulator {
  return {
    visits: 0,
    users: 0,
    usersAvailable: true,
    pageviews: 0,
    bounceRateTotal: 0,
    bounceRateWeight: 0,
    durationTotal: 0,
    durationWeight: 0,
    depthTotal: 0,
    depthWeight: 0,
  };
}

function addWeightedPostClickMetric(
  accumulator: PostClickAccumulator,
  value: number | null | undefined,
  totalKey: "bounceRateTotal" | "durationTotal" | "depthTotal",
  weightKey: "bounceRateWeight" | "durationWeight" | "depthWeight",
  weight: number,
): void {
  if (value === null || value === undefined) return;
  const safeWeight = weight > 0 ? weight : 1;
  accumulator[totalKey] += value * safeWeight;
  accumulator[weightKey] += safeWeight;
}

function finishPostClick(accumulator: PostClickAccumulator | null): UnifiedSeoPageRow["post_click"] {
  if (!accumulator) return null;
  return {
    visits: accumulator.visits,
    users: accumulator.users,
    users_available: accumulator.usersAvailable,
    pageviews: accumulator.pageviews,
    bounce_rate: accumulator.bounceRateWeight > 0 ? accumulator.bounceRateTotal / accumulator.bounceRateWeight : null,
    avg_duration_seconds: accumulator.durationWeight > 0 ? accumulator.durationTotal / accumulator.durationWeight : null,
    page_depth: accumulator.depthWeight > 0 ? accumulator.depthTotal / accumulator.depthWeight : null,
  };
}

export function buildUnifiedSeoPageRows({
  gscRows,
  webmasterRows,
  metrikaRows,
  seoOsRows,
}: {
  gscRows: ZarukuGscLandingPageRow[];
  webmasterRows: ZarukuYandexWebmasterPageRow[];
  metrikaRows: ZarukuSeoMetricRow[];
  seoOsRows: ZarukuSeoClusterRow[];
}): UnifiedSeoPageRow[] {
  const rows = new Map<string, MutablePageRow>();

  for (const sourceRow of gscRows) {
    const row = getOrCreatePageRow(rows, sourceRow.page);
    if (!row) continue;
    row.google ??= createMetricsAccumulator();
    addMetrics(row.google, sourceRow);
  }

  for (const sourceRow of webmasterRows) {
    const row = getOrCreatePageRow(rows, sourceRow.url);
    if (!row) continue;
    row.webmaster ??= createMetricsAccumulator();
    addMetrics(row.webmaster, sourceRow);
  }

  for (const sourceRow of metrikaRows) {
    if (!sourceRow.url) continue;
    const row = getOrCreatePageRow(rows, sourceRow.url, sourceRow.label);
    if (!row) continue;
    row.post_click ??= createPostClickAccumulator();
    row.post_click.visits += sourceRow.visits;
    if (row.post_click.usersAvailable && sourceRow.users_available !== false) {
      row.post_click.users += sourceRow.users;
    } else {
      row.post_click.users = 0;
      row.post_click.usersAvailable = false;
    }
    row.post_click.pageviews += sourceRow.pageviews;
    addWeightedPostClickMetric(row.post_click, sourceRow.bounce_rate, "bounceRateTotal", "bounceRateWeight", sourceRow.visits);
    addWeightedPostClickMetric(row.post_click, sourceRow.avg_duration_seconds, "durationTotal", "durationWeight", sourceRow.visits);
    addWeightedPostClickMetric(row.post_click, sourceRow.page_depth, "depthTotal", "depthWeight", sourceRow.visits);
  }

  for (const sourceRow of seoOsRows) {
    if (!sourceRow.matched_url) continue;
    const row = getOrCreatePageRow(rows, sourceRow.matched_url);
    if (row) row.seo_os_tracked_queries += 1;
  }

  return Array.from(rows.values(), (row) => ({
    key: row.key,
    url: row.url,
    label: row.label,
    google: finishMetrics(row.google),
    webmaster: finishMetrics(row.webmaster),
    post_click: finishPostClick(row.post_click),
    seo_os_tracked_queries: row.seo_os_tracked_queries,
  }));
}

function aggregateQueryMetrics(rows: Array<{ impressions: number; clicks: number; average_position: number | null }>): SeoSourceMetrics | null {
  if (rows.length === 0) return null;
  const accumulator = createMetricsAccumulator();
  for (const row of rows) addMetrics(accumulator, row);
  return finishMetrics(accumulator);
}

export function buildSeoExecutiveSnapshot({
  gscRows,
  webmasterRows,
  positionTrend,
  aiRows,
  postClickRows,
}: {
  gscRows: ZarukuGscQueryRow[];
  webmasterRows: ZarukuYandexWebmasterQueryRow[];
  positionTrend: ZarukuSeoPositionTrendPoint[];
  aiRows: ZarukuSeoAiVisibilityAggregateRow[];
  postClickRows: ZarukuSeoMetricRow[];
}): SeoExecutiveSnapshot {
  let positionTotal = 0;
  let positionWeight = 0;
  let foundRows = 0;
  let trackedRows = 0;
  for (const row of positionTrend) {
    foundRows += row.found_rows;
    trackedRows += row.tracked_rows;
    if (row.average_position !== null && row.found_rows > 0) {
      positionTotal += row.average_position * row.found_rows;
      positionWeight += row.found_rows;
    }
  }

  const aiPresenceValues = aiRows.map((row) => row.presence_rate).filter((value) => Number.isFinite(value));
  return {
    google: aggregateQueryMetrics(gscRows),
    webmaster: aggregateQueryMetrics(webmasterRows),
    seo_os: positionTrend.length > 0 ? {
      average_position: positionWeight > 0 ? positionTotal / positionWeight : null,
      coverage: trackedRows > 0 ? foundRows / trackedRows : null,
    } : null,
    ai: aiRows.length > 0 ? {
      presence_rate: aiPresenceValues.length > 0
        ? aiPresenceValues.reduce((sum, value) => sum + value, 0) / aiPresenceValues.length
        : null,
      mentions: aiRows.reduce((sum, row) => sum + row.mentions, 0),
      citations: aiRows.reduce((sum, row) => sum + row.citations, 0),
    } : null,
    post_click: postClickRows.length > 0
      ? {
        visits: postClickRows.reduce((sum, row) => sum + row.visits, 0),
        users: postClickRows.every((row) => row.users_available !== false)
          ? postClickRows.reduce((sum, row) => sum + row.users, 0)
          : 0,
        users_available: postClickRows.every(
          (row) => row.users_available !== false,
        ),
      }
      : null,
  };
}

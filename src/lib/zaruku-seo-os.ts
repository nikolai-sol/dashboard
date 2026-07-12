import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import type {
  ZarukuSeoClusterRow,
  ZarukuSeoOpportunityRow,
  ZarukuSeoOsData,
  ZarukuSeoPositionTrendPoint,
  ZarukuSeoRunRow,
  ZarukuSeoSectionPattern,
  ZarukuSeoTaskRow,
  ZarukuSeoTrafficVisibilityRow,
} from "@/lib/types";

type IsoWeek = { year: number; week: number };

const ISO_WEEK_PATTERN = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

function parseIsoWeek(value: string): IsoWeek {
  const match = ISO_WEEK_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid ISO week: ${value}`);

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week > isoWeeksInYear(year)) throw new Error(`Invalid ISO week: ${value}`);
  return { year, week };
}

function isoWeeksInYear(year: number) {
  const januaryFirstDate = new Date(0);
  januaryFirstDate.setUTCFullYear(year, 0, 1);
  const januaryFirst = januaryFirstDate.getUTCDay() || 7;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return januaryFirst === 4 || (januaryFirst === 3 && isLeapYear) ? 53 : 52;
}

function formatIsoWeek({ year, week }: IsoWeek) {
  return `${String(year).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
}

function nextIsoWeek(value: IsoWeek): IsoWeek {
  const nextWeek = value.week + 1;
  return nextWeek > isoWeeksInYear(value.year) ? { year: value.year + 1, week: 1 } : { year: value.year, week: nextWeek };
}

function compareIsoWeeks(left: string, right: string) {
  const a = parseIsoWeek(left);
  const b = parseIsoWeek(right);
  return a.year - b.year || a.week - b.week;
}

function pathnameFromUrl(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return value.split(/[?#]/, 1)[0] || "/";
  }
}

type SqlQuery = { sql: string; params: string[] };

type SeoSectionPatternDbRow = {
  section: string;
  url_pattern: string;
  priority: number | string;
};

type SeoClusterDbRow = {
  week: string;
  section: string;
  cluster_id: string;
  query: string;
  serp_position: number | string | null;
  delta_prev: number | string | null;
  matched_url: string | null;
  status: ZarukuSeoClusterRow["status"];
};

type SeoOpportunityDbRow = {
  week: string;
  opportunity_id: string;
  section: string | null;
  opportunity_type: string;
  title: string;
  target_url: string | null;
  decision: ZarukuSeoOpportunityRow["decision"];
  reject_reason: string | null;
  confidence: number | string | null;
  priority: ZarukuSeoOpportunityRow["priority"];
};

type SeoTaskDbRow = {
  week: string;
  task_id: string;
  section: string | null;
  title: string;
  status: ZarukuSeoTaskRow["status"];
  notion_url: string | null;
};

type SeoRunDbRow = {
  week: string;
  status: ZarukuSeoRunRow["status"];
  serp_requests: number | string;
  llm_tokens: number | string;
  digest_count: number | string;
  stages: unknown;
};

type CanonicalPageTrafficDbRow = {
  report_date: string | Date;
  page_url: string | null;
  visits: number | string | null;
  users: number | string | null;
  pageviews: number | string | null;
};

function buildInClause(values: readonly string[]) {
  return values.map(() => "?").join(", ");
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asNullableNumber(value: unknown) {
  return value == null ? null : asNumber(value);
}

function asNullableString(value: unknown) {
  return value == null ? null : String(value);
}

function parseStages(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed != null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function normalizeSeoSectionPatternRow(row: SeoSectionPatternDbRow): ZarukuSeoSectionPattern {
  return {
    section: String(row.section),
    url_pattern: String(row.url_pattern),
    priority: asNumber(row.priority),
  };
}

export function normalizeSeoClusterRow(row: SeoClusterDbRow): ZarukuSeoClusterRow {
  return {
    week: String(row.week),
    section: String(row.section),
    cluster_id: String(row.cluster_id),
    query: String(row.query),
    serp_position: asNullableNumber(row.serp_position),
    delta_prev: asNullableNumber(row.delta_prev),
    matched_url: asNullableString(row.matched_url),
    status: row.status,
  };
}

export function normalizeSeoOpportunityRow(row: SeoOpportunityDbRow): ZarukuSeoOpportunityRow {
  return {
    week: String(row.week),
    opportunity_id: String(row.opportunity_id),
    section: asNullableString(row.section),
    opportunity_type: String(row.opportunity_type),
    title: String(row.title),
    target_url: asNullableString(row.target_url),
    decision: row.decision,
    reject_reason: asNullableString(row.reject_reason),
    confidence: asNumber(row.confidence),
    priority: row.priority,
  };
}

export function normalizeSeoTaskRow(row: SeoTaskDbRow): ZarukuSeoTaskRow {
  return {
    week: String(row.week),
    task_id: String(row.task_id),
    section: asNullableString(row.section),
    title: String(row.title),
    status: row.status,
    notion_url: asNullableString(row.notion_url),
  };
}

export function normalizeSeoRunRow(row: SeoRunDbRow): ZarukuSeoRunRow {
  return {
    week: String(row.week),
    status: row.status,
    serp_requests: asNumber(row.serp_requests),
    llm_tokens: asNumber(row.llm_tokens),
    digest_count: asNumber(row.digest_count),
    stages: parseStages(row.stages),
  };
}

export function buildSeoOsAccountQueries(counterIds: string[]): Record<"sectionPatterns" | "positions" | "opportunities" | "tasks" | "runs", SqlQuery> {
  const accountScope = buildInClause(counterIds);
  return {
    sectionPatterns: {
      sql: `
        SELECT section, url_pattern, priority
        FROM seo_section_patterns
        WHERE analytics_account_id IN (${accountScope})
        ORDER BY priority ASC, section ASC, url_pattern ASC
      `,
      params: counterIds,
    },
    positions: {
      sql: `
        SELECT week_key AS week, section, cluster_id, query, serp_position, delta_prev, matched_url, status
        FROM seo_positions_weekly
        WHERE analytics_account_id IN (${accountScope})
        ORDER BY week_key ASC, section ASC, cluster_id ASC
      `,
      params: counterIds,
    },
    opportunities: {
      sql: `
        SELECT
          week_key AS week,
          CONCAT(cluster_id, ':', opportunity_type) AS opportunity_id,
          section,
          opportunity_type,
          CONCAT(opportunity_type, ': ', cluster_id) AS title,
          target_url,
          decision,
          reject_reason,
          confidence,
          priority
        FROM seo_opportunities
        WHERE analytics_account_id IN (${accountScope})
        ORDER BY week_key ASC, section ASC, cluster_id ASC, opportunity_type ASC
      `,
      params: counterIds,
    },
    tasks: {
      sql: `
        SELECT
          week_key AS week,
          task_id,
          NULL AS section,
          CONCAT(opportunity_type, ': ', cluster_id) AS title,
          status,
          notion_url
        FROM seo_tasks
        WHERE analytics_account_id IN (${accountScope})
        ORDER BY week_key ASC, task_id ASC
      `,
      params: counterIds,
    },
    runs: {
      sql: `
        SELECT week_key AS week, status, serp_requests, llm_tokens, digest_count, stages_json AS stages
        FROM seo_weekly_runs
        WHERE analytics_account_id IN (${accountScope})
        ORDER BY week_key ASC
      `,
      params: counterIds,
    },
  };
}

export function buildSeoOsTrafficQuery(counterIds: string[], from: string, to: string): SqlQuery {
  return {
    sql: `
      SELECT
        report_date,
        page_url,
        COALESCE(SUM(visits), 0) AS visits,
        COALESCE(SUM(users), 0) AS users,
        COALESCE(SUM(pageviews), 0) AS pageviews
      FROM canonical_fact_site_analytics_daily
      WHERE source_key = 'yandex_metrika'
        AND analytics_scope = 'page'
        AND analytics_account_id IN (${buildInClause(counterIds)})
        AND report_date BETWEEN ? AND ?
      GROUP BY report_date, page_url
      ORDER BY report_date ASC, page_url ASC
    `,
    params: [...counterIds, from, to],
  };
}

export function sortIsoWeeks(weeks: string[]) {
  return [...weeks].sort(compareIsoWeeks);
}

export function previousAvailableWeek(weeks: string[], selectedWeek: string) {
  const sortedWeeks = sortIsoWeeks(weeks);
  const selectedIndex = sortedWeeks.indexOf(selectedWeek);
  return selectedIndex > 0 ? sortedWeeks[selectedIndex - 1] : null;
}

export function matchSectionPattern(url: string, patterns: ZarukuSeoSectionPattern[]) {
  const pathname = pathnameFromUrl(url);
  return patterns
    .map((pattern, index) => ({ pattern, index }))
    .filter(({ pattern }) => pathname.includes(pattern.url_pattern))
    .sort(
      (left, right) =>
        right.pattern.url_pattern.length - left.pattern.url_pattern.length ||
        left.pattern.priority - right.pattern.priority ||
        left.index - right.index,
    )[0]?.pattern;
}

export function buildSectionPositionTrend(
  rows: Array<Pick<ZarukuSeoClusterRow, "week" | "section" | "serp_position" | "status">>,
): ZarukuSeoPositionTrendPoint[] {
  const groups = new Map<string, { week: string; section: string; positions: number[]; foundRows: number; trackedRows: number }>();

  for (const row of rows) {
    const key = `${row.week}\u0000${row.section}`;
    const group = groups.get(key) ?? { week: row.week, section: row.section, positions: [], foundRows: 0, trackedRows: 0 };
    group.trackedRows += 1;
    if (row.status === "found") group.foundRows += 1;
    if (row.serp_position != null) group.positions.push(row.serp_position);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map(({ week, section, positions, foundRows, trackedRows }) => ({
      week,
      section,
      average_position: positions.length > 0 ? positions.reduce((total, position) => total + position, 0) / positions.length : null,
      coverage: trackedRows > 0 ? foundRows / trackedRows : 0,
      found_rows: foundRows,
      tracked_rows: trackedRows,
    }))
    .sort((left, right) => compareIsoWeeks(left.week, right.week) || left.section.localeCompare(right.section));
}

export function calculateApproveRate(rows: Array<Pick<ZarukuSeoOpportunityRow, "decision">>) {
  const decidedRows = rows.filter(({ decision }) => decision === "approved" || decision === "rejected");
  if (decidedRows.length === 0) return null;
  return (decidedRows.filter(({ decision }) => decision === "approved").length / decidedRows.length) * 100;
}

export function buildRhythmWeeks(runs: ZarukuSeoRunRow[], availableWeeks = runs.map((run) => run.week)): ZarukuSeoRunRow[] {
  if (availableWeeks.length === 0) return [];

  const runsByWeek = new Map(runs.map((run) => [run.week, run]));
  const weeks = sortIsoWeeks(availableWeeks);
  const first = parseIsoWeek(weeks[0]);
  const last = parseIsoWeek(weeks[weeks.length - 1]);
  const rhythm: ZarukuSeoRunRow[] = [];

  for (let current = first; current.year < last.year || (current.year === last.year && current.week <= last.week); current = nextIsoWeek(current)) {
    const week = formatIsoWeek(current);
    rhythm.push(runsByWeek.get(week) ?? { week, status: "missing", serp_requests: 0, llm_tokens: 0, digest_count: 0 });
  }

  return rhythm;
}

function isoWeekDateRange(week: string) {
  const { year, week: weekNumber } = parseIsoWeek(week);
  const januaryFourth = new Date(0);
  januaryFourth.setUTCFullYear(year, 0, 4);
  const weekOneMonday = new Date(januaryFourth);
  weekOneMonday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() || 7) - 1));
  const monday = new Date(weekOneMonday);
  monday.setUTCDate(weekOneMonday.getUTCDate() + (weekNumber - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

function isoWeekFromDate(value: string | Date) {
  const date = value instanceof Date ? new Date(value) : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(0);
  yearStart.setUTCFullYear(year, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return formatIsoWeek({ year, week });
}

function buildTrafficVisibility(
  rows: CanonicalPageTrafficDbRow[],
  patterns: ZarukuSeoSectionPattern[],
  positionTrend: ZarukuSeoPositionTrendPoint[],
): ZarukuSeoTrafficVisibilityRow[] {
  const knownSections = new Set(patterns.map((pattern) => pattern.section));
  const values = new Map<string, ZarukuSeoTrafficVisibilityRow>();

  for (const point of positionTrend) {
    if (!knownSections.has(point.section)) continue;
    values.set(`${point.week}\u0000${point.section}`, {
      week: point.week,
      section: point.section,
      visits: 0,
      users: 0,
      pageviews: 0,
      average_position: point.average_position,
      coverage: point.coverage,
    });
  }

  for (const row of rows) {
    const pageUrl = asNullableString(row.page_url);
    if (!pageUrl) continue;
    const pattern = matchSectionPattern(pageUrl, patterns);
    if (!pattern) continue;
    const week = isoWeekFromDate(row.report_date);
    const key = `${week}\u0000${pattern.section}`;
    const current =
      values.get(key) ??
      ({
        week,
        section: pattern.section,
        visits: 0,
        users: 0,
        pageviews: 0,
        average_position: null,
        coverage: null,
      } satisfies ZarukuSeoTrafficVisibilityRow);
    current.visits += asNumber(row.visits);
    current.users += asNumber(row.users);
    current.pageviews += asNumber(row.pageviews);
    values.set(key, current);
  }

  return [...values.values()].sort((left, right) => compareIsoWeeks(left.week, right.week) || left.section.localeCompare(right.section));
}

export function emptyZarukuSeoOsData(error: string | null = null): ZarukuSeoOsData {
  return {
    available: false,
    error,
    weeks: [],
    latest_week: null,
    section_patterns: [],
    position_trend: [],
    clusters: [],
    opportunities: [],
    tasks: [],
    runs: [],
    traffic_visibility: [],
  };
}

export async function loadZarukuSeoOsData(counterIds: string[]): Promise<ZarukuSeoOsData> {
  try {
    const queries = buildSeoOsAccountQueries(counterIds);
    const [sectionPatternRows, clusterRows, opportunityRows, taskRows, runRows] = await Promise.all([
      pool.execute<Array<SeoSectionPatternDbRow & RowDataPacket>>(queries.sectionPatterns.sql, queries.sectionPatterns.params),
      pool.execute<Array<SeoClusterDbRow & RowDataPacket>>(queries.positions.sql, queries.positions.params),
      pool.execute<Array<SeoOpportunityDbRow & RowDataPacket>>(queries.opportunities.sql, queries.opportunities.params),
      pool.execute<Array<SeoTaskDbRow & RowDataPacket>>(queries.tasks.sql, queries.tasks.params),
      pool.execute<Array<SeoRunDbRow & RowDataPacket>>(queries.runs.sql, queries.runs.params),
    ]);
    const sectionPatterns = sectionPatternRows[0].map(normalizeSeoSectionPatternRow);
    const clusters = clusterRows[0].map(normalizeSeoClusterRow);
    const opportunities = opportunityRows[0].map(normalizeSeoOpportunityRow);
    const tasks = taskRows[0].map(normalizeSeoTaskRow);
    const runRecords = runRows[0].map(normalizeSeoRunRow);
    const weeks = sortIsoWeeks([...new Set([...clusters, ...opportunities, ...tasks, ...runRecords].map((row) => row.week))]);
    const positionTrend = buildSectionPositionTrend(clusters);
    const runs = buildRhythmWeeks(runRecords, weeks);

    if (weeks.length === 0) {
      return {
        available: true,
        error: null,
        weeks,
        latest_week: null,
        section_patterns: sectionPatterns,
        position_trend: positionTrend,
        clusters,
        opportunities,
        tasks,
        runs,
        traffic_visibility: [],
      };
    }

    const dateRange = {
      from: isoWeekDateRange(weeks[0]).from,
      to: isoWeekDateRange(weeks[weeks.length - 1]).to,
    };
    const trafficQuery = buildSeoOsTrafficQuery(counterIds, dateRange.from, dateRange.to);
    const [trafficRows] = await pool.execute<Array<CanonicalPageTrafficDbRow & RowDataPacket>>(trafficQuery.sql, trafficQuery.params);

    return {
      available: true,
      error: null,
      weeks,
      latest_week: weeks[weeks.length - 1],
      section_patterns: sectionPatterns,
      position_trend: positionTrend,
      clusters,
      opportunities,
      tasks,
      runs,
      traffic_visibility: buildTrafficVisibility(trafficRows, sectionPatterns, positionTrend),
    };
  } catch (error) {
    return emptyZarukuSeoOsData(error instanceof Error ? error.message : String(error));
  }
}

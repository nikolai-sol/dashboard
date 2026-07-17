import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";

import {
  loadActiveAbbottReleaseBundle,
} from "@/lib/abbott-private-store";
import type {
  AbbottAggregatePrivateData,
  AbbottPrivateSessionJourneysData,
  ParsedAbbottWorkbook,
  ParsedBitrixAnalytics,
  AbbottReleaseBundle,
} from "@/lib/abbott-private-types";
import pool from "@/lib/db";
import type {
  AbbottBiBitrixPageRow,
  AbbottBiBitrixSummary,
  AbbottBiData,
  AbbottBiExternalClickRow,
  AbbottBiMaterialRow,
  AbbottBiPageStatRow,
  AbbottBiPrivateSourceMetadata,
  AbbottBiReturningRow,
  AbbottBiSessionJourneysData,
  AbbottBiTimeBuckets,
  AbbottBiUserActionRow,
  AbbottBiUserSummaryRow,
} from "@/lib/types";

export type AbbottDashboardAudience = "manager" | "embed";

const ABBOTT_SOURCE_KEY = "yandex_metrika";
const ABBOTT_COUNTER_ID = "90602537";
const ABBOTT_CANONICAL_CUTOFF = "2026-01-01";
const ABBOTT_REQUIRED_SCOPES = ["other", "traffic", "page", "user_behavior", "returning"] as const;

type AbbottRequiredScope = (typeof ABBOTT_REQUIRED_SCOPES)[number];
type AbbottCoverageStatus =
  | "success"
  | "success_empty"
  | "partial"
  | "skipped"
  | "sampled"
  | "failed"
  | "missing"
  | "unavailable"
  | "invalid_request";

export interface AbbottCanonicalGap {
  counter_id: string;
  report_date: string;
  scope: AbbottRequiredScope | "release" | "request";
  status: AbbottCoverageStatus;
}

export interface AbbottCanonicalDataQuality {
  status: "complete" | "incomplete";
  release_id: number | null;
  requested_scopes: readonly AbbottRequiredScope[];
  requested_from: string;
  requested_to: string;
  blocking_gaps: AbbottCanonicalGap[];
  content_lookup: {
    ambiguous_groups: number;
    collapsed_groups: number;
  };
}

export type AbbottCanonicalBiData = AbbottBiData & {
  source: "canonical";
  access_level: AbbottDashboardAudience;
  data_quality: AbbottCanonicalDataQuality;
};

export interface AbbottBiQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
}

export interface AbbottBiLoaderDependencies {
  aggregateExecutor: AbbottBiQueryExecutor;
  privateExecutor: AbbottBiQueryExecutor;
  loadReleaseBundle(
    dashboardId: number,
    audience: AbbottDashboardAudience,
    from: string,
    to: string,
  ): Promise<AbbottReleaseBundle>;
}

type CoverageRow = Record<string, unknown> & {
  counter_id?: unknown;
  report_date?: unknown;
  scope_key?: unknown;
  collection_status?: unknown;
  pagination_complete?: unknown;
  is_sampled?: unknown;
  empty_reconciled?: unknown;
};

type SiteFactRow = Record<string, unknown> & {
  analytics_scope?: unknown;
  traffic_source?: unknown;
  utm_source?: unknown;
  page_url?: unknown;
  page_title?: unknown;
  sessions?: unknown;
  users?: unknown;
  pageviews?: unknown;
  bounce_rate?: unknown;
  average_session_seconds?: unknown;
};

type ReturningFactRow = Record<string, unknown> & {
  report_date?: unknown;
  raw_page_value?: unknown;
  normalized_page?: unknown;
  return_bucket_code?: unknown;
  source_percentage?: unknown;
  source_denominator?: unknown;
};

type PrivateBehaviorRow = Record<string, unknown> & {
  raw_user_id?: unknown;
  start_url?: unknown;
  end_url?: unknown;
  pageviews?: unknown;
};

type AbbottReturningOutput = AbbottBiReturningRow & {
  is_derived: true;
  normalization_collision: boolean;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const valueText = text(value);
  return valueText.length > 0 ? valueText : null;
}

function rawIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Abbott canonical data is unavailable");
  }
  return value;
}

function numberMetric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function integerMetric(value: unknown): number {
  return Math.round(numberMetric(value));
}

function booleanMetric(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function placeholders(values: readonly unknown[]): string {
  if (values.length === 0) throw new Error("Abbott canonical data is unavailable");
  return values.map(() => "?").join(", ");
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function listDates(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return [];
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function normalizePage(rawValue: unknown): string {
  const value = text(rawValue).trim().replaceAll("&amp;", "&");
  if (!value) return "";
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return value.split(/[?#]/, 1)[0]?.replace(/\/{2,}/g, "/").replace(/\/+$/, "") ?? "";
  }
}

function lookupHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedPagePath(normalized: string): string {
  try {
    return new URL(normalized).pathname;
  } catch {
    return normalized;
  }
}

export function toAbbottDateOnly(value: string | null | undefined): string {
  return text(value).slice(0, 10);
}

export function isAbbottBitrixPeriodActive(
  dashboardFrom: string,
  dashboardTo: string,
  summary: AbbottBiBitrixSummary | null,
): boolean {
  if (!summary?.date_from || !summary?.date_to) return false;
  const from = toAbbottDateOnly(dashboardFrom);
  const to = toAbbottDateOnly(dashboardTo);
  const bitrixFrom = toAbbottDateOnly(summary.date_from);
  const bitrixTo = toAbbottDateOnly(summary.date_to);
  return Boolean(from && to && bitrixFrom && bitrixTo && from >= bitrixFrom && to <= bitrixTo);
}

function emptyTimeBuckets(): AbbottBiTimeBuckets {
  return {
    overall: [
      { bucket_id: "lt_1m", label: "Менее 1 мин", users: 0 },
      { bucket_id: "1_2m", label: "1 - 2 минуты", users: 0 },
      { bucket_id: "2_5m", label: "2 - 5 минут", users: 0 },
      { bucket_id: "gt_5m", label: "Более 5 минут", users: 0 },
    ],
    materials: [],
    by_page: [],
  };
}

function emptyJourneys(): AbbottBiSessionJourneysData {
  return { report_date: "", schema: null, summary: null, rows: [] };
}

function unavailableBitrixSource(): AbbottBiPrivateSourceMetadata {
  return {
    source_status: "unavailable",
    test_dump: true,
    snapshot_id: null,
    generated_at: null,
    period_from: null,
    period_to: null,
  };
}

function emptyAbbottData(
  counters: string[],
  audience: AbbottDashboardAudience,
  from: string,
  to: string,
  releaseId: number | null,
  gaps: AbbottCanonicalGap[],
  lookupQuality: AbbottAggregatePrivateData["workbook"]["lookupQuality"] = {
    ambiguousGroups: 0,
    collapsedGroups: 0,
  },
): AbbottCanonicalBiData {
  return {
    source: "canonical",
    access_level: audience,
    data_quality: {
      status: gaps.length === 0 ? "complete" : "incomplete",
      release_id: releaseId,
      requested_scopes: ABBOTT_REQUIRED_SCOPES,
      requested_from: from,
      requested_to: to,
      blocking_gaps: gaps,
      content_lookup: {
        ambiguous_groups: lookupQuality.ambiguousGroups,
        collapsed_groups: lookupQuality.collapsedGroups,
      },
    },
    counters,
    users_summary: [],
    traffic_summary: [],
    user_actions: [],
    page_stats: [],
    bitrix_pages: [],
    bitrix_summary: null,
    bitrix_sources: {
      pages: unavailableBitrixSource(),
      journeys: unavailableBitrixSource(),
    },
    bitrix_period_active: false,
    session_journeys: emptyJourneys(),
    external_events: [],
    external_clicks: [],
    time_buckets: emptyTimeBuckets(),
    returning: [],
    general_materials: [],
  };
}

function coverageKey(counterId: string, reportDate: string, scope: string): string {
  return `${counterId}\n${reportDate}\n${scope}`;
}

function validCoverageRow(row: CoverageRow): boolean {
  if (!booleanMetric(row.pagination_complete) || booleanMetric(row.is_sampled)) return false;
  if (row.collection_status === "success") return true;
  return row.collection_status === "success_empty" && booleanMetric(row.empty_reconciled);
}

async function coverageGaps(
  executor: AbbottBiQueryExecutor,
  releaseId: number,
  counterIds: string[],
  from: string,
  to: string,
): Promise<AbbottCanonicalGap[]> {
  const rows = (await executor.query(
    `SELECT counter_id, report_date, scope_key, collection_status,
            pagination_complete, is_sampled, empty_reconciled
     FROM \`report_bd\`.\`canonical_source_coverage_daily\`
     WHERE canonical_release_id = ?
       AND source_key = ?
       AND counter_id IN (${placeholders(counterIds)})
       AND report_date >= ?
       AND report_date <= ?
     ORDER BY counter_id, report_date, scope_key`,
    [releaseId, ABBOTT_SOURCE_KEY, ...counterIds, from, to],
  )) as readonly CoverageRow[];
  const byKey = new Map(rows.map((row) => [coverageKey(text(row.counter_id), text(row.report_date).slice(0, 10), text(row.scope_key)), row]));
  const gaps: AbbottCanonicalGap[] = [];
  for (const counterId of counterIds) {
    for (const reportDate of listDates(from, to)) {
      for (const scope of ABBOTT_REQUIRED_SCOPES) {
        const row = byKey.get(coverageKey(counterId, reportDate, scope));
        if (!row || !validCoverageRow(row)) {
          gaps.push({
            counter_id: counterId,
            report_date: reportDate,
            scope,
            status: row ? (text(row.collection_status) as AbbottCoverageStatus) : "missing",
          });
        }
      }
    }
  }
  return gaps;
}

async function querySiteFacts(
  executor: AbbottBiQueryExecutor,
  releaseId: number,
  counterIds: string[],
  from: string,
  to: string,
): Promise<readonly SiteFactRow[]> {
  return (await executor.query(
    `SELECT analytics_scope,
            JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.traffic_source')) AS traffic_source,
            JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.utm_source')) AS utm_source,
            JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.page_url')) AS page_url,
            JSON_UNQUOTE(JSON_EXTRACT(scope_dimensions, '$.page_title')) AS page_title,
            sessions, users, pageviews, bounce_rate, average_session_seconds
     FROM \`report_bd\`.\`canonical_fact_metrika_site_analytics_daily\`
     WHERE canonical_release_id = ?
       AND source_key = ?
       AND analytics_account_id IN (${placeholders(counterIds)})
       AND counter_id IN (${placeholders(counterIds)})
       AND analytics_scope IN ('other', 'traffic', 'page')
       AND report_date >= ?
       AND report_date <= ?
     ORDER BY analytics_scope, scope_hash`,
    [releaseId, ABBOTT_SOURCE_KEY, ...counterIds, ...counterIds, from, to],
  )) as readonly SiteFactRow[];
}

async function queryReturningFacts(
  executor: AbbottBiQueryExecutor,
  releaseId: number,
  counterIds: string[],
  from: string,
  to: string,
): Promise<readonly ReturningFactRow[]> {
  return (await executor.query(
    `SELECT report_date, raw_page_value, normalized_page, return_bucket_code,
            source_percentage, source_denominator
     FROM \`report_bd\`.\`canonical_fact_metrika_returning_pages_daily\`
     WHERE canonical_release_id = ?
       AND counter_id IN (${placeholders(counterIds)})
       AND report_date >= ?
       AND report_date <= ?
       AND return_bucket_code IN ('next_day', 'days_2_7', 'days_8_31')
     ORDER BY normalized_page_hash, raw_page_hash, report_date, return_bucket_code`,
    [releaseId, ...counterIds, from, to],
  )) as readonly ReturningFactRow[];
}

async function queryExternalClicks(
  executor: AbbottBiQueryExecutor,
  releaseId: number,
  counterIds: string[],
  from: string,
  to: string,
): Promise<readonly Record<string, unknown>[]> {
  return executor.query(
    `SELECT normalized_path AS external_url, COUNT(*) AS outbound_clicks
     FROM \`report_bd\`.\`portal_external_events\`
     WHERE canonical_release_id = ?
       AND source_key = ?
       AND analytics_account_id IN (${placeholders(counterIds)})
       AND report_date >= ?
       AND report_date <= ?
     GROUP BY normalized_path, normalized_path_hash
     ORDER BY outbound_clicks DESC, normalized_path_hash`,
    [releaseId, ABBOTT_SOURCE_KEY, ...counterIds, from, to],
  );
}

async function queryManagerBehavior(
  executor: AbbottBiQueryExecutor,
  releaseId: number,
  counterIds: string[],
  from: string,
  to: string,
): Promise<readonly PrivateBehaviorRow[]> {
  return (await executor.query(
    `SELECT raw_user_id, start_url, end_url, pageviews
     FROM \`report_bd_private\`.\`canonical_fact_metrika_user_behavior_daily\`
     WHERE canonical_release_id = ?
       AND counter_id IN (${placeholders(counterIds)})
       AND report_date >= ?
       AND report_date <= ?
     ORDER BY raw_user_id_hash, report_date, request_fingerprint`,
    [releaseId, ...counterIds, from, to],
  )) as readonly PrivateBehaviorRow[];
}

function metadataForPage(
  rawUrl: string,
  pageTitle: string,
  workbook: AbbottAggregatePrivateData["workbook"],
): { direction: string | null; material_type: string | null; access: string | null; hidden: boolean } {
  const normalized = normalizePage(rawUrl);
  const path = normalizedPagePath(normalized);
  const slug = path.split("/").filter(Boolean).at(-1) ?? "";
  const metadata = workbook.contentByTitle.get(lookupHash(pageTitle))
    ?? workbook.contentBySlug.get(lookupHash(slug));
  return {
    direction: metadata?.direction ?? workbook.urlReturnDirections.get(lookupHash(path)) ?? null,
    material_type: metadata?.material_type ?? null,
    access: metadata?.access ?? null,
    hidden: metadata?.is_active === false,
  };
}

function buildTrafficSummary(rows: readonly SiteFactRow[]): AbbottBiUserSummaryRow[] {
  const totals = new Map<string, AbbottBiUserSummaryRow & { durationWeight: number; bounceWeight: number }>();
  rows.filter((row) => row.analytics_scope === "other").forEach((row) => {
    const source = nullableText(row.traffic_source) ?? "Unknown traffic";
    const sessions = integerMetric(row.sessions);
    const current = totals.get(source) ?? {
      user_id: "",
      has_user_id: false,
      traffic_source: source,
      direction: null,
      visits: 0,
      users: 0,
      new_users: 0,
      page_depth: 0,
      avg_duration: 0,
      bounce_rate: 0,
      durationWeight: 0,
      bounceWeight: 0,
    };
    current.visits += sessions;
    current.users += integerMetric(row.users);
    current.page_depth += integerMetric(row.pageviews);
    current.durationWeight += numberMetric(row.average_session_seconds) * sessions;
    current.bounceWeight += numberMetric(row.bounce_rate) * sessions;
    totals.set(source, current);
  });
  return [...totals.values()].map(({ durationWeight, bounceWeight, ...row }) => ({
    ...row,
    page_depth: row.visits > 0 ? Number((row.page_depth / row.visits).toFixed(2)) : 0,
    avg_duration: row.visits > 0 ? Number((durationWeight / row.visits).toFixed(2)) : 0,
    bounce_rate: row.visits > 0 ? Number((bounceWeight / row.visits).toFixed(2)) : 0,
  })).sort((left, right) => right.visits - left.visits || left.traffic_source.localeCompare(right.traffic_source));
}

function buildPageStats(
  rows: readonly SiteFactRow[],
  workbook: AbbottAggregatePrivateData["workbook"],
): AbbottBiPageStatRow[] {
  const result = new Map<string, AbbottBiPageStatRow & { hidden: boolean }>();
  rows.filter((row) => row.analytics_scope === "page").forEach((row) => {
    const url = normalizePage(row.page_url);
    const title = text(row.page_title);
    const metadata = metadataForPage(url, title, workbook);
    const key = `${title}\n${url}`;
    const current = result.get(key) ?? {
      page_title: title,
      url,
      direction: metadata.direction,
      material_type: metadata.material_type,
      access: metadata.access,
      pageviews: 0,
      users: 0,
      bitrix_pageviews: 0,
      bitrix_sessions: 0,
      bitrix_users: 0,
      bitrix_logged_in_sessions: 0,
      bitrix_anonymous_sessions: 0,
      bitrix_avg_session_duration: 0,
      hidden: metadata.hidden,
    };
    current.pageviews += integerMetric(row.pageviews);
    current.users += integerMetric(row.users);
    current.hidden ||= metadata.hidden;
    result.set(key, current);
  });
  return [...result.values()]
    .filter((row) => !row.hidden && Boolean(row.url || row.page_title))
    .map((row) => ({
      page_title: row.page_title,
      url: row.url,
      direction: row.direction,
      material_type: row.material_type,
      access: row.access,
      pageviews: row.pageviews,
      users: row.users,
      bitrix_pageviews: row.bitrix_pageviews,
      bitrix_sessions: row.bitrix_sessions,
      bitrix_users: row.bitrix_users,
      bitrix_logged_in_sessions: row.bitrix_logged_in_sessions,
      bitrix_anonymous_sessions: row.bitrix_anonymous_sessions,
      bitrix_avg_session_duration: row.bitrix_avg_session_duration,
    }))
    .sort((left, right) => right.pageviews - left.pageviews || right.users - left.users || left.page_title.localeCompare(right.page_title));
}

function mapBitrixPages(
  data: ParsedBitrixAnalytics,
  workbook: AbbottAggregatePrivateData["workbook"],
): AbbottBiBitrixPageRow[] {
  type AggregatedBitrixRow = AbbottBiBitrixPageRow & {
    durationWeight: number;
    durationSessions: number;
    representativeSessions: number;
    representativePageviews: number;
    representativeDate: string;
  };
  const byUrl = new Map<string, AggregatedBitrixRow>();
  data.rows.forEach((row) => {
    const url = normalizePage(row.url);
    const metadata = metadataForPage(url, "", workbook);
    const current = byUrl.get(url) ?? {
      url,
      path: normalizePage(row.path),
      direction: metadata.direction,
      material_type: row.material_type_hint ?? metadata.material_type,
      access: metadata.access,
      pageviews: 0,
      sessions: 0,
      users: 0,
      guests: 0,
      logged_in_hits: 0,
      anonymous_hits: 0,
      logged_in_sessions: 0,
      anonymous_sessions: 0,
      entry_sessions: 0,
      exit_sessions: 0,
      avg_session_duration: 0,
      top_utm_source: "",
      top_utm_medium: "",
      top_utm_campaign: "",
      durationWeight: 0,
      durationSessions: 0,
      representativeSessions: -1,
      representativePageviews: -1,
      representativeDate: "",
    };
    current.pageviews += row.pageviews;
    current.sessions += row.sessions;
    current.users += row.users;
    current.guests += row.guests;
    current.logged_in_hits += row.logged_in_hits;
    current.anonymous_hits += row.anonymous_hits;
    current.logged_in_sessions += row.logged_in_sessions;
    current.anonymous_sessions += row.anonymous_sessions;
    current.entry_sessions += row.entry_sessions;
    current.exit_sessions += row.exit_sessions;
    current.material_type = current.material_type ?? row.material_type_hint;
    if (row.avg_session_duration_seconds !== null && row.sessions > 0) {
      current.durationWeight += row.avg_session_duration_seconds * row.sessions;
      current.durationSessions += row.sessions;
    }

    // A daily source exposes only its top UTM tuple, not tuple counts. Among
    // days with a defined tuple, preserve the highest-session day; break ties
    // by pageviews and earliest date so aggregation is never last-row wins.
    const hasUtmTuple = row.top_utm_source !== null || row.top_utm_medium !== null || row.top_utm_campaign !== null;
    const useRepresentative = hasUtmTuple && (
      row.sessions > current.representativeSessions ||
      (row.sessions === current.representativeSessions && row.pageviews > current.representativePageviews) ||
      (row.sessions === current.representativeSessions &&
        row.pageviews === current.representativePageviews &&
        (!current.representativeDate || row.report_date < current.representativeDate))
    );
    if (useRepresentative) {
      current.representativeSessions = row.sessions;
      current.representativePageviews = row.pageviews;
      current.representativeDate = row.report_date;
      current.top_utm_source = row.top_utm_source ?? "";
      current.top_utm_medium = row.top_utm_medium ?? "";
      current.top_utm_campaign = row.top_utm_campaign ?? "";
    }
    byUrl.set(url, current);
  });
  return [...byUrl.values()]
    .map((row) => ({
      url: row.url,
      path: row.path,
      direction: row.direction,
      material_type: row.material_type,
      access: row.access,
      pageviews: row.pageviews,
      sessions: row.sessions,
      users: row.users,
      guests: row.guests,
      logged_in_hits: row.logged_in_hits,
      anonymous_hits: row.anonymous_hits,
      logged_in_sessions: row.logged_in_sessions,
      anonymous_sessions: row.anonymous_sessions,
      entry_sessions: row.entry_sessions,
      exit_sessions: row.exit_sessions,
      avg_session_duration: row.durationSessions > 0
        ? Number((row.durationWeight / row.durationSessions).toFixed(2))
        : 0,
      top_utm_source: row.top_utm_source,
      top_utm_medium: row.top_utm_medium,
      top_utm_campaign: row.top_utm_campaign,
    }))
    .sort((left, right) => right.pageviews - left.pageviews || left.url.localeCompare(right.url));
}

function bitrixSummary(data: ParsedBitrixAnalytics): AbbottBiBitrixSummary | null {
  if (!data.summary) return null;
  return {
    raw_hit_rows: data.rows.reduce((total, row) => total + row.pageviews, 0),
    clean_hit_rows: data.rows.reduce((total, row) => total + row.pageviews, 0),
    raw_date_from: data.summary.date_from,
    raw_date_to: data.summary.date_to,
    date_from: data.summary.date_from,
    date_to: data.summary.date_to,
    sessions_loaded: data.rows.reduce((total, row) => total + row.sessions, 0),
    unique_clean_urls: data.rows.length,
    excluded: {},
  };
}

function enrichWithBitrix(pageStats: AbbottBiPageStatRow[], bitrixRows: AbbottBiBitrixPageRow[]): AbbottBiPageStatRow[] {
  const byUrl = new Map(bitrixRows.map((row) => [normalizePage(row.url), row]));
  return pageStats.map((row) => {
    const bitrix = byUrl.get(normalizePage(row.url));
    return bitrix
      ? {
          ...row,
          bitrix_pageviews: bitrix.pageviews,
          bitrix_sessions: bitrix.sessions,
          bitrix_users: bitrix.users,
          bitrix_logged_in_sessions: bitrix.logged_in_sessions,
          bitrix_anonymous_sessions: bitrix.anonymous_sessions,
          bitrix_avg_session_duration: bitrix.avg_session_duration,
        }
      : row;
  });
}

function parseNonNegativeDecimal(value: unknown): { numerator: bigint; scale: bigint } {
  const normalized = text(value);
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Abbott canonical data is unavailable");
  const [whole, fraction = ""] = normalized.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`),
    scale: BigInt(10) ** BigInt(fraction.length),
  };
}

function deriveReturningCount(denominatorValue: unknown, percentageValue: unknown): number {
  const denominatorText = text(denominatorValue);
  if (!/^\d+$/.test(denominatorText)) throw new Error("Abbott canonical data is unavailable");
  const denominator = BigInt(denominatorText);
  const percentage = parseNonNegativeDecimal(percentageValue);
  const numerator = denominator * percentage.numerator;
  const divisor = BigInt(100) * percentage.scale;
  const rounded = (numerator * BigInt(2) + divisor) / (divisor * BigInt(2));
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Abbott canonical data is unavailable");
  return Number(rounded);
}

function buildReturning(
  rows: readonly ReturningFactRow[],
  workbook: AbbottAggregatePrivateData["workbook"],
): AbbottReturningOutput[] {
  const totals = new Map<string, AbbottReturningOutput & { rawPages: Set<string>; denominatorKeys: Set<string> }>();
  rows.forEach((row) => {
    const url = normalizePage(row.normalized_page);
    const rawPage = rawIdentifier(row.raw_page_value);
    const reportDate = text(row.report_date).slice(0, 10);
    const bucket = text(row.return_bucket_code);
    if (!url || !(["next_day", "days_2_7", "days_8_31"] as string[]).includes(bucket)) {
      throw new Error("Abbott canonical data is unavailable");
    }
    const count = deriveReturningCount(row.source_denominator, row.source_percentage);
    const current = totals.get(url) ?? {
      url,
      direction: workbook.urlReturnDirections.get(lookupHash(normalizedPagePath(url))) ?? null,
      visits: 0,
      returning_1_day: 0,
      returning_2_7_days: 0,
      returning_8_31_days: 0,
      is_derived: true,
      normalization_collision: false,
      rawPages: new Set<string>(),
      denominatorKeys: new Set<string>(),
    };
    const denominatorKey = `${reportDate}\n${rawPage}`;
    if (!current.denominatorKeys.has(denominatorKey)) {
      current.visits += integerMetric(row.source_denominator);
      current.denominatorKeys.add(denominatorKey);
    }
    current.rawPages.add(rawPage);
    if (bucket === "next_day") current.returning_1_day += count;
    if (bucket === "days_2_7") current.returning_2_7_days += count;
    if (bucket === "days_8_31") current.returning_8_31_days += count;
    current.normalization_collision = current.rawPages.size > 1;
    totals.set(url, current);
  });
  return [...totals.values()].map((row) => ({
    url: row.url,
    direction: row.direction,
    visits: row.visits,
    returning_1_day: row.returning_1_day,
    returning_2_7_days: row.returning_2_7_days,
    returning_8_31_days: row.returning_8_31_days,
    is_derived: row.is_derived,
    normalization_collision: row.normalization_collision,
  }))
    .sort((left, right) => right.visits - left.visits || left.url.localeCompare(right.url));
}

function buildManagerBehavior(
  rows: readonly PrivateBehaviorRow[],
  workbook: ParsedAbbottWorkbook,
): { summaries: AbbottBiUserSummaryRow[]; actions: AbbottBiUserActionRow[] } {
  const summaries = new Map<string, AbbottBiUserSummaryRow>();
  const actions = rows.map((row) => {
    const userId = rawIdentifier(row.raw_user_id);
    const pageviews = integerMetric(row.pageviews);
    const summary = summaries.get(userId) ?? {
      user_id: userId,
      has_user_id: true,
      traffic_source: "Registered portal behavior",
      direction: workbook.userDirections.get(userId) ?? null,
      visits: 0,
      users: 1,
      new_users: 0,
      page_depth: 0,
      avg_duration: 0,
      bounce_rate: 0,
    };
    summary.visits += 1;
    summary.page_depth += pageviews;
    summaries.set(userId, summary);
    return {
      user_id: userId,
      has_user_id: true,
      traffic_source: "Registered portal behavior",
      direction: workbook.userDirections.get(userId) ?? null,
      start_url: text(row.start_url),
      end_url: text(row.end_url),
      visits: 1,
      page_depth: pageviews,
      avg_duration: 0,
    };
  });
  return {
    summaries: [...summaries.values()].map((row) => ({
      ...row,
      page_depth: row.visits > 0 ? Number((row.page_depth / row.visits).toFixed(2)) : 0,
    })).sort((left, right) => left.user_id.localeCompare(right.user_id)),
    actions,
  };
}

function mapJourneys(data: AbbottPrivateSessionJourneysData): AbbottBiSessionJourneysData {
  const rows = data.rows.map((row, index) => {
    const paths = row.events.map((event) => normalizePage(event.normalized_path)).filter(Boolean);
    return {
      session_id: index + 1,
      user_id: row.raw_user_id,
      has_user_id: row.raw_user_id !== null,
      entry_url_day: paths[0] ?? "",
      exit_url_day: paths.at(-1) ?? "",
      entry_url_session: paths[0] ?? "",
      exit_url_session: paths.at(-1) ?? "",
      hits_total: row.events.length,
      hits_clean: paths.length,
      hits_content: paths.length,
      steps_content: paths.length,
      events_count: row.events.length,
      duration_seconds: 0,
      content_path: paths,
      content_path_summary: paths.join(" → "),
      all_path_summary: paths.join(" → "),
      events_available: true,
    };
  });
  const reportDate = data.rows.map((row) => row.report_date).sort().at(-1) ?? "";
  return {
    report_date: reportDate,
    schema: rows.length > 0
      ? {
          grain: "protected visit x report date",
          sources: ["canonical private Bitrix journey facts"],
          entry_exit_day: "ordered event path",
          entry_exit_session: "ordered event path",
          content_path: "normalized ordered paths",
          all_path: "normalized ordered paths",
          events: "available",
          duration: "not available",
        }
      : null,
    summary: rows.length > 0
      ? {
          sessions_in_day: rows.length,
          sessions_exported: rows.length,
          sessions_with_user_id: rows.filter((row) => row.has_user_id).length,
          sessions_with_content_path: rows.filter((row) => row.content_path.length > 0).length,
          hits_total: rows.reduce((total, row) => total + row.hits_total, 0),
          hits_clean: rows.reduce((total, row) => total + row.hits_clean, 0),
          events_available: true,
        }
      : null,
    rows,
  };
}

function buildExternalClickRows(
  rows: readonly Record<string, unknown>[],
  workbook: AbbottAggregatePrivateData["workbook"],
): AbbottBiExternalClickRow[] {
  const eventByUrl = new Map(workbook.externalEvents.map((event) => [normalizePage(event.registration_url), event]));
  return rows.map((row) => {
    const externalUrl = normalizePage(row.external_url);
    const event = eventByUrl.get(externalUrl);
    return {
      title: event?.title ?? null,
      direction: event?.direction ?? null,
      external_url: externalUrl,
      outbound_clicks: integerMetric(row.outbound_clicks),
    };
  });
}

function buildGeneralMaterials(
  pageStats: AbbottBiPageStatRow[],
  workbook: AbbottAggregatePrivateData["workbook"],
): AbbottBiMaterialRow[] {
  const byUrl = new Map(pageStats.map((row) => [normalizePage(row.url), row]));
  return workbook.generalMaterials.map((material) => {
    const url = normalizePage(material.url);
    const stats = byUrl.get(url);
    return { material_name: material.name, url, pageviews: stats?.pageviews ?? 0, users: stats?.users ?? 0 };
  });
}

export async function loadAbbottBiDataWithDependencies(
  dashboardId: number,
  counterIds: string[],
  from: string,
  to: string,
  audience: AbbottDashboardAudience | undefined,
  dependencies: AbbottBiLoaderDependencies,
): Promise<AbbottCanonicalBiData> {
  if (audience !== "manager" && audience !== "embed") {
    throw new Error("Abbott trusted audience is required");
  }
  const counters = counterIds.length > 0 ? [...new Set(counterIds)] : [ABBOTT_COUNTER_ID];
  const requestDates = listDates(from, to);
  if (
    !Number.isSafeInteger(dashboardId) || dashboardId <= 0 ||
    requestDates.length === 0 || from < ABBOTT_CANONICAL_CUTOFF ||
    counters.length !== 1 || counters[0] !== ABBOTT_COUNTER_ID
  ) {
    return emptyAbbottData(counters, audience, from, to, null, [{
      counter_id: counters[0] ?? ABBOTT_COUNTER_ID,
      report_date: from,
      scope: "request",
      status: "invalid_request",
    }]);
  }

  let releaseId: number | null = null;
  try {
    const releaseBundle = await dependencies.loadReleaseBundle(dashboardId, audience, from, to);
    if (releaseBundle.audience !== audience || positiveInteger(releaseBundle.releaseId) === null) {
      throw new Error("Abbott canonical data is unavailable");
    }
    releaseId = releaseBundle.releaseId;
    const gaps = await coverageGaps(dependencies.aggregateExecutor, releaseId, counters, from, to);
    if (gaps.length > 0) {
      return emptyAbbottData(counters, audience, from, to, releaseId, gaps, releaseBundle.workbook.lookupQuality);
    }

    const [siteFacts, returningFacts, externalFacts, behaviorFacts] = await Promise.all([
      querySiteFacts(dependencies.aggregateExecutor, releaseId, counters, from, to),
      queryReturningFacts(dependencies.aggregateExecutor, releaseId, counters, from, to),
      queryExternalClicks(dependencies.aggregateExecutor, releaseId, counters, from, to),
      audience === "manager"
        ? queryManagerBehavior(dependencies.privateExecutor, releaseId, counters, from, to)
        : Promise.resolve([]),
    ]);
    const trafficSummary = buildTrafficSummary(siteFacts);
    const bitrixPages = mapBitrixPages(releaseBundle.bitrixPages, releaseBundle.workbook);
    const summary = bitrixSummary(releaseBundle.bitrixPages);
    const periodActive = isAbbottBitrixPeriodActive(from, to, summary);
    const pageStats = buildPageStats(siteFacts, releaseBundle.workbook);
    const enrichedPageStats = periodActive ? enrichWithBitrix(pageStats, bitrixPages) : pageStats;
    const managerBehavior = audience === "manager"
      ? buildManagerBehavior(behaviorFacts, releaseBundle.workbook as ParsedAbbottWorkbook)
      : { summaries: [], actions: [] };

    return {
      ...emptyAbbottData(counters, audience, from, to, releaseId, [], releaseBundle.workbook.lookupQuality),
      users_summary: managerBehavior.summaries,
      traffic_summary: trafficSummary,
      user_actions: managerBehavior.actions,
      page_stats: enrichedPageStats,
      bitrix_pages: bitrixPages,
      bitrix_summary: summary,
      bitrix_sources: {
        pages: releaseBundle.bitrixPages.source,
        journeys: releaseBundle.audience === "manager"
          ? releaseBundle.journeys.source
          : releaseBundle.journeyTransitions.source,
      },
      bitrix_period_active: periodActive,
      session_journeys: releaseBundle.audience === "manager"
        ? mapJourneys(releaseBundle.journeys)
        : emptyJourneys(),
      external_events: releaseBundle.workbook.externalEvents,
      external_clicks: buildExternalClickRows(externalFacts, releaseBundle.workbook),
      returning: buildReturning(returningFacts, releaseBundle.workbook),
      general_materials: buildGeneralMaterials(enrichedPageStats, releaseBundle.workbook),
    };
  } catch {
    return emptyAbbottData(counters, audience, from, to, releaseId, [{
      counter_id: ABBOTT_COUNTER_ID,
      report_date: from,
      scope: releaseId === null ? "release" : "request",
      status: "unavailable",
    }]);
  }
}

type PrivatePoolGlobal = typeof globalThis & { __abbottBiPrivateMysqlPool?: Pool };

function requiredPrivateEnvironment(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) throw new Error("Abbott private database is not configured");
  return value;
}

async function privatePool(): Promise<Pool> {
  const shared = globalThis as PrivatePoolGlobal;
  if (shared.__abbottBiPrivateMysqlPool) return shared.__abbottBiPrivateMysqlPool;
  const rawPort = requiredPrivateEnvironment("ABBOTT_PRIVATE_DB_PORT");
  const database = requiredPrivateEnvironment("ABBOTT_PRIVATE_DB_NAME");
  if (!/^\d+$/.test(rawPort) || database !== "report_bd_private") throw new Error("Abbott private database is not configured");
  const mysql = await import("mysql2/promise");
  shared.__abbottBiPrivateMysqlPool = mysql.createPool({
    host: requiredPrivateEnvironment("ABBOTT_PRIVATE_DB_HOST"),
    port: Number(rawPort),
    user: requiredPrivateEnvironment("ABBOTT_PRIVATE_DB_USER"),
    password: requiredPrivateEnvironment("ABBOTT_PRIVATE_DB_PASSWORD"),
    database,
    dateStrings: ["DATE", "DATETIME"],
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    multipleStatements: false,
  });
  return shared.__abbottBiPrivateMysqlPool;
}

async function privateQuery(sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
  let connection: PoolConnection | undefined;
  try {
    connection = await (await privatePool()).getConnection();
    await connection.query("SET TRANSACTION READ ONLY");
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(sql, params as never[]);
    await connection.commit();
    return rows as unknown as readonly Record<string, unknown>[];
  } catch {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // The caller receives only the typed sanitized incomplete state.
      }
    }
    throw new Error("Abbott private data is unavailable");
  } finally {
    connection?.release();
  }
}

const productionDependencies: AbbottBiLoaderDependencies = {
  aggregateExecutor: {
    async query(sql, params) {
      const [rows] = await pool.execute<RowDataPacket[]>(sql, params as never[]);
      return rows as unknown as readonly Record<string, unknown>[];
    },
  },
  privateExecutor: { query: privateQuery },
  loadReleaseBundle: loadActiveAbbottReleaseBundle,
};

export function getDefaultAbbottCounterIds(): string[] {
  return [ABBOTT_COUNTER_ID];
}

export function getDefaultZarukuCounterIds(): string[] {
  return ["66624469", "99078698"];
}

export async function loadAbbottBiData(
  dashboardId: number,
  counterIds: string[],
  from: string,
  to: string,
  audience?: AbbottDashboardAudience,
): Promise<AbbottCanonicalBiData> {
  return loadAbbottBiDataWithDependencies(dashboardId, counterIds, from, to, audience, productionDependencies);
}

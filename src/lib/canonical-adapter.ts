import type { RowDataPacket } from 'mysql2';
import pool from './db';
import { ADS_AUTHORITY_FACT_SCOPE } from './source-mapping';

export interface CanonicalFilter {
  source_key: string;
  date_from: string;
  date_to: string;
  account_ids?: string[];
  campaign_filter?: {
    filter_type: 'name_pattern' | 'id_list' | 'all';
    filter_value: string | null;
  };
}

export interface PromopagesFilter {
  source_key: string;
  date_from: string;
  date_to: string;
  account_ids?: string[];
}

type SqlParam = string | number | boolean | Date | null;

type CampaignCatalogOptions = {
  search?: string;
  accountIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  requireFactInRange?: boolean;
};

type AggregateRow = RowDataPacket & {
  total_impressions: number | string | null;
  total_clicks: number | string | null;
  total_spend: number | string | null;
  total_conversions: number | string | null;
  total_views: number | string | null;
  total_reach: number | string | null;
  total_vv25: number | string | null;
  total_vv50: number | string | null;
  total_vv75: number | string | null;
  total_vv100: number | string | null;
  avg_ctr: number | string | null;
  avg_cpm: number | string | null;
  avg_cpc: number | string | null;
};

type AdsTimeseriesRow = RowDataPacket & {
  date: string | Date;
  impressions: number | string | null;
  reach: number | string | null;
  clicks: number | string | null;
  spend: number | string | null;
  views: number | string | null;
  conversions: number | string | null;
};

type CampaignDailyAdsRow = RowDataPacket & {
  date: string | Date;
  platform_campaign_id: string;
  impressions: number | string | null;
  reach: number | string | null;
  clicks: number | string | null;
  spend: number | string | null;
  views: number | string | null;
  conversions: number | string | null;
};

type CampaignBreakdownRow = RowDataPacket & {
  campaign_id: string;
  campaign_name: string | null;
  source_key: string;
  impressions: number | string | null;
  clicks: number | string | null;
  spend: number | string | null;
  conversions: number | string | null;
  cpa: number | string | null;
  cpc: number | string | null;
  ctr: number | string | null;
};

type AnalyticsAggregateRow = RowDataPacket & {
  total_visits: number | string | null;
  total_users: number | string | null;
  total_pageviews: number | string | null;
  avg_bounce_rate: number | string | null;
  avg_visit_duration: number | string | null;
};

type AnalyticsTimeseriesRow = RowDataPacket & {
  date: string | Date;
  visits: number | string | null;
  users: number | string | null;
  pageviews: number | string | null;
  bounce_rate: number | string | null;
};

type ActiveAccountRow = RowDataPacket & {
  id: string;
  name: string | null;
  latest_report_date: string | Date | null;
  fact_rows: number | string | null;
  total_spend: number | string | null;
};

type PromopagesAggregateRow = RowDataPacket & {
  total_impressions: number | string | null;
  total_reach: number | string | null;
  total_views: number | string | null;
  total_clicks: number | string | null;
  total_budget: number | string | null;
  total_clickouts: number | string | null;
  total_full_reads: number | string | null;
  total_metrica_visits: number | string | null;
  avg_ctr: number | string | null;
  avg_cpm: number | string | null;
};

type PromopagesTimeseriesRow = RowDataPacket & {
  date: string | Date;
  impressions: number | string | null;
  reach: number | string | null;
  views: number | string | null;
  clicks: number | string | null;
  budget: number | string | null;
  clickouts: number | string | null;
  full_reads: number | string | null;
  metrica_visits: number | string | null;
};

type PromopagesCampaignAggregateRow = RowDataPacket & {
  total_impressions: number | string | null;
  total_reach: number | string | null;
  total_views: number | string | null;
  total_clicks: number | string | null;
  total_clickouts: number | string | null;
  total_budget: number | string | null;
};

type PromopagesCampaignRow = RowDataPacket & {
  platform_account_id: string;
  account_name: string | null;
  platform_campaign_id: string;
  campaign_name: string | null;
  report_date: string | Date;
  impressions: number | string | null;
  reach: number | string | null;
  views: number | string | null;
  clicks: number | string | null;
  ctr: number | string | null;
  budget: number | string | null;
  cpm: number | string | null;
  clickouts: number | string | null;
  clickout_cost: number | string | null;
  clickout_percent: number | string | null;
  full_reads: number | string | null;
  full_read_percent: number | string | null;
  full_read_time_sec: number | string | null;
  metrica_visits: number | string | null;
  metrica_visit_percent: number | string | null;
  metrica_visit_cost: number | string | null;
};

function normalizeMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim();
}

function toIsoDateOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function isSuggestedAccount(accountName: string, clientName?: string): boolean {
  if (!clientName) return false;
  const normalizedAccount = normalizeMatch(accountName);
  const normalizedClient = normalizeMatch(clientName);
  if (!normalizedAccount || !normalizedClient) return false;
  if (normalizedAccount.includes(normalizedClient) || normalizedClient.includes(normalizedAccount)) {
    return true;
  }

  const tokens = normalizedClient.split(/\s+/).filter((token) => token.length >= 3);
  if (!tokens.length) return false;
  return tokens.every((token) => normalizedAccount.includes(token));
}

function buildAccountWhereAds(filter: CanonicalFilter, params: SqlParam[]): string {
  const accountIds = Array.isArray(filter.account_ids)
    ? filter.account_ids.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!accountIds.length) return '';
  params.push(...accountIds);
  return `AND f.platform_account_id IN (${accountIds.map(() => '?').join(',')})`;
}

function buildAccountWherePromopages(filter: PromopagesFilter, params: SqlParam[]): string {
  const accountIds = Array.isArray(filter.account_ids)
    ? filter.account_ids.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!accountIds.length) return '';
  params.push(...accountIds);
  return `AND f.platform_account_id IN (${accountIds.map(() => '?').join(',')})`;
}

function buildAccountWhereAnalytics(filter: CanonicalFilter, params: SqlParam[]): string {
  const accountIds = Array.isArray(filter.account_ids)
    ? filter.account_ids.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!accountIds.length) return '';
  params.push(...accountIds);
  return `AND analytics_account_id IN (${accountIds.map(() => '?').join(',')})`;
}

function buildCampaignWhere(filter: CanonicalFilter, params: SqlParam[]): string {
  const cf = filter.campaign_filter;
  if (!cf) return '';

  if (cf.filter_type === 'name_pattern' && cf.filter_value) {
    params.push(filter.source_key, cf.filter_value);
    return `AND f.platform_campaign_id IN (
      SELECT platform_campaign_id
      FROM canonical_source_campaigns
      WHERE source_key = ? AND campaign_name LIKE ?
    )`;
  }

  if (cf.filter_type === 'id_list' && cf.filter_value) {
    const ids = cf.filter_value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!ids.length) return '';
    params.push(...ids);
    return `AND f.platform_campaign_id IN (${ids.map(() => '?').join(',')})`;
  }

  return '';
}

function authorityFactScope(sourceKey: string): 'campaign' | 'delivery_entity' {
  return ADS_AUTHORITY_FACT_SCOPE[sourceKey] ?? 'delivery_entity';
}

export async function getAdsAggregate(filter: CanonicalFilter) {
  const params: SqlParam[] = [filter.source_key, authorityFactScope(filter.source_key), filter.date_from, filter.date_to];
  const accountWhere = buildAccountWhereAds(filter, params);
  const campaignWhere = buildCampaignWhere(filter, params);

  const sql = `
    SELECT
      COALESCE(SUM(f.impressions), 0) as total_impressions,
      COALESCE(SUM(f.clicks), 0) as total_clicks,
      COALESCE(SUM(f.spend), 0) as total_spend,
      COALESCE(SUM(f.conversions), 0) as total_conversions,
      COALESCE(SUM(f.views), 0) as total_views,
      COALESCE(SUM(f.reach), 0) as total_reach,
      COALESCE(SUM(f.video_views_25), 0) as total_vv25,
      COALESCE(SUM(f.video_views_50), 0) as total_vv50,
      COALESCE(SUM(f.video_views_75), 0) as total_vv75,
      COALESCE(SUM(f.video_views_100), 0) as total_vv100,
      CASE WHEN COALESCE(SUM(f.impressions), 0) > 0
        THEN COALESCE(SUM(f.clicks), 0) / SUM(f.impressions) * 100 ELSE 0 END as avg_ctr,
      CASE WHEN COALESCE(SUM(f.impressions), 0) > 0
        THEN COALESCE(SUM(f.spend), 0) / SUM(f.impressions) * 1000 ELSE 0 END as avg_cpm,
      CASE WHEN COALESCE(SUM(f.clicks), 0) > 0
        THEN COALESCE(SUM(f.spend), 0) / SUM(f.clicks) ELSE 0 END as avg_cpc
    FROM canonical_fact_ads_daily f
    WHERE f.source_key = ?
      AND f.fact_scope = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      ${accountWhere}
      ${campaignWhere}
  `;

  const [rows] = await pool.execute<AggregateRow[]>(sql, params);
  return rows[0] ?? null;
}

export async function getPromopagesAggregate(filter: PromopagesFilter) {
  const params: SqlParam[] = [filter.source_key, filter.date_from, filter.date_to];
  const accountWhere = buildAccountWherePromopages(filter, params);

  const sql = `
    SELECT
      COALESCE(SUM(f.impressions), 0) AS total_impressions,
      COALESCE(SUM(f.reach), 0) AS total_reach,
      COALESCE(SUM(f.views), 0) AS total_views,
      COALESCE(SUM(f.clicks), 0) AS total_clicks,
      COALESCE(SUM(f.budget), 0) AS total_budget,
      COALESCE(SUM(f.clickouts), 0) AS total_clickouts,
      COALESCE(SUM(f.full_reads), 0) AS total_full_reads,
      COALESCE(SUM(f.metrica_visits), 0) AS total_metrica_visits,
      CASE WHEN COALESCE(SUM(f.impressions), 0) > 0
        THEN COALESCE(SUM(f.clicks), 0) / SUM(f.impressions) * 100 ELSE 0 END AS avg_ctr,
      CASE WHEN COALESCE(SUM(f.impressions), 0) > 0
        THEN COALESCE(SUM(f.budget), 0) / SUM(f.impressions) * 1000 ELSE 0 END AS avg_cpm
    FROM canonical_fact_promopages_daily f
    WHERE f.source_key = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      ${accountWhere}
  `;

  const [rows] = await pool.query<PromopagesAggregateRow[]>(sql, params);
  return rows[0] ?? null;
}

export async function getPromopagesAggregateByCampaignIds(
  sourceKey: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  const normalizedIds = Array.isArray(campaignIds)
    ? campaignIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!normalizedIds.length) {
    return {
      total_impressions: 0,
      total_reach: 0,
      total_views: 0,
      total_clicks: 0,
      total_clickouts: 0,
      total_budget: 0,
    };
  }

  const placeholders = normalizedIds.map(() => '?').join(',');
  const params: SqlParam[] = [sourceKey, dateFrom, dateTo, ...normalizedIds];

  const sql = `
    SELECT
      COALESCE(SUM(f.impressions), 0) AS total_impressions,
      COALESCE(SUM(f.reach), 0) AS total_reach,
      COALESCE(SUM(f.views), 0) AS total_views,
      COALESCE(SUM(f.clicks), 0) AS total_clicks,
      COALESCE(SUM(f.clickouts), 0) AS total_clickouts,
      COALESCE(SUM(f.budget), 0) AS total_budget
    FROM canonical_fact_promopages_daily f
    WHERE f.source_key = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      AND f.platform_campaign_id IN (${placeholders})
  `;

  const [rows] = await pool.query<PromopagesCampaignAggregateRow[]>(sql, params);
  return rows[0] ?? null;
}

// Aggregate facts by explicit campaign id list within canonical_fact_ads_daily.
// If campaignIds is empty, falls back to generic aggregate for the source.
export async function getFactByCampaignIds(
  sourceKey: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  const normalizedIds = Array.isArray(campaignIds)
    ? campaignIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!normalizedIds.length) {
    return getAdsAggregate({
      source_key: sourceKey,
      date_from: dateFrom,
      date_to: dateTo,
    });
  }

  const factScope = authorityFactScope(sourceKey);
  const params: SqlParam[] = [sourceKey, factScope, dateFrom, dateTo, ...normalizedIds];
  const placeholders = normalizedIds.map(() => '?').join(',');

  const sql = `
    SELECT 
      COALESCE(SUM(f.impressions), 0) as total_impressions,
      COALESCE(SUM(f.clicks), 0) as total_clicks,
      COALESCE(SUM(f.spend), 0) as total_spend,
      COALESCE(SUM(f.conversions), 0) as total_conversions,
      COALESCE(SUM(f.views), 0) as total_views,
      COALESCE(SUM(f.reach), 0) as total_reach,
      COALESCE(SUM(f.video_views_25), 0) as total_vv25,
      COALESCE(SUM(f.video_views_50), 0) as total_vv50,
      COALESCE(SUM(f.video_views_75), 0) as total_vv75,
      COALESCE(SUM(f.video_views_100), 0) as total_vv100,
      CASE WHEN COALESCE(SUM(f.impressions), 0) > 0 
        THEN COALESCE(SUM(f.clicks), 0) / SUM(f.impressions) * 100 ELSE 0 END as avg_ctr,
      CASE WHEN COALESCE(SUM(f.impressions), 0) > 0 
        THEN COALESCE(SUM(f.spend), 0) / SUM(f.impressions) * 1000 ELSE 0 END as avg_cpm,
      CASE WHEN COALESCE(SUM(f.clicks), 0) > 0 
        THEN COALESCE(SUM(f.spend), 0) / SUM(f.clicks) ELSE 0 END as avg_cpc
    FROM canonical_fact_ads_daily f
    WHERE f.source_key = ?
      AND f.fact_scope = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      AND f.platform_campaign_id IN (${placeholders})
  `;

  const [rows] = await pool.execute<AggregateRow[]>(sql, params);
  return rows[0] ?? null;
}

export async function getAdsTimeseries(filter: CanonicalFilter) {
  const params: SqlParam[] = [filter.source_key, authorityFactScope(filter.source_key), filter.date_from, filter.date_to];
  const accountWhere = buildAccountWhereAds(filter, params);
  const campaignWhere = buildCampaignWhere(filter, params);

  const sql = `
    SELECT
      f.report_date as date,
      COALESCE(SUM(f.impressions), 0) as impressions,
      COALESCE(SUM(f.reach), 0) as reach,
      COALESCE(SUM(f.clicks), 0) as clicks,
      COALESCE(SUM(f.spend), 0) as spend,
      COALESCE(SUM(f.views), 0) as views,
      COALESCE(SUM(f.conversions), 0) as conversions
    FROM canonical_fact_ads_daily f
    WHERE f.source_key = ?
      AND f.fact_scope = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      ${accountWhere}
      ${campaignWhere}
    GROUP BY f.report_date
    ORDER BY f.report_date
  `;

  const [rows] = await pool.execute<AdsTimeseriesRow[]>(sql, params);
  return rows;
}

export async function getPromopagesTimeseries(filter: PromopagesFilter) {
  const params: SqlParam[] = [filter.source_key, filter.date_from, filter.date_to];
  const accountWhere = buildAccountWherePromopages(filter, params);
  const sql = `
    SELECT
      f.report_date AS date,
      COALESCE(SUM(f.impressions), 0) AS impressions,
      COALESCE(SUM(f.reach), 0) AS reach,
      COALESCE(SUM(f.views), 0) AS views,
      COALESCE(SUM(f.clicks), 0) AS clicks,
      COALESCE(SUM(f.budget), 0) AS budget,
      COALESCE(SUM(f.clickouts), 0) AS clickouts,
      COALESCE(SUM(f.full_reads), 0) AS full_reads,
      COALESCE(SUM(f.metrica_visits), 0) AS metrica_visits
    FROM canonical_fact_promopages_daily f
    WHERE f.source_key = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      ${accountWhere}
    GROUP BY f.report_date
    ORDER BY f.report_date
  `;
  const [rows] = await pool.query<PromopagesTimeseriesRow[]>(sql, params);
  return rows.map((row) => ({
    date: toIsoDateOrNull(row.date) ?? '',
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    views: Number(row.views ?? 0),
    clicks: Number(row.clicks ?? 0),
    budget: Number(Number(row.budget ?? 0).toFixed(2)),
    clickouts: Number(row.clickouts ?? 0),
    full_reads: Number(row.full_reads ?? 0),
    metrica_visits: Number(row.metrica_visits ?? 0),
  }));
}

export async function getPromopagesTimeseriesByCampaignIds(
  sourceKey: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  const normalizedIds = Array.isArray(campaignIds)
    ? campaignIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!normalizedIds.length) {
    return [];
  }

  const placeholders = normalizedIds.map(() => '?').join(',');
  const params: SqlParam[] = [sourceKey, dateFrom, dateTo, ...normalizedIds];
  const sql = `
    SELECT
      f.report_date AS date,
      COALESCE(SUM(f.impressions), 0) AS impressions,
      COALESCE(SUM(f.reach), 0) AS reach,
      COALESCE(SUM(f.views), 0) AS views,
      COALESCE(SUM(f.clicks), 0) AS clicks,
      COALESCE(SUM(f.budget), 0) AS budget
      ,
      COALESCE(SUM(f.clickouts), 0) AS clickouts
    FROM canonical_fact_promopages_daily f
    WHERE f.source_key = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      AND f.platform_campaign_id IN (${placeholders})
    GROUP BY f.report_date
    ORDER BY f.report_date
  `;
  const [rows] = await pool.query<PromopagesTimeseriesRow[]>(sql, params);
  return rows.map((row) => ({
    date: toIsoDateOrNull(row.date) ?? '',
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    views: Number(row.views ?? 0),
    clicks: Number(row.clicks ?? 0),
    budget: Number(Number(row.budget ?? 0).toFixed(2)),
    clickouts: Number(row.clickouts ?? 0),
    full_reads: 0,
    metrica_visits: 0,
  }));
}

export async function getPromopagesCampaignBreakdown(filter: PromopagesFilter) {
  const params: SqlParam[] = [filter.date_from, filter.date_to];
  const accountWhere = buildAccountWherePromopages(filter, params);
  const sql = `
    SELECT
      f.platform_account_id,
      COALESCE(a.account_name, f.platform_account_id) AS account_name,
      f.platform_campaign_id,
      COALESCE(c.campaign_name, f.platform_campaign_id) AS campaign_name,
      f.report_date,
      COALESCE(SUM(f.impressions), 0) AS impressions,
      COALESCE(SUM(f.reach), 0) AS reach,
      COALESCE(SUM(f.views), 0) AS views,
      COALESCE(SUM(f.clicks), 0) AS clicks,
      CASE WHEN COALESCE(SUM(f.impressions), 0) > 0
        THEN COALESCE(SUM(f.clicks), 0) / SUM(f.impressions) * 100 ELSE 0 END AS ctr,
      COALESCE(SUM(f.budget), 0) AS budget,
      CASE WHEN COALESCE(SUM(f.impressions), 0) > 0
        THEN COALESCE(SUM(f.budget), 0) / SUM(f.impressions) * 1000 ELSE 0 END AS cpm,
      COALESCE(SUM(f.clickouts), 0) AS clickouts,
      CASE WHEN COALESCE(SUM(f.clickouts), 0) > 0
        THEN COALESCE(SUM(f.budget), 0) / SUM(f.clickouts) ELSE 0 END AS clickout_cost,
      CASE WHEN COALESCE(SUM(f.views), 0) > 0
        THEN COALESCE(SUM(f.clickouts), 0) / SUM(f.views) * 100 ELSE 0 END AS clickout_percent,
      COALESCE(SUM(f.full_reads), 0) AS full_reads,
      CASE WHEN COALESCE(SUM(f.views), 0) > 0
        THEN COALESCE(SUM(f.full_reads), 0) / SUM(f.views) * 100 ELSE 0 END AS full_read_percent,
      AVG(COALESCE(f.full_read_time_sec, 0)) AS full_read_time_sec,
      COALESCE(SUM(f.metrica_visits), 0) AS metrica_visits,
      CASE WHEN COALESCE(SUM(f.clickouts), 0) > 0
        THEN COALESCE(SUM(f.metrica_visits), 0) / SUM(f.clickouts) * 100 ELSE 0 END AS metrica_visit_percent,
      CASE WHEN COALESCE(SUM(f.metrica_visits), 0) > 0
        THEN COALESCE(SUM(f.budget), 0) / SUM(f.metrica_visits) ELSE 0 END AS metrica_visit_cost
    FROM canonical_fact_promopages_daily f
    LEFT JOIN canonical_source_accounts a
      ON a.source_key = ?
     AND a.platform_account_id = f.platform_account_id
    LEFT JOIN canonical_source_campaigns c
      ON c.source_key = ?
     AND c.platform_campaign_id = f.platform_campaign_id
     AND c.platform_account_id = f.platform_account_id
    WHERE f.source_key = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      ${accountWhere}
    GROUP BY
      f.platform_account_id,
      account_name,
      f.platform_campaign_id,
      campaign_name,
      f.report_date
    ORDER BY f.report_date DESC, budget DESC, impressions DESC
  `;
  const [rows] = await pool.query<PromopagesCampaignRow[]>(
    sql,
    [filter.source_key, filter.source_key, filter.source_key, ...params],
  );
  return rows.map((row) => ({
    platform_account_id: String(row.platform_account_id),
    account_name: String(row.account_name ?? row.platform_account_id),
    platform_campaign_id: String(row.platform_campaign_id),
    campaign_name: String(row.campaign_name ?? row.platform_campaign_id),
    report_date: toIsoDateOrNull(row.report_date) ?? '',
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    views: Number(row.views ?? 0),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(Number(row.ctr ?? 0).toFixed(2)),
    budget: Number(Number(row.budget ?? 0).toFixed(2)),
    cpm: Number(Number(row.cpm ?? 0).toFixed(2)),
    clickouts: Number(row.clickouts ?? 0),
    clickout_cost: Number(Number(row.clickout_cost ?? 0).toFixed(2)),
    clickout_percent: Number(Number(row.clickout_percent ?? 0).toFixed(2)),
    full_reads: Number(row.full_reads ?? 0),
    full_read_percent: Number(Number(row.full_read_percent ?? 0).toFixed(2)),
    full_read_time_sec: Number(Number(row.full_read_time_sec ?? 0).toFixed(2)),
    metrica_visits: Number(row.metrica_visits ?? 0),
    metrica_visit_percent: Number(Number(row.metrica_visit_percent ?? 0).toFixed(2)),
    metrica_visit_cost: Number(Number(row.metrica_visit_cost ?? 0).toFixed(2)),
  }));
}

// Timeseries restricted to a specific set of campaign ids.
// If campaignIds is empty, falls back to generic timeseries for the source.
export async function getTimeseriesByCampaignIds(
  sourceKey: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  const normalizedIds = Array.isArray(campaignIds)
    ? campaignIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!normalizedIds.length) {
    return getAdsTimeseries({
      source_key: sourceKey,
      date_from: dateFrom,
      date_to: dateTo,
    });
  }

  const factScope = authorityFactScope(sourceKey);
  const params: SqlParam[] = [sourceKey, factScope, dateFrom, dateTo, ...normalizedIds];
  const placeholders = normalizedIds.map(() => '?').join(',');

  const sql = `
    SELECT 
      f.report_date as date,
      COALESCE(SUM(f.impressions), 0) as impressions,
      COALESCE(SUM(f.reach), 0) as reach,
      COALESCE(SUM(f.clicks), 0) as clicks,
      COALESCE(SUM(f.spend), 0) as spend,
      COALESCE(SUM(f.views), 0) as views,
      COALESCE(SUM(f.conversions), 0) as conversions
    FROM canonical_fact_ads_daily f
    WHERE f.source_key = ?
      AND f.fact_scope = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      AND f.platform_campaign_id IN (${placeholders})
    GROUP BY f.report_date
    ORDER BY f.report_date
  `;

  const [rows] = await pool.execute<AdsTimeseriesRow[]>(sql, params);
  return rows;
}

export async function getCampaignDailyFactsByIds(
  sourceKey: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  const normalizedIds = Array.isArray(campaignIds)
    ? campaignIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  if (!normalizedIds.length) {
    return [] as CampaignDailyAdsRow[];
  }

  const factScope = authorityFactScope(sourceKey);
  const params: SqlParam[] = [sourceKey, factScope, dateFrom, dateTo, ...normalizedIds];
  const placeholders = normalizedIds.map(() => "?").join(",");

  const sql = `
    SELECT
      f.report_date as date,
      f.platform_campaign_id,
      COALESCE(SUM(f.impressions), 0) as impressions,
      COALESCE(SUM(f.reach), 0) as reach,
      COALESCE(SUM(f.clicks), 0) as clicks,
      COALESCE(SUM(f.spend), 0) as spend,
      COALESCE(SUM(f.views), 0) as views,
      COALESCE(SUM(f.conversions), 0) as conversions
    FROM canonical_fact_ads_daily f
    WHERE f.source_key = ?
      AND f.fact_scope = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      AND f.platform_campaign_id IN (${placeholders})
    GROUP BY f.report_date, f.platform_campaign_id
    ORDER BY f.report_date, f.platform_campaign_id
  `;

  const [rows] = await pool.execute<CampaignDailyAdsRow[]>(sql, params);
  return rows;
}

export async function getCampaignBreakdown(filter: CanonicalFilter) {
  const params: SqlParam[] = [filter.source_key, authorityFactScope(filter.source_key), filter.date_from, filter.date_to];
  const accountWhere = buildAccountWhereAds(filter, params);
  const campaignWhere = buildCampaignWhere(filter, params);

  const sql = `
    SELECT
      f.platform_campaign_id as campaign_id,
      COALESCE(MAX(c.campaign_name), f.platform_campaign_id) as campaign_name,
      f.source_key as source_key,
      COALESCE(SUM(f.impressions), 0) as impressions,
      COALESCE(SUM(f.clicks), 0) as clicks,
      COALESCE(SUM(f.spend), 0) as spend,
      COALESCE(SUM(f.conversions), 0) as conversions,
      CASE
        WHEN COALESCE(SUM(f.conversions), 0) > 0
          THEN COALESCE(SUM(f.spend), 0) / SUM(f.conversions)
        ELSE 0
      END as cpa,
      CASE
        WHEN COALESCE(SUM(f.clicks), 0) > 0
          THEN COALESCE(SUM(f.spend), 0) / SUM(f.clicks)
        ELSE 0
      END as cpc,
      CASE
        WHEN COALESCE(SUM(f.impressions), 0) > 0
          THEN COALESCE(SUM(f.clicks), 0) / SUM(f.impressions) * 100
        ELSE 0
      END as ctr
    FROM canonical_fact_ads_daily f
    LEFT JOIN canonical_source_campaigns c
      ON c.source_key = f.source_key
     AND c.platform_campaign_id = f.platform_campaign_id
     AND c.platform_account_id = f.platform_account_id
    WHERE f.source_key = ?
      AND f.fact_scope = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      ${accountWhere}
      ${campaignWhere}
    GROUP BY f.platform_campaign_id, f.source_key
    HAVING
      COALESCE(SUM(f.spend), 0) > 0
      OR COALESCE(SUM(f.clicks), 0) > 0
      OR COALESCE(SUM(f.conversions), 0) > 0
    ORDER BY
      CASE
        WHEN COALESCE(SUM(f.conversions), 0) > 0
          THEN COALESCE(SUM(f.spend), 0) / SUM(f.conversions)
        ELSE 999999999
      END ASC,
      COALESCE(SUM(f.conversions), 0) DESC,
      COALESCE(SUM(f.spend), 0) DESC
  `;

  const [rows] = await pool.execute<CampaignBreakdownRow[]>(sql, params);
  return rows.map((row) => ({
    campaign_id: String(row.campaign_id ?? ""),
    campaign_name: String(row.campaign_name ?? row.campaign_id ?? ""),
    source_key: String(row.source_key ?? filter.source_key),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    spend: Number(Number(row.spend ?? 0).toFixed(2)),
    conversions: Number(row.conversions ?? 0),
    cpa: Number(Number(row.cpa ?? 0).toFixed(2)),
    cpc: Number(Number(row.cpc ?? 0).toFixed(2)),
    ctr: Number(Number(row.ctr ?? 0).toFixed(2)),
  }));
}

export async function getAnalyticsAggregate(filter: CanonicalFilter) {
  const params: SqlParam[] = [filter.source_key, filter.date_from, filter.date_to];
  const accountWhere = buildAccountWhereAnalytics(filter, params);
  const sql = `
    SELECT
      COALESCE(SUM(visits), 0) as total_visits,
      COALESCE(SUM(users), 0) as total_users,
      COALESCE(SUM(pageviews), 0) as total_pageviews,
      COALESCE(AVG(bounce_rate), 0) as avg_bounce_rate,
      COALESCE(AVG(avg_visit_duration_seconds), 0) as avg_visit_duration
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = ?
      AND report_date >= ?
      AND report_date <= ?
      ${accountWhere}
      AND analytics_scope = 'traffic'
  `;

  const [rows] = await pool.execute<AnalyticsAggregateRow[]>(sql, params);
  return rows[0] ?? null;
}

export async function getAnalyticsTimeseries(filter: CanonicalFilter) {
  const params: SqlParam[] = [filter.source_key, filter.date_from, filter.date_to];
  const accountWhere = buildAccountWhereAnalytics(filter, params);
  const sql = `
    SELECT
      report_date as date,
      COALESCE(SUM(visits), 0) as visits,
      COALESCE(SUM(users), 0) as users,
      COALESCE(SUM(pageviews), 0) as pageviews,
      COALESCE(AVG(bounce_rate), 0) as bounce_rate
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = ?
      AND report_date >= ?
      AND report_date <= ?
      ${accountWhere}
      AND analytics_scope = 'traffic'
    GROUP BY report_date
    ORDER BY report_date
  `;

  const [rows] = await pool.execute<AnalyticsTimeseriesRow[]>(sql, params);
  return rows;
}

export async function getCampaignNames(
  sourceKey: string,
  search?: string,
  accountIds?: string[],
  options?: Omit<CampaignCatalogOptions, 'search' | 'accountIds'>,
) {
  return getCampaignCatalog(sourceKey, {
    search,
    accountIds,
    ...options,
  }).then((rows) => rows.map((row) => ({ id: row.id, name: row.name })));
}

export async function getCampaignCatalog(sourceKey: string, accountIdsOrOptions?: string[] | CampaignCatalogOptions) {
  const options: CampaignCatalogOptions = Array.isArray(accountIdsOrOptions)
    ? { accountIds: accountIdsOrOptions }
    : (accountIdsOrOptions ?? {});
  let sql = `
    SELECT DISTINCT
      c.platform_campaign_id AS id,
      c.campaign_name AS name
    FROM canonical_source_campaigns c
    WHERE c.source_key = ?
  `;
  const params: SqlParam[] = [sourceKey];

  const normalizedAccountIds = Array.isArray(options.accountIds)
    ? options.accountIds.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (normalizedAccountIds.length) {
    sql += ` AND c.platform_account_id IN (${normalizedAccountIds.map(() => '?').join(',')})`;
    params.push(...normalizedAccountIds);
  }

  if (options.search) {
    sql += ` AND c.campaign_name LIKE ?`;
    params.push(`%${options.search}%`);
  }

  if (options.requireFactInRange && options.dateFrom && options.dateTo) {
    sql += `
      AND EXISTS (
        SELECT 1
        FROM canonical_fact_ads_daily f
        WHERE f.source_key = ?
          AND f.platform_account_id = c.platform_account_id
          AND f.platform_campaign_id = c.platform_campaign_id
          AND f.fact_scope = ?
          AND f.report_date >= ?
          AND f.report_date <= ?
          AND (
            COALESCE(f.spend, 0) <> 0
            OR COALESCE(f.impressions, 0) <> 0
            OR COALESCE(f.clicks, 0) <> 0
            OR COALESCE(f.conversions, 0) <> 0
            OR COALESCE(f.views, 0) <> 0
            OR COALESCE(f.reach, 0) <> 0
          )
      )
    `;
    params.push(sourceKey, authorityFactScope(sourceKey), options.dateFrom, options.dateTo);
  }

  sql += ` ORDER BY c.campaign_name LIMIT 5000`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows as Array<{ id: string; name: string }>;
}

export async function countAdsCampaigns(filter: CanonicalFilter): Promise<number> {
  const params: SqlParam[] = [filter.source_key, authorityFactScope(filter.source_key), filter.date_from, filter.date_to];
  const accountWhere = buildAccountWhereAds(filter, params);
  const campaignWhere = buildCampaignWhere(filter, params);
  const sql = `
    SELECT COUNT(DISTINCT f.platform_campaign_id) AS total
    FROM canonical_fact_ads_daily f
    WHERE f.source_key = ?
      AND f.fact_scope = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      ${accountWhere}
      ${campaignWhere}
  `;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

export async function countPromopagesCampaigns(filter: PromopagesFilter): Promise<number> {
  const params: SqlParam[] = [filter.source_key, filter.date_from, filter.date_to];
  const accountWhere = buildAccountWherePromopages(filter, params);
  const sql = `
    SELECT COUNT(DISTINCT f.platform_campaign_id) AS total
    FROM canonical_fact_promopages_daily f
    WHERE f.source_key = ?
      AND f.report_date >= ?
      AND f.report_date <= ?
      ${accountWhere}
  `;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

export async function countAnalyticsAccounts(sourceKey: string, accountIds?: string[]): Promise<number> {
  const filter: CanonicalFilter = {
    source_key: sourceKey,
    date_from: '1900-01-01',
    date_to: '2999-12-31',
    account_ids: accountIds,
  };
  const params: SqlParam[] = [sourceKey];
  const accountWhere = buildAccountWhereAnalytics(filter, params);
  const sql = `
    SELECT COUNT(DISTINCT analytics_account_id) AS total
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = ?
      ${accountWhere}
      AND analytics_scope = 'traffic'
  `;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

export async function getActiveAccounts(
  sourceKey: string,
  sourceType: 'ads' | 'analytics' | 'promopages',
  options?: { search?: string; client_name?: string; date_from?: string; date_to?: string },
) {
  const search = String(options?.search ?? '').trim();
  const clientName = String(options?.client_name ?? '').trim();
  const dateFrom = String(options?.date_from ?? '').trim();
  const dateTo = String(options?.date_to ?? '').trim();
  const usePeriodFilter = dateFrom.length === 10 && dateTo.length === 10;

  if (sourceType === 'analytics') {
    let sql = `
      SELECT
        a.platform_account_id AS id,
        a.account_name AS name,
        MAX(f.report_date) AS latest_report_date,
        COUNT(*) AS fact_rows,
        0 AS total_spend
      FROM canonical_source_accounts a
      JOIN canonical_fact_site_analytics_daily f
        ON f.source_key = a.source_key
       AND f.analytics_account_id = a.platform_account_id
       AND f.analytics_scope = 'traffic'
      WHERE a.source_key = ?
        AND f.report_date >= DATE_SUB(
          (SELECT MAX(report_date)
             FROM canonical_fact_site_analytics_daily
            WHERE source_key = ?
              AND analytics_scope = 'traffic'),
          INTERVAL 60 DAY
        )
    `;
    const params: SqlParam[] = [sourceKey, sourceKey];

    if (search) {
      sql += ` AND a.account_name LIKE ?`;
      params.push(`%${search}%`);
    }

    sql += `
      GROUP BY a.platform_account_id, a.account_name
    `;

    const [rows] = await pool.query<ActiveAccountRow[]>(sql, params);
    return rows
      .map((row) => {
        const name = String(row.name ?? row.id);
        return {
          id: String(row.id),
          name,
          latest_report_date: toIsoDateOrNull(row.latest_report_date),
          fact_rows: Number(row.fact_rows ?? 0),
          total_spend: 0,
          suggested: isSuggestedAccount(name, clientName),
        };
      })
      .sort((a, b) => {
        if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  if (sourceType === 'promopages') {
    let sql = `
      SELECT
        a.platform_account_id AS id,
        a.account_name AS name,
        MAX(f.report_date) AS latest_report_date,
        COUNT(*) AS fact_rows,
        COALESCE(SUM(f.budget), 0) AS total_spend
      FROM canonical_source_accounts a
      JOIN canonical_fact_promopages_daily f
        ON f.source_key = a.source_key
       AND f.platform_account_id = a.platform_account_id
      WHERE a.source_key = ?
    `;
    const params: SqlParam[] = [sourceKey];

    if (usePeriodFilter) {
      sql += ` AND f.report_date >= ? AND f.report_date <= ?`;
      params.push(dateFrom, dateTo);
    } else {
      sql += ` AND f.report_date >= DATE_SUB(
        (SELECT MAX(report_date)
           FROM canonical_fact_promopages_daily
          WHERE source_key = ?),
        INTERVAL 60 DAY
      )`;
      params.push(sourceKey);
    }

    if (search) {
      sql += ` AND a.account_name LIKE ?`;
      params.push(`%${search}%`);
    }

    sql += ` GROUP BY a.source_key, a.platform_account_id, a.account_name`;
    const [rows] = await pool.execute<ActiveAccountRow[]>(sql, params);
    return rows
      .map((row) => {
        const name = String(row.name ?? row.id);
        return {
          id: String(row.id),
          name,
          latest_report_date: toIsoDateOrNull(row.latest_report_date),
          fact_rows: Number(row.fact_rows ?? 0),
          total_spend: Number(Number(row.total_spend ?? 0).toFixed(2)),
          suggested: isSuggestedAccount(name, clientName),
        };
      })
      .sort((a, b) => {
        if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
        if (b.total_spend !== a.total_spend) return b.total_spend - a.total_spend;
        return a.name.localeCompare(b.name);
      });
  }

  const factScope = authorityFactScope(sourceKey);
  const dateClause =
    usePeriodFilter
      ? `AND f.report_date >= ? AND f.report_date <= ?`
      : `AND f.report_date >= DATE_SUB(
        (SELECT MAX(report_date)
           FROM canonical_fact_ads_daily
          WHERE source_key = ?
            AND fact_scope = ?),
        INTERVAL 60 DAY
      )`;
  const isYandex = sourceKey === 'yandex_direct';
  const nameExpr = isYandex
    ? `CASE
        WHEN a.platform_account_id LIKE 'campaign::%' THEN
          COALESCE(
            (SELECT c.campaign_name FROM canonical_source_campaigns c
             WHERE c.source_key = a.source_key AND c.platform_account_id = a.platform_account_id
             LIMIT 1),
            a.account_name
          )
        ELSE a.account_name
      END`
    : 'a.account_name';
  let sql = `
    SELECT
      a.platform_account_id AS id,
      ${nameExpr} AS name,
      MAX(f.report_date) AS latest_report_date,
      COUNT(*) AS fact_rows,
      COALESCE(SUM(f.spend), 0) AS total_spend
    FROM canonical_source_accounts a
    JOIN canonical_fact_ads_daily f
      ON f.source_key = a.source_key
     AND f.platform_account_id = a.platform_account_id
     AND f.fact_scope = ?
    WHERE a.source_key = ?
      ${dateClause}
  `;
  const params: SqlParam[] = usePeriodFilter
    ? [factScope, sourceKey, dateFrom, dateTo]
    : [factScope, sourceKey, sourceKey, factScope];

  if (search) {
    const searchPattern = `%${search}%`;
    if (isYandex) {
      sql += ` AND (a.account_name LIKE ? OR a.platform_account_id IN (
        SELECT platform_account_id FROM canonical_source_campaigns
        WHERE source_key = ? AND platform_account_id = a.platform_account_id AND campaign_name LIKE ?
      ))`;
      params.push(searchPattern, sourceKey, searchPattern);
    } else {
      sql += ` AND a.account_name LIKE ?`;
      params.push(searchPattern);
    }
  }

  sql += `
    GROUP BY a.source_key, a.platform_account_id, a.account_name
  `;

  const [rows] = await pool.execute<ActiveAccountRow[]>(sql, params);
  return rows
    .map((row) => {
      const name = String(row.name ?? row.id);
      return {
        id: String(row.id),
        name,
        latest_report_date: toIsoDateOrNull(row.latest_report_date),
        fact_rows: Number(row.fact_rows ?? 0),
        total_spend: Number(Number(row.total_spend ?? 0).toFixed(2)),
        suggested: isSuggestedAccount(name, clientName),
      };
    })
    .sort((a, b) => {
      if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
      if (b.total_spend !== a.total_spend) return b.total_spend - a.total_spend;
      return a.name.localeCompare(b.name);
    });
}

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

type SqlParam = string | number | boolean | Date | null;

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

export async function getCampaignNames(sourceKey: string, search?: string, accountIds?: string[]) {
  let sql = `
    SELECT platform_campaign_id as id, campaign_name as name
    FROM canonical_source_campaigns
    WHERE source_key = ?
  `;
  const params: SqlParam[] = [sourceKey];

  const normalizedAccountIds = Array.isArray(accountIds)
    ? accountIds.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (normalizedAccountIds.length) {
    sql += ` AND platform_account_id IN (${normalizedAccountIds.map(() => '?').join(',')})`;
    params.push(...normalizedAccountIds);
  }

  if (search) {
    sql += ` AND campaign_name LIKE ?`;
    params.push(`%${search}%`);
  }

  sql += ` ORDER BY campaign_name LIMIT 500`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return rows as Array<{ id: string; name: string }>;
}

export async function getCampaignCatalog(sourceKey: string, accountIds?: string[]) {
  let sql = `
    SELECT
      platform_campaign_id AS id,
      campaign_name AS name
    FROM canonical_source_campaigns
    WHERE source_key = ?
  `;
  const params: SqlParam[] = [sourceKey];

  const normalizedAccountIds = Array.isArray(accountIds)
    ? accountIds.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (normalizedAccountIds.length) {
    sql += ` AND platform_account_id IN (${normalizedAccountIds.map(() => '?').join(',')})`;
    params.push(...normalizedAccountIds);
  }

  sql += ` ORDER BY campaign_name LIMIT 5000`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
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
  sourceType: 'ads' | 'analytics',
  options?: { search?: string; client_name?: string },
) {
  const search = String(options?.search ?? '').trim();
  const clientName = String(options?.client_name ?? '').trim();

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

    const [rows] = await pool.execute<ActiveAccountRow[]>(sql, params);
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

  const factScope = authorityFactScope(sourceKey);
  let sql = `
    SELECT
      a.platform_account_id AS id,
      a.account_name AS name,
      MAX(f.report_date) AS latest_report_date,
      COUNT(*) AS fact_rows,
      COALESCE(SUM(f.spend), 0) AS total_spend
    FROM canonical_source_accounts a
    JOIN canonical_fact_ads_daily f
      ON f.source_key = a.source_key
     AND f.platform_account_id = a.platform_account_id
     AND f.fact_scope = ?
    WHERE a.source_key = ?
      AND f.report_date >= DATE_SUB(
        (SELECT MAX(report_date)
           FROM canonical_fact_ads_daily
          WHERE source_key = ?
            AND fact_scope = ?),
        INTERVAL 60 DAY
      )
  `;
  const params: SqlParam[] = [factScope, sourceKey, sourceKey, factScope];

  if (search) {
    sql += ` AND a.account_name LIKE ?`;
    params.push(`%${search}%`);
  }

  sql += `
    GROUP BY a.platform_account_id, a.account_name
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

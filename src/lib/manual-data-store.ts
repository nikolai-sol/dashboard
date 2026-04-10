import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import type { ManualDataRow } from "@/lib/manual-data-fetcher";

export type ConfirmedManualDataMeta = {
  status: "confirmed";
  confirmed_at: string;
  rows: number;
  date_from: string | null;
  date_to: string | null;
  source_upload_name: string | null;
};

type ManualFactRow = RowDataPacket & {
  report_date: string;
  platform: string;
  channel: string;
  impressions: number | string | null;
  clicks: number | string | null;
  spend: number | string | null;
  views: number | string | null;
  conversions: number | string | null;
  reach: number | string | null;
  sessions: number | string | null;
};

export type StoredManualFactRow = {
  date: string;
  platform: string;
  channel: string;
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
  reach: number;
  sessions: number;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildManualSourceKey(): string {
  return `manual_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function aggregateManualRows(rows: ManualDataRow[]): StoredManualFactRow[] {
  const grouped = new Map<string, StoredManualFactRow>();

  for (const row of rows) {
    const date = String(row.date ?? "").trim();
    const platform = String(row.platform ?? "").trim().toLowerCase();
    const channel = String(row.channel ?? "").trim();
    if (!date || !platform || !channel) continue;

    const key = `${date}||${platform}||${channel}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date,
        platform,
        channel,
        impressions: 0,
        clicks: 0,
        spend: 0,
        views: 0,
        conversions: 0,
        reach: 0,
        sessions: 0,
      });
    }

    const current = grouped.get(key)!;
    current.impressions += asNumber(row.impressions);
    current.clicks += asNumber(row.clicks);
    current.spend += asNumber(row.spend);
    current.views += asNumber(row.views);
    current.conversions += asNumber(row.conversions);
    current.reach += asNumber(row.reach);
    current.sessions += asNumber(row.sessions);
  }

  return Array.from(grouped.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform) || a.channel.localeCompare(b.channel),
  );
}

export function buildConfirmedManualDataMeta(
  rows: StoredManualFactRow[],
  sourceUploadName: string | null,
): ConfirmedManualDataMeta {
  const dates = rows.map((row) => row.date).sort();
  return {
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    rows: rows.length,
    date_from: dates[0] ?? null,
    date_to: dates[dates.length - 1] ?? null,
    source_upload_name: sourceUploadName,
  };
}

export async function replaceDashboardManualFacts(
  conn: PoolConnection,
  dashboardId: number,
  manualSourceKey: string,
  rows: StoredManualFactRow[],
  sourceUploadName: string | null,
): Promise<void> {
  await conn.execute(
    `DELETE FROM dashboard_manual_facts_daily
     WHERE dashboard_id = ? AND manual_source_key = ?`,
    [dashboardId, manualSourceKey],
  );

  if (!rows.length) return;

  for (const row of rows) {
    await conn.execute(
      `INSERT INTO dashboard_manual_facts_daily (
         dashboard_id,
         manual_source_key,
         report_date,
         platform,
         channel,
         impressions,
         clicks,
         spend,
         views,
         conversions,
         reach,
         sessions,
         source_upload_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dashboardId,
        manualSourceKey,
        row.date,
        row.platform,
        row.channel,
        row.impressions,
        row.clicks,
        Number(row.spend.toFixed(6)),
        row.views,
        row.conversions,
        row.reach,
        row.sessions,
        sourceUploadName,
      ],
    );
  }
}

export async function deleteDashboardManualFacts(
  conn: PoolConnection,
  dashboardId: number,
  manualSourceKey: string,
): Promise<void> {
  await conn.execute(
    `DELETE FROM dashboard_manual_facts_daily
     WHERE dashboard_id = ? AND manual_source_key = ?`,
    [dashboardId, manualSourceKey],
  );
}

export async function deleteDashboardManualFactsExceptKeys(
  conn: PoolConnection,
  dashboardId: number,
  retainedKeys: string[],
): Promise<void> {
  if (!retainedKeys.length) {
    await conn.execute(`DELETE FROM dashboard_manual_facts_daily WHERE dashboard_id = ?`, [dashboardId]);
    return;
  }

  const placeholders = retainedKeys.map(() => "?").join(", ");
  await conn.execute(
    `DELETE FROM dashboard_manual_facts_daily
     WHERE dashboard_id = ?
       AND manual_source_key NOT IN (${placeholders})`,
    [dashboardId, ...retainedKeys],
  );
}

export async function loadDashboardManualFacts(
  dashboardId: number,
  manualSourceKey: string,
  from: string,
  to: string,
): Promise<StoredManualFactRow[]> {
  const [rows] = await pool.execute<ManualFactRow[]>(
    `SELECT report_date, platform, channel, impressions, clicks, spend, views, conversions, reach, sessions
     FROM dashboard_manual_facts_daily
     WHERE dashboard_id = ?
       AND manual_source_key = ?
       AND report_date BETWEEN ? AND ?
     ORDER BY report_date, platform, channel`,
    [dashboardId, manualSourceKey, from, to],
  );

  return rows.map((row) => ({
    date: String(row.report_date),
    platform: String(row.platform ?? "").trim().toLowerCase(),
    channel: String(row.channel ?? "").trim(),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    spend: asNumber(row.spend),
    views: Math.round(asNumber(row.views)),
    conversions: Math.round(asNumber(row.conversions)),
    reach: Math.round(asNumber(row.reach)),
    sessions: Math.round(asNumber(row.sessions)),
  }));
}

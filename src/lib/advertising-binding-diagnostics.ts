import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "./db";
import {
  loadBoundAdvertisingFacts,
  type AdvertisingBindingReadModel,
} from "./advertising-binding-read-model";

type SqlExecutor = Pick<PoolConnection, "execute">;

export type AdvertisingCoverageRow = {
  source_key: string;
  platform_account_id: string;
  report_date: string | Date;
  coverage_state: "complete_with_data" | "complete_empty" | "not_due" | "failed" | "missing";
};

type FactTotals = {
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
  reach: number;
};

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function addTotals(target: FactTotals, source: FactTotals): void {
  target.impressions += source.impressions;
  target.clicks += source.clicks;
  target.spend += source.spend;
  target.views += source.views;
  target.conversions += source.conversions;
  target.reach += source.reach;
}

function emptyTotals(): FactTotals {
  return { impressions: 0, clicks: 0, spend: 0, views: 0, conversions: 0, reach: 0 };
}

function datesBetween(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    days.push(cursor.toISOString().slice(0, 10));
    if (days.length > 366) throw new Error("binding diagnostics range cannot exceed 366 days");
  }
  return days;
}

export function buildAdvertisingBindingDiagnostics(
  readModel: AdvertisingBindingReadModel,
  coverageRows: AdvertisingCoverageRow[],
  from: string,
  to: string,
  asOf = new Date().toISOString().slice(0, 10),
) {
  const unbound = new Map<string, {
    canonical_campaign_id: number | null;
    source_key: string;
    platform_account_id: string;
    platform_campaign_id: string;
    campaign_name: string;
    first_date: string;
    last_date: string;
    fact_totals: FactTotals;
  }>();
  for (const fact of readModel.unboundFacts) {
    const key = `${fact.sourceKey}\u0000${fact.platformAccountId}\u0000${fact.platformCampaignId}`;
    if (!unbound.has(key)) {
      unbound.set(key, {
        canonical_campaign_id: fact.canonicalCampaignId,
        source_key: fact.sourceKey,
        platform_account_id: fact.platformAccountId,
        platform_campaign_id: fact.platformCampaignId,
        campaign_name: fact.campaignName,
        first_date: fact.date,
        last_date: fact.date,
        fact_totals: emptyTotals(),
      });
    }
    const row = unbound.get(key)!;
    if (fact.date < row.first_date) row.first_date = fact.date;
    if (fact.date > row.last_date) row.last_date = fact.date;
    addTotals(row.fact_totals, fact);
  }

  const coverageByScope = new Map(
    coverageRows.map((row) => [
      `${String(row.source_key)}\u0000${String(row.platform_account_id)}\u0000${isoDate(row.report_date)}`,
      row.coverage_state,
    ] as const),
  );
  const missingCoverageDates: Array<{
    source_key: string;
    platform_account_id: string;
    report_date: string;
    coverage_state: "failed" | "missing";
  }> = [];
  const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
  const yesterday = new Date(asOfDate.getTime() - 86_400_000).toISOString().slice(0, 10);
  const dueThrough = to < yesterday ? to : yesterday;
  for (const account of readModel.selectedAccounts) {
    for (const date of from <= dueThrough ? datesBetween(from, dueThrough) : []) {
      const state = coverageByScope.get(`${account.sourceKey}\u0000${account.platformAccountId}\u0000${date}`);
      if (state === "failed" || state === "missing" || state === undefined) {
        missingCoverageDates.push({
          source_key: account.sourceKey,
          platform_account_id: account.platformAccountId,
          report_date: date,
          coverage_state: state === "failed" ? "failed" : "missing",
        });
      }
    }
  }

  const totalFacts = emptyTotals();
  const byLine = Array.from(readModel.lines.values()).map((line) => {
    const values = {
      impressions: line.impressions,
      clicks: line.clicks,
      spend: line.spend,
      views: line.views,
      conversions: line.conversions,
      reach: line.reach,
    };
    addTotals(totalFacts, values);
    return { line_key: line.lineKey, channel: line.channel, ...values };
  });

  return {
    unresolved_legacy_bindings: readModel.unresolvedLegacyBindings.map((binding) => ({
      line_key: binding.lineKey,
      channel: binding.channel,
      source_key: binding.sourceKey,
      platform_campaign_id: binding.platformCampaignId,
    })),
    unbound_campaigns: Array.from(unbound.values()).sort(
      (left, right) =>
        left.source_key.localeCompare(right.source_key) ||
        left.platform_account_id.localeCompare(right.platform_account_id) ||
        left.platform_campaign_id.localeCompare(right.platform_campaign_id),
    ),
    missing_coverage_dates: missingCoverageDates,
    fact_totals: { total: totalFacts, by_line: byLine },
  };
}

export async function loadAdvertisingBindingDiagnostics(
  dashboardId: number,
  from: string,
  to: string,
  executor: SqlExecutor = pool as unknown as SqlExecutor,
) {
  const readModel = await loadBoundAdvertisingFacts(dashboardId, from, to, executor);
  let coverageRows: AdvertisingCoverageRow[] = [];
  if (readModel.selectedAccounts.length) {
    const accountFilter = readModel.selectedAccounts
      .map(() => "(source_key = ? AND platform_account_id = ?)")
      .join(" OR ");
    const params = readModel.selectedAccounts.flatMap((account) => [account.sourceKey, account.platformAccountId]);
    const [rows] = await executor.execute<Array<RowDataPacket & AdvertisingCoverageRow>>(
      `SELECT source_key, platform_account_id, report_date, coverage_state
       FROM canonical_ad_coverage_daily
       WHERE report_date BETWEEN ? AND ?
         AND (${accountFilter})
       ORDER BY report_date, source_key, platform_account_id`,
      [from, to, ...params],
    );
    coverageRows = rows;
  }
  return buildAdvertisingBindingDiagnostics(readModel, coverageRows, from, to);
}

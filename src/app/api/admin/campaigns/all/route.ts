import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { loadDashboardWithSources } from "@/lib/admin-dashboards";
import { getCampaignCatalog, type CanonicalCampaignCatalogItem } from "@/lib/canonical-adapter";
import { resolveSourceKey } from "@/lib/source-mapping";
import { dashboardSourceAccountLabel } from "@/lib/dashboard-source-display";
import type { DashboardFilterInput } from "@/lib/admin-dashboards";

type SourceSpec = {
  platform?: string;
  source_key?: string;
  account_ids?: string[];
  account_display_name?: string;
  filters?: DashboardFilterInput[];
};

type CampaignLoaderDependencies = {
  getCampaignCatalog: (
    sourceKey: string,
    options: { accountIds: string[]; campaignFilter?: DashboardFilterInput },
  ) => Promise<CanonicalCampaignCatalogItem[]>;
};

const defaultDependencies: CampaignLoaderDependencies = { getCampaignCatalog };

export async function loadCampaigns(
  dashboardId: number,
  _dateFrom: string,
  _dateTo: string,
  sourceSpecs: SourceSpec[],
  dependencies: CampaignLoaderDependencies = defaultDependencies,
) {
  const resolvedSources: Array<{
    source_key: string;
    account_ids?: string[];
    account_display_name?: string;
    filters?: DashboardFilterInput[];
  }> = [];

  if (Number.isFinite(dashboardId) && dashboardId > 0) {
    const conn = await pool.getConnection();
    try {
      const dashboard = await loadDashboardWithSources(conn, dashboardId);
      if (!dashboard) {
        return { campaigns: [], total: 0, message: "Dashboard not found" };
      }
      dashboard.sources
        .filter((source) => source.role === "actual" && source.platform !== "leads")
        .forEach((source) => {
          const sourceKey = String(
            source.source_config?.source_key ?? resolveSourceKey(source.platform),
          ).trim();
          if (!sourceKey || sourceKey === "manual_data") return;
          const configuredAccounts = Array.isArray(source.source_config?.account_ids)
            ? source.source_config.account_ids
            : [source.source_config?.platform_account_id];
          const accountIds = configuredAccounts
            .map((item) => String(item ?? "").trim())
            .filter(Boolean);
          resolvedSources.push({ source_key: sourceKey, account_ids: accountIds, account_display_name: String(source.source_config?.account_display_name ?? '').trim() || undefined, filters: source.filters });
        });
    } finally {
      conn.release();
    }
  } else if (sourceSpecs.length) {
    sourceSpecs.forEach((source) => {
      const sourceKey = String(source.source_key ?? resolveSourceKey(String(source.platform ?? ""))).trim();
      if (!sourceKey) return;
      if (sourceKey === "leads" || source.platform === "leads") {
        return;
      }
      if (sourceKey === "manual_data" || source.platform === "manual_data") {
        return;
      } else {
        const accountIds = Array.isArray(source.account_ids)
          ? source.account_ids.map((item) => String(item).trim()).filter(Boolean)
          : [];
        resolvedSources.push({ source_key: sourceKey, account_ids: accountIds, account_display_name: source.account_display_name, filters: source.filters });
      }
    });
  }

  const dedupedSources = new Map<string, { sourceKey: string; accountIds: string[]; accountDisplayName?: string; filters?: DashboardFilterInput[] }>();
  for (const source of resolvedSources) {
    const accountIds = Array.isArray(source.account_ids)
      ? source.account_ids.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (accountIds.length === 0) continue;
    const key = JSON.stringify([source.source_key, accountIds, source.account_display_name ?? '', source.filters ?? []]);
    dedupedSources.set(key, { sourceKey: source.source_key, accountIds, accountDisplayName: source.account_display_name, filters: source.filters });
  }

  const canonicalCampaigns = (
    await Promise.all(
      Array.from(dedupedSources.values()).map(async (source) => {
        if (!source.accountIds.length) return [];
        const campaignFilter = source.filters?.find((filter) => filter.filter_type === 'id_list');
        const items = await dependencies.getCampaignCatalog(source.sourceKey, { accountIds: source.accountIds, campaignFilter });
        return items.map((item) => ({
          canonical_campaign_id: item.canonicalCampaignId,
          source_key: item.sourceKey,
          platform_account_id: item.platformAccountId,
          account_name: dashboardSourceAccountLabel({ account_ids: source.accountIds, account_display_name: source.accountDisplayName }, item.platformAccountId, item.accountName),
          platform_campaign_id: item.platformCampaignId,
          campaign_name: item.campaignName,
          display_label: `${item.campaignName} \u00b7 ${item.platformCampaignId} \u00b7 ${dashboardSourceAccountLabel({ account_ids: source.accountIds, account_display_name: source.accountDisplayName }, item.platformAccountId, item.accountName)}`,
        }));
      }),
    )
  ).flat();
  return { campaigns: canonicalCampaigns, total: canonicalCampaigns.length };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const dashboardId = Number(url.searchParams.get("dashboard_id") ?? "");
    const dateFrom = String(url.searchParams.get("date_from") ?? "").trim();
    const dateTo = String(url.searchParams.get("date_to") ?? "").trim();
    const sourceKeys = String(url.searchParams.get("source_keys") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    // For backward compatibility: support GET without sources body for simple cases
    if (!dashboardId && sourceKeys.length === 0) {
      return NextResponse.json({ campaigns: [], total: 0 });
    }

    const result = await loadCampaigns(
      dashboardId,
      dateFrom,
      dateTo,
      [],
    );

    if (result.message === "Dashboard not found") {
      return NextResponse.json(result, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load campaigns", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      dashboard_id?: number;
      date_from?: string;
      date_to?: string;
      sources?: SourceSpec[];
    };

    const dashboardId = Number(body.dashboard_id ?? 0);
    const dateFrom = String(body.date_from ?? "").trim();
    const dateTo = String(body.date_to ?? "").trim();
    const sourceSpecs = Array.isArray(body.sources) ? body.sources : [];

    const result = await loadCampaigns(
      dashboardId,
      dateFrom,
      dateTo,
      sourceSpecs,
    );

    if (result.message === "Dashboard not found") {
      return NextResponse.json(result, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load campaigns", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { loadDashboardWithSources } from "@/lib/admin-dashboards";
import { getCampaignCatalog } from "@/lib/canonical-adapter";
import { fetchManualDataFromSourceConfig, aggregateByChannel } from "@/lib/manual-data-fetcher";
import { resolveSourceKey } from "@/lib/source-mapping";

type SourceSpec = {
  platform?: string;
  source_key?: string;
  account_ids?: string[];
  sheet_url?: string;
  upload_file?: unknown;
  default_platform?: string;
  default_channel?: string;
};

async function loadCampaigns(
  dashboardId: number,
  dateFrom: string,
  dateTo: string,
  sourceSpecs: SourceSpec[],
) {
  const resolvedSources: Array<{
    source_key: string;
    account_ids?: string[];
    sheet_url?: string;
    upload_file?: unknown;
    default_platform?: string;
    default_channel?: string;
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
          const sourceKey = resolveSourceKey(source.platform);
          if (source.platform === "manual_data") {
            const sheetUrl = String(source.source_config?.sheet_url ?? "").trim();
            resolvedSources.push({
              source_key: "manual_data",
              account_ids: [],
              sheet_url: sheetUrl,
              upload_file: source.source_config?.upload_file,
              default_platform: String(source.source_config?.platform ?? "").trim(),
              default_channel: String(source.source_config?.channel ?? "").trim(),
            });
          } else {
            const accountIds = Array.isArray(source.source_config?.account_ids)
              ? source.source_config.account_ids.map((item) => String(item).trim()).filter(Boolean)
              : [];
            resolvedSources.push({ source_key: sourceKey, account_ids: accountIds });
          }
        });
      const config = (dashboard.config ?? {}) as Record<string, unknown>;
      dateFrom = dateFrom || String(config.period_from ?? "").trim();
      dateTo = dateTo || String(config.period_to ?? "").trim();
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
        resolvedSources.push({
          source_key: "manual_data",
          account_ids: [],
          sheet_url: String(source.sheet_url ?? "").trim(),
          upload_file: source.upload_file,
          default_platform: String(source.default_platform ?? "").trim(),
          default_channel: String(source.default_channel ?? "").trim(),
        });
      } else {
        const accountIds = Array.isArray(source.account_ids)
          ? source.account_ids.map((item) => String(item).trim()).filter(Boolean)
          : [];
        resolvedSources.push({ source_key: sourceKey, account_ids: accountIds });
      }
    });
  }

  const manualSources = resolvedSources.filter(
    (s) => s.source_key === "manual_data" && (s.sheet_url || s.upload_file),
  );
  const canonicalSources = resolvedSources.filter((s) => s.source_key !== "manual_data");

  const dedupedSources = new Map<string, string[]>();
  for (const source of canonicalSources) {
    const accountIds = Array.isArray(source.account_ids)
      ? source.account_ids.map((item) => String(item).trim()).filter(Boolean)
      : [];
    // Bindings must respect Source-step account selection; empty means no catalog for that source.
    if (!accountIds.length) {
      continue;
    }
    const existing = dedupedSources.get(source.source_key) ?? [];
    const merged = [...existing, ...accountIds];
    dedupedSources.set(source.source_key, Array.from(new Set(merged)));
  }

  const canonicalCampaigns = (
    await Promise.all(
      Array.from(dedupedSources.entries()).map(async ([sourceKey, accountIds]) => {
        const items = await getCampaignCatalog(sourceKey, {
          accountIds,
          dateFrom,
          dateTo,
          requireFactInRange: sourceKey === "yandex_direct" && Boolean(dateFrom && dateTo),
        });
        return items.map((item) => ({
          source_key: sourceKey,
          platform_campaign_id: String(item.id),
          campaign_name: String(item.name),
        }));
      }),
    )
  ).flat();

  const manualCampaigns: Array<{ source_key: string; platform_campaign_id: string; campaign_name: string }> = [];
  for (const source of manualSources) {
    try {
      const rows = await fetchManualDataFromSourceConfig({
        sheet_url: source.sheet_url,
        upload_file: source.upload_file,
        platform: source.default_platform,
        channel: source.default_channel,
      });
      const byChannel = aggregateByChannel(rows);
      for (const ch of byChannel) {
        manualCampaigns.push({
          source_key: "manual_data",
          platform_campaign_id: `manual:${ch.platform}|${ch.channel}`,
          campaign_name: `${ch.platform} / ${ch.channel}`,
        });
      }
    } catch {
      // skip failed fetch
    }
  }

  const campaigns = [...canonicalCampaigns, ...manualCampaigns];

  return { campaigns, total: campaigns.length };
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

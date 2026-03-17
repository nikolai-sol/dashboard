import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { loadDashboardWithSources } from "@/lib/admin-dashboards";
import { getCampaignCatalog } from "@/lib/canonical-adapter";
import { resolveSourceKey } from "@/lib/source-mapping";

type SourceSpec = {
  platform?: string;
  source_key?: string;
  account_ids?: string[];
};

function parseSourcesQuery(value: string): SourceSpec[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as SourceSpec[]) : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const dashboardId = Number(url.searchParams.get("dashboard_id") ?? "");
    const sourceKeys = String(url.searchParams.get("source_keys") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const sourceSpecs = parseSourcesQuery(String(url.searchParams.get("sources") ?? ""));

    const resolvedSources: Array<{ source_key: string; account_ids?: string[] }> = [];

    if (Number.isFinite(dashboardId) && dashboardId > 0) {
      const conn = await pool.getConnection();
      try {
        const dashboard = await loadDashboardWithSources(conn, dashboardId);
        if (!dashboard) {
          return NextResponse.json({ campaigns: [], total: 0, message: "Dashboard not found" }, { status: 404 });
        }
        dashboard.sources
          .filter((source) => source.role === "actual")
          .forEach((source) => {
            const sourceKey = resolveSourceKey(source.platform);
            const accountIds = Array.isArray(source.source_config?.account_ids)
              ? source.source_config.account_ids.map((item) => String(item).trim()).filter(Boolean)
              : [];
            resolvedSources.push({ source_key: sourceKey, account_ids: accountIds });
          });
      } finally {
        conn.release();
      }
    } else if (sourceSpecs.length) {
      sourceSpecs.forEach((source) => {
        const sourceKey = String(source.source_key ?? resolveSourceKey(String(source.platform ?? ""))).trim();
        if (!sourceKey) return;
        const accountIds = Array.isArray(source.account_ids)
          ? source.account_ids.map((item) => String(item).trim()).filter(Boolean)
          : [];
        resolvedSources.push({ source_key: sourceKey, account_ids: accountIds });
      });
    } else {
      sourceKeys.forEach((sourceKey) => {
        resolvedSources.push({ source_key: sourceKey });
      });
    }

    const dedupedSources = new Map<string, string[]>();
    for (const source of resolvedSources) {
      const existing = dedupedSources.get(source.source_key) ?? [];
      const merged = [...existing, ...(source.account_ids ?? [])];
      dedupedSources.set(source.source_key, Array.from(new Set(merged)));
    }

    const campaigns = (
      await Promise.all(
        Array.from(dedupedSources.entries()).map(async ([sourceKey, accountIds]) => {
          const items = await getCampaignCatalog(sourceKey, accountIds);
          return items.map((item) => ({
            source_key: sourceKey,
            platform_campaign_id: String(item.id),
            campaign_name: String(item.name),
          }));
        }),
      )
    ).flat();

    return NextResponse.json({
      campaigns,
      total: campaigns.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load campaigns", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

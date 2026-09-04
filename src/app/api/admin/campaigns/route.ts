import { NextResponse } from "next/server";
import { getSchemaMetaByPlatform } from "@/lib/schema-registry";
import { getCampaignCatalog } from "@/lib/canonical-adapter";
import { resolveSourceKey, resolveSourceType } from "@/lib/source-mapping";

function parseAccountIds(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const platform = String(url.searchParams.get("platform") ?? "")
      .trim()
      .toLowerCase();
    const sourcePlatform = resolveSourceKey(platform);
    const search = String(url.searchParams.get("search") ?? "").trim();
    const accountIds = parseAccountIds(String(url.searchParams.get("account_ids") ?? ""));
    if (!platform) {
      return NextResponse.json({ error: "platform query param is required" }, { status: 400 });
    }

    const schemaMeta = getSchemaMetaByPlatform(sourcePlatform);
    if (!schemaMeta) {
      return NextResponse.json({ campaigns: [], total: 0, message: "Platform schema not found" });
    }

    const sourceType = schemaMeta.source_type ?? resolveSourceType(schemaMeta.source_key);
    if (sourceType !== "ads" && sourceType !== "promopages") {
      return NextResponse.json({
        campaigns: [],
        total: 0,
        message: "Platform does not use campaign dictionary",
      });
    }
    const campaigns = await getCampaignCatalog(schemaMeta.source_key, { search, accountIds });
    const result = campaigns.map((row) => {
      const id = row.platformCampaignId;
      return {
        canonical_campaign_id: row.canonicalCampaignId,
        source_key: row.sourceKey,
        platform_account_id: row.platformAccountId,
        account_name: row.accountName,
        platform_campaign_id: row.platformCampaignId,
        campaign_name: row.campaignName,
         display_label: `${row.campaignName} \u00b7 ${row.platformCampaignId} \u00b7 ${row.accountName}`,
         id,
        name: row.campaignName,
        platform: sourcePlatform,
         copyable_id: id,
      };
    });

    return NextResponse.json({
      campaigns: result,
      total: result.length,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "Failed to load campaigns", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

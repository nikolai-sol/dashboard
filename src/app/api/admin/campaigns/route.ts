import { NextResponse } from "next/server";
import { getSchemaMetaByPlatform } from "@/lib/schema-registry";
import { getCampaignNames } from "@/lib/canonical-adapter";
import { resolveSourceType } from "@/lib/source-mapping";

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
    const search = String(url.searchParams.get("search") ?? "").trim();
    const accountIds = parseAccountIds(String(url.searchParams.get("account_ids") ?? ""));
    const dateFrom = String(url.searchParams.get("date_from") ?? "").trim();
    const dateTo = String(url.searchParams.get("date_to") ?? "").trim();

    if (!platform) {
      return NextResponse.json({ error: "platform query param is required" }, { status: 400 });
    }

    const schemaMeta = getSchemaMetaByPlatform(platform);
    if (!schemaMeta) {
      return NextResponse.json({ campaigns: [], total: 0, message: "Platform schema not found" });
    }

    const sourceType = schemaMeta.source_type ?? resolveSourceType(schemaMeta.source_key);
    if (sourceType !== "ads") {
      return NextResponse.json({
        campaigns: [],
        total: 0,
        message: "Platform does not use campaign dictionary",
      });
    }
    const campaigns = await getCampaignNames(schemaMeta.source_key, search, accountIds, {
      dateFrom,
      dateTo,
      requireFactInRange: schemaMeta.source_key === "yandex_direct" && Boolean(dateFrom && dateTo),
    });
    const result = campaigns.map((row) => {
      const id = String(row.id);
      return {
        id,
        name: String(row.name),
        platform,
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

import { NextResponse } from "next/server";
import { getActiveAccounts } from "@/lib/canonical-adapter";
import { getSchemaMetaByPlatform } from "@/lib/schema-registry";
import { resolveSourceType } from "@/lib/source-mapping";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const platform = String(url.searchParams.get("platform") ?? "")
      .trim()
      .toLowerCase();
    const search = String(url.searchParams.get("search") ?? "").trim();
    const clientName = String(url.searchParams.get("client_name") ?? "").trim();
    const dateFrom = String(url.searchParams.get("date_from") ?? "").trim();
    const dateTo = String(url.searchParams.get("date_to") ?? "").trim();

    if (!platform) {
      return NextResponse.json({ error: "platform query param is required" }, { status: 400 });
    }

    const schemaMeta = getSchemaMetaByPlatform(platform);
    if (!schemaMeta) {
      return NextResponse.json({ accounts: [], total: 0, message: "Platform schema not found" });
    }

    const sourceType = schemaMeta.source_type ?? resolveSourceType(schemaMeta.source_key);
    if (sourceType === "gsheet" || sourceType === "manual" || sourceType === "leads") {
      return NextResponse.json({
        accounts: [],
        total: 0,
        message: "Platform does not use canonical account dictionary",
      });
    }

    const isYandex = schemaMeta.source_key === "yandex_direct";
    const accounts = await getActiveAccounts(schemaMeta.source_key, sourceType, {
      search,
      client_name: clientName,
      date_from: isYandex && dateFrom && dateTo ? dateFrom : undefined,
      date_to: isYandex && dateFrom && dateTo ? dateTo : undefined,
    });

    return NextResponse.json({
      accounts,
      total: accounts.length,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "Failed to load accounts", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { fetchManualData, fetchManualDataFromSourceConfig } from "@/lib/manual-data-fetcher";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sheetUrl = url.searchParams.get("url");
  const defaultPlatform = String(url.searchParams.get("platform") ?? "").trim();
  const defaultChannel = String(url.searchParams.get("channel") ?? "").trim();
  if (!sheetUrl || !sheetUrl.startsWith("http")) {
    return NextResponse.json({ error: "Valid URL is required" }, { status: 400 });
  }

  try {
    const rows = await fetchManualData(sheetUrl, { defaultPlatform, defaultChannel });
    const preview = rows.slice(0, 5);
    return NextResponse.json({ rows: preview });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch manual data", details: String(error) },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { source_config?: unknown };
  const sourceConfig = body.source_config;

  try {
    const rows = await fetchManualDataFromSourceConfig(
      sourceConfig && typeof sourceConfig === "object" ? (sourceConfig as Record<string, unknown>) : null,
    );
    return NextResponse.json({ rows: rows.slice(0, 5) });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch manual data", details: String(error) },
      { status: 502 },
    );
  }
}

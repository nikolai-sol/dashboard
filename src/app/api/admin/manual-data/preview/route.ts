import { NextResponse } from "next/server";
import { fetchManualData } from "@/lib/manual-data-fetcher";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sheetUrl = url.searchParams.get("url");
  if (!sheetUrl || !sheetUrl.startsWith("http")) {
    return NextResponse.json({ error: "Valid URL is required" }, { status: 400 });
  }

  try {
    const rows = await fetchManualData(sheetUrl);
    const preview = rows.slice(0, 5);
    return NextResponse.json({ rows: preview });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch manual data", details: String(error) },
      { status: 502 },
    );
  }
}

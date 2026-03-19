import { NextResponse } from "next/server";
import { fetchCustomTable } from "@/lib/gsheet-fetcher";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sheetUrl = url.searchParams.get("url");
  if (!sheetUrl || !sheetUrl.startsWith("http")) {
    return NextResponse.json({ error: "Valid URL is required" }, { status: 400 });
  }

  try {
    const { headers, rows } = await fetchCustomTable(sheetUrl);
    const previewRows = rows.slice(0, 5);
    return NextResponse.json({ headers, rows: previewRows });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch CSV", details: String(error) },
      { status: 502 },
    );
  }
}
